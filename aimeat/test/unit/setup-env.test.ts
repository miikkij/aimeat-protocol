/**
 * @file test/unit/setup-env.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The .env the first-run setup route writes (services/setup-env.ts), the one writer of
 *   a .env line (utils/env-file.ts) and the 0600 file writer (utils/private-file.ts). Secrets audit
 *   2026-10-09, node configuration S1 and S4d: a line break in a setup field added a variable to
 *   .env, and the file was written with the default mode.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSetupNodeSettings, buildSetupEnv } from '../../src/services/setup-env.js';
import { envLine, EnvValueError } from '../../src/utils/env-file.js';
import { writePrivateFile, appendPrivateFile, ensurePrivateDir } from '../../src/utils/private-file.js';

const cfg = { nodeId: 'aimeat-local-001', port: 40050, nodeType: 'personal' };
const dir = mkdtempSync(join(tmpdir(), 'aimeat-setup-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The variables a reader of the file would set, one per `NAME=` line. */
const variablesIn = (content: string): string[] =>
  content.split('\n').filter(l => /^[A-Z_][A-Z0-9_]*=/.test(l)).map(l => l.slice(0, l.indexOf('=')));

describe('setup node settings', () => {
  it('refuses a line break, a carriage return or a quote in any of the four', () => {
    for (const body of [
      { genesisUrl: 'https://g.example\nAIMEAT_AI_PROVIDERS=[]' },
      { nodeId: 'a\nAIMEAT_X=1' },
      { nodeType: 'full"\nAIMEAT_X="1' },
      { locale: 'en\r\nAIMEAT_X=1' },
      { genesisUrl: 'https://g.example/"x' },
    ]) {
      expect(parseSetupNodeSettings(body).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it('refuses a value the node does not take', () => {
    for (const body of [
      { nodeType: 'galaxy' }, { nodeId: 'my node' }, { nodeId: 42 }, { locale: 'en_US.UTF-8' },
      { genesisUrl: 'javascript:alert(1)' }, { genesisUrl: 'https://u:p@g.example' }, { genesisUrl: 'https://g.example/a b' },
    ]) {
      expect(parseSetupNodeSettings(body).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it('takes what the wizard sends, and leaves out what it does not', () => {
    const r = parseSetupNodeSettings({ nodeId: 'aimeat-local-002', nodeType: 'full', locale: 'fi', genesisUrl: 'https://aimeat.io', port: 40100, owner: {} });
    expect(r).toEqual({ ok: true, settings: { nodeId: 'aimeat-local-002', nodeType: 'full', locale: 'fi', genesisUrl: 'https://aimeat.io', port: 40100 } });
    expect(parseSetupNodeSettings({ nodeId: '', locale: null, port: '80' })).toEqual({ ok: true, settings: {} });
  });

  it('writes one variable per setting and nothing else', () => {
    const r = parseSetupNodeSettings({ nodeId: 'n1', genesisUrl: 'https://aimeat.io', locale: 'es' });
    if (!r.ok) throw new Error(r.problem);
    const content = buildSetupEnv(r.settings, cfg, '2026-10-09T00:00:00.000Z');
    expect(variablesIn(content)).toEqual(['AIMEAT_NODE_ID', 'AIMEAT_PORT', 'AIMEAT_NODE_TYPE', 'AIMEAT_GENESIS_URL', 'AIMEAT_LOCALE']);
    expect(content).toContain('AIMEAT_GENESIS_URL="https://aimeat.io"');
    expect(content).toContain('AIMEAT_NODE_TYPE="personal"');
  });
});

describe('envLine', () => {
  it('quotes a value, and keeps a Windows path', () => {
    expect(envLine('AIMEAT_SQLITE_PATH', 'C:\\data\\aimeat.db')).toBe('AIMEAT_SQLITE_PATH="C:\\data\\aimeat.db"');
    expect(envLine('AIMEAT_PORT', 40050)).toBe('AIMEAT_PORT="40050"');
  });
  it('refuses a value that would end the line or the quote, and a name that is not one', () => {
    expect(() => envLine('AIMEAT_X', 'a\nB=1')).toThrow(EnvValueError);
    expect(() => envLine('AIMEAT_X', 'a\rB=1')).toThrow(EnvValueError);
    expect(() => envLine('AIMEAT_X', 'a"b')).toThrow(EnvValueError);
    expect(() => envLine('AIMEAT_X', 'a\u0000b')).toThrow(EnvValueError);
    expect(() => envLine('aimeat x', 'v')).toThrow(EnvValueError);
  });
});

// Windows keeps only the read-only attribute from a mode, so the mode bits are asserted on Unix.
describe.skipIf(process.platform === 'win32')('private files', () => {
  it('a file that existed at 0644 is 0600 after a write and after an append', () => {
    const p = join(dir, 'existing.env');
    writeFileSync(p, 'A=1\n');
    chmodSync(p, 0o644);
    writePrivateFile(p, 'B="2"\n');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    chmodSync(p, 0o644);
    appendPrivateFile(p, 'C="3"\n');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf-8')).toBe('B="2"\nC="3"\n');
  });
  it('a folder is 0700', () => {
    const d = join(dir, 'tokens');
    ensurePrivateDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });
});
