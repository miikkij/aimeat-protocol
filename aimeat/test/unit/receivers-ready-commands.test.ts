/**
 * @file test/unit/receivers-ready-commands.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ready commands of the Incoming webhooks page's key-once view
 *   (public/views/profile/receivers/commands.js and dialogs.js readyCommands): a POSIX line and a
 *   PowerShell line that carry the node's address, the API key just shown and an example message, so
 *   a person pastes one and runs it with nothing to edit.
 *
 *   THE CASE (developer, 2026-11-08): to try an incoming webhook he had to find the API key shown
 *   once elsewhere and paste it into the command by hand, because the view's curl read the key from
 *   $AIMEAT_RECEIVER_KEY. FIRST FAIL: against dialogs.js v1.1.1 commands.js does not exist and the
 *   key-once view holds no command with the key in it.
 *
 *   Each line is checked three ways: a quoting model written here (always), the real bash when the
 *   host has one, and the real Windows PowerShell or PowerShell 7 when the host has one, each with the
 *   command's program replaced by a function that prints the arguments it got. The values hold single
 *   quotes, a typographic quote, ampersands, dollars, percent signs, backticks and `!`. The example
 *   message built from every bundled data description (docs/csm-examples) passes the server's own
 *   schema check. The living document's gear link carries the value's sample, bounded.
 * @usage cd aimeat && pnpm exec vitest run test/unit/receivers-ready-commands.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (secaudit2026nov08b round 15d).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsm, csmToJsonSchema } from '../../src/services/csm-parser.js';
import { validateValueAgainstSchema } from '../../src/services/schema-validator.js';

const here = dirname(fileURLToPath(import.meta.url));
vi.stubGlobal('fetch', async (url: string) => {
  const file = /\/locales\/([a-z]+)\.json/.exec(url)?.[1];
  const body = file ? readFileSync(join(here, '../../locales', `${file}.json`), 'utf-8') : '{}';
  return { ok: !!file, json: async () => JSON.parse(body) };
});
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('document', {
  documentElement: { getAttribute: () => null }, cookie: '', querySelector: () => null,
  addEventListener: () => undefined, removeEventListener: () => undefined,
});
const { loadTranslations } = await import('../../public/js/i18n.js');
await loadTranslations('en');

const cmd = await import('../../public/views/profile/receivers/commands.js');
const { renderDialogs } = await import('../../public/views/profile/receivers/dialogs.js');

const KEY = "aimeat_rcv_k'ey$HOME&100%`x`!’";
const URL_ = "https://node.example/v1/receive/o'wner/home?x=1&y=$z%20";
const BODY = JSON.stringify({ q: "it's", amp: 'a&b', d: '$HOME', p: '100%', bt: '`x`', bang: 'hi!', typo: 'don’t', nl: 'a\nb' });

/** The words a POSIX shell passes, and the operators it acts on (`{op}`). */
function shellWords(line: string): Array<string | { op: string }> {
  const out: Array<string | { op: string }> = [];
  let word = ''; let inWord = false; let i = 0;
  const flush = () => { if (inWord) out.push(word); word = ''; inWord = false; };
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated single quote');
      word += line.slice(i + 1, end); inWord = true; i = end + 1;
    } else if (c === '"') {
      throw new Error('a double quote outside single quotes: the shell would expand inside it');
    } else if (c === '\\') { word += line[i + 1] ?? ''; inWord = true; i += 2; }
    else if (/\s/.test(c)) { flush(); i += 1; }
    else if (';&|<>()$`!'.includes(c)) { flush(); out.push({ op: c }); i += 1; }
    else { word += c; inWord = true; i += 1; }
  }
  flush();
  return out;
}

/** The single-quoted strings of a PowerShell line, in order, as PowerShell reads them. */
function psStrings(line: string): string[] {
  const QUOTE = /['‘’‚‛]/;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (!QUOTE.test(line[i])) { i += 1; continue; }
    let s = ''; i += 1;
    for (;;) {
      if (i >= line.length) throw new Error('unterminated string');
      if (QUOTE.test(line[i])) {
        if (QUOTE.test(line[i + 1] ?? '')) { s += line[i + 1]; i += 2; continue; }
        i += 1; break;
      }
      s += line[i]; i += 1;
    }
    out.push(s);
  }
  return out;
}

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
const psExe = ['pwsh', 'powershell.exe'].find((exe) => {
  try { return spawnSync(exe, ['-NoProfile', '-Command', 'exit 0'], { timeout: 30_000 }).status === 0; } catch { return false; }
});

