import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Gauge, register } from 'prom-client';

import { BotGateway } from '../gateway/bot.gateway';
import { HealthService } from './health.service';

let defaultMetricsEnabled = false;

function getOrCreateGauge(name: string, help: string): Gauge<string> {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as Gauge<string>;
  return new Gauge({ name, help });
}

const gauges = {
  wsConnectedClients: getOrCreateGauge(
    'botparty_ws_connected_clients',
    'Total number of connected websocket clients',
  ),
  wsConnectedRobots: getOrCreateGauge(
    'botparty_ws_connected_robot_clients',
    'Total number of connected robot websocket clients',
  ),
  wsRooms: getOrCreateGauge('botparty_ws_active_rooms', 'Total number of active websocket rooms'),
  wsRoomMemberships: getOrCreateGauge(
    'botparty_ws_room_memberships',
    'Total number of websocket room memberships',
  ),
  wsActiveTurns: getOrCreateGauge(
    'botparty_ws_active_turns',
    'Total number of active control turns',
  ),
  wsControlCooldowns: getOrCreateGauge(
    'botparty_ws_control_cooldowns',
    'Total number of tracked control cooldown entries',
  ),
  queueDepth: getOrCreateGauge('botparty_queue_depth', 'Total queue depth across all robots'),
  databaseUp: getOrCreateGauge(
    'botparty_dependency_database_up',
    'Whether the API can reach the database (1=up, 0=down)',
  ),
  redisUp: getOrCreateGauge(
    'botparty_dependency_redis_up',
    'Whether the API can reach Redis (1=up, 0=down)',
  ),
  telemetryFresh: getOrCreateGauge(
    'botparty_robot_telemetry_fresh_robots',
    'Number of robots with telemetry received in the last 180 seconds',
  ),
  telemetryControlConnected: getOrCreateGauge(
    'botparty_robot_telemetry_control_connected_robots',
    'Number of robots with fresh telemetry and an active control connection',
  ),
  telemetryLivekitConnected: getOrCreateGauge(
    'botparty_robot_telemetry_livekit_connected_robots',
    'Number of robots with fresh telemetry and an active LiveKit connection',
  ),
  telemetryAvgCpu: getOrCreateGauge(
    'botparty_robot_telemetry_avg_cpu_percent',
    'Average CPU percent across robots with fresh telemetry',
  ),
  telemetryAvgMemory: getOrCreateGauge(
    'botparty_robot_telemetry_avg_memory_percent',
    'Average memory percent across robots with fresh telemetry',
  ),
  telemetryAvgTemperature: getOrCreateGauge(
    'botparty_robot_telemetry_avg_temperature_c',
    'Average temperature in Celsius across robots with fresh telemetry',
  ),
  queueOldestAge: getOrCreateGauge(
    'botparty_queue_oldest_entry_age_seconds',
    'Age of the oldest active queue entry in seconds',
  ),
  billingNeedsReview: getOrCreateGauge(
    'botparty_billing_needs_review',
    'Billing intents that require manual review',
  ),
  notificationEmailFailed: getOrCreateGauge(
    'botparty_notification_email_failed',
    'Notification email outbox rows in terminal failed state',
  ),
  webhookDeliveryFailed: getOrCreateGauge(
    'botparty_webhook_delivery_failed',
    'Active robot webhooks whose latest delivery failed',
  ),
  databaseConnections: getOrCreateGauge(
    'botparty_database_connections',
    'Current PostgreSQL connections for the BotParty database',
  ),
  redisMemoryBytes: getOrCreateGauge(
    'botparty_redis_memory_used_bytes',
    'Redis memory currently in use',
  ),
  livekitUp: getOrCreateGauge(
    'botparty_dependency_livekit_up',
    'Whether the API can reach LiveKit (1=up, 0=down)',
  ),
  objectStorageUp: getOrCreateGauge(
    'botparty_dependency_object_storage_up',
    'Whether the API can reach object storage (1=up, 0=down)',
  ),
  readReplicaUp: getOrCreateGauge(
    'botparty_dependency_read_replica_up',
    'Whether the configured read connection is reachable (1=up, 0=down)',
  ),
  readReplicaConfigured: getOrCreateGauge(
    'botparty_dependency_read_replica_configured',
    'Whether a distinct read replica is configured (1=yes, 0=no)',
  ),
};

@Injectable()
export class HealthMetricsService {
  constructor(
    private readonly health: HealthService,
    private readonly gateway: BotGateway,
  ) {
    if (!defaultMetricsEnabled) {
      collectDefaultMetrics({ prefix: 'botparty_api_' });
      defaultMetricsEnabled = true;
    }
  }

  async render(): Promise<string> {
    const websocket = this.gateway.getRuntimeMetricsSnapshot();
    gauges.wsConnectedClients.set(websocket.connectedClients);
    gauges.wsConnectedRobots.set(websocket.connectedRobotClients);
    gauges.wsRooms.set(websocket.activeRooms);
    gauges.wsRoomMemberships.set(websocket.roomMemberships);
    gauges.wsActiveTurns.set(websocket.activeTurns);
    gauges.wsControlCooldowns.set(websocket.controlCooldowns);

    const snapshot = await this.health.getMetricsSnapshot();
    gauges.databaseUp.set(snapshot.databaseUp);
    gauges.redisUp.set(snapshot.redisUp);
    gauges.queueDepth.set(snapshot.queueDepth);
    gauges.telemetryFresh.set(snapshot.robotTelemetry.freshRobots);
    gauges.telemetryControlConnected.set(snapshot.robotTelemetry.controlConnectedRobots);
    gauges.telemetryLivekitConnected.set(snapshot.robotTelemetry.livekitConnectedRobots);
    gauges.telemetryAvgCpu.set(snapshot.robotTelemetry.avgCpuPercent);
    gauges.telemetryAvgMemory.set(snapshot.robotTelemetry.avgMemoryPercent);
    gauges.telemetryAvgTemperature.set(snapshot.robotTelemetry.avgTemperatureC);
    gauges.queueOldestAge.set(snapshot.oldestQueueAgeSec);
    gauges.billingNeedsReview.set(snapshot.billingNeedsReview);
    gauges.notificationEmailFailed.set(snapshot.failedEmails);
    gauges.webhookDeliveryFailed.set(snapshot.failedWebhooks);
    gauges.databaseConnections.set(snapshot.databaseConnections);
    gauges.redisMemoryBytes.set(snapshot.redisMemoryBytes);
    gauges.livekitUp.set(snapshot.livekitUp);
    gauges.objectStorageUp.set(snapshot.objectStorageUp);
    gauges.readReplicaUp.set(snapshot.readReplicaUp);
    gauges.readReplicaConfigured.set(snapshot.readReplicaConfigured);

    return register.metrics();
  }
}
