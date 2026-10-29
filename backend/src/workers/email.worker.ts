import { DelayedError, Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData } from '../queues/email.queue';
import { redisConfig } from '../queues/redis.connection';
import { prisma } from '../repositories/prisma';
import { EmailStatus } from '@prisma/client';
import { emailDeliveryService } from '../integrations/email/ethereal.service';
import { rateLimiterService } from '../services/rateLimiter.service';
import { elasticsearchService } from '../integrations/elasticsearch/elasticsearch.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class EmailWorker {
  private worker: Worker<EmailJobData> | null = null;

  public start(): Worker<EmailJobData> {
    if (this.worker) return this.worker;

    logger.info(
      { concurrency: env.WORKER_CONCURRENCY },
      'Initializing BullMQ Email Worker process'
    );

    this.worker = new Worker<EmailJobData>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailJobData>) => {
        return this.processJob(job);
      },
      {
        connection: redisConfig,
        concurrency: env.WORKER_CONCURRENCY,
        lockDuration: 30000, // 30s lock
        stalledInterval: 15000,
        maxStalledCount: 2,
      }
    );

    this.worker.on('active', (job) => {
      logger.info({ jobId: job.id, emailId: job.data.emailId }, 'Worker processing email job');
    });

    this.worker.on('completed', (job, result) => {
      logger.info({ jobId: job.id, result }, 'Worker completed email job');
    });

    this.worker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, emailId: job?.data?.emailId, error: err.message },
        'Worker job failed'
      );
    });

    this.worker.on('error', (err) => {
      logger.error({ err }, 'BullMQ Worker encountered an internal error');
    });

    return this.worker;
  }

  public async close(): Promise<void> {
    if (this.worker) {
      logger.info('Closing BullMQ Worker gracefully...');
      await this.worker.close();
      this.worker = null;
      logger.info('BullMQ Worker closed.');
    }
  }

  private async processJob(job: Job<EmailJobData>) {
    const { emailId, senderId, userId, recipientEmail, subject, body } = job.data;

    // 1. Fetch authoritative email record from PostgreSQL
    const email = await prisma.scheduledEmail.findUnique({
      where: { id: emailId },
      include: { sender: true },
    });

    if (!email) {
      logger.warn({ emailId }, 'Email record not found in PostgreSQL. Skipping job.');
      return { skipped: true, reason: 'Record not found' };
    }

    if (email.status === EmailStatus.CANCELLED) {
      logger.info({ emailId }, 'Email was cancelled by user. Skipping delivery.');
      return { skipped: true, reason: 'Cancelled' };
    }

    if (email.status === EmailStatus.SENT) {
      logger.info({ emailId }, 'Email already marked as sent. Idempotency safeguard applied.');
      return { skipped: true, reason: 'Already sent' };
    }

    // 2. Mark PROCESSING and increment attempt count
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: {
        status: EmailStatus.PROCESSING,
        attemptCount: { increment: 1 },
      },
    });

    // 3. Check Hourly Rate Limit
    const rateCheck = await rateLimiterService.reserveHourlyQuota(senderId, userId, emailId);
    if (!rateCheck.allowed) {
      // Limit exceeded for this sender. Defer to next eligible hourly window.
      logger.warn(
        {
          emailId,
          senderId,
          delayMs: rateCheck.delayUntilNextWindowMs,
          nextEligibleAt: rateCheck.nextEligibleAt.toISOString(),
        },
        'Sender hourly rate limit exceeded. Deferring job to next hourly window.'
      );

      await prisma.scheduledEmail.update({
        where: { id: emailId },
        data: {
          status: EmailStatus.SCHEDULED,
          nextEligibleAt: rateCheck.nextEligibleAt,
        },
      });

      await job.moveToDelayed(Date.now() + rateCheck.delayUntilNextWindowMs, job.token);
      throw new DelayedError();
    }

    // 4. Enforce Distributed Minimum Send Delay
    const delayRequiredMs = await rateLimiterService.coordinateSendDelay(
      senderId,
      env.MIN_DELAY_BETWEEN_EMAILS_MS
    );
    if (delayRequiredMs > 0) {
      logger.info(
        { emailId, delayRequiredMs },
        'Waiting for minimum send delay spacing across workers...'
      );
      await new Promise((resolve) => setTimeout(resolve, delayRequiredMs));
    }

    // 5. Deliver Email via Nodemailer SMTP
    try {
      const sender = email.sender;
      const sendResult = await emailDeliveryService.sendEmail({
        fromName: sender.name,
        fromEmail: sender.email,
        to: recipientEmail,
        subject,
        body,
        host: sender.host,
        port: sender.port,
        secure: sender.secure,
        username: sender.username,
        password: sender.password,
      });

      // 6. Update PostgreSQL state to SENT
      const sentAt = new Date();
      const updated = await prisma.scheduledEmail.update({
        where: { id: emailId },
        data: {
          status: EmailStatus.SENT,
          sentAt,
          providerMessageId: sendResult.messageId,
          etherealPreviewUrl: sendResult.previewUrl ? String(sendResult.previewUrl) : null,
          errorDetails: null,
        },
      });

      // 7. Synchronize Elasticsearch index
      elasticsearchService
        .indexEmail({
          id: updated.id,
          userId: updated.userId,
          senderId: updated.senderId,
          senderEmail: sender.email,
          recipientEmail: updated.recipientEmail,
          subject: updated.subject,
          body: updated.body,
          status: updated.status,
          scheduledAt: updated.scheduledAt.toISOString(),
          sentAt: sentAt.toISOString(),
          createdAt: updated.createdAt.toISOString(),
        })
        .catch(() => {});

      return {
        success: true,
        messageId: sendResult.messageId,
        previewUrl: sendResult.previewUrl,
      };
    } catch (smtpError: any) {
      logger.error(
        { emailId, error: smtpError.message, attempts: job.attemptsMade },
        'SMTP transmission failed'
      );

      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 3);

      await prisma.scheduledEmail.update({
        where: { id: emailId },
        data: {
          status: isFinalAttempt ? EmailStatus.FAILED : EmailStatus.SCHEDULED,
          failedAt: isFinalAttempt ? new Date() : null,
          errorDetails: smtpError.message,
        },
      });

      // Update Elasticsearch with failure details
      elasticsearchService
        .indexEmail({
          id: email.id,
          userId: email.userId,
          senderId: email.senderId,
          senderEmail: email.sender.email,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
          status: isFinalAttempt ? EmailStatus.FAILED : EmailStatus.SCHEDULED,
          scheduledAt: email.scheduledAt.toISOString(),
          createdAt: email.createdAt.toISOString(),
        })
        .catch(() => {});

      throw smtpError;
    }
  }
}

export const emailWorker = new EmailWorker();
