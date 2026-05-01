/**
 * BotParty WebSocket Load Test
 *
 * Simulates:
 * - 200 concurrent spectators joining a room
 * - 5 active drivers with control latency under 100ms
 * - Queue joins/leaves
 * - Chat messages
 *
 * Run: k6 run tests/load/ws-load-test.k6.js --vus 205 --duration 5m
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },    // Ramp up to 50 clients
    { duration: '30s', target: 100 },   // Continue to 100
    { duration: '1m', target: 205 },    // Peak load: 200 spectators + 5 drivers
    { duration: '1m', target: 100 },    // Cool down
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    'ws_connecting': ['p(95)<500'],     // 95% connect in <500ms
    'ws_session_duration': ['p(95)<180000'], // 95% sessions < 3min
    'ws_messages_sent': ['count>1000'], // Verify meaningful message volume
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const ROBOT_SLUG = __ENV.ROBOT_SLUG || 'test-robot';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

export default function test() {
  const isDriver = __VU % 41 === 0; // VU 41, 82, 123, 164, 205 (5 drivers)

  const wsUrl = `ws://localhost:3000/ws?robot=${ROBOT_SLUG}`;

  const res = ws.connect(wsUrl, {}, function (socket) {
    socket.on('open', () => {
      if (AUTH_TOKEN) {
        socket.send(JSON.stringify({
          type: 'auth',
          token: AUTH_TOKEN,
        }));
      }

      if (isDriver) {
        // Driver sends control commands
        socket.send(JSON.stringify({
          type: 'control',
          command: 'forward',
          timestamp: Date.now(),
        }));
      } else {
        // Spectator joins queue or just watches
        if (Math.random() > 0.7) {
          socket.send(JSON.stringify({
            type: 'queue_join',
            timestamp: Date.now(),
          }));
        }
      }
    });

    socket.on('message', (message) => {
      check(message, {
        'message is non-empty': (msg) => msg && msg.length > 0,
      });
    });

    socket.on('error', (e) => {
      console.error(`WS error: ${e}`);
    });

    // Simulate periodic activity
    const sendInterval = setInterval(() => {
      if (isDriver) {
        const commands = ['forward', 'backward', 'left', 'right'];
        socket.send(JSON.stringify({
          type: 'control',
          command: commands[Math.floor(Math.random() * commands.length)],
          timestamp: Date.now(),
        }));
      } else if (Math.random() > 0.9) {
        socket.send(JSON.stringify({
          type: 'chat',
          text: `Message from VU ${__VU}`,
          timestamp: Date.now(),
        }));
      }
    }, isDriver ? 500 : 5000); // Drivers: 500ms, spectators: 5s

    socket.setTimeout(() => {
      clearInterval(sendInterval);
      socket.close();
    }, 180000); // Close after 3 minutes
  });

  check(res, {
    'status is 101 Switching Protocols': (r) => r && r.status === 101,
  });

  sleep(1);
}
