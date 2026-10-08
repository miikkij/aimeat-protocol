/**
 * @file test/unit/visibility-agent-experience.test.ts
 * @description AI visibility, layer C (services/visibility/agent-experience.ts): an agent is named
 *   by its AI and never by its own name, an outside agent's call to an owner's tool is counted for
 *   that owner from the usage stream (refused ones included, which name the owner by account name),
 *   the owner's own agents and people are not, and the report's findings read as one line each.
 * @usage pnpm test -- visibility-agent-experience
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer C).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ ownerGhii: string; family: string | null; tool: string; outcome: string; reason?: string | null }> = [];
let watching = true;
vi.mock('../../src/services/visibility/visibility-counter.js', () => ({
  recordAgentCall: (_s: unknown, _c: unknown, input: (typeof calls)[number]) => { calls.push(input); },
  nodeWatchesAgents: () => watching,
}));

const { watchAgentCalls, agentExperienceSection, stageOfCode } = await import('../../src/services/visibility/agent-experience.js');
const { agentFamilyOf, agentAttribution } = await import('../../src/services/visibility/attribution.js');
const { recordUsageCall, resetUsageBuffer } = await import('../../src/services/usage/usage-buffer.js');
const { emptyVisibilityDay } = await import('../../src/models/visibility-schemas.js');

const NODE = 'node-1';
const storage = {} as never;
watchAgentCalls(storage, { nodeId: NODE } as never);

beforeEach(() => { calls.length = 0; watching = true; resetUsageBuffer(); });

describe('agentFamilyOf', () => {
  it('reads the AI from the agent name and keeps nothing else', () => {
    expect(agentFamilyOf(`claude-code#alice@${NODE}`)).toBe('claude');
    expect(agentFamilyOf(`my-copilot-helper#alice@${NODE}`)).toBe('copilot');
    expect(agentFamilyOf(`codex#alice@${NODE}`)).toBe('chatgpt');
    expect(agentFamilyOf(`gemini#alice@${NODE}`)).toBe('gemini');
    expect(agentFamilyOf(`shopper#alice@${NODE}`)).toBe('aimeat-agent');
    expect(agentFamilyOf(`alice@${NODE}`)).toBe('aimeat-agent');
    expect(agentFamilyOf(null)).toBe('aimeat-agent');
  });

  it('gives way to a header that names the AI, and fills in when none does', () => {
    expect(agentAttribution({ ucpAgent: 'profile="https://copilot.microsoft.com/.well-known/ucp"', gaii: `claude#a@${NODE}` }).family).toBe('copilot');
    expect(agentAttribution({ userAgent: 'curl/8.0', gaii: `claude#a@${NODE}` }).family).toBe('claude');
    expect(agentAttribution({ gaii: `shopper#a@${NODE}` }).family).toBe('aimeat-agent');
    expect(agentAttribution({}).family).toBe('other');
  });
});

describe('watchAgentCalls', () => {
  const base = { ownerGhii: `bob@${NODE}`, surface: 'apptool' as const, coordinate: 'apptool:alice/shop.html/quote', counterpartyGhii: `alice@${NODE}` };

  it('counts an outside agent\'s call to an owner\'s tool for that owner, by its AI', () => {
    recordUsageCall({ ...base, actorGaii: `claude#bob@${NODE}`, actorKind: 'agent', outcome: 'ok' });
    expect(calls).toEqual([{ ownerGhii: `alice@${NODE}`, family: 'claude', tool: base.coordinate, outcome: 'ok', reason: '' }]);
  });

  it('counts a refused call, which names the seller by account name', () => {
    recordUsageCall({ ...base, counterpartyGhii: 'alice', actorGaii: `chatgpt#bob@${NODE}`, actorKind: 'agent', outcome: 'refused', reason: 'payment_required' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ ownerGhii: `alice@${NODE}`, family: 'chatgpt', outcome: 'refused', reason: 'payment_required' });
  });

  it('does not count the owner\'s own agent, a person, a call with no seller, or another node\'s seller', () => {
    recordUsageCall({ ...base, ownerGhii: `alice@${NODE}`, actorGaii: `claude#alice@${NODE}`, actorKind: 'agent' });
    recordUsageCall({ ...base, actorGaii: `bob@${NODE}`, actorKind: 'owner' });
    recordUsageCall({ ...base, counterpartyGhii: '', actorGaii: `claude#bob@${NODE}`, actorKind: 'agent' });
    recordUsageCall({ ...base, counterpartyGhii: 'carol@elsewhere', actorGaii: `claude#bob@${NODE}`, actorKind: 'agent' });
    recordUsageCall({ ...base, surface: 'mcp', actorGaii: `claude#bob@${NODE}`, actorKind: 'agent' });
    expect(calls).toEqual([]);
  });

  it('counts nothing when the operator switched layer C off', () => {
    watching = false;
    recordUsageCall({ ...base, actorGaii: `claude#bob@${NODE}`, actorKind: 'agent' });
    expect(calls).toEqual([]);
  });
});

describe('agentExperienceSection', () => {
  it('says each finding in one line, with where the checkouts stopped', () => {
    const day = emptyVisibilityDay();
    day.checkouts = { copilot: { created: 14, failed: 9, canceled: 2, completed: 3 } };
    day.checkoutErrors = { 'copilot|PSP_ERROR': 9 };
    day.agentCalls = { claude: { ok: 4, refused: 2 } };
    day.agentErrors = { 'claude|apptool:alice/shop.html/quote|payment_required': 2 };
    const s = agentExperienceSection(day);
    expect(s.checkouts[0]).toMatchObject({ family: 'copilot', started: 14, failed: 9, canceled: 2, completed: 3 });
    expect(s.findings.map((f) => f.text)).toEqual([
      'A copilot agent tried to buy 14 times; 9 checkouts failed at payment (PSP_ERROR), 2 were abandoned, 3 completed.',
      'A claude agent called your tools 6 times; 2 did not succeed, most often apptool:alice/shop.html/quote (payment_required).',
    ]);
  });

  it('has no finding where nothing happened or nothing went wrong', () => {
    const day = emptyVisibilityDay();
    day.agentCalls = { claude: { ok: 5 } };
    expect(agentExperienceSection(day).findings).toEqual([]);
    expect(agentExperienceSection(emptyVisibilityDay()).findings).toEqual([]);
  });

  it('places an error code at the step it stopped', () => {
    expect(stageOfCode('UNKNOWN_PAYMENT_HANDLER')).toBe('at payment');
    expect(stageOfCode('OFFER_NOT_FOUND')).toBe('at an item');
    expect(stageOfCode('PURCHASE_LIMIT_NOT_SET')).toBe('at the agent\'s spending permission');
    expect(stageOfCode('SOMETHING_ELSE')).toBe('at a step of the checkout');
  });
});
