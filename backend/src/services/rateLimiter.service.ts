import { randomUUID } from 'crypto';
import { getRedisClient } from '../queues/redis.connection';
import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { slackService } from '../integrations/slack/slack.service';

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  nextEligibleAt: Date;
  delayUntilNextWindowMs: number;
}

export class RateLimiterService {
  private static instance: RateLimiterService;

  private constructor() {}

  public static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  /**
   * Calculates the current UTC hourly window bounds
   */
  public getHourlyWindowBounds(date: Date = new Date()): {
    windowStart: Date;
    nextWindowStart: Date;
  } {
    const windowStart = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        0,
        0,
        0
      )
    );
    const nextWindowStart = new Date(windowStart.getTime() + 60 * 60 * 1000);
    return { windowStart, nextWindowStart };
  }

  /**
   * Atomically increments and reserves an hourly email sending slot for a given sender.
   * If limit is exceeded, does not fail the job; instead returns next eligible timestamp.
   */
  public async reserveHourlyQuota(
    senderId: string,
    userId: string,
    emailId: string,
    customHourlyLimit?: number
  ): Promise<RateLimitCheckResult> {
    const redis = getRedisClient();
    const maxLimit = customHourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const { windowStart } = this.getHourlyWindowBounds();
    const windowKey = `ratelimit:hourly:${senderId}`;
    const firstWindowEpoch = Math.floor(windowStart.getTime() / 1000);
    const luaScript = `
      local reservation_field = 'email:' .. ARGV[2]
      local existing = redis.call('HGET', KEYS[1], reservation_field)
      if existing then
        local assigned_window, assigned_count = string.match(existing, '^(%d+):(%d+)$')
        if tonumber(assigned_window) >= tonumber(ARGV[1]) then
          return { tonumber(assigned_window), tonumber(assigned_count) }
        end
        redis.call('HDEL', KEYS[1], reservation_field)
      end

      local window_start = tonumber(ARGV[1])
      local limit = tonumber(ARGV[3])
      while true do
        local window_field = 'window:' .. tostring(window_start)
        local current = tonumber(redis.call('HGET', KEYS[1], window_field) or '0')
        if current < limit then
          current = redis.call('HINCRBY', KEYS[1], window_field, 1)
          redis.call('HSET', KEYS[1], reservation_field, tostring(window_start) .. ':' .. tostring(current))
          redis.call('EXPIRE', KEYS[1], 315360000)
          return { window_start, current }
        end
        window_start = window_start + 3600
      end
    `;

    const [reservedWindowEpoch, currentCount] = (await redis.eval(
      luaScript,
      1,
      windowKey,
      firstWindowEpoch.toString(),
      emailId,
      maxLimit.toString()
    )) as [number, number];
    const nextEligibleAt = new Date(reservedWindowEpoch * 1000);
    const isCurrentWindow = reservedWindowEpoch === firstWindowEpoch;

    if (!isCurrentWindow) {
      logger.warn(
        {
          senderId,
          currentCount,
          maxLimit,
          nextEligibleAt: nextEligibleAt.toISOString(),
        },
        'Hourly rate limit reached for sender. Reserving capacity in a future window.'
      );

      this.checkAndSendSlackRateLimitAlert(
        senderId,
        userId,
        maxLimit,
        maxLimit + 1,
        nextEligibleAt,
        windowStart
      ).catch((err) => {
        logger.error({ err, senderId }, 'Failed in Slack rate-limit alert trigger');
      });

      return {
        allowed: false,
        currentCount,
        maxLimit,
        nextEligibleAt,
        delayUntilNextWindowMs: Math.max(1000, nextEligibleAt.getTime() - Date.now()),
      };
    }

    return {
      allowed: true,
      currentCount,
      maxLimit,
      nextEligibleAt: new Date(),
      delayUntilNextWindowMs: 0,
    };
  }

  /**
   * Reserves the next send slot across distributed workers and returns its wait time.
   */
  public async coordinateSendDelay(
    senderId: string,
    minDelayMs: number = env.MIN_DELAY_BETWEEN_EMAILS_MS
  ): Promise<number> {
    if (minDelayMs <= 0) return 0;

    const redis = getRedisClient();
    const lockKey = `ratelimit:send_slot:${senderId}`;
    const now = Date.now();

    const luaScript = `
      local now = tonumber(ARGV[1])
      local min_delay = tonumber(ARGV[2])
      local next_slot = tonumber(redis.call('GET', KEYS[1]) or '0')
      local reserved_slot = math.max(now, next_slot)
      local ttl = math.max(min_delay * 5, reserved_slot - now + min_delay * 5, 60000)
      redis.call('SET', KEYS[1], reserved_slot + min_delay, 'PX', ttl)
      return reserved_slot - now
    `;

    try {
      const waitTime = (await redis.eval(luaScript, 1, lockKey, now.toString(), minDelayMs.toString())) as number;
      return Math.max(0, waitTime);
    } catch (err) {
      logger.error({ err, senderId }, 'Redis send-slot reservation failed');
      throw err;
    }
  }

  /**
   * Sends rate limit alert to connected Slack channel with deduplication
   */
  private async checkAndSendSlackRateLimitAlert(
    senderId: string,
    userId: string,
    hourlyLimit: number,
    currentCount: number,
    nextEligibleAt: Date,
    windowStart: Date
  ): Promise<void> {
    const redis = getRedisClient();
    const alertKey = `slack_alert_sent:${senderId}:${windowStart.toISOString()}`;
    const lockKey = `${alertKey}:lock`;
    const lockToken = randomUUID();
    const acquired = await redis.set(lockKey, lockToken, 'EX', 120, 'NX');
    if (!acquired) {
      return;
    }

    try {
      if (await redis.get(alertKey)) return;

      const slackIntegration = await prisma.slackIntegration.findFirst({
        where: {
          userId,
          isConnected: true,
        },
      });

      if (!slackIntegration) {
        logger.info({ userId }, 'No connected Slack integration found; rate-limit alert skipped.');
        return;
      }

      const sender = await prisma.emailSender.findUnique({
        where: { id: senderId },
        select: { name: true, email: true },
      });

      const delivered = await slackService.sendRateLimitAlert(
        slackIntegration.botAccessToken,
        slackIntegration.channelId || undefined,
        slackIntegration.incomingWebhookUrl || undefined,
        {
          senderName: sender?.name || 'Primary Sender',
          senderEmail: sender?.email || 'N/A',
          hourlyLimit,
          currentCount,
          nextEligibleAt,
        }
      );

      if (delivered) {
        await redis.set(alertKey, '1', 'EX', 7200);
      } else {
        logger.warn({ senderId, userId }, 'Slack did not confirm delivery of rate-limit alert');
      }
    } finally {
      await redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken
      );
    }
  }
}

export const rateLimiterService = RateLimiterService.getInstance();
