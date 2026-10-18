/**
 * @file test/unit/classification-audience-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A label's audience cap (plan doc-mvdipuyqraas, L3): the level order and the pure
 *   questions asked of it, maxAudience in the policy (read, inherited, narrowed by a lower level and
 *   never widened, merged as the narrower), audienceCapOf on a real SQLite store (a raise over the cap
 *   refused and named, a keep or a narrowing allowed, a container's label capping its content, the
 *   closed node, the owner's 'audience' exception and its lapse when the label rises, off reads
 *   nothing), and the settle step lowering a record over its new label's cap and telling the owner.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ContentLabelTarget } from '../../src/storage/interface.js';
import {
  AUDIENCE_LEVELS, audienceRank, capAllows, isAudienceLevel, narrowerCap, storedLevel,
} from '../../src/services/classification/audience-levels.js';
import { audienceCapOf, audienceOfShareAccess, audienceOfVisibility } from '../../src/services/classification/audience-cap.js';
import { settleAudienceAfterRise } from '../../src/services/classification/audience-settle.js';
import { DEFAULT_LABELS, defaultPolicy } from '../../src/services/classification/defaults.js';
import {
  loosenings, mergePolicy, normaliseLayer, PolicyError, validateLayer, validateNodePolicy, weakerFields,
} from '../../src/services/classification/levels.js';
import { NODE_POLICY_KEY } from '../../src/services/classification/policy.js';
import { memoryTarget } from '../../src/services/classification/labels.js';
import { workspaceTarget } from '../../src/services/classification/containers.js';
import { addException } from '../../src/services/classification/exceptions.js';
import type { AimeatConfig } from '../../src/config.js';

const N = 'n';
const ALICE = `alice@${N}`;
const CONF = 'luottamuksellinen';
const HIGH = 'erittain-luottamuksellinen';

/** The node's policy with these caps on its default labels, written as the operator would. */
async function capsOnNode(storage: SqliteStorage, caps: Record<string, string>): Promise<void> {
  const labels = DEFAULT_LABELS.map(l => ({ ...l, name: { ...l.name }, ...(caps[l.id] ? { maxAudience: caps[l.id] } : {}) }));
  const at = '2026-10-18T00:00:00.000Z';
  await storage.setMemory({
    key: NODE_POLICY_KEY, ownerGaii: `system@${N}`, value: { policy: { labels }, history: [], proposal: null },
    visibility: 'private', tags: ['classification-policy'], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
  });
}

async function put(storage: SqliteStorage, t: ContentLabelTarget, label: string): Promise<void> {
  await storage.putContentLabel({
    ...t, id: `row-${t.kind}-${t.key}`, ownerGaii: null, label, source: 'human', locked: true,
    suggestion: null, justification: null, humanSaid: null, history: [], setBy: ALICE, updatedAt: '2026-10-18T00:00:00.000Z',
  });
}

const cfg = (over: Partial<AimeatConfig> = {}) => ({ classificationMode: 'all', nodeId: N, ...over } as AimeatConfig);

describe('the audience levels', () => {
  it('orders them from the narrowest to the widest, as the exposure report does', () => {
    expect(AUDIENCE_LEVELS).toEqual(['private', 'organism', 'signed-in', 'link', 'public']);
    expect(audienceRank('public')).toBeGreaterThan(audienceRank('link'));
    expect(isAudienceLevel('members')).toBe(false);
  });

  it('takes the narrower cap, admits within a cap, and reads public as signed-in on a closed node', () => {
    expect(narrowerCap('link', 'organism')).toBe('organism');
    expect(narrowerCap(null, 'signed-in')).toBe('signed-in');
    expect(narrowerCap(undefined, undefined)).toBeNull();
    expect(capAllows('organism', 'signed-in')).toBe(false);
    expect(capAllows('signed-in', 'organism')).toBe(true);
    expect(capAllows(null, 'public')).toBe(true);
    expect(storedLevel({ contentAccess: 'signed-in' }, 'public')).toBe('signed-in');
    expect(storedLevel({ contentAccess: 'signed-in' }, 'link')).toBe('signed-in');
    expect(storedLevel({}, 'public')).toBe('public');
  });

  it('reads each kind\'s stored level', () => {
    expect(audienceOfVisibility('public')).toBe('public');
    expect(audienceOfVisibility('members')).toBe('signed-in');
    expect(audienceOfVisibility('organism:o1')).toBe('organism');
    expect(audienceOfVisibility('group')).toBe('private');
    expect(audienceOfShareAccess('open')).toBe('link');
    expect(audienceOfShareAccess('account')).toBe('signed-in');
    expect(audienceOfShareAccess('password')).toBe('private');
  });
});

