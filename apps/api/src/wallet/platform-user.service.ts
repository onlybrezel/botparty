import { Injectable, Logger, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const PLATFORM_USER_FALLBACK_ID = '00000000-0000-0000-0000-00000000fee5';

@Injectable()
export class PlatformUserService implements OnModuleInit {
  private readonly logger = new Logger(PlatformUserService.name);
  private readonly platformUserId: string;
  private readonly feeBps: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.platformUserId = this.config.get<string>('PLATFORM_USER_ID') ?? PLATFORM_USER_FALLBACK_ID;
    const rawBps = Number(this.config.get<string>('PLATFORM_FEE_BPS') ?? '1000');
    this.feeBps = Number.isFinite(rawBps) && rawBps >= 0 && rawBps <= 5_000 ? Math.round(rawBps) : 1_000;
  }

  async onModuleInit() {
    const platform = await this.prisma.user.findUnique({
      where: { id: this.platformUserId },
      select: { id: true, isActive: true },
    });
    if (!platform) {
      this.logger.error(
        `Platform user ${this.platformUserId} missing. Run migrations to seed it before serving traffic.`,
      );
      throw new InternalServerErrorException('Platform user is not provisioned');
    }
    if (!platform.isActive) {
      this.logger.error(`Platform user ${this.platformUserId} exists but is inactive.`);
      throw new InternalServerErrorException('Platform user is inactive');
    }
    this.logger.log(`Platform user ready (id=${platform.id}, fee=${this.feeBps}bps)`);
  }

  getPlatformUserId(): string {
    return this.platformUserId;
  }

  /** Fee is calculated as floor(gross * bps / 10_000). */
  computeFee(gross: number): number {
    if (gross <= 0) return 0;
    return Math.floor((gross * this.feeBps) / 10_000);
  }

  getFeeBps(): number {
    return this.feeBps;
  }

  isPlatformUser(userId: string): boolean {
    return userId === this.platformUserId;
  }
}
