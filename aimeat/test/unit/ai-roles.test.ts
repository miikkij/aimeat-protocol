/**
 * @file test/unit/ai-roles.test.ts
 * @description AI roles, the pure parts (wish-tekoalyn-roolit): an app's role declarations read from its
 *   meta (services/app-ai-roles.ts, through app-ai-posture.ts), a change to the roles checked
 *   (normaliseRolesInput), the built-in roles showing the legacy setting (rolesWithLegacy), and a call's
 *   role resolved or refused with its code (resolveRole).
 * @usage pnpm test -- ai-roles
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { parseAppAiRoles } from '../../src/services/app-ai-roles.js';
import { parseAiPosture } from '../../src/services/app-ai-posture.js';
import { normaliseRolesInput, rolesWithLegacy, resolveRole, bindingKey, type RolesRecord } from '../../src/services/ai/roles.js';
import type { AiProvider } from '../../src/services/ai/providers.js';

const empty: RolesRecord = { version: 1, roles: {}, bindings: {} };
const provider = (id: string, extra: Partial<AiProvider> = {}) => ({ id, source: 'owner', capabilities: {}, ...extra }) as unknown as AiProvider;

describe('an app\'s role declarations', () => {
  it('reads each role with its capabilities, purpose and fine-tuning, and leaves out one that does not read', () => {
    const raw = new Map([
      ['role.summarizer', 'text'], ['role.summarizer.purpose', 'Short summaries'], ['role.summarizer.temperature', '0.2'],
      ['role.summarizer.reasoning', 'LOW'], ['role.illustrator', 'text+image'], ['role.illustrator.local', 'yes'],
      ['role.illustrator.context', '100000'], ['role.bad', 'teleport'], ['role.Upper', 'text'], ['role.x.temperature', '9'],
    ]);
    const { roles, invalid } = parseAppAiRoles(raw);
    expect(roles.map((r) => r.name).sort()).toEqual(['illustrator', 'summarizer']);
    expect(roles.find((r) => r.name === 'summarizer')).toEqual({ name: 'summarizer', capabilities: ['text'], purpose: 'Short summaries', params: { temperature: 0.2, reasoning: 'low' } });
    expect(roles.find((r) => r.name === 'illustrator')).toMatchObject({ capabilities: ['text', 'image'], local: true, context: 100000 });
    expect(invalid.sort()).toEqual(['role.Upper', 'role.bad'].sort());
  });

  it('keeps the purpose\'s case through the meta parser, and an out-of-range temperature is dropped', () => {
    const p = parseAiPosture('<meta name="aimeat-ai" content="generates=text; role.writer=text; role.writer.purpose=Drafts For Mail; role.writer.temperature=5">');
    expect(p?.roles).toEqual([{ name: 'writer', capabilities: ['text'], purpose: 'Drafts For Mail' }]);
  });
});

describe('a change to the roles', () => {
  const known = new Set(['my-openai', 'node-openrouter']);
  it('names every problem at once', () => {
    const r = normaliseRolesInput({
      roles: { 'Bad Id': {}, writer: { capabilities: { text: [{ provider: 'nope' }, { provider: 'my-openai' }, { provider: 'my-openai' }], teleport: [] } }, reasoning: null },
      bindings: { 'no-hash': 'writer', 'a/b.html#r': 'ghost' },
    }, known, empty);
    expect('problems' in r).toBe(true);
    const problems = (r as { problems: string[] }).problems.join('\n');
    expect(problems).toMatch(/Bad Id: an id/);
    expect(problems).toMatch(/nope is not a provider/);
    expect(problems).toMatch(/listed twice/);
    expect(problems).toMatch(/teleport: not a capability/);
    expect(problems).toMatch(/built-in role cannot be removed/);
    expect(problems).toMatch(/no-hash: the app's address/);
    expect(problems).toMatch(/a\/b\.html#r: one of your role ids/);
  });

  it('accepts a role and a binding to it in the same change', () => {
    const r = normaliseRolesInput({ roles: { writer: { title: 'Writer', capabilities: { text: [{ provider: 'my-openai', model: 'gpt-5.4-mini' }] } } }, bindings: { 'a/b.html#r': 'writer' } }, known, empty);
    expect('value' in r).toBe(true);
  });
});

describe('the built-in roles', () => {
  it('show the legacy setting on the migrated provider until the owner sets one', () => {
    const providers = { owner: [provider('openrouter', { legacy: { settingsVersion: 1, keyVersion: 1, provider: 'openrouter' } } as Partial<AiProvider>)], node: [] };
    const out = rolesWithLegacy(empty, { reasoningModel: 'anthropic/claude-opus-5.5' }, providers);
    expect(out.reasoning.capabilities.text).toEqual([{ provider: 'openrouter', model: 'anthropic/claude-opus-5.5' }]);
    expect(out.reasoning.legacy).toBe(true);
    expect(out.execution.capabilities.text).toBeUndefined();
    const set = rolesWithLegacy({ ...empty, roles: { reasoning: { id: 'reasoning', title: 'R', capabilities: { text: [{ provider: 'x' }] } } } }, { reasoningModel: 'y' }, providers);
    expect(set.reasoning.capabilities.text).toEqual([{ provider: 'x' }]);
    expect(set.reasoning.legacy).toBeUndefined();
  });
});

describe('a call\'s role', () => {
  const roles = { writer: { id: 'writer', title: 'Writer', capabilities: { text: [{ provider: 'p' }] } } };
  const record: RolesRecord = { version: 1, roles, bindings: { [bindingKey('a/b.html', 'summarizer')]: { role: 'writer', boundAt: '' } } };
  const declared = [{ name: 'summarizer', capabilities: ['text' as const] }, { name: 'waiting', capabilities: ['text' as const] }];
  const code = (fn: () => unknown) => { try { fn(); return 'none'; } catch (e) { return (e as { code: string }).code; } };

  it('an owner\'s role resolves, an unknown one or one without the capability is refused', () => {
    expect(resolveRole({ name: 'writer', capability: 'text', roles, record }).role.id).toBe('writer');
    expect(code(() => resolveRole({ name: 'ghost', capability: 'text', roles, record }))).toBe('AI_ROLE_UNKNOWN');
    expect(code(() => resolveRole({ name: 'writer', capability: 'image', roles, record }))).toBe('AI_ROLE_LACKS_CAPABILITY');
  });

  it('an app\'s role runs only when bound, and a role it does not declare is refused', () => {
    const app = { address: 'a/b.html', declared };
    const r = resolveRole({ name: 'summarizer', capability: 'text', roles, record, app });
    expect(r.role.id).toBe('writer');
    expect(r.binding).toBe('a/b.html#summarizer');
    expect(code(() => resolveRole({ name: 'waiting', capability: 'text', roles, record, app }))).toBe('AI_ROLE_NOT_BOUND');
    expect(code(() => resolveRole({ name: 'writer', capability: 'text', roles, record, app }))).toBe('AI_ROLE_NOT_DECLARED');
  });
});