describe('maxAudience in the policy', () => {
  const nodeWith = (caps: Record<string, string | null>) =>
    validateNodePolicy({ ...defaultPolicy(), labels: defaultPolicy().labels.map(l => (l.id in caps ? { ...l, maxAudience: caps[l.id] } : l)) });

  it('reads a cap, keeps no cap as null, and refuses a word that is not a level', () => {
    const node = nodeWith({ [CONF]: 'organism' });
    expect(node.labels.find(l => l.id === CONF)!.maxAudience).toBe('organism');
    expect(node.labels.find(l => l.id === 'julkinen')!.maxAudience).toBeNull();
    expect(() => nodeWith({ [CONF]: 'everyone' })).toThrow(PolicyError);
  });

  it('lets a lower level narrow a node cap and refuses widening or removing it, naming the label', () => {
    const node = nodeWith({ [CONF]: 'signed-in' });
    const narrowed = validateLayer(node, { labels: [{ id: CONF, maxAudience: 'organism' }] });
    expect(mergePolicy(node, narrowed).labels.find(l => l.id === CONF)!.maxAudience).toBe('organism');
    for (const wider of ['public', null]) {
      try {
        validateLayer(node, { labels: [{ id: CONF, maxAudience: wider }] });
        expect.unreachable('a wider cap must be refused');
      } catch (err) {
        expect((err as PolicyError).code).toBe('POLICY_DILUTES');
        expect((err as PolicyError).problems.join(' ')).toContain(CONF);
      }
    }
  });

  it('gives an own label the cap of the node label below it, and merges the narrower of two', () => {
    const node = nodeWith({ [CONF]: 'organism' });
    const layer = validateLayer(node, { labels: [{ id: 'top-secret', rank: 25, name: { en: 'Top secret' } }] });
    expect(mergePolicy(node, layer).labels.find(l => l.id === 'top-secret')!.maxAudience).toBe('organism');
    expect(() => validateLayer(node, { labels: [{ id: 'top-secret', rank: 25, maxAudience: 'public' }] })).toThrow(PolicyError);
  });

  it('counts a wider cap as protecting less and as a loosening', () => {
    const a = { ...DEFAULT_LABELS[2]!, maxAudience: 'organism' as const };
    const b = { ...DEFAULT_LABELS[2]!, maxAudience: 'public' as const };
    expect(weakerFields(b, a)).toContain('maxAudience');
    expect(weakerFields(a, b)).not.toContain('maxAudience');
    const before = nodeWith({ [CONF]: 'organism' });
    const after = nodeWith({ [CONF]: 'public' });
    expect(loosenings(before, after).join(' ')).toContain(CONF);
    expect(loosenings(after, before)).toEqual([]);
  });

  it('drops a stored narrowing the node has since met, and says so', () => {
    const node = nodeWith({ [CONF]: 'organism' });
    const { layer, dropped } = normaliseLayer(node, { labels: [{ id: CONF, maxAudience: 'signed-in' }] });
    expect((layer as { labels: unknown[] }).labels).toEqual([]);
    expect(dropped.join(' ')).toContain(CONF);
  });
});

