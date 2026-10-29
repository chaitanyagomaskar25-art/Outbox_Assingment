export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ReachInbox Email Job Scheduler API',
    version: '1.0.0',
    description:
      'Production-oriented REST API for persistent email scheduling, BullMQ delayed job processing, distributed rate-limiting, Ethereal fake SMTP delivery, and real Google & Slack OAuth integrations.',
    contact: {
      name: 'ReachInbox Engineering',
    },
  },
  servers: [
    {
      url: 'https://outbox-assingment-cqpz.vercel.app',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'reachinbox_token',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ScheduledEmail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          senderId: { type: 'string', format: 'uuid' },
          recipientEmail: { type: 'string', format: 'email' },
          subject: { type: 'string' },
          body: { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time' },
          nextEligibleAt: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            enum: ['SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'],
          },
          attemptCount: { type: 'integer' },
          providerMessageId: { type: 'string', nullable: true },
          etherealPreviewUrl: { type: 'string', nullable: true },
          sentAt: { type: 'string', format: 'date-time', nullable: true },
          failedAt: { type: 'string', format: 'date-time', nullable: true },
          errorDetails: { type: 'string', nullable: true },
        },
      },
      ScheduleEmailRequest: {
        type: 'object',
        required: ['recipientEmail', 'subject', 'body', 'scheduledAt'],
        properties: {
          senderId: { type: 'string', format: 'uuid' },
          recipientEmail: { type: 'string', format: 'email' },
          subject: { type: 'string' },
          body: { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time' },
          idempotencyKey: { type: 'string' },
        },
      },
      ScheduleBatchRequest: {
        type: 'object',
        required: ['recipients', 'subject', 'body', 'scheduledAt'],
        properties: {
          senderId: { type: 'string', format: 'uuid' },
          recipients: {
            type: 'array',
            items: { type: 'string', format: 'email' },
          },
          subject: { type: 'string' },
          body: { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time' },
          minDelayBetweenSendsMs: { type: 'integer', default: 2000 },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  paths: {
    '/api/auth/config': {
      get: {
        summary: 'Get authentication provider configuration',
        tags: ['Authentication'],
        security: [],
        responses: {
          200: { description: 'Authentication provider availability' },
        },
      },
    },
    '/api/auth/signup': {
      post: {
        summary: 'Create an account using email and password',
        tags: ['Authentication'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', maxLength: 100 },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Account created and session established' },
          409: { description: 'An account already exists for this email' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Sign in using email and password',
        tags: ['Authentication'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Signed in and session established' },
          401: { description: 'Invalid email or password' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Get current authenticated user profile',
        tags: ['Authentication'],
        responses: {
          200: { description: 'Authenticated user details' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/emails/schedule': {
      post: {
        summary: 'Schedule a single email with BullMQ delayed job and outbox guarantee',
        tags: ['Emails'],
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            schema: { type: 'string' },
            description: 'Optional idempotency key to prevent duplicate scheduling',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScheduleEmailRequest' },
            },
          },
        },
        responses: {
          201: { description: 'Email successfully scheduled' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/api/emails/batch': {
      post: {
        summary: 'Schedule a batch of emails with staggered send delay support',
        tags: ['Emails'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScheduleBatchRequest' },
            },
          },
        },
        responses: {
          201: { description: 'Batch emails scheduled' },
        },
      },
    },
    '/api/emails': {
      get: {
        summary: 'List user emails with pagination and status filters',
        tags: ['Emails'],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ALL', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Paginated list of emails' },
        },
      },
    },
    '/api/emails/search': {
      get: {
        summary: 'Full-text search email records via Elasticsearch with PG fallback',
        tags: ['Emails'],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', default: 'ALL' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Search results' },
        },
      },
    },
    '/api/emails/{id}': {
      get: {
        summary: 'Get email record details by ID',
        tags: ['Emails'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Email details' },
          404: { description: 'Email not found' },
        },
      },
    },
    '/api/emails/{id}/cancel': {
      post: {
        summary: 'Cancel an eligible scheduled email',
        tags: ['Emails'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Email cancelled' },
          400: { description: 'Email not eligible for cancellation' },
        },
      },
    },
    '/api/emails/{id}/retry': {
      post: {
        summary: 'Retry delivery for a failed email',
        tags: ['Emails'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Email retry scheduled' },
        },
      },
    },
    '/api/dashboard/stats': {
      get: {
        summary: 'Get dashboard summary metrics and queue health',
        tags: ['Dashboard'],
        responses: {
          200: { description: 'Aggregated statistics' },
        },
      },
    },
    '/api/integrations/slack/status': {
      get: {
        summary: 'Check Slack connection status and channel config',
        tags: ['Integrations'],
        responses: {
          200: { description: 'Slack integration status' },
        },
      },
    },
    '/api/integrations/slack/disconnect': {
      post: {
        summary: 'Disconnect connected Slack workspace',
        tags: ['Integrations'],
        responses: {
          200: { description: 'Slack disconnected' },
        },
      },
    },
  },
};
