import { EmailStatus, OutboxStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { getEmailQueue, defaultJobOptions, EmailJobData } from '../queues/email.queue';
import { elasticsearchService } from '../integrations/elasticsearch/elasticsearch.service';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { ScheduleEmailInput, ScheduleBatchEmailInput } from '../schemas/email.schema';

export class EmailSchedulerService {
  private static instance: EmailSchedulerService;

  private constructor() {}

  public static getInstance(): EmailSchedulerService {
    if (!EmailSchedulerService.instance) {
      EmailSchedulerService.instance = new EmailSchedulerService();
    }
    return EmailSchedulerService.instance;
  }

  /**
   * Resolves an active sender for the user. If senderId is not provided, uses default sender.
   */
  public async resolveSender(userId: string, senderId?: string) {
    if (senderId) {
      const sender = await prisma.emailSender.findFirst({
        where: { id: senderId, userId },
      });
      if (!sender) {
        throw new AppError('Specified email sender not found or not owned by user.', 404);
      }
      return sender;
    }

    // Find default or first sender
    let sender = await prisma.emailSender.findFirst({
      where: { userId, isDefault: true },
    });

    if (!sender) {
      sender = await prisma.emailSender.findFirst({
        where: { userId },
      });
    }

    if (!sender) {
      // Auto-provision a default Ethereal sender for this user
      sender = await prisma.emailSender.create({
        data: {
          userId,
          name: 'Primary Outreach Account',
          email: 'outreach@reachinbox.test',
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          isDefault: true,
        },
      });
    }

    return sender;
  }

  /**
   * Schedules a single email with transactional outbox guarantees
   */
  public async scheduleSingleEmail(userId: string, input: ScheduleEmailInput) {
    if (input.idempotencyKey) {
      const existingEmail = await prisma.scheduledEmail.findFirst({
        where: { userId, idempotencyKey: input.idempotencyKey },
      });
      if (existingEmail) return existingEmail;
    }

    const sender = await this.resolveSender(userId, input.senderId);
    const scheduledAtDate = new Date(input.scheduledAt);
    const now = Date.now();
    const delayMs = Math.max(0, scheduledAtDate.getTime() - now);

    // 1. Transactional Outbox: Write ScheduledEmail and EmailOutbox atomically
    let email;
    let outbox;
    try {
      ({ email, outbox } = await prisma.$transaction(async (tx) => {
        const createdEmail = await tx.scheduledEmail.create({
          data: {
            userId,
            senderId: sender.id,
            recipientEmail: input.recipientEmail.trim().toLowerCase(),
            subject: input.subject,
            body: input.body,
            scheduledAt: scheduledAtDate,
            nextEligibleAt: scheduledAtDate,
            status: EmailStatus.SCHEDULED,
            idempotencyKey: input.idempotencyKey,
          },
        });

        const payload: EmailJobData = {
          emailId: createdEmail.id,
          userId,
          senderId: sender.id,
          recipientEmail: createdEmail.recipientEmail,
          subject: createdEmail.subject,
          body: createdEmail.body,
          scheduledAt: createdEmail.scheduledAt.toISOString(),
        };

        const createdOutbox = await tx.emailOutbox.create({
          data: {
            emailId: createdEmail.id,
            payload: payload as any,
            status: OutboxStatus.PENDING,
          },
        });

        return { email: createdEmail, outbox: createdOutbox };
      }));
    } catch (error) {
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingEmail = await prisma.scheduledEmail.findFirst({
          where: { userId, idempotencyKey: input.idempotencyKey },
        });
        if (existingEmail) return existingEmail;
      }
      throw error;
    }

    // 2. Enqueue to BullMQ with stable Job ID
    try {
      const queue = getEmailQueue();
      const job = await queue.add(
        'send-email',
        outbox.payload as unknown as EmailJobData,
        defaultJobOptions(email.id, delayMs)
      );

      // 3. Mark outbox ENQUEUED & record Bull job ID
      await prisma.$transaction([
        prisma.emailOutbox.update({
          where: { id: outbox.id },
          data: { status: OutboxStatus.ENQUEUED },
        }),
        prisma.scheduledEmail.update({
          where: { id: email.id },
          data: { bullJobId: job.id },
        }),
      ]);
    } catch (enqueueError: any) {
      logger.error(
        { err: enqueueError, emailId: email.id },
        'Failed to immediately enqueue job in Redis. Outbox sweeper will recover.'
      );
    }

    // 4. Index in Elasticsearch asynchronously
    elasticsearchService
      .indexEmail({
        id: email.id,
        userId: email.userId,
        senderId: sender.id,
        senderEmail: sender.email,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt.toISOString(),
        createdAt: email.createdAt.toISOString(),
      })
      .catch((err) => {
        logger.warn({ err, emailId: email.id }, 'Async Elasticsearch index failed');
      });

    return email;
  }

  /**
   * Schedules a batch of emails (e.g. from CSV upload) with optional staggered delays
   */
  public async scheduleBatch(userId: string, input: ScheduleBatchEmailInput) {
    const sender = await this.resolveSender(userId, input.senderId);
    const baseScheduledAt = new Date(input.scheduledAt);
    const staggeredDelayMs = input.minDelayBetweenSendsMs || 0;
    const batchId = input.batchId || `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const uniqueRecipients = Array.from(
      new Set(input.recipients.map((r) => r.trim().toLowerCase()))
    );

    const scheduledEmails: any[] = [];
    const queue = getEmailQueue();

    // Process batch with staggered scheduled timestamps
    for (let i = 0; i < uniqueRecipients.length; i++) {
      const recipient = uniqueRecipients[i];
      const emailScheduledAt = new Date(baseScheduledAt.getTime() + i * staggeredDelayMs);
      const delayMs = Math.max(0, emailScheduledAt.getTime() - Date.now());

      const { email, outbox } = await prisma.$transaction(async (tx) => {
        const createdEmail = await tx.scheduledEmail.create({
          data: {
            userId,
            senderId: sender.id,
            recipientEmail: recipient,
            subject: input.subject,
            body: input.body,
            scheduledAt: emailScheduledAt,
            nextEligibleAt: emailScheduledAt,
            status: EmailStatus.SCHEDULED,
            batchId,
          },
        });

        const payload: EmailJobData = {
          emailId: createdEmail.id,
          userId,
          senderId: sender.id,
          recipientEmail: recipient,
          subject: input.subject,
          body: input.body,
          scheduledAt: emailScheduledAt.toISOString(),
          batchId,
        };

        const createdOutbox = await tx.emailOutbox.create({
          data: {
            emailId: createdEmail.id,
            payload: payload as any,
            status: OutboxStatus.PENDING,
          },
        });

        return { email: createdEmail, outbox: createdOutbox };
      });

      scheduledEmails.push(email);

      // Enqueue to BullMQ
      try {
        const job = await queue.add(
          'send-email',
          outbox.payload as unknown as EmailJobData,
          defaultJobOptions(email.id, delayMs)
        );

        await prisma.$transaction([
          prisma.emailOutbox.update({
            where: { id: outbox.id },
            data: { status: OutboxStatus.ENQUEUED },
          }),
          prisma.scheduledEmail.update({
            where: { id: email.id },
            data: { bullJobId: job.id },
          }),
        ]);
      } catch (err: any) {
        logger.error({ err, emailId: email.id }, 'Batch email BullMQ enqueue failed; outbox will recover');
      }

      // Elasticsearch indexing asynchronously
      elasticsearchService
        .indexEmail({
          id: email.id,
          userId,
          senderId: sender.id,
          senderEmail: sender.email,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
          status: email.status,
          scheduledAt: email.scheduledAt.toISOString(),
          createdAt: email.createdAt.toISOString(),
        })
        .catch(() => {});
    }

    return {
      batchId,
      totalScheduled: scheduledEmails.length,
      emails: scheduledEmails,
    };
  }

  /**
   * Cancels a scheduled email if it is still eligible (SCHEDULED)
   */
  public async cancelEmail(userId: string, emailId: string) {
    const email = await prisma.scheduledEmail.findFirst({
      where: { id: emailId, userId },
    });

    if (!email) {
      throw new AppError('Scheduled email not found or unauthorized.', 404);
    }

    if (email.status !== EmailStatus.SCHEDULED) {
      throw new AppError(`Cannot cancel email with status '${email.status}'.`, 400);
    }

    // Remove or cancel from BullMQ
    if (email.bullJobId) {
      try {
        const queue = getEmailQueue();
        const job = await queue.getJob(email.bullJobId);
        if (job) {
          await job.remove();
        }
      } catch (err) {
        logger.warn({ err, emailId }, 'Could not remove job from BullMQ queue directly');
      }
    }

    const updated = await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: { status: EmailStatus.CANCELLED },
    });

    // Update Elasticsearch
    elasticsearchService.indexEmail({
      id: updated.id,
      userId: updated.userId,
      senderId: updated.senderId,
      recipientEmail: updated.recipientEmail,
      subject: updated.subject,
      body: updated.body,
      status: updated.status,
      scheduledAt: updated.scheduledAt.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    }).catch(() => {});

    return updated;
  }
}

export const emailSchedulerService = EmailSchedulerService.getInstance();
