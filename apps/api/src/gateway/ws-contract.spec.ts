import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  WS_EVENTS,
  WS_PROTOCOL_VERSION,
} from '@botparty/shared';

function parsePythonWsEvents(source: string): Record<string, string> {
  const dictMatch = source.match(/WS_EVENTS(?:\s*:[^=]+)?\s*=\s*\{([\s\S]*?)^\}/m);
  if (!dictMatch) {
    throw new Error('Unable to locate WS_EVENTS in Python protocol file');
  }

  const dictBody = dictMatch[1];
  if (typeof dictBody !== 'string') {
    throw new Error('Unable to parse WS_EVENTS body from Python protocol file');
  }

  return Object.fromEntries(
    Array.from(dictBody.matchAll(/"([A-Z_]+)"\s*:\s*"([^"]+)"/g), (match) => [match[1], match[2]]),
  );
}

function parsePythonProtocolVersion(source: string): number {
  const versionMatch = source.match(/WS_PROTOCOL_VERSION\s*=\s*(\d+)/);
  if (!versionMatch) {
    throw new Error('Unable to locate WS_PROTOCOL_VERSION in Python protocol file');
  }
  return Number(versionMatch[1]);
}

const pythonProtocolPath = process.env.BOTPARTY_CLIENT_PROTOCOL_FILE
  ? path.resolve(process.env.BOTPARTY_CLIENT_PROTOCOL_FILE)
  : path.resolve(__dirname, '../../../../../botparty-client/botparty_robot/ws_protocol.py');

(existsSync(pythonProtocolPath) ? describe : describe.skip)('Python websocket contract', () => {
  const source = readFileSync(pythonProtocolPath, 'utf-8');

  it('matches shared websocket event names used by the robot client', () => {
    expect(parsePythonWsEvents(source)).toMatchObject({
      ROBOT_CLAIM: WS_EVENTS.ROBOT_CLAIM,
      ROBOT_HEARTBEAT: WS_EVENTS.ROBOT_HEARTBEAT,
      ROBOT_TELEMETRY: WS_EVENTS.ROBOT_TELEMETRY,
      ROBOT_ACTIONS_PULL: WS_EVENTS.ROBOT_ACTIONS_PULL,
      ROBOT_ACTIONS: WS_EVENTS.ROBOT_ACTIONS,
      CONTROL_COMMAND: WS_EVENTS.CONTROL_COMMAND,
      CONTROL_EMERGENCY_STOP: WS_EVENTS.CONTROL_EMERGENCY_STOP,
      SERVER_SHUTDOWN: WS_EVENTS.SERVER_SHUTDOWN,
    });
  });

  it('shares the websocket protocol version', () => {
    expect(parsePythonProtocolVersion(source)).toBe(WS_PROTOCOL_VERSION);
  });
});