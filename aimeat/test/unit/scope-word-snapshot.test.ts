/**
 * @file scope-word-snapshot.test.ts
 * @description check:scope-words decides (scripts/lib/scope-word-snapshot.ts): a scope word added to
 *   an MCP tool or REST route that already exists is refused unless a keep-working step new in the
 *   change hands it out, or the snapshot writes down why; a new tool or route, and a word that left,
 *   pass. A step the snapshot already knows has run once on every node and cannot carry a later word.
 *   The registry of steps (scripts/lib/scope-keep-steps.ts) names steps the boot really calls.
 * @structure addedWords · answerAddition · routeScopeWords · the registry against the boot files
 * @usage cd aimeat && pnpm exec vitest run test/unit/scope-word-snapshot.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial (docs/pitfalls.md §119 and §6, third bullet, now deleted).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { addedWords, answerAddition, routeScopeWords, sortedWordMap, type ScopeKeepStep } from '../../scripts/lib/scope-word-snapshot.js';
import { SCOPE_KEEP_STEPS } from '../../scripts/lib/scope-keep-steps.js';

const before = { aimeat_workspace_read: ['memory:read'], aimeat_dm_send: [] as string[] };

describe('addedWords', () => {
  it('finds a word added to an existing tool, and to a tool that had none', () => {
    const now = { aimeat_workspace_read: ['memory:read', 'organism:read'], aimeat_dm_send: ['messages:send'] };
    expect(addedWords('tool', before, now)).toEqual([
      { surface: 'tool', key: 'aimeat_workspace_read', word: 'organism:read' },
      { surface: 'tool', key: 'aimeat_dm_send', word: 'messages:send' },
    ]);
  });
  it('passes a new tool and a word that left', () => {
    expect(addedWords('tool', before, { aimeat_workspace_read: [], aimeat_dm_send: [], aimeat_new_tool: ['ai:use'] })).toEqual([]);
  });
});

describe('answerAddition', () => {
  const add = { surface: 'tool' as const, key: 'aimeat_workspace_read', word: 'organism:read' };
  const step: ScopeKeepStep = { key: 'migrations.organism-read-keep', run: 'keepOrganismReadOnce', file: 'x.ts', words: ['organism:read'] };
  it('is answered by a step the snapshot does not know yet that hands the word out', () => {
    expect(answerAddition(add, [step], { steps: [], accepted: {} })).toBe('migrations.organism-read-keep');
  });
  it('is not answered by a step that already ran, nor by a new step that hands out other words', () => {
    expect(answerAddition(add, [step], { steps: [step.key], accepted: {} })).toBeNull();
    expect(answerAddition(add, [{ ...step, key: 'migrations.other', words: ['memory:read'] }], { steps: [], accepted: {} })).toBeNull();
  });
  it('is answered by a written reason for that tool and word only', () => {
    expect(answerAddition(add, [], { steps: [], accepted: { 'aimeat_workspace_read organism:read': 'narrowed on purpose' } })).toBe('accepted');
    expect(answerAddition(add, [], { steps: [], accepted: { 'aimeat_workspace_overview organism:read': 'another tool' } })).toBeNull();
  });
});

describe('routeScopeWords', () => {
  it('reads literal words from requireScope and requireRestScope', () => {
    expect(routeScopeWords(", requireAuth(), requireRestScope('task:write', { unlessSelf: id }), requireScope(\"memory:read\"), ")).toEqual(['memory:read', 'task:write']);
  });
  it('reads nothing from a constant, an any-of list or a role gate', () => {
    expect(routeScopeWords(', requireAuth(), requireScope(POLICY_WRITE_SCOPE), requireAnyScope([\'a:b\']), requireRole(\'operator\'), ')).toEqual([]);
  });
  it('sorts keys and words and drops a repeated word', () => {
    expect(JSON.stringify(sortedWordMap({ b: ['y', 'x', 'x'], a: [] }))).toBe('{"a":[],"b":["x","y"]}');
  });
});

describe('the keep-working steps the check knows', () => {
  const bootDir = join(process.cwd(), 'src', 'server-bootstrap');
  const boot = readdirSync(bootDir).filter(f => f.endsWith('.ts'))
    .map(f => readFileSync(join(bootDir, f), 'utf-8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n')).join('\n');
  it.each(SCOPE_KEEP_STEPS.map(s => [s.run, s] as const))('%s is called at boot and hands out words', (_run, s) => {
    expect(boot).toMatch(new RegExp(`\\b${s.run}\\(`));
    expect(s.words.length).toBeGreaterThan(0);
    expect(s.key).toMatch(/^migrations\./);
  });
  it('names each once-only key once', () => {
    expect(new Set(SCOPE_KEEP_STEPS.map(s => s.key)).size).toBe(SCOPE_KEEP_STEPS.length);
  });
});
