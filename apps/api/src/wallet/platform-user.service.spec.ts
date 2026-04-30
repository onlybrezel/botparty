import { ConfigService } from '@nestjs/config';
import { PlatformUserService } from './platform-user.service';

const PLATFORM_ID = '00000000-0000-0000-0000-00000000fee5';

function build(configMap: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn((key: string) => configMap[key]),
  } as unknown as ConfigService;
  const prisma = {} as never;
  return new PlatformUserService(prisma, config);
}

describe('PlatformUserService', () => {
  it('uses fallback platform user id when env is not set', () => {
    const svc = build();
    expect(svc.getPlatformUserId()).toBe(PLATFORM_ID);
    expect(svc.isPlatformUser(PLATFORM_ID)).toBe(true);
    expect(svc.isPlatformUser('11111111-1111-1111-1111-111111111111')).toBe(false);
  });

  it('honours PLATFORM_USER_ID and PLATFORM_FEE_BPS', () => {
    const svc = build({
      PLATFORM_USER_ID: '22222222-2222-2222-2222-222222222222',
      PLATFORM_FEE_BPS: '500',
    });
    expect(svc.getPlatformUserId()).toBe('22222222-2222-2222-2222-222222222222');
    expect(svc.getFeeBps()).toBe(500);
  });

  it('falls back to default fee bps when input is invalid or out of range', () => {
    expect(build({ PLATFORM_FEE_BPS: 'not-a-number' }).getFeeBps()).toBe(1000);
    expect(build({ PLATFORM_FEE_BPS: '-5' }).getFeeBps()).toBe(1000);
    expect(build({ PLATFORM_FEE_BPS: '99999' }).getFeeBps()).toBe(1000);
  });

  it('computeFee floors the result and treats non-positive amounts as zero', () => {
    const svc = build({ PLATFORM_FEE_BPS: '1000' });
    expect(svc.computeFee(100)).toBe(10);
    expect(svc.computeFee(99)).toBe(9); // floor(99 * 0.10) = 9
    expect(svc.computeFee(0)).toBe(0);
    expect(svc.computeFee(-50)).toBe(0);
  });

  it('computeFee uses configured bps', () => {
    const svc = build({ PLATFORM_FEE_BPS: '2500' });
    expect(svc.computeFee(200)).toBe(50);
  });
});
