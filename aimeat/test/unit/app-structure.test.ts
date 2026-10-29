/**
 * @file test/unit/app-structure.test.ts
 * @description The rules of the app plan and the structure steps, without a node: what a plan write
 *   accepts and refuses (services/app-plan.ts readPlanPatch, held to the node's own registries), and
 *   how the eight steps read a plan, a draft and a published app (services/app-structure.ts).
 * @version-history
 *   v1.1.0 — 2026-10-29 — A custom layout or nav with a note.
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { describe, it, expect } from 'vitest';
import { readPlanPatch, allowedChoiceValues, APP_PLAN_SPEC, type AppPlan } from '../../src/services/app-plan.js';
import { computeStructure, nextStep, STEP_IDS } from '../../src/services/app-structure.js';
import { LOOKS } from '../../src/data/atelier-looks.js';
import { UI_LAYOUT_PRESETS } from '../../src/services/app-ui/layouts.js';

const plan = (over: Partial<AppPlan> = {}): AppPlan => ({
  spec: APP_PLAN_SPEC, appId: 'alice/a.html', choices: {}, updatedBy: 'alice', updatedByPrincipal: 'alice@n',
  updatedAt: '2026-10-29T00:00:00Z', revision: 1, createdAt: '2026-10-29T00:00:00Z', ...over,
});
const base = { plan: null, app: null, hasDraft: false, specWritten: false, map: null, builders: 0, legalMissing: [] as string[] };
const state = (steps: ReturnType<typeof computeStructure>, id: string) => steps.find((s) => s.id === id)!.state;

describe('what a plan write accepts', () => {
  it('takes every look and every layout preset the node serves, so a new one is valid with no change', () => {
    expect(allowedChoiceValues('look')).toEqual(LOOKS.map((l) => l.id));
    expect(allowedChoiceValues('layout')).toEqual([...UI_LAYOUT_PRESETS.map((p) => p.id), 'custom']);
    for (const l of LOOKS) expect(readPlanPatch({ choices: { look: { value: l.id } } }).ok, l.id).toBe(true);
  });
  it('refuses a value the node does not offer, naming the ones it does', () => {
    const r = readPlanPatch({ choices: { nav: { value: 'teleport' } } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('bottom-bar');
  });
  it('refuses a choice key that does not exist and a state that is neither waiting nor done', () => {
    expect(readPlanPatch({ choices: { colour: { value: 'red' } } }).ok).toBe(false);
    expect(readPlanPatch({ choices: { look: { value: 'flat', state: 'maybe' } } }).ok).toBe(false);
  });
  it('reads null and an empty string as clearing a field, and leaves out what was not sent', () => {
    const r = readPlanPatch({ purpose: '', now: null, choices: { look: null } });
    expect(r.ok && r.patch).toEqual({ purpose: null, now: null, choices: { look: null } });
  });
  it('holds a genre to the Design Book id form and the data statement to its shape', () => {
    expect(readPlanPatch({ choices: { genre: 'nightfloor' } }).ok).toBe(true);
    expect(readPlanPatch({ choices: { genre: 'Not An Id!' } }).ok).toBe(false);
    expect(readPlanPatch({ data: { summary: 'x', personalData: 'maybe' } }).ok).toBe(false);
  });
  it('takes a custom layout or nav only with a note, and the refusal of an unknown one names custom', () => {
    // Cold Opus runs of a 3D game reached for "single" and "agent-decides" and had no value to write.
    const single = readPlanPatch({ choices: { layout: { value: 'single' } } });
    expect(!single.ok && single.message).toContain('"custom"');
    expect(readPlanPatch({ choices: { layout: { value: 'custom' } } }).ok).toBe(false);
    expect(readPlanPatch({ choices: { nav: { value: 'custom', note: 'One screen; the cube turns by drag.' } } }).ok).toBe(true);
  });
});

describe('the eight steps', () => {
  it('are always the same eight, in the order a person meets them', () => {
    expect(computeStructure(base).map((s) => s.id)).toEqual([...STEP_IDS]);
  });
  it('before anything: purpose and data are missing and point the person at the purpose first', () => {
    const s = computeStructure(base);
    expect(state(s, 'purpose')).toBe('missing');
    expect(state(s, 'data')).toBe('missing');
    expect(state(s, 'layout')).toBe('optional');
    expect(state(s, 'build')).toBe('missing');
    expect(state(s, 'requirements')).toBe('later');
    expect(nextStep(s)).toBe('purpose');
  });
  it('a person\'s choice that waits makes the step in progress; built, it is fine', () => {
    const waiting = computeStructure({ ...base, plan: plan({ choices: { look: { value: 'flat', by: 'owner', state: 'waiting', at: '' } } }) });
    expect(state(waiting, 'look')).toBe('progress');
    const built = computeStructure({ ...base, plan: plan({ choices: { look: { value: 'flat', by: 'owner', state: 'done', at: '' } } }) });
    expect(state(built, 'look')).toBe('fine');
  });
  it('personal data in the plan says a privacy notice comes at the publish', () => {
    const s = computeStructure({ ...base, plan: plan({ purpose: 'p', data: { summary: 's', personalData: 'yes' } }) });
    expect(s.find((x) => x.id === 'requirements')!.detail.personal).toBe(true);
    expect(nextStep(s)).toBe('layout');
  });
  it('a published app reads its listing, its legal pages and its open AI Act questions', () => {
    // Community is stored as parked + community (appListingOf).
    const app = { versionNumber: 3, parked: true, community: true, forkable: true, manifest: { description: 'd' } } as never;
    const s = computeStructure({ ...base, app, map: { declared: true, rows: 2, personal: 1, aiUnanswered: 2, usesAi: true }, legalMissing: ['privacy'] });
    expect(s.find((x) => x.id === 'visibility')!.detail.listing).toBe('community');
    expect(state(s, 'requirements')).toBe('missing');
    expect(s.find((x) => x.id === 'requirements')!.detail).toMatchObject({ legalMissing: ['privacy'], aiUnanswered: 2 });
    expect(state(s, 'build')).toBe('fine');
  });
});