describe('audienceCapOf on a store', () => {
  let storage: SqliteStorage;
  beforeEach(async () => { storage = new SqliteStorage(':memory:'); await capsOnNode(storage, { [CONF]: 'signed-in', [HIGH]: 'organism' }); });
  afterEach(() => storage.close());

  it('refuses a raise past the cap with 409 LABEL_CAPS_AUDIENCE naming the label and the cap', async () => {
    const t = memoryTarget(ALICE, 'notes.secret');
    await put(storage, t, CONF);
    const out = await audienceCapOf({ storage, config: cfg() }, t, 'public', { from: 'private' });
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out).toMatchObject({ status: 409, code: 'LABEL_CAPS_AUDIENCE', label: CONF, cap: 'signed-in', level: 'public' });
    expect(out.message).toContain('Confidential');
    expect(out.message).toContain('signed-in');
  });

  it('allows a level within the cap, a keep and a narrowing, and anything while classification is off', async () => {
    const t = memoryTarget(ALICE, 'notes.secret');
    await put(storage, t, CONF);
    expect((await audienceCapOf({ storage, config: cfg() }, t, 'signed-in')).kind).toBe('allowed');
    expect((await audienceCapOf({ storage, config: cfg() }, t, 'public', { from: 'public' })).kind).toBe('allowed');
    expect((await audienceCapOf({ storage, config: cfg() }, t, 'link', { from: 'public' })).kind).toBe('allowed');
    expect((await audienceCapOf({ storage, config: cfg({ classificationMode: 'off' }) }, t, 'public')).kind).toBe('allowed');
    // Unlabelled content carries the default, Internal, which has no cap here.
    expect((await audienceCapOf({ storage, config: cfg() }, memoryTarget(ALICE, 'notes.plain'), 'public')).kind).toBe('allowed');
  });

  it('holds organism content to its workspace\'s label', async () => {
    await put(storage, workspaceTarget('o1', 'ws1'), HIGH);
    const doc = memoryTarget(ALICE, 'organism.o1.w.ws1.notes.plan');
    const out = await audienceCapOf({ storage, config: cfg() }, doc, 'signed-in');
    expect(out).toMatchObject({ kind: 'refused', label: HIGH, cap: 'organism' });
    if (out.kind === 'refused') expect(out.message).toContain('workspace');
  });

  it('compares what a closed node stores: public is signed-in there', async () => {
    const t = memoryTarget(ALICE, 'notes.secret');
    await put(storage, t, CONF);
    expect((await audienceCapOf({ storage, config: cfg({ contentAccess: 'signed-in' }) }, t, 'public')).kind).toBe('allowed');
  });

  it('lets the owner\'s audience exception through until the label rises above the one it was made for', async () => {
    const t = memoryTarget(ALICE, 'notes.secret');
    await put(storage, t, CONF);
    await addException({ storage, config: cfg() }, {
      by: ALICE, byKind: 'human', scope: t.scope, target: { kind: t.kind, key: t.key }, label: CONF,
      action: 'audience', reason: 'the press release goes out today', auto: false,
    });
    const through = await audienceCapOf({ storage, config: cfg() }, t, 'public');
    expect(through.kind).toBe('allowed');
    if (through.kind === 'allowed') expect(through.exception?.action).toBe('audience');
    await put(storage, t, HIGH);
    expect((await audienceCapOf({ storage, config: cfg() }, t, 'public')).kind).toBe('refused');
  });

  it('holds a new container with no address to its scope\'s default label', async () => {
    await capsOnNode(storage, { sisainen: 'signed-in' });
    expect((await audienceCapOf({ storage, config: cfg() }, { scope: ALICE }, 'public')).kind).toBe('refused');
    expect((await audienceCapOf({ storage, config: cfg() }, { scope: ALICE }, 'signed-in')).kind).toBe('allowed');
  });
});

describe('settleAudienceAfterRise: a label that rises lowers what is already wider', () => {
  let storage: SqliteStorage;
  beforeEach(async () => { storage = new SqliteStorage(':memory:'); await capsOnNode(storage, { [CONF]: 'signed-in' }); });
  afterEach(() => storage.close());

  it('lowers a public record to members, writes nothing else, and tells the owner', async () => {
    const at = '2026-10-18T00:00:00.000Z';
    await storage.setMemory({ key: 'notes.secret', ownerGaii: ALICE, value: { text: 'x' }, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at });
    const t = memoryTarget(ALICE, 'notes.secret');
    await put(storage, t, CONF);
    const lowered = await settleAudienceAfterRise({ storage, config: cfg() }, { target: t, from: 'sisainen', to: CONF, by: ALICE });
    expect(lowered).toMatchObject([{ from: 'public', to: 'signed-in', label: CONF, owner: ALICE }]);
    const rec = await storage.getMemory(ALICE, 'notes.secret');
    expect(rec?.visibility).toBe('members');
    expect(rec?.value).toEqual({ text: 'x' });
    const notes = (await storage.listMemory(ALICE, { prefix: 'notif.' })).map(r => r.value as { type: string; i18n?: { key: string } });
    expect(notes.some(n => n.type === 'classification_audience_lowered' && n.i18n?.key === 'audience_lowered')).toBe(true);
  });

  it('leaves a record within the cap, and one the owner excepted', async () => {
    const at = '2026-10-18T00:00:00.000Z';
    for (const key of ['notes.inside', 'notes.excepted']) {
      await storage.setMemory({ key, ownerGaii: ALICE, value: 1, visibility: key === 'notes.inside' ? 'members' : 'public', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at });
      await put(storage, memoryTarget(ALICE, key), CONF);
    }
    const ex = memoryTarget(ALICE, 'notes.excepted');
    await addException({ storage, config: cfg() }, { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: ex.key }, label: CONF, action: 'audience', reason: 'public on purpose', auto: false });
    for (const key of ['notes.inside', 'notes.excepted']) {
      expect(await settleAudienceAfterRise({ storage, config: cfg() }, { target: memoryTarget(ALICE, key), from: 'sisainen', to: CONF, by: ALICE })).toEqual([]);
    }
    expect((await storage.getMemory(ALICE, 'notes.excepted'))?.visibility).toBe('public');
  });
});
