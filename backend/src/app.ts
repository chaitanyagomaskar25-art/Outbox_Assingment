import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env';
import { openApiSpec } from './docs/openapi';
import { getEmailQueue } from './queues/email.queue';
import { authRoutes } from './routes/auth.routes';
import { emailRoutes } from './routes/email.routes';
import { integrationRoutes } from './routes/integration.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Express {
  const app = express();

  // Basic security and parsing
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows Bull-Board & Swagger UI inline scripts
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: [env.FRONTEND_URL, 'http://localhost:5175', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Dev-User-Email'],
    })
  );

  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    return res.status(200).json({
      status: 'ok',
      service: 'ReachInbox Email Job Scheduler',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // OpenAPI Swagger Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(openApiSpec);
  });

  // Bull-Board Dashboard for BullMQ Queue Monitoring
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(getEmailQueue() as any) as any],
    serverAdapter,
  });

  // HTTP Basic Auth for Bull-Board administration
  const bullBoardAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Admin Dashboard"');
      return res.status(401).send('Authentication required for BullMQ Dashboard');
    }

    const auth = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    if (user === env.BULL_BOARD_USERNAME && pass === env.BULL_BOARD_PASSWORD) {
      return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Admin Dashboard"');
    return res.status(401).send('Invalid administrative credentials');
  };

  app.use('/admin/queues', bullBoardAuth, serverAdapter.getRouter());

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      status: 'error',
      message: 'Route not found',
    });
  });

  // Central Error Handler
  app.use(errorHandler);

  return app;
}
