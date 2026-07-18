import { Logger } from '@nestjs/common';
import { WS_EVENTS, LIMITS, chatMessageSchema } from '@botparty/shared';
import { isStaffRole } from '../common/robot-access';
import type { ModerationService } from '../moderation/moderation.service';
import type { RobotsService } from '../robots/robots.service';
import type { CommandMetadata, WsClient } from './gateway-types';

export interface ChatHandlerContext {
  broadcastToRoom(robotId: string, event: string, data: unknown, excludeClientId?: string): void;
  getOpenRobotClient(robotId: string): WsClient | undefined;
  buildCommandMetadata(client: WsClient, robotId: string, ownerId?: string | null): CommandMetadata;
  reserveChatMessage(actorId: string, clientMessageId: string): Promise<boolean>;
}

const incomingChatSchema = chatMessageSchema.strict();

export class ChatHandler {
  private readonly logger = new Logger(ChatHandler.name);

  constructor(
    private readonly ctx: ChatHandlerContext,
    private readonly robotsService: RobotsService,
    private readonly moderationService: ModerationService,
  ) {}

  async handle(client: WsClient, rawPayload: unknown): Promise<void> {
    const parsed = incomingChatSchema.safeParse(rawPayload);
    if (!parsed.success) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid chat payload' } }));
      return;
    }
    const data = parsed.data;

    if (!(await this.ctx.reserveChatMessage(client.userId ?? client.id, data.clientMessageId))) {
      return;
    }

    if (client.watchingRobotId !== data.robotId) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Join the room before chatting' } }));
      return;
    }

    const robot = await this.robotsService.findByIdCached(data.robotId);
    const access = await this.robotsService.getAccessPolicy(data.robotId);
    if (access.chat === 'DISABLED') {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Chat is disabled for this robot' } }));
      return;
    }
    if (access.chat === 'AUTHENTICATED' && client.isGuest) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Please sign in to chat in this room' } }));
      return;
    }

    if (!data.content?.trim() || data.content.length > LIMITS.MAX_CHAT_MESSAGE_LENGTH) {
      client.send(
        JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: `Chat messages must be 1-${LIMITS.MAX_CHAT_MESSAGE_LENGTH} chars` } }),
      );
      return;
    }

    const { sanitized, hasIllegalChars } = this.moderationService.sanitizeChatContent(data.content);
    if (!sanitized) {
      return;
    }
    if (hasIllegalChars) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Message contains invalid characters' } }));
      return;
    }

    if (this.moderationService.containsForbiddenSymbols(sanitized)) {
      if (client.userId) {
        this.moderationService
          .recordProfanityEvent({
            robotId: data.robotId,
            userId: client.userId,
            username: client.username ?? 'unknown',
            content: sanitized,
          })
          .catch((error: unknown) => {
            this.logger.warn(`Failed to record forbidden-symbol moderation event: ${(error as Error).message}`);
          });
      }
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Message blocked by moderation filter' } }));
      return;
    }

    if (this.moderationService.containsProfanity(sanitized)) {
      if (client.userId) {
        this.moderationService
          .recordProfanityEvent({
            robotId: data.robotId,
            userId: client.userId,
            username: client.username ?? 'unknown',
            content: sanitized,
          })
          .catch((error: unknown) => {
            this.logger.warn(`Failed to record profanity moderation event: ${(error as Error).message}`);
          });
      }
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Message blocked by profanity filter' } }));
      return;
    }

    const now = Date.now();
    const rateMs = isStaffRole(client.role) ? LIMITS.CHAT_RATE_LIMIT_ADMIN_MS : LIMITS.CHAT_RATE_LIMIT_MS;
    if (client.lastChatAt && now - client.lastChatAt < rateMs) return;
    client.lastChatAt = now;

    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(data.robotId, client.userId);
      if (restriction) {
        client.send(
          JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'You are restricted in this room', restriction } }),
        );
        return;
      }
    }

    const isRobotOwner = Boolean(client.userId) && client.userId === robot.ownerId;
    const isSiteAdmin = client.role === 'ADMIN';
    const isSiteModerator = isStaffRole(client.role) && !isSiteAdmin;

    this.ctx.broadcastToRoom(data.robotId, WS_EVENTS.CHAT_MESSAGE, {
      userId: client.userId,
      username: client.username,
      content: sanitized,
      timestamp: now,
      clientMessageId: data.clientMessageId,
    });

    void this.robotsService.appendChatMessage(data.robotId, client.userId, sanitized, now, data.clientMessageId).catch((err) => {
      this.logger.warn(`Failed to persist chat message for ${data.robotId}: ${String(err)}`);
    });

    const robotClient = this.ctx.getOpenRobotClient(data.robotId);
    if (robotClient) {
      robotClient.send(
        JSON.stringify({
          event: WS_EVENTS.CONTROL_COMMAND,
          data: {
            command: 'chat',
            value: {
              message: sanitized,
              sender: client.username,
              anonymous: client.isGuest,
              user: {
                id: client.userId ?? null,
                username: client.username ?? null,
                role: client.role ?? null,
                isGuest: Boolean(client.isGuest),
                isRobotOwner,
                isSiteAdmin,
                isSiteModerator,
              },
              robotId: data.robotId,
            },
            metadata: this.ctx.buildCommandMetadata(client, data.robotId, robot.ownerId),
            timestamp: now,
          },
        }),
      );
    }
  }
}
