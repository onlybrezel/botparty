import WebSocket from 'ws';
import type { WsClient } from '../gateway/gateway-types';

export function createWsClient(overrides: Partial<WsClient> = {}): WsClient {
  return {
    id: 'socket-1',
    readyState: WebSocket.OPEN,
    close: jest.fn(),
    ping: jest.fn(),
    send: jest.fn(),
    ...overrides,
  };
}
