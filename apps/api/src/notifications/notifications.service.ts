import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type {
  NotificationCategory,
  NotificationKind,
  UpdateNotificationPreferencesInput,
} from '@botparty/shared';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
type NotificationsDatabase = {
  notification: Pick<
    PrismaService['notification'],
    'count' | 'create' | 'findMany' | 'findUnique' | 'update' | 'updateMany'
  >;
  notificationPreference: Pick<
    PrismaService['notificationPreference'],
    'findUniqueOrThrow' | 'update' | 'upsert'
  >;
  user: Pick<PrismaService['user'], 'findUnique'>;
};

export interface PublishNotificationInput {
  userId: string;
  kind: NotificationKind;
  category: NotificationCategory;
  title: string;
  body: string;
  actionUrl?: string;
  dedupeKey: string;
}

const DEFAULT_PREFERENCES = {
  inAppEnabled: true,
  browserEnabled: false,
  emailTurn: true,
  emailRobot: true,
  emailFinance: true,
  quietStartMin: null as number | null,
  quietEndMin: null as number | null,
  timezone: 'UTC',
};

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDeliveryCycleErrorLogAt = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: NotificationsDatabase,
    @Inject(MailService) private readonly mail: Pick<MailService, 'isEnabled' | 'sendRaw'>,
  ) {}

  onModuleInit() {
    this.startupTimer = setTimeout(() => this.deliverPendingEmailsSafely(), 5_000);
    this.startupTimer.unref?.();
    this.timer = setInterval(() => this.deliverPendingEmailsSafely(), 15_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private deliverPendingEmailsSafely() {
    void this.deliverPendingEmails()
      .then(() => {
        this.lastDeliveryCycleErrorLogAt = 0;
      })
      .catch((error) => {
        const now = Date.now();
        if (now - this.lastDeliveryCycleErrorLogAt >= 60_000) {
          this.lastDeliveryCycleErrorLogAt = now;
          this.logger.error(
            `Notification email delivery cycle failed: ${(error as Error).message}`,
          );
        }
      });
  }

  async publish(input: PublishNotificationInput) {
    const actionUrl = this.normalizeActionUrl(input.actionUrl);
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        email: true,
        emailVerified: true,
        isActive: true,
        notificationPreference: true,
      },
    });
    if (!user?.isActive) return null;

    const preferences = user.notificationPreference ?? DEFAULT_PREFERENCES;
    const emailEnabled =
      this.emailEnabled(preferences, input.category) && user.emailVerified && this.mail.isEnabled();
    const nextEmailAttemptAt = emailEnabled
      ? this.nextAllowedDelivery(
          preferences.quietStartMin,
          preferences.quietEndMin,
          preferences.timezone,
        )
      : null;

    try {
      return await this.prisma.notification.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          category: input.category,
          title: input.title.trim().slice(0, 120),
          body: input.body.trim().slice(0, 500),
          actionUrl,
          dedupeKey: input.dedupeKey.trim().slice(0, 192),
          browserRequested: preferences.inAppEnabled && preferences.browserEnabled,
          emailRequested: emailEnabled,
          emailStatus: emailEnabled ? 'PENDING' : 'SKIPPED',
          nextEmailAttemptAt,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return this.prisma.notification.findUnique({ where: { dedupeKey: input.dedupeKey } });
      }
      throw error;
    }
  }

  async publishSafely(input: PublishNotificationInput) {
    try {
      return await this.publish(input);
    } catch (error) {
      this.logger.warn(
        `Notification ${input.kind} could not be stored: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async list(userId: string, cursor?: string, limit = 25) {
    const preferences = await this.getPreferences(userId);
    if (!preferences.inAppEnabled) return { items: [], nextCursor: null, unreadCount: 0 };
    const take = Math.min(Math.max(limit, 1), 100);
    const now = new Date();
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, expiresAt: { gt: now } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          kind: true,
          category: true,
          title: true,
          body: true,
          actionUrl: true,
          browserRequested: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({
        where: { userId, readAt: null, expiresAt: { gt: now } },
      }),
    ]);
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, unreadCount };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async getPreferences(userId: string) {
    try {
      return await this.prisma.notificationPreference.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return this.prisma.notificationPreference.findUniqueOrThrow({ where: { userId } });
    }
  }

  async updatePreferences(userId: string, input: UpdateNotificationPreferencesInput) {
    const updates = {
      ...(input.inAppEnabled === undefined ? {} : { inAppEnabled: input.inAppEnabled }),
      ...(input.browserEnabled === undefined ? {} : { browserEnabled: input.browserEnabled }),
      ...(input.emailTurn === undefined ? {} : { emailTurn: input.emailTurn }),
      ...(input.emailRobot === undefined ? {} : { emailRobot: input.emailRobot }),
      ...(input.emailFinance === undefined ? {} : { emailFinance: input.emailFinance }),
      ...(input.quietStartMin === undefined ? {} : { quietStartMin: input.quietStartMin }),
      ...(input.quietEndMin === undefined ? {} : { quietEndMin: input.quietEndMin }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    };
    try {
      return await this.prisma.notificationPreference.upsert({
        where: { userId },
        create: { userId, ...updates },
        update: updates,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return this.prisma.notificationPreference.update({ where: { userId }, data: updates });
    }
  }

  async deliverPendingEmails() {
    const now = new Date();
    await this.prisma.notification.updateMany({
      where: { emailStatus: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
      data: { emailStatus: 'RETRY', nextEmailAttemptAt: now },
    });
    const pending = await this.prisma.notification.findMany({
      where: {
        emailStatus: { in: ['PENDING', 'RETRY'] },
        OR: [{ nextEmailAttemptAt: null }, { nextEmailAttemptAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: { user: { select: { email: true, emailVerified: true, isActive: true } } },
    });
    for (const notification of pending) {
      const claimed = await this.prisma.notification.updateMany({
        where: { id: notification.id, emailStatus: { in: ['PENDING', 'RETRY'] } },
        data: { emailStatus: 'SENDING', emailAttempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;
      if (
        !notification.user.isActive ||
        !notification.user.emailVerified ||
        !this.mail.isEnabled()
      ) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { emailStatus: 'SKIPPED', nextEmailAttemptAt: null },
        });
        continue;
      }
      try {
        const safeTitle = this.escapeHtml(notification.title);
        const safeBody = this.escapeHtml(notification.body);
        const link = notification.actionUrl
          ? `<p><a href="${this.escapeHtml(notification.actionUrl)}">Open BotParty</a></p>`
          : '';
        await this.mail.sendRaw(
          notification.user.email,
          notification.title,
          `<h1>${safeTitle}</h1><p>${safeBody}</p>${link}<p>You can change notification preferences in your BotParty settings.</p>`,
          `${notification.title}\n\n${notification.body}${notification.actionUrl ? `\n\n${notification.actionUrl}` : ''}\n\nYou can change notification preferences in your BotParty settings.`,
          undefined,
          `<notification-${notification.id}@botparty.live>`,
        );
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: 'DELIVERED',
            emailDeliveredAt: new Date(),
            nextEmailAttemptAt: null,
          },
        });
      } catch (error) {
        const attempts = notification.emailAttempts + 1;
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: attempts >= 5 ? 'FAILED' : 'RETRY',
            nextEmailAttemptAt:
              attempts >= 5
                ? null
                : new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** attempts)),
          },
        });
        this.logger.warn(
          `Notification email ${notification.id} failed: ${(error as Error).message}`,
        );
      }
    }
  }

  private emailEnabled(preferences: typeof DEFAULT_PREFERENCES, category: NotificationCategory) {
    if (category === 'TURN') return preferences.emailTurn;
    if (category === 'ROBOT') return preferences.emailRobot;
    return preferences.emailFinance;
  }

  private nextAllowedDelivery(start: number | null, end: number | null, timezone: string) {
    if (start === null || end === null) return new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const localMinute = hour * 60 + minute;
    const quiet =
      start < end
        ? localMinute >= start && localMinute < end
        : localMinute >= start || localMinute < end;
    if (!quiet) return new Date();
    const minutesUntilEnd = (end - localMinute + 1440) % 1440 || 1440;
    return new Date(Date.now() + minutesUntilEnd * 60_000);
  }

  private normalizeActionUrl(value?: string) {
    if (!value) return null;
    if (!value.startsWith('/') || value.startsWith('//')) return null;
    return value.slice(0, 512);
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
