import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const output of ['dist', 'dist/browser']) {
  for (const entry of ['index', 'auth']) {
    test(`browser schemas (${output}/${entry}) validate without probing eval under a strict CSP`, () => {
      const schemaUrl = new URL(`../packages/shared/${output}/schemas/${entry}.js`, import.meta.url).href;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        globalThis.window = globalThis;
        let evalAttempts = 0;
        globalThis.Function = new Proxy(globalThis.Function, {
          apply() { evalAttempts++; throw new EvalError('CSP blocks eval'); },
          construct() { evalAttempts++; throw new EvalError('CSP blocks eval'); },
        });
        const { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } = await import(${JSON.stringify(schemaUrl)});
        const { LEGAL_POLICY_VERSIONS } = await import(new URL('../constants/index.js', ${JSON.stringify(schemaUrl)}));
        assert.equal(loginSchema.safeParse({ email: 'viewer@example.com', password: 'valid-password' }).success, true);
        assert.equal(loginSchema.safeParse({ email: 'invalid', password: '' }).success, false);
        assert.equal(forgotPasswordSchema.safeParse({ email: 'viewer@example.com' }).success, true);
        const registration = {
          username: 'viewer', email: 'viewer@example.com', password: 'valid-password',
          acceptedTermsVersion: LEGAL_POLICY_VERSIONS.TERMS,
          acceptedPrivacyVersion: LEGAL_POLICY_VERSIONS.PRIVACY,
        };
        assert.equal(registerSchema.safeParse(registration).success, true);
        assert.equal(registerSchema.safeParse({ ...registration, acceptedTermsVersion: 'retired' }).success, false);
        assert.equal(resetPasswordSchema.safeParse({ token: 'x'.repeat(16), password: 'valid-password' }).success, true);
        assert.equal(resetPasswordSchema.safeParse({ token: 'short', password: 'weak' }).success, false);
        assert.equal(evalAttempts, 0, 'even a caught eval probe emits a browser CSP report');
      `], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    });
  }
}
