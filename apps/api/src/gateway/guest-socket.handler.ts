import type { WsClient } from './gateway-types';

const MAX_GUEST_SOCKETS_PER_IP = 5;

export class GuestSocketHandler {
  private readonly guestSocketsByIp = new Map<string, Set<string>>();

  canJoin(client: Pick<WsClient, 'remoteIp'>): boolean {
    const sockets = this.guestSocketsByIp.get(this.resolveIp(client));
    return (sockets?.size ?? 0) < MAX_GUEST_SOCKETS_PER_IP;
  }

  register(client: Pick<WsClient, 'id' | 'remoteIp'>): void {
    const ip = this.resolveIp(client);
    const sockets = this.guestSocketsByIp.get(ip) ?? new Set<string>();
    sockets.add(client.id);
    this.guestSocketsByIp.set(ip, sockets);
  }

  unregister(client: Pick<WsClient, 'id' | 'remoteIp'>): void {
    const ip = this.resolveIp(client);
    const sockets = this.guestSocketsByIp.get(ip);
    if (!sockets) {
      return;
    }

    sockets.delete(client.id);
    if (sockets.size === 0) {
      this.guestSocketsByIp.delete(ip);
    }
  }

  private resolveIp(client: Pick<WsClient, 'remoteIp'>): string {
    return client.remoteIp ?? 'unknown';
  }
}