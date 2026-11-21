/**
 * @file test/unit/single-entry-silent-drops.test.ts
 * @description The check:single-entry rules that replaced docs/pitfalls.md entries on 2026-11-21: each
 *   pattern finds the trap's own line, does not find the line that does it right, and is not fooled
 *   by a comment or a string naming the pattern (the scanner drops comments).
 *
 *   Seen red first: none of these rule ids existed, so every `rule()` lookup failed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/single-entry-silent-drops.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { RULES, lineTexts } from '../../scripts/check-single-entry.js';

function rule(id: string) {
  const r = RULES.find(x => x.id === id);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
}
const hits = (id: string, src: string) => lineTexts(src).filter(l => rule(id).pattern.test(l)).length;

describe('silent-drop rules', () => {
  it('task-create: a second writer of a task, not the shared service', () => {
    expect(hits('task-create', 'await storage.createAgentTask(record);')).toBe(1);
    expect(hits('task-create', 'await deps.storage.createAgentTask({ id });')).toBe(1);
    expect(hits('task-create', 'const r = await createTask(deps, args); // storage.createAgentTask(')).toBe(0);
  });

  it('flag-mount: a bare `if (config.xEnabled)` in a routes loader, not a negated guard', () => {
    expect(hits('flag-mount', 'if (config.cortexEnabled) {\n  app.use(cortexRouter(config, storage));\n}')).toBe(1);
    expect(hits('flag-mount', 'if (!config.realtimeEnabled) return null;')).toBe(0);
    expect(rule('flag-mount').onlyDirs).toEqual(['src/server-bootstrap/routes-loader']);
  });

  it('app-record-key: a hand-built tools or datamap key, not the key builders', () => {
    expect(hits('app-record-key', 'const k = `apps.${app.filename}.tools`;')).toBe(1);
    expect(hits('app-record-key', 'const k = `apps.${id}.datamap`;')).toBe(1);
    expect(hits('app-record-key', 'const k = appToolsKey(app.filename);')).toBe(0);
    expect(hits('app-record-key', 'const k = `apps.${filename}.config`;')).toBe(0);
  });

  it('child-env: a child process call, not a method of the same name', () => {
    expect(hits('child-env', "const child = spawn(bin, ['acp'], { env });")).toBe(1);
    expect(hits('child-env', 'execFile(bin, args, opts, cb);')).toBe(1);
    expect(hits('child-env', 'const m = re.exec(text); worker.fork(); x.spawn();')).toBe(0);
  });

  it('long-ai-call: a model call through apiPost, not a settings write', () => {
    expect(hits('long-ai-call', "const r = await apiPost('/v1/ai/complete', body);")).toBe(1);
    expect(hits('long-ai-call', 'await apiPost(`/v1/ai/transcribe`, b);')).toBe(1);
    expect(hits('long-ai-call', "await apiPost('/v1/ai/settings', b);")).toBe(0);
    expect(hits('long-ai-call', "await api('/v1/ai/complete', { method: 'POST', timeoutMs: 1_800_000, retries: 0 });")).toBe(0);
    expect(rule('long-ai-call').tree).toBe('public');
  });

  it('closed-node-fetch: the global fetch and an API picture, not a session\'s own fetch', () => {
    expect(hits('closed-node-fetch', "fetch('/v1/public/node-totals').then(r => r.json());")).toBe(1);
    expect(hits('closed-node-fetch', 'html`<img src="/v1/storage/a.png">`')).toBe(1);
    expect(hits('closed-node-fetch', "session.fetch('/v1/admin/platforms');")).toBe(0);
    expect(hits('closed-node-fetch', "closedNodeFetch('/v1/public/node-totals');")).toBe(0);
  });

  it('locale-format: a hand decimal comma and a tag picked from the language', () => {
    expect(hits('locale-format', "const p = String(x).replace('.', ',') + ' %';")).toBe(1);
    expect(hits('locale-format', "const tag = getLocale() === 'fi' ? 'fi-FI' : 'en-GB';")).toBe(1);
    expect(hits('locale-format', "const p = percent(x); const s = name.replace('.', '-');")).toBe(0);
  });

  it('palette-cycle: a palette indexed modulo its length, not a hue turned modulo 360', () => {
    expect(hits('palette-cycle', 'ds.backgroundColor = PALETTE[i % PALETTE.length];')).toBe(1);
    expect(hits('palette-cycle', 'bit.style.background = colors[i % colors.length];')).toBe(1);
    expect(hits('palette-cycle', 'const hue = (k * GOLDEN_ANGLE + 20) % 360; const l = [52, 42, 62][k % 3];')).toBe(0);
  });
});
