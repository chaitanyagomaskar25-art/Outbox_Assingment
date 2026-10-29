import { Request, Response, NextFunction } from 'express';
import { prisma } from '../repositories/prisma';
import { emailSchedulerService } from '../services/emailScheduler.service';
import { elasticsearchService } from '../integrations/elasticsearch/elasticsearch.service';
import { EmailStatus } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { getEmailQueue, defaultJobOptions } from '../queues/email.queue';
import {
  ScheduleEmailInput,
  ScheduleBatchEmailInput,
  CreateSenderInput,
} from '../schemas/email.schema';

export class EmailController {
  /**
   * POST /api/emails/schedule
   */
  public scheduleEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const input = {
        ...req.body,
        idempotencyKey: req.get('Idempotency-Key') || req.body.idempotencyKey,
      } as ScheduleEmailInput;
      const email = await emailSchedulerService.scheduleSingleEmail(userId, input);

      return res.status(201).json({
        status: 'success',
        message: 'Email scheduled successfully',
        data: { email },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/emails/batch
   */
  public scheduleBatch = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const input = req.body as ScheduleBatchEmailInput;
      const result = await emailSchedulerService.scheduleBatch(userId, input);

      return res.status(201).json({
        status: 'success',
        message: `Successfully scheduled batch of ${result.totalScheduled} emails`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/emails
   */
  public getEmails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const statusParam = req.query.status as string;
      const searchParam = req.query.search as string;
      const senderId = req.query.senderId as string;

      const skip = (page - 1) * limit;

      const whereClause: any = { userId };

      if (statusParam && statusParam !== 'ALL') {
        whereClause.status = statusParam as EmailStatus;
      }

      if (senderId) {
        whereClause.senderId = senderId;
      }

      if (searchParam) {
        whereClause.OR = [
          { recipientEmail: { contains: searchParam, mode: 'insensitive' } },
          { subject: { contains: searchParam, mode: 'insensitive' } },
          { body: { contains: searchParam, mode: 'insensitive' } },
        ];
      }

      const [total, emails] = await Promise.all([
        prisma.scheduledEmail.count({ where: whereClause }),
        prisma.scheduledEmail.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: { scheduledAt: 'desc' },
          include: {
            sender: {
              select: { id: true, name: true, email: true },
            },
          },
        }),
      ]);

      return res.json({
        status: 'success',
        data: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          emails,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/emails/search
   * Uses Elasticsearch with transparent PostgreSQL fallback
   */
  public searchEmails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const query = (req.query.q as string) || '';
      const status = (req.query.status as string) || 'ALL';
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

      if (!query.trim()) {
        throw new AppError('Search query parameter "q" is required.', 400);
      }

      try {
        const esResult = await elasticsearchService.searchEmails({
          userId,
          query,
          status,
          page,
          limit,
        });

        return res.json({
          status: 'success',
          source: 'elasticsearch',
          data: {
            total: esResult.total,
            page: esResult.page,
            limit: esResult.limit,
            totalPages: Math.ceil(esResult.total / limit),
            emails: esResult.emails,
          },
        });
      } catch (esError) {
        // Fallback to PostgreSQL
        const skip = (page - 1) * limit;
        const whereClause: any = {
          userId,
          OR: [
            { recipientEmail: { contains: query, mode: 'insensitive' } },
            { subject: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
          ],
        };

        if (status && status !== 'ALL') {
          whereClause.status = status as EmailStatus;
        }

        const [total, emails] = await Promise.all([
          prisma.scheduledEmail.count({ where: whereClause }),
          prisma.scheduledEmail.findMany({
            where: whereClause,
            skip,
            take: limit,
            orderBy: { scheduledAt: 'desc' },
            include: { sender: { select: { id: true, name: true, email: true } } },
          }),
        ]);

        return res.json({
          status: 'success',
          source: 'database_fallback',
          data: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            emails,
          },
        });
      }
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/emails/:id
   */
  public getEmailById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const email = await prisma.scheduledEmail.findFirst({
        where: { id, userId },
        include: { sender: true },
      });

      if (!email) {
        throw new AppError('Email record not found or access unauthorized.', 404);
      }

      return res.json({
        status: 'success',
        data: { email },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/emails/:id/cancel
   */
  public cancelEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const cancelledEmail = await emailSchedulerService.cancelEmail(userId, id);

      return res.json({
        status: 'success',
        message: 'Scheduled email cancelled successfully.',
        data: { email: cancelledEmail },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/emails/:id/retry
   */
  public retryEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const email = await prisma.scheduledEmail.findFirst({
        where: { id, userId },
      });

      if (!email) {
        throw new AppError('Email record not found or access unauthorized.', 404);
      }

      if (email.status !== EmailStatus.FAILED) {
        throw new AppError('Only failed emails can be retried.', 400);
      }

      const queue = getEmailQueue();
      const existingJob = await queue.getJob(email.bullJobId || email.id);
      if (existingJob) {
        await existingJob.remove();
      }

      await queue.add(
        'send-email',
        {
          emailId: email.id,
          userId: email.userId,
          senderId: email.senderId,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
          scheduledAt: new Date().toISOString(),
        },
        defaultJobOptions(email.id, 0)
      );

      const updated = await prisma.scheduledEmail.update({
        where: { id },
        data: {
          status: EmailStatus.SCHEDULED,
          nextEligibleAt: new Date(),
          errorDetails: null,
        },
      });

      return res.json({
        status: 'success',
        message: 'Email retry scheduled immediately.',
        data: { email: updated },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/senders
   */
  public getSenders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const senders = await prisma.emailSender.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          email: true,
          host: true,
          port: true,
          secure: true,
          isDefault: true,
          createdAt: true,
        },
      });

      return res.json({
        status: 'success',
        data: { senders },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/senders
   */
  public createSender = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const input = req.body as CreateSenderInput;

      if (input.isDefault) {
        await prisma.emailSender.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }

      const sender = await prisma.emailSender.create({
        data: {
          userId,
          name: input.name,
          email: input.email,
          host: input.host,
          port: input.port,
          secure: input.secure,
          username: input.username,
          password: input.password,
          isDefault: input.isDefault,
        },
        select: {
          id: true,
          name: true,
          email: true,
          host: true,
          port: true,
          secure: true,
          isDefault: true,
          createdAt: true,
        },
      });

      return res.status(201).json({
        status: 'success',
        message: 'Sender account created successfully.',
        data: { sender },
      });
    } catch (error) {
      next(error);
    }
  };
}

export const emailController = new EmailController();
