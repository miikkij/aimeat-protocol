/**
 * @file ai-caller-context.test.ts
 * @description Who an AI call runs as when it runs later than the request (secaudit 2026-10, AI-2 and
 *   AI-3): a schedule fires as its maker, asked again at the fire; a workflow run's AI calls run as
 *   the principal the run acts for; a credential names its caller one way everywhere.
 *     - aiCallerFromCredential: an app grant is its app, an agent its agent, the chat 'chat', else the owner;
 *     - scheduleActor: an app's schedule fires as that app with its grant's scopes, and not at all
 *       once the grant is revoked; an agent's with the agent's scopes, and not once it is deleted;
 *       one an app made before grants were kept does not fire; the owner's fires as the owner;
 *     - aiCallerForStart / workflowAiCaller: a trigger's run is its saver, a started run its starter,
 *       a run from before is its saver.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-caller-context.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, AI-2 and AI-3).
 */
import { describe, it, expect } from 'vitest';
import { aiCallerFromCredential, aiCallerOfPrincipal } from '../../src/services/ai/caller-context.js';
import { scheduleActor } from '../../src/services/schedule-actor.js';
import { aiCallerForStart, workflowAiCaller } from '../../src/services/workflow/ai-caller.js';

const NODE = 'node-t';
const OWNER = `alice@${NODE}`;
const AGENT = `bot#alice@${NODE}`;

/** The storage reads the code under test makes, with what the test says exists. */
function stubStorage(opts: { grants?: Record<string, { app: string; scopes: string[]; revoked?: boolean }>; agents?: Record<string, string[]> } = {}) {
  return {
    getAppGrant: async (id: string) => {
      const g = opts.grants?.[id];
      return g ? { grantId: id, app: g.app, appName: g.app, scopes: g.scopes, revoked: !!g.revoked } : null;
    },
    getAgent: async (gaii: string) => (opts.agents?.[gaii] ? { gaii, name: 'bot', defaultScopes: opts.agents[gaii] } : null),
    listPats: async () => [],
    getEcosystemApp: async () => null,
  } as any;
}

describe('a credential names its caller one way', () => {
  it('an app grant is its app, an agent its agent, the chat the chat, anything else the owner', () => {
    expect(aiCallerFromCredential({ roles: ['app'], app: 'alice/x.html' }, OWNER)).toEqual({ caller: 'app', verifiedApp: 'alice/x.html' });
    expect(aiCallerFromCredential({ roles: ['agent'] }, AGENT)).toEqual({ caller: 'agent', agent: 'bot' });
    expect(aiCallerFromCredential({ roles: ['agent'] }, `chat#alice@${NODE}`)).toEqual({ caller: 'chat' });
    expect(aiCallerFromCredential({ roles: ['owner'] }, OWNER)).toEqual({ caller: 'owner' });
    expect(aiCallerOfPrincipal(AGENT).caller).toBe('agent');
  });
});

describe('a schedule fires as its maker, asked at the fire', () => {
  const base = { ownerScope: OWNER, createdBy: OWNER };

  it('the owner\'s own schedule fires as the owner', async () => {
    const a = await scheduleActor(stubStorage(), { ...base, createdByAgent: false });
    expect(a).toMatchObject({ ok: true, isOwner: true, roles: ['owner'], ai: { caller: 'owner' } });
  });
  it('an app\'s schedule fires as that app, with its grant\'s scopes, never the owner\'s', async () => {
    const storage = stubStorage({ grants: { g1: { app: 'alice/refine.html', scopes: ['ai:use', 'memory:write'] } } });
    const a = await scheduleActor(storage, { ...base, createdByAgent: true, createdByApp: 'g1' });
    expect(a).toMatchObject({ ok: true, isOwner: false, roles: ['app'], scopes: ['ai:use', 'memory:write'], appRef: 'alice/refine.html', ai: { caller: 'app', verifiedApp: 'alice/refine.html' } });
  });
  it('an app\'s schedule does not fire once the owner revoked the app', async () => {
    const storage = stubStorage({ grants: { g1: { app: 'alice/refine.html', scopes: ['ai:use'], revoked: true } } });
    const a = await scheduleActor(storage, { ...base, createdByAgent: true, createdByApp: 'g1' });
    expect(a.ok).toBe(false);
  });
  it('an agent\'s schedule fires with the agent\'s words today, and not once the agent is gone', async () => {
    const live = await scheduleActor(stubStorage({ agents: { [AGENT]: ['ai:use'] } }), { ...base, createdBy: AGENT, createdByAgent: true });
    expect(live).toMatchObject({ ok: true, principal: AGENT, roles: ['agent'], scopes: ['ai:use'], ai: { caller: 'agent', agent: 'bot' } });
    const gone = await scheduleActor(stubStorage(), { ...base, createdBy: AGENT, createdByAgent: true });
    expect(gone.ok).toBe(false);
  });
  it('a schedule an app made before its grant was kept does not fire with the owner\'s authority', async () => {
    const a = await scheduleActor(stubStorage(), { ...base, createdByAgent: true });
    expect(a.ok).toBe(false);
  });
});

describe('a workflow run\'s AI calls run as the principal the run acts for', () => {
  const def = (savedBy?: { kind: 'owner' | 'agent' | 'app' | 'ecosystem'; id: string }) => ({ createdBy: OWNER, ...(savedBy ? { savedBy } : {}) }) as any;

  it('a trigger\'s run is its saver: an agent, or an app by its grant', async () => {
    const storage = stubStorage({ grants: { g2: { app: 'alice/flow.html', scopes: [] } } });
    expect(await aiCallerForStart(storage, def({ kind: 'agent', id: AGENT }), undefined)).toEqual({ caller: 'agent', agent: 'bot' });
    expect(await aiCallerForStart(storage, def({ kind: 'app', id: 'g2' }), undefined)).toEqual({ caller: 'app', verifiedApp: 'alice/flow.html' });
    expect(await aiCallerForStart(storage, def(), undefined)).toEqual({ caller: 'owner' });
  });
  it('a run somebody starts is that somebody; "Run as me" is the owner', async () => {
    const storage = stubStorage({ grants: { g3: { app: 'alice/run.html', scopes: [] } } });
    expect(await aiCallerForStart(storage, def({ kind: 'agent', id: AGENT }), { roles: ['owner'], scopes: [] })).toEqual({ caller: 'owner' });
    expect(await aiCallerForStart(storage, def(), { roles: ['agent'], scopes: [], principal: AGENT })).toEqual({ caller: 'agent', agent: 'bot' });
    expect(await aiCallerForStart(storage, def(), { roles: ['app'], scopes: [], appGrant: 'g3' })).toEqual({ caller: 'app', verifiedApp: 'alice/run.html' });
  });
  it('a run from before the field existed answers as its saver', async () => {
    const who = await workflowAiCaller(stubStorage(), { defSnapshot: def({ kind: 'agent', id: AGENT }) } as any);
    expect(who).toEqual({ caller: 'agent', agent: 'bot' });
  });
});
