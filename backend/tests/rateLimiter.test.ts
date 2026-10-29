import { beforeEach, describe, it, expect, vi } from 'vitest';
import { rateLimiterService } from '../src/services/rateLimiter.service';
import { slackService } from '../src/integrations/slack/slack.service';

const {
  evalMock,
  redisSetMock,
  redisGetMock,
  slackIntegrationLookup,
  senderLookup,
  slackSendMock,
} = vi.hoisted(() => ({
  evalMock: vi.fn(),
  redisSetMock: vi.fn().mockResolvedValue('OK'),
  redisGetMock: vi.fn().mockResolvedValue(null),
  slackIntegrationLookup: vi.fn().mockResolvedValue(null),
  senderLookup: vi.fn().mockResolvedValue(null),
  slackSendMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/queues/redis.connection', () => ({
  getRedisClient: () => ({
    eval: evalMock,
    set: redisSetMock,
    get: redisGetMock,
  }),
}));

vi.mock('../src/repositories/prisma', () => ({
  prisma: {
    slackIntegration: { findFirst: slackIntegrationLookup },
    emailSender: { findUnique: senderLookup },
  },
}));

vi.mock('../src/integrations/slack/slack.service', () => ({
  slackService: { sendRateLimitAlert: slackSendMock },
}));

beforeEach(() => {
  vi.clearAllMocks();
  redisSetMock.mockResolvedValue('OK');
  redisGetMock.mockResolvedValue(null);
  slackIntegrationLookup.mockResolvedValue(null);
  senderLookup.mockResolvedValue(null);
  slackSendMock.mockResolvedValue(true);
});

describe('RateLimiterService', () => {
  it('calculates hourly window bounds accurately in UTC', () => {
    // 2026-10-16 14:35:22 UTC
    const date = new Date(Date.UTC(2026, 9, 16, 14, 35, 22));
    const { windowStart, nextWindowStart } = rateLimiterService.getHourlyWindowBounds(date);

    expect(windowStart.getUTCFullYear()).toBe(2026);
    expect(windowStart.getUTCMonth()).toBe(9); // October (0-indexed)
    expect(windowStart.getUTCDate()).toBe(16);
    expect(windowStart.getUTCHours()).toBe(14);
    expect(windowStart.getUTCMinutes()).toBe(0);
    expect(windowStart.getUTCSeconds()).toBe(0);
    expect(windowStart.getUTCMilliseconds()).toBe(0);

    expect(nextWindowStart.getTime() - windowStart.getTime()).toBe(3600 * 1000);
    expect(nextWindowStart.getUTCHours()).toBe(15);
  });

  it('calculates window boundary rollover across midnight', () => {
    // 2026-10-16 23:59:59 UTC
    const date = new Date(Date.UTC(2026, 9, 16, 23, 59, 59));
    const { windowStart, nextWindowStart } = rateLimiterService.getHourlyWindowBounds(date);

    expect(windowStart.getUTCDate()).toBe(16);
    expect(windowStart.getUTCHours()).toBe(23);

    expect(nextWindowStart.getUTCDate()).toBe(17);
    expect(nextWindowStart.getUTCHours()).toBe(0);
  });

  it('respects zero or negative minimum send delay', async () => {
    const delay = await rateLimiterService.coordinateSendDelay('sender-123', 0);
    expect(delay).toBe(0);
  });

  it('reserves an atomic distributed send slot and returns its wait time', async () => {
    evalMock.mockResolvedValueOnce(1250);

    await expect(rateLimiterService.coordinateSendDelay('sender-123', 2000)).resolves.toBe(1250);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('reserved_slot + min_delay'),
      1,
      'ratelimit:send_slot:sender-123',
      expect.any(String),
      '2000'
    );
  });

  it('fails the job instead of bypassing send spacing when Redis reservation fails', async () => {
    const redisError = new Error('Redis unavailable');
    evalMock.mockRejectedValueOnce(redisError);

    await expect(rateLimiterService.coordinateSendDelay('sender-123', 2000)).rejects.toBe(redisError);
  });

  it('reserves an email in the earliest available hourly window without double-counting retries', async () => {
    const now = new Date();
    const currentWindow = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()) / 1000
    );
    evalMock.mockResolvedValueOnce([currentWindow + 3600, 1]);

    const result = await rateLimiterService.reserveHourlyQuota(
      'sender-123',
      'user-123',
      'email-123',
      200
    );

    expect(result.allowed).toBe(false);
    expect(result.nextEligibleAt.getTime()).toBe((currentWindow + 3600) * 1000);
    expect(result.delayUntilNextWindowMs).toBeGreaterThan(0);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("reservation_field = 'email:' .. ARGV[2]"),
      1,
      'ratelimit:hourly:sender-123',
      String(currentWindow),
      'email-123',
      '200'
    );
    const quotaScript = evalMock.mock.calls.find(([script]) =>
      script.includes("reservation_field = 'email:'")
    )?.[0];
    expect(quotaScript).toContain('window_start = window_start + 3600');
    await vi.waitFor(() =>
      expect(slackIntegrationLookup).toHaveBeenCalledWith({
        where: { userId: 'user-123', isConnected: true },
      })
    );
  });

  it('sends and records a Slack alert when a connected sender hits its hourly cap', async () => {
    const now = new Date();
    const currentWindow = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()) / 1000
    );
    evalMock.mockResolvedValueOnce([currentWindow + 3600, 1]);
    slackIntegrationLookup.mockResolvedValueOnce({
      botAccessToken: 'slack-token',
      channelId: 'C123',
      incomingWebhookUrl: null,
    });
    senderLookup.mockResolvedValueOnce({ name: 'Sender', email: 'sender@example.test' });

    await rateLimiterService.reserveHourlyQuota('sender-123', 'user-123', 'email-456', 200);

    await vi.waitFor(() =>
      expect(slackService.sendRateLimitAlert).toHaveBeenCalledWith(
        'slack-token',
        'C123',
        undefined,
        expect.objectContaining({
          senderName: 'Sender',
          senderEmail: 'sender@example.test',
          hourlyLimit: 200,
          currentCount: 201,
        })
      )
    );
    expect(redisSetMock).toHaveBeenCalledWith(
      expect.stringContaining('slack_alert_sent:sender-123:'),
      '1',
      'EX',
      7200
    );
  });
});
