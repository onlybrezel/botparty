import { WS_EVENTS, WS_MIN_SUPPORTED_PROTOCOL_VERSION, WS_PROTOCOL_VERSION } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import type { ModerationService } from '../moderation/moderation.service';
import type { RobotsService } from '../robots/robots.service';
import type { WsClient } from './gateway-types';
import {
  roomJoinSchema,
  roomPingSchema,
} from './gateway-payloads';
import type { GatewayRuntimeSupport } from './gateway-runtime.support';

type RoomRuntimePort = Pick<
  GatewayRuntimeSupport,
  | 'broadcastToRoom'
  | 'parseWsPayload'
  | 'resolveSocketUser'
  | 'rooms'
> & {
  guestSockets: Pick<GatewayRuntimeSupport['guestSockets'], 'canJoin' | 'register' | 'unregister'>;
  logger: Pick<GatewayRuntimeSupport['logger'], 'warn'>;
  presence: Pick<GatewayRuntimeSupport['presence'], 'refresh' | 'remove' | 'touch'>;
};
type RoomRobotsPort = Pick<
  RobotsService,
  'getRecentChatMessages' | 'resolveRoomAccessActorId' | 'validateRoomAccess'
>;

export class RoomHandler {
  constructor(
    private readonly runtime: RoomRuntimePort,
    private readonly robotsService: RoomRobotsPort,
    private readonly moderationService: Pick<ModerationService, 'getActiveRestriction'>,
  ) {}

  async handleJoin(client: WsClient, data: unknown) {
    const parsed = this.runtime.parseWsPayload(client, data, roomJoinSchema, 'Invalid room join payload');
    if (!parsed) {
      return;
    }
    client.protocolVersion = parsed.protocolVersion;

    if (client.watchingRobotId) {
      await this.leaveRoom(client);
    }

    const providedAccessToken = parsed.accessToken?.trim();
    let authPayload: JwtPayload | null;
    try {
      authPayload = await this.runtime.resolveSocketUser(providedAccessToken, client.cookieHeader);
    } catch (err) {
      this.runtime.logger.warn(`Failed to validate websocket auth for ${client.id}: ${(err as Error).message}`);
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Failed to validate session token' } }));
      return;
    }
    client.authAccessToken = authPayload ? providedAccessToken : undefined;

    this.runtime.guestSockets.unregister(client);
    client.watchingRobotId = parsed.robotId;
    const isGuest = authPayload === null;
    client.isGuest = isGuest;

    if (isGuest && !this.runtime.guestSockets.canJoin(client)) {
      this.resetViewerIdentity(client);
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Guest connection limit reached for this IP' } }));
      return;
    }

    if (authPayload === null) {
      const grantedActorId = await this.robotsService.resolveRoomAccessActorId(parsed.robotId, parsed.roomAccessToken);
      const derivedGuestId =
        grantedActorId && grantedActorId.startsWith('guest:')
          ? grantedActorId.slice('guest:'.length)
          : client.id.replace(/-/g, '').slice(0, 16);
      client.userId = `guest:${derivedGuestId}`;
      client.username = `Guest-${derivedGuestId.slice(0, 6)}`;
      client.role = undefined;
    } else {
      client.userId = authPayload.sub;
      client.username = authPayload.username || `User-${authPayload.sub.slice(0, 6)}`;
      client.role = authPayload.role;
    }

    const allowed = await this.robotsService.validateRoomAccess({
      robotId: parsed.robotId,
      actorId: client.userId,
      roomAccessToken: parsed.roomAccessToken,
    });
    if (!allowed) {
      this.resetViewerIdentity(client);
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Room access verification required' } }));
      return;
    }

    if (isGuest) {
      this.runtime.guestSockets.register(client);
    }

    let pendingRestriction:
      | { event: string; data: unknown }
      | null = null;

    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(parsed.robotId, client.userId);
      if (restriction) {
        const action = typeof restriction.action === 'string' ? restriction.action : 'TIMEOUT';
        const event =
          action === 'BAN'
            ? WS_EVENTS.MOD_BAN
            : action === 'KICK'
              ? WS_EVENTS.MOD_KICK
              : WS_EVENTS.MOD_TIMEOUT;

        if (action === 'BAN') {
          this.resetViewerIdentity(client);
          client.send(JSON.stringify({ event, data: restriction }));
          return;
        }

        pendingRestriction = { event, data: restriction };
      }
    }

    const roomClients = this.runtime.rooms.get(parsed.robotId) ?? new Set<string>();
    roomClients.add(client.id);
    this.runtime.rooms.set(parsed.robotId, roomClients);

    client.presenceJoinedAt = Date.now();
    const presenceSnapshot = await this.runtime.presence.refresh(client, parsed.robotId);

    if (presenceSnapshot.focusUserConnections === 1) {
      this.runtime.broadcastToRoom(
        parsed.robotId,
        WS_EVENTS.PRESENCE_JOIN,
        { userId: client.userId, username: client.username },
        client.id,
      );
    }

    client.send(JSON.stringify({ event: WS_EVENTS.PRESENCE_UPDATE, data: { viewers: presenceSnapshot.presenceList } }));

    const history = await this.robotsService.getRecentChatMessages(parsed.robotId);
    for (const entry of history) {
      client.send(JSON.stringify({ event: WS_EVENTS.CHAT_MESSAGE, data: { ...entry, historical: true } }));
    }

    if (pendingRestriction) {
      client.send(JSON.stringify({ event: pendingRestriction.event, data: pendingRestriction.data }));
    }

    return {
      event: WS_EVENTS.ROOM_JOIN,
      data: {
        ok: true,
        viewerCount: presenceSnapshot.viewerCount,
        protocolVersion: WS_PROTOCOL_VERSION,
        minProtocolVersion: WS_MIN_SUPPORTED_PROTOCOL_VERSION,
        clientProtocolVersion: parsed.protocolVersion,
      },
    };
  }

  async handlePing(client: WsClient, data: unknown) {
    const parsed = this.runtime.parseWsPayload(client, data, roomPingSchema, 'Invalid room ping payload');
    if (!parsed) {
      return;
    }

    if (!client.watchingRobotId || client.watchingRobotId !== parsed.robotId || !client.userId) {
      return;
    }

    await this.runtime.presence.touch(client, parsed.robotId);
  }

  async leaveRoom(client: WsClient) {
    const robotId = client.watchingRobotId;
    if (!robotId) {
      return;
    }

    const room = this.runtime.rooms.get(robotId);
    room?.delete(client.id);
    if (room && room.size === 0) {
      this.runtime.rooms.delete(robotId);
    }

    client.watchingRobotId = undefined;
    if (client.isGuest) {
      this.runtime.guestSockets.unregister(client);
    }
    if (!client.userId) {
      return;
    }

    const snapshot = await this.runtime.presence.remove(client, robotId);
    if (snapshot.focusUserConnections === 0) {
      this.runtime.broadcastToRoom(robotId, WS_EVENTS.PRESENCE_LEAVE, {
        userId: client.userId,
        username: client.username,
      });
    }
    if (snapshot.cleanedStaleEntries) {
      this.runtime.broadcastToRoom(robotId, WS_EVENTS.PRESENCE_UPDATE, {
        viewers: snapshot.presenceList,
      });
    }
  }

  private resetViewerIdentity(client: WsClient) {
    client.watchingRobotId = undefined;
    client.userId = undefined;
    client.username = undefined;
    client.authAccessToken = undefined;
    client.isGuest = undefined;
    client.role = undefined;
  }
}