describe('the POSIX command', () => {
  const line = cmd.bashCommand({ url: URL_, key: KEY, body: BODY });

  it('is curl with the address, the JSON header, the API key and the message, each one word', () => {
    const words = shellWords(line);
    expect(words.filter((w) => typeof w !== 'string')).toEqual([]);
    expect(words).toEqual(['curl', '-X', 'POST', URL_, '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${KEY}`, '-d', BODY]);
  });

  it.runIf(hasBash)('the real bash passes the same words to curl', () => {
    const script = 'curl() { for a in "$@"; do printf \'%s\\0\' "$a"; done; }\n' + line + '\n';
    const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\0').slice(0, -1)).toEqual(['-X', 'POST', URL_, '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${KEY}`, '-d', BODY]);
  });
});

describe('the PowerShell command', () => {
  const line = cmd.powershellCommand({ url: URL_, key: KEY, body: BODY });

  it('is Invoke-RestMethod with every value one single-quoted string', () => {
    expect(line.startsWith('Invoke-RestMethod -Method Post -Uri \'')).toBe(true);
    expect(line).toContain(' -Headers @{ Authorization = \'');
    expect(psStrings(line)).toEqual([URL_, `Bearer ${KEY}`, 'application/json; charset=utf-8', BODY]);
  });

  it('a typographic single quote is doubled, as a straight one is', () => {
    expect(cmd.psQuote('don’t')).toBe("'don’’t'");
    expect(cmd.psQuote("it's")).toBe("'it''s'");
    expect(cmd.psQuote('$x `y` %z% &')).toBe("'$x `y` %z% &'");
  });

  it.runIf(!!psExe)('the real PowerShell passes the same values to Invoke-RestMethod', () => {
    const script = [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      'function Invoke-RestMethod { param($Method, $Uri, $Headers, $ContentType, $Body)',
      '  [Console]::Out.Write((ConvertTo-Json -Compress @{ method = $Method; uri = $Uri; auth = $Headers.Authorization; ct = $ContentType; body = $Body })) }',
      line,
    ].join('\n');
    const run = spawnSync(psExe!, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60_000 });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ method: 'Post', uri: URL_, auth: `Bearer ${KEY}`, ct: 'application/json; charset=utf-8', body: BODY });
  });
});

describe('the address', () => {
  it('is the server\'s full address; a path gets the page\'s own origin; a prefix target names a last part', () => {
    const r = { address: 'https://node.example/v1/receive/alice/home', target: { kind: 'key', key: 'home.temp' } };
    expect(cmd.commandAddress(r, 'https://other.example', false)).toBe('https://node.example/v1/receive/alice/home');
    expect(cmd.commandAddress({ ...r, address: '/v1/receive/alice/home' }, 'http://localhost:40630', false)).toBe('http://localhost:40630/v1/receive/alice/home');
    expect(cmd.commandAddress({ ...r, target: { kind: 'prefix', prefix: 'ruuvit' } }, '', true)).toBe('https://node.example/v1/receive/alice/home/example?dry_run=true');
  });
});

describe('the example message', () => {
  it('from every bundled data description passes the server\'s check of that description', () => {
    const dir = join(here, '../../docs/csm-examples');
    const files = readdirSync(dir).filter((f) => f.endsWith('.csm.yaml'));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const schema = csmToJsonSchema(parseCsm(readFileSync(join(dir, f), 'utf8')));
      const body = cmd.exampleBody({ jsonSchema: schema });
      const v = validateValueAgainstSchema(JSON.parse(body), schema);
      expect({ f, ok: v.ok, why: v.ok ? null : v.violations ?? v.errors }).toEqual({ f, ok: true, why: null });
    }
  });

  it('a pattern the page cannot satisfy gets a placeholder in the JSON only', () => {
    expect(cmd.exampleFromSchema({ type: 'object', required: ['sku'], properties: { sku: { type: 'string', pattern: '^[A-Z]{3}-\\d+$' } } })).toEqual({ sku: '<sku>' });
  });

  it('the sample from the address is taken as JSON, bounded, and otherwise the default', () => {
    expect(cmd.exampleBody({ sample: '{ "value": 4.2 }' })).toBe('{"value":4.2}');
    expect(cmd.exampleBody({ sample: 'not json' })).toBe(cmd.DEFAULT_EXAMPLE);
    expect(cmd.exampleBody({ sample: JSON.stringify({ value: 'x'.repeat(cmd.SAMPLE_MAX) }) })).toBe(cmd.DEFAULT_EXAMPLE);
    expect(cmd.exampleBody({})).toBe('{"value":1}');
    expect(cmd.exampleBody({ jsonSchema: { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 3 } } }, sample: '{"value":9}' })).toBe('{"n":3}');
  });
});

/** Every vnode under `v`, depth first. */
function* walk(v: any): Generator<any> {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const c of v) yield* walk(c); return; }
  yield v;
  for (const [k, p] of Object.entries(v.props ?? {})) if (k === 'children' || (p && typeof p === 'object')) yield* walk(p);
}
const copies = (v: any): string[] => [...walk(v)].map((n) => n.props?.copy).filter((c) => typeof c === 'string');

describe('the key-once view', () => {
  const receiver = {
    name: 'home', display_name: 'Home', address: 'https://node.example/v1/receive/alice/home', state: 'active',
    target: { kind: 'key', key: 'home.temp' }, schema: null,
  };
  const key = 'aimeat_rcv_0123456789abcdef';
  const ctxOf = (d: Record<string, unknown>) => ({
    origin: 'https://node.example', setCommandsDry: vi.fn(), closeDialog: () => undefined, setTestBody: () => undefined, runDryRun: () => undefined,
    dialog: { kind: 'key', receiver, key, say: '', rotated: false, testBody: '{"value":1}', test: null, testing: false, example: '{"value":1}', commandsDry: false, ...d },
  });

  it('carries both commands with the API key, each with its own copy button', () => {
    const all = copies(renderDialogs(ctxOf({})));
    expect(all).toContain(key);
    expect(all).toContain(`curl -X POST 'https://node.example/v1/receive/alice/home' -H 'Content-Type: application/json' -H 'Authorization: Bearer ${key}' -d '{"value":1}'`);
    expect(all).toContain(`Invoke-RestMethod -Method Post -Uri 'https://node.example/v1/receive/alice/home' -Headers @{ Authorization = 'Bearer ${key}' } -ContentType 'application/json; charset=utf-8' -Body '{"value":1}'`);
    expect(all.some((c) => c.includes('$AIMEAT_RECEIVER_KEY'))).toBe(false);
  });

  it('the test switch adds ?dry_run=true to both, and pressing it asks the page to switch', () => {
    const ctx = ctxOf({ commandsDry: true });
    const all = copies(renderDialogs(ctx));
    expect(all.filter((c) => c.includes("/v1/receive/alice/home?dry_run=true'")).length).toBe(2);
    const off = ctxOf({});
    const sw = [...walk(renderDialogs(off))].find((n) => typeof n.props?.onChange === 'function' && 'checked' in (n.props ?? {}));
    expect(sw.props.checked).toBe(false);
    sw.props.onChange(true);
    expect(off.setCommandsDry).toHaveBeenCalledWith(true);
  });

  it('while the data description is read, it shows no command yet', () => {
    const all = copies(renderDialogs(ctxOf({ example: null })));
    expect(all.some((c) => c.startsWith('curl') || c.startsWith('Invoke-RestMethod'))).toBe(false);
  });
});

describe('the living document\'s gear link', () => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };
  const shapeFor = async (value: unknown) => {
    const { inwardShape } = await import('../../src/static/sdk-libs/living/hooks-shapes.js');
    const doc = { v: 1, key: 'living.notes', title: { en: 'Notes' }, lang: 'en', model: { nodes: { note: { type: 'value', label: { en: 'Note' } } } } };
    return inwardShape({ id: 'note', node: doc.model.nodes.note, doc, graph: { valueOf: () => value }, langs: () => ['en'], base: 'https://app.example', apex: 'https://node.example', owner: 'alice' });
  };

  it('carries the value\'s sample as URL-encoded JSON, and leaves out one that is too long', async () => {
    const one = new URL((await shapeFor("4.2 & it's 100%")).receiver.settings);
    expect(one.searchParams.get('sample')).toBe(JSON.stringify({ value: "4.2 & it's 100%" }));
    expect(one.searchParams.get('key')).toBe('living.notes.in.note');
    const long = new URL((await shapeFor('x'.repeat(2000))).receiver.settings);
    expect(long.searchParams.has('sample')).toBe(false);
  });
});
