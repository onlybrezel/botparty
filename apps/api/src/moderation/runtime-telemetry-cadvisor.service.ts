import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ContainerMetricAccumulator = {
  service: string;
  containerName: string | null;
  cpuUsageSeconds: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  rxBytes: number;
  txBytes: number;
};

type CadvisorSample = {
  capturedAt: number;
  machineCpuCores: number | null;
  machineMemoryBytes: number | null;
  hostCpuUsageSeconds: number | null;
  hostMemoryUsageBytes: number | null;
  hostRxBytes: number;
  hostTxBytes: number;
  containers: Map<string, ContainerMetricAccumulator>;
};

@Injectable()
export class RuntimeTelemetryCadvisorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeTelemetryCadvisorService.name);
  private previousCadvisorSample: CadvisorSample | null = null;
  private cadvisorWarmupInterval: ReturnType<typeof setInterval> | null = null;
  private cadvisorWarmupInFlight = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    void this.warmSample();
    this.cadvisorWarmupInterval = setInterval(() => {
      void this.warmSample();
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.cadvisorWarmupInterval) {
      clearInterval(this.cadvisorWarmupInterval);
      this.cadvisorWarmupInterval = null;
    }
  }

  async getRuntime() {
    const cadvisorUrl = this.config.get<string>('CADVISOR_URL')?.trim();
    if (!cadvisorUrl) {
      return {
        available: false,
        error: 'CADVISOR_URL not configured',
        host: null,
        containers: [] as Array<{
          service: string;
          containerName: string | null;
          cpuPercent: number | null;
          memoryUsageBytes: number | null;
          memoryLimitBytes: number | null;
          memoryPercent: number | null;
          rxKbps: number | null;
          txKbps: number | null;
        }>,
      };
    }

    try {
      const response = await fetch(`${cadvisorUrl.replace(/\/$/, '')}/metrics`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        throw new Error(`cAdvisor returned ${response.status}`);
      }

      const text = await response.text();
      const current = this.parseCadvisorMetrics(text);
      const previous = this.previousCadvisorSample;
      this.previousCadvisorSample = current;

      const hostCpuPercent = this.computeCpuPercent(
        current.hostCpuUsageSeconds,
        previous?.hostCpuUsageSeconds ?? null,
        current.capturedAt,
        previous?.capturedAt ?? null,
        current.machineCpuCores,
      );
      const hostRxKbps = this.computeRateKbps(current.hostRxBytes, previous?.hostRxBytes ?? null, current.capturedAt, previous?.capturedAt ?? null);
      const hostTxKbps = this.computeRateKbps(current.hostTxBytes, previous?.hostTxBytes ?? null, current.capturedAt, previous?.capturedAt ?? null);

      const containers = Array.from(current.containers.values())
        .map((container) => {
          const previousContainer = previous?.containers.get(container.service) ?? null;
          const memoryLimitBytes =
            typeof container.memoryLimitBytes === 'number' && container.memoryLimitBytes > 0
              ? container.memoryLimitBytes
              : current.machineMemoryBytes;
          const memoryPercent =
            typeof container.memoryUsageBytes === 'number' && typeof memoryLimitBytes === 'number' && memoryLimitBytes > 0
              ? Number(((container.memoryUsageBytes / memoryLimitBytes) * 100).toFixed(1))
              : null;

          return {
            service: container.service,
            containerName: container.containerName,
            cpuPercent: this.computeCpuPercent(
              container.cpuUsageSeconds,
              previousContainer?.cpuUsageSeconds ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
              current.machineCpuCores,
            ),
            memoryUsageBytes: container.memoryUsageBytes,
            memoryLimitBytes,
            memoryPercent,
            rxKbps: this.computeRateKbps(
              container.rxBytes,
              previousContainer?.rxBytes ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
            ),
            txKbps: this.computeRateKbps(
              container.txBytes,
              previousContainer?.txBytes ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
            ),
          };
        })
        .sort((left, right) => left.service.localeCompare(right.service));

      return {
        available: true,
        error: null,
        host: {
          cpuCores: current.machineCpuCores,
          memoryBytes: current.machineMemoryBytes,
          cpuPercent: hostCpuPercent,
          memoryUsageBytes: current.hostMemoryUsageBytes,
          memoryPercent:
            typeof current.hostMemoryUsageBytes === 'number' && typeof current.machineMemoryBytes === 'number' && current.machineMemoryBytes > 0
              ? Number(((current.hostMemoryUsageBytes / current.machineMemoryBytes) * 100).toFixed(1))
              : null,
          rxKbps: hostRxKbps,
          txKbps: hostTxKbps,
        },
        containers,
      };
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : 'cAdvisor unavailable',
        host: null,
        containers: [],
      };
    }
  }

  async warmSample() {
    const cadvisorUrl = this.config.get<string>('CADVISOR_URL')?.trim();
    if (!cadvisorUrl || this.cadvisorWarmupInFlight) {
      return;
    }

    this.cadvisorWarmupInFlight = true;
    try {
      await this.getRuntime();
    } catch (err) {
      this.logger.debug(`cAdvisor warmup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      this.cadvisorWarmupInFlight = false;
    }
  }

  private parseCadvisorMetrics(text: string): CadvisorSample {
    const containers = new Map<string, ContainerMetricAccumulator>();
    const sample: CadvisorSample = {
      capturedAt: Date.now(),
      machineCpuCores: null,
      machineMemoryBytes: null,
      hostCpuUsageSeconds: null,
      hostMemoryUsageBytes: null,
      hostRxBytes: 0,
      hostTxBytes: 0,
      containers,
    };

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const parsed = this.parsePrometheusLine(line);
      if (!parsed) {
        continue;
      }

      const { metric, labels, value } = parsed;
      if (metric === 'machine_cpu_cores') {
        sample.machineCpuCores = value;
        continue;
      }
      if (metric === 'machine_memory_bytes') {
        sample.machineMemoryBytes = value;
        continue;
      }

      const id = labels['id'] ?? labels['name'] ?? '';
      const containerName = this.normalizeCadvisorContainerName(labels['name']?.trim() || labels['container']?.trim() || null);
      const service = this.resolveCadvisorService(labels, containerName);
      const interfaceName = labels['interface']?.trim();

      if (id === '/') {
        if (metric === 'container_cpu_usage_seconds_total') {
          sample.hostCpuUsageSeconds = value;
        } else if (metric === 'container_memory_working_set_bytes') {
          sample.hostMemoryUsageBytes = value;
        } else if (metric === 'container_network_receive_bytes_total' && interfaceName !== 'lo') {
          sample.hostRxBytes += value;
        } else if (metric === 'container_network_transmit_bytes_total' && interfaceName !== 'lo') {
          sample.hostTxBytes += value;
        }
        continue;
      }

      if (!service) {
        continue;
      }

      const entry = containers.get(service) ?? {
        service,
        containerName,
        cpuUsageSeconds: null,
        memoryUsageBytes: null,
        memoryLimitBytes: null,
        rxBytes: 0,
        txBytes: 0,
      };
      if (!entry.containerName && containerName) {
        entry.containerName = containerName;
      }

      if (metric === 'container_cpu_usage_seconds_total') {
        entry.cpuUsageSeconds = value;
      } else if (metric === 'container_memory_working_set_bytes') {
        entry.memoryUsageBytes = value;
      } else if (metric === 'container_spec_memory_limit_bytes') {
        entry.memoryLimitBytes = value;
      } else if (metric === 'container_network_receive_bytes_total' && interfaceName !== 'lo') {
        entry.rxBytes += value;
      } else if (metric === 'container_network_transmit_bytes_total' && interfaceName !== 'lo') {
        entry.txBytes += value;
      }

      containers.set(service, entry);
    }

    return sample;
  }

  private parsePrometheusLine(line: string): { metric: string; labels: Record<string, string>; value: number } | null {
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?:\s+[-+]?\d+)?$/,
    );
    if (!match) {
      return null;
    }

    const metric = match[1];
    const labelsRaw = match[3] ?? '';
    const value = Number(match[4]);
    if (!metric || !Number.isFinite(value)) {
      return null;
    }

    const labels: Record<string, string> = {};
    const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;
    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelPattern.exec(labelsRaw)) !== null) {
      const labelKey = labelMatch[1];
      const labelValue = labelMatch[2];
      if (!labelKey || labelValue === undefined) {
        continue;
      }
      labels[labelKey] = labelValue
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    return { metric, labels, value };
  }

  private normalizeCadvisorContainerName(name: string | null): string | null {
    if (!name) {
      return null;
    }

    const normalized = name.trim().replace(/^\/+/, '');
    return normalized || null;
  }

  private resolveCadvisorService(labels: Record<string, string>, containerName: string | null) {
    const composeProject = labels['container_label_com_docker_compose_project']?.trim().toLowerCase() ?? '';
    const composeService = labels['container_label_com_docker_compose_service']?.trim();
    const normalizedContainerName = containerName?.trim().toLowerCase() ?? '';
    const belongsToBotparty = composeProject.includes('botparty') || normalizedContainerName.includes('botparty');

    if (composeService && belongsToBotparty) {
      return this.matchKnownCadvisorService(composeService) ?? composeService;
    }

    if (!containerName || !belongsToBotparty) {
      return '';
    }

    return this.matchKnownCadvisorService(containerName) ?? containerName;
  }

  private matchKnownCadvisorService(value: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/^\/+/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!normalized) {
      return null;
    }

    const knownServices = [
      'livekit-ingress',
      'livekit-egress',
      'livekit',
      'postgres',
      'redis',
      'cadvisor',
      'nginx',
      'api',
      'web',
    ] as const;

    for (const service of knownServices) {
      if (
        normalized === service ||
        normalized.endsWith(`-${service}`) ||
        normalized.startsWith(`${service}-`) ||
        normalized.includes(`-${service}-`)
      ) {
        return service;
      }
    }

    return null;
  }

  private computeCpuPercent(
    currentValue: number | null,
    previousValue: number | null,
    currentTs: number,
    previousTs: number | null,
    machineCpuCores: number | null,
  ) {
    if (
      typeof currentValue !== 'number' ||
      typeof previousValue !== 'number' ||
      typeof previousTs !== 'number' ||
      typeof machineCpuCores !== 'number' ||
      machineCpuCores <= 0
    ) {
      return null;
    }

    const deltaSeconds = (currentTs - previousTs) / 1000;
    const deltaCpu = currentValue - previousValue;
    if (deltaSeconds <= 0 || deltaCpu < 0) {
      return null;
    }

    return Number(Math.max(0, Math.min(100, (deltaCpu / deltaSeconds / machineCpuCores) * 100)).toFixed(1));
  }

  private computeRateKbps(currentValue: number, previousValue: number | null, currentTs: number, previousTs: number | null) {
    if (typeof previousValue !== 'number' || typeof previousTs !== 'number') {
      return null;
    }

    const deltaSeconds = (currentTs - previousTs) / 1000;
    const deltaBytes = currentValue - previousValue;
    if (deltaSeconds <= 0 || deltaBytes < 0) {
      return null;
    }

    return Number((((deltaBytes * 8) / 1000) / deltaSeconds).toFixed(1));
  }
}
