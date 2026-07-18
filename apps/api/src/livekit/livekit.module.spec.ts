import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from '../auth/auth.module';
import { LivekitModule } from './livekit.module';

describe('LivekitModule', () => {
  it('owns the authentication dependency required by robot runtime endpoints', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, LivekitModule) as unknown[];

    expect(imports).toContain(AuthModule);
  });
});
