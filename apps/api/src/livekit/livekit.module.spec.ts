import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from '../auth/auth.module';
import { LivekitModule } from './livekit.module';

describe('LivekitModule', () => {
  it('owns the authentication dependency required by robot runtime endpoints', () => {
    const imports: unknown = Reflect.getMetadata(MODULE_METADATA.IMPORTS, LivekitModule);
    if (!Array.isArray(imports)) {
      throw new Error('Expected LivekitModule imports metadata to be an array');
    }

    expect(imports).toContain(AuthModule);
  });
});
