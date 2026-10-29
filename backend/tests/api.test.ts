import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/services/passwordAuth.service';

const { userFindUnique, userCreate } = vi.hoisted(() => ({
  userFindUnique: vi.fn().mockResolvedValue({
    id: 'dev-user-id',
    email: 'dev@reachinbox.test',
    name: 'Dev User',
    avatarUrl: null,
    googleId: null,
  }),
  userCreate: vi.fn().mockImplementation(({ data }) => ({
    id: 'dev-user-id',
    email: data.email,
    name: data.name,
    avatarUrl: null,
    googleId: null,
  })),
}));

vi.mock('../src/queues/email.queue', () => ({
  getEmailQueue: () => ({
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }),
    on: vi.fn(),
  }),
  defaultJobOptions: (jobId: string, delay: number) => ({ jobId, delay }),
  EMAIL_QUEUE_NAME: 'email-scheduler',
}));

vi.mock('../src/repositories/prisma', () => ({
  prisma: {
    user: {
      findUnique: userFindUnique,
      create: userCreate,
    },
    idempotencyRecord: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    $on: vi.fn(),
  },
}));

describe('Express API Endpoints', () => {
  const app = createApp();

  it('GET /health returns 200 OK with service details', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toContain('ReachInbox');
  });

  it('GET /api-docs.json returns valid OpenAPI 3.0 specification', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toContain('ReachInbox');
    expect(res.body.paths).toHaveProperty('/api/emails/schedule');
  });

  it('GET /api/auth/me returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toContain('Authentication required');
  });

  it('GET /api/auth/config exposes enabled authentication methods', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body.data.googleConfigured).toBeTypeOf('boolean');
    expect(res.body.data.passwordAuth).toBe(true);
  });

  it('validates account creation fields', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'Test User',
      email: 'not-an-email',
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('validates required password login fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('creates a password account with a hash and sets the session cookie', async () => {
    userFindUnique.mockResolvedValueOnce(null);
    userCreate.mockImplementationOnce(({ data }) => ({
      id: 'new-user-id',
      email: data.email,
      name: data.name,
      avatarUrl: null,
      googleId: null,
    }));

    const res = await request(app).post('/api/auth/signup').send({
      name: 'New User',
      email: 'NEW@example.com',
      password: 'a-secure-password',
    });

    expect(res.status).toBe(201);
    expect(res.headers['set-cookie'][0]).toContain('reachinbox_token=');
    expect(res.body.data.user.email).toBe('new@example.com');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');

    const createCall = userCreate.mock.calls.at(-1)?.[0];
    expect(createCall.data.email).toBe('new@example.com');
    expect(createCall.data.passwordHash).not.toBe('a-secure-password');
    await expect(verifyPassword('a-secure-password', createCall.data.passwordHash)).resolves.toBe(
      true
    );
  });

  it('signs in with a valid password and rejects invalid credentials', async () => {
    const passwordHash = await hashPassword('a-secure-password');
    const account = {
      id: 'existing-user-id',
      email: 'user@example.com',
      name: 'Existing User',
      avatarUrl: null,
      googleId: null,
      passwordHash,
    };

    userFindUnique.mockResolvedValueOnce(account);
    const success = await request(app).post('/api/auth/login').send({
      email: 'USER@example.com',
      password: 'a-secure-password',
    });
    expect(success.status).toBe(200);
    expect(success.headers['set-cookie'][0]).toContain('reachinbox_token=');
    expect(success.body.data.user).not.toHaveProperty('passwordHash');

    userFindUnique.mockResolvedValueOnce(account);
    const failure = await request(app).post('/api/auth/login').send({
      email: 'user@example.com',
      password: 'incorrect-password',
    });
    expect(failure.status).toBe(401);
    expect(failure.body.message).toBe('Invalid email or password.');
  });

  it('does not expose a mock-login endpoint', async () => {
    const res = await request(app).post('/api/auth/mock-login').send({
      email: 'demo@example.com',
      name: 'Demo User',
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/emails/schedule returns 401 when unauthorized', async () => {
    const res = await request(app).post('/api/emails/schedule').send({
      recipientEmail: 'test@example.com',
      subject: 'Hello',
      body: 'World',
      scheduledAt: new Date().toISOString(),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/emails/schedule returns 400 for invalid input when authenticated', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('x-dev-user-email', 'dev@reachinbox.test')
      .send({ recipientEmail: 'not-an-email', subject: '' });
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.errors).toBeDefined();
  });
});
