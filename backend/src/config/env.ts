import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from root or backend
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  FRONTEND_URL: z.string().default(''),

  // Security
  SESSION_SECRET: z.string().min(16).default('reachinbox_super_secret_session_key_min_32_chars_long_123456'),
  JWT_SECRET: z.string().min(16).default('reachinbox_jwt_secret_token_key_change_in_production_987654'),

  // PostgreSQL
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/reachinbox?schema=public'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Elasticsearch
  ELASTICSEARCH_NODE: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('reachinbox-emails'),

  // Scheduler & Rate Limits
  WORKER_CONCURRENCY: z.coerce.number().min(1).default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().min(1).default(200),
  OUTBOX_SWEEPER_INTERVAL_MS: z.coerce.number().min(1000).default(10000),

  // Ethereal / SMTP
  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().default(587),
  ETHEREAL_SECURE: z.coerce.boolean().default(false),
  ETHEREAL_USER: z.string().optional().default(''),
  ETHEREAL_PASS: z.string().optional().default(''),
  DEFAULT_SENDER_NAME: z.string().default('ReachInbox Scheduler'),
  DEFAULT_SENDER_EMAIL: z.string().default('outreach@reachinbox.test'),

  // Google OAuth 2.0
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:5000/api/auth/google/callback'),

  // Slack OAuth 2.0
  SLACK_CLIENT_ID: z.string().optional().default(''),
  SLACK_CLIENT_SECRET: z.string().optional().default(''),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:5000/api/integrations/slack/callback'),
  SLACK_SIGNING_SECRET: z.string().optional().default(''),

  // Bull-Board Admin Credentials
  BULL_BOARD_USERNAME: z.string().default('admin'),
  BULL_BOARD_PASSWORD: z.string().default('admin'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type EnvConfig = z.infer<typeof envSchema>;

