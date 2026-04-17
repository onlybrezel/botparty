import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

type ChatPersistJob = {
  robotId: string;
  userId: string;
  content: string;
  timestampMs: number;
};

const CHAT_PERSIST_QUEUE = 'chat-persist';
const CHAT_PERSIST_JOB = 'chat-message';

@Injectable()
export class ChatPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatPersistenceService.name);
  private queue: Queue<ChatPersistJob> | null = null;
  private worker: Worker<ChatPersistJob> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const connection = {
      host: this.configService.get<string>('REDIS_HOST', 'redis'),
      port: Number(this.configService.get<string>('REDIS_PORT', '6379')),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue<ChatPersistJob>(CHAT_PERSIST_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 250,
        },
      },
    });

    this.worker = new Worker<ChatPersistJob>(
      CHAT_PERSIST_QUEUE,
      async (job) => this.persistJob(job),
      {
        connection,
        concurrency: 4,
      },
    );

    this.worker.on('failed', (job, error) => {
      const id = job?.id ?? 'unknown';
      this.logger.warn(`Chat persistence job ${String(id)} failed: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  async enqueue(input: ChatPersistJob) {
    if (!this.queue) {
      this.logger.warn('Chat persistence queue not initialized; dropping message');
      return;
    }

    await this.queue.add(CHAT_PERSIST_JOB, input);
  }

  private async persistJob(job: Job<ChatPersistJob>) {
    const { robotId, userId, content, timestampMs } = job.data;
    await this.prisma.chatMessage.create({
      data: {
        robotId,
        userId,
        content,
        isSystem: false,
        createdAt: new Date(timestampMs),
      },
    });
  }
}
