import { OutboxStatus, EmailStatus } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { getEmailQueue, defaultJobOptions, EmailJobData } from '../queues/email.queue';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class OutboxSweeperService {
  private isRunning = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info(
      { intervalMs: env.OUTBOX_SWEEPER_INTERVAL_MS },
      'Starting Transactional Outbox Sweeper service'
    );

    // Initial sweep immediately on startup
    this.sweepOutbox().catch((err) => {
      logger.error({ err }, 'Initial outbox sweep encountered an error');
    });

    this.intervalTimer = setInterval(async () => {
      try {
        await this.sweepOutbox();
        await this.recoverStalledProcessingEmails();
      } catch (err) {
        logger.error({ err }, 'Error during outbox sweeper cycle');
      }
    }, env.OUTBOX_SWEEPER_INTERVAL_MS);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
    logger.info('Outbox Sweeper service stopped');
  }

  /**
   * Sweeps pending outbox entries that failed initial Redis queueing
   */
  public async sweepOutbox(): Promise<number> {
    const queue = getEmailQueue();
    // Look for records pending for more than 5 seconds
    const threshold = new Date(Date.now() - 5000);

    const pendingRecords = await prisma.emailOutbox.findMany({
      where: {
        status: OutboxStatus.PENDING,
        createdAt: { lte: threshold },
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    if (pendingRecords.length === 0) {
      return 0;
    }

    logger.info({ count: pendingRecords.length }, 'Outbox sweeper found pending records to enqueue');

    let recovered = 0;
    for (const record of pendingRecords) {
      try {
        const email = await prisma.scheduledEmail.findUnique({
          where: { id: record.emailId },
        });

        if (!email || email.status !== EmailStatus.SCHEDULED) {
          // If cancelled or already processed, mark outbox ENQUEUED
          await prisma.emailOutbox.update({
            where: { id: record.id },
            data: { status: OutboxStatus.ENQUEUED },
          });
          continue;
        }

        const payload = record.payload as unknown as EmailJobData;
        const delayMs = Math.max(0, email.nextEligibleAt.getTime() - Date.now());

        // Check if job already exists in BullMQ (stable job ID)
        const existingJob = await queue.getJob(record.emailId);
        if (!existingJob) {
          await queue.add('send-email', payload, defaultJobOptions(record.emailId, delayMs));
        }

        await prisma.$transaction([
          prisma.emailOutbox.update({
            where: { id: record.id },
            data: { status: OutboxStatus.ENQUEUED },
          }),
          prisma.scheduledEmail.update({
            where: { id: email.id },
            data: { bullJobId: record.emailId },
          }),
        ]);

        recovered++;
      } catch (err: any) {
        logger.error({ err, outboxId: record.id }, 'Failed to recover outbox record');
        await prisma.emailOutbox.update({
          where: { id: record.id },
          data: {
            retries: { increment: 1 },
            lastError: err.message,
          },
        });
      }
    }

    logger.info({ recovered }, 'Outbox sweeper recovery cycle finished');
    return recovered;
  }

  /**
   * Recovers jobs that were marked PROCESSING but the worker abruptly crashed
   */
  public async recoverStalledProcessingEmails(): Promise<number> {
    const stalledThreshold = new Date(Date.now() - 15 * 60 * 1000); // 15 mins stuck

    const stalledEmails = await prisma.scheduledEmail.findMany({
      where: {
        status: EmailStatus.PROCESSING,
        updatedAt: { lte: stalledThreshold },
      },
      take: 20,
    });

    if (stalledEmails.length === 0) return 0;

    logger.warn({ count: stalledEmails.length }, 'Found stranded PROCESSING emails from crashed workers');

    const queue = getEmailQueue();
    let recoveredCount = 0;

    for (const email of stalledEmails) {
      try {
        const existingJob = await queue.getJob(email.bullJobId || email.id);
        if (existingJob) {
          logger.info(
            { emailId: email.id, jobId: existingJob.id },
            'BullMQ still owns the job; leaving recovery to BullMQ to avoid duplicate enqueue.'
          );
          continue;
        }

        const payload: EmailJobData = {
          emailId: email.id,
          userId: email.userId,
          senderId: email.senderId,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
          scheduledAt: email.scheduledAt.toISOString(),
          batchId: email.batchId || undefined,
        };

        const delayMs = Math.max(0, email.nextEligibleAt.getTime() - Date.now());
        await queue.add('send-email', payload, defaultJobOptions(email.id, delayMs));

        await prisma.scheduledEmail.update({
          where: { id: email.id },
          data: {
            status: EmailStatus.SCHEDULED,
          },
        });
        recoveredCount++;
      } catch (err) {
        logger.error({ err, emailId: email.id }, 'Failed to recover stranded PROCESSING email');
      }
    }

    return recoveredCount;
  }
}

export const outboxSweeperService = new OutboxSweeperService();
