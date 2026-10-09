/**
 * @file admin-setup-secret.test.ts
 * @description The generated admin setup secret reaches a person through a 0600 file while the node
 *   has no owner, and through nothing else (secrets audit 2026-10-09, 1.4). Until then the boot
 *   wrote it to stderr, so anyone reading the server log could register an operator.
 * @usage cd aimeat && pnpm exec vitest run test/unit/admin-setup-secret.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, 1.4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ADMIN_SETUP_SECRET_FILE,
  adminSetupSecretDir,
  removeAdminSetupSecretFile,
  syncAdminSetupSecretFile,
} from '../../src/services/admin-setup-secret.js';

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aimeat-setup-secret-'));
  dir = join(root, 'data');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('syncAdminSetupSecretFile', () => {
  it('writes the secret to <dir>/admin-setup-secret when the node has no owner, creating the directory', () => {
    const r = syncAdminSetupSecretFile({ dir, secret: 's3cret-value', hasOwner: false });
    expect(r.action).toBe('written');
    expect(r.path).toBe(join(dir, ADMIN_SETUP_SECRET_FILE));
    expect(readFileSync(r.path, 'utf-8')).toBe('s3cret-value\n');
  });

  it.skipIf(process.platform === 'win32')('sets mode 0600 on create', () => {
    const r = syncAdminSetupSecretFile({ dir, secret: 'a', hasOwner: false });
    expect(statSync(r.path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('sets mode 0600 also when a world-readable file was left from an earlier boot', () => {
    syncAdminSetupSecretFile({ dir, secret: 'old', hasOwner: false });
    const path = join(dir, ADMIN_SETUP_SECRET_FILE);
    rmSync(path);
    writeFileSync(path, 'old\n', { mode: 0o644 });
    const r = syncAdminSetupSecretFile({ dir, secret: 'new', hasOwner: false });
    expect(readFileSync(r.path, 'utf-8')).toBe('new\n');
    expect(statSync(r.path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('replaces a symbolic link at the path instead of writing through it', () => {
    syncAdminSetupSecretFile({ dir, secret: 'x', hasOwner: false });
    const path = join(dir, ADMIN_SETUP_SECRET_FILE);
    const target = join(root, 'elsewhere.txt');
    writeFileSync(target, 'untouched\n');
    rmSync(path);
    symlinkSync(target, path);
    syncAdminSetupSecretFile({ dir, secret: 'secret', hasOwner: false });
    expect(readFileSync(target, 'utf-8')).toBe('untouched\n');
    expect(readFileSync(path, 'utf-8')).toBe('secret\n');
  });

  it('writes nothing and deletes a file left from an earlier boot when the node has an owner', () => {
    syncAdminSetupSecretFile({ dir, secret: 'old', hasOwner: false });
    const r = syncAdminSetupSecretFile({ dir, secret: 'new', hasOwner: true });
    expect(r.action).toBe('removed');
    expect(existsSync(r.path)).toBe(false);
  });

  it('writes nothing and deletes a stale file when the secret was set by the operator (null)', () => {
    syncAdminSetupSecretFile({ dir, secret: 'old', hasOwner: false });
    const r = syncAdminSetupSecretFile({ dir, secret: null, hasOwner: false });
    expect(r.action).toBe('removed');
    expect(existsSync(r.path)).toBe(false);
  });

  it('does nothing when the node has an owner and there is no file, and creates no directory', () => {
    const r = syncAdminSetupSecretFile({ dir, secret: 'x', hasOwner: true });
    expect(r.action).toBe('none');
    expect(existsSync(dir)).toBe(false);
  });
});

describe('removeAdminSetupSecretFile', () => {
  it('deletes the file and reports it, then reports none', () => {
    syncAdminSetupSecretFile({ dir, secret: 'x', hasOwner: false });
    expect(removeAdminSetupSecretFile(dir).action).toBe('removed');
    expect(removeAdminSetupSecretFile(dir).action).toBe('none');
  });
});

describe('adminSetupSecretDir', () => {
  it('is the directory of the database file on a SQLite node', () => {
    expect(adminSetupSecretDir({ storageProvider: 'sqlite', sqlitePath: './db/node.db' }, root))
      .toBe(resolve(root, 'db'));
  });

  it('is ./data under the working directory for in-memory SQLite and for Postgres', () => {
    expect(adminSetupSecretDir({ storageProvider: 'sqlite', sqlitePath: ':memory:' }, root)).toBe(resolve(root, 'data'));
    expect(adminSetupSecretDir({ storageProvider: 'postgres-kysely', sqlitePath: './db/node.db' }, root)).toBe(resolve(root, 'data'));
    expect(adminSetupSecretDir({ storageProvider: 'sqlite', sqlitePath: '' }, root)).toBe(resolve(root, 'data'));
  });
});
