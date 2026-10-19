import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./write-backup-manifest.mjs', import.meta.url));

for (const [serverVersionNum, expectedMajor] of [['160011', 16], ['180002', 18]]) {
  test(`records PostgreSQL ${expectedMajor} from the source server version`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'backup-manifest-'));
    try {
      const output = join(directory, 'manifest.json');
      const result = spawnSync(process.execPath, [script, output], {
        env: { ...process.env, BACKUP_POSTGRES_VERSION_NUM: serverVersionNum },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(readFileSync(output, 'utf8')).postgresMajor, expectedMajor);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('rejects absent or malformed source versions instead of recording an assumed major', () => {
  for (const version of ['', '18.2', '180002junk']) {
    const result = spawnSync(process.execPath, [script, 'unused-manifest.json'], {
      env: { ...process.env, BACKUP_POSTGRES_VERSION_NUM: version },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /valid PostgreSQL source server_version_num/);
  }
});
