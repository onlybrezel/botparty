import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('browser schemas validate without probing eval under a strict CSP', () => {
  const schemaUrl = new URL('../packages/shared/dist/schemas/index.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    globalThis.window = globalThis;
    let evalAttempts = 0;
    globalThis.Function = new Proxy(globalThis.Function, {
      apply() { evalAttempts++; throw new EvalError('CSP blocks eval'); },
      construct() { evalAttempts++; throw new EvalError('CSP blocks eval'); },
    });
    const { loginSchema, forgotPasswordSchema } = await import(${JSON.stringify(schemaUrl)});
    assert.equal(loginSchema.safeParse({ email: 'viewer@example.com', password: 'valid-password' }).success, true);
    assert.equal(loginSchema.safeParse({ email: 'invalid', password: '' }).success, false);
    assert.equal(forgotPasswordSchema.safeParse({ email: 'viewer@example.com' }).success, true);
    assert.equal(evalAttempts, 0, 'even a caught eval probe emits a browser CSP report');
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
