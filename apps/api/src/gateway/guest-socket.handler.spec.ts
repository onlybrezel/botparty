import { GuestSocketHandler } from './guest-socket.handler';

describe('GuestSocketHandler', () => {
  let handler: GuestSocketHandler;

  beforeEach(() => {
    handler = new GuestSocketHandler();
  });

  it('limits guest sockets per IP and frees capacity after unregister', () => {
    for (let index = 0; index < 5; index += 1) {
      expect(handler.canJoin({ remoteIp: '203.0.113.10' })).toBe(true);
      handler.register({ id: `guest-${index}`, remoteIp: '203.0.113.10' });
    }

    expect(handler.canJoin({ remoteIp: '203.0.113.10' })).toBe(false);

    handler.unregister({ id: 'guest-2', remoteIp: '203.0.113.10' });

    expect(handler.canJoin({ remoteIp: '203.0.113.10' })).toBe(true);
  });

  it('tracks unknown remote addresses and cleans them up', () => {
    handler.register({ id: 'guest-a', remoteIp: undefined });
    handler.register({ id: 'guest-b', remoteIp: undefined });

    expect(handler.canJoin({ remoteIp: undefined })).toBe(true);

    handler.unregister({ id: 'guest-a', remoteIp: undefined });
    handler.unregister({ id: 'guest-b', remoteIp: undefined });

    expect(handler.canJoin({ remoteIp: undefined })).toBe(true);
  });
});