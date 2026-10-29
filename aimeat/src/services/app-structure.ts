/**
 * @file src/services/app-structure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's structure and status: the eight steps an app goes through, each with where
 *   it stands, read from the places the node already keeps them, plus the app plan
 *   (services/app-plan.ts) for what exists before a publish. The structure page in appcat draws it,
 *   and the building AI reads the same answer through aimeat_app_manage, so both see one status.
 *
 *   THE STEPS, IN THE ORDER A PERSON MEETS THEM: purpose, data, layout, look, build, builders,
 *   visibility, requirements. A step's `state` is one of fine, progress, optional, not_needed,
 *   missing or later, and `detail` carries the facts the page words in the reader's language.
 *   `said` is the same in one English sentence for an AI.
 *
 *   WHERE EACH ONE COMES FROM. Before a publish: the plan and the draft. After: the design spec, the
 *   data map (readProgramMap, as a node read), the listing, the development rights
 *   (listDevGrants), the legal pages (legalReadiness) and the AI Act questions the map leaves open.
 *   The plan still carries the choices after a publish, because no other record says which layout
 *   or look the person picked.
 *
 *   WHO MAY: everybody inside the build, the same test the draft and the design spec make
 *   (resolveAppTarget with the `draft` act). A person writing is the owner side (`owner`): a choice
 *   they make waits for the AI. Anything else writing, an agent or a connected AI, is the AI side.
 * @structure STEP_IDS · structurePageUrl · computeStructure · readStructureFor · writePlanFor · listPlansFor
 * @usage const out = await readStructureFor(storage, config, req.auth!, { owner, filename });
 * @version-history
 *   v1.1.0 — 2026-10-29 — A layout, nav, look or genre step carries the choice's note, which describes a custom one.
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { appListingOf } from '../storage/types/apps.js';
import { localAccountName, resolveIdentity, isOwnerInPerson } from '../utils/gaii.js';
import { accountOf } from './app-members.js';
import { emitChange } from './event-bus.js';
import { resolveAppTarget, listDevGrants } from './app-dev-grant.js';
import { readAppDesignSpec } from './app-design-spec.js';
import { readProgramMap, NODE_READ } from './data-map/data-map-access.js';
import { legalReadiness } from './app-legal.js';
import { readAppPlan, writeAppPlan, readPlanPatch, listAppPlansOf, type AppPlan, type AppPlanChoice } from './app-plan.js';
import { done, refuse, type AppOpCaller, type AppOpOutcome, type AppOpRefusal } from './app-op-outcome.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export const STEP_IDS = ['purpose', 'data', 'layout', 'look', 'build', 'builders', 'visibility', 'requirements'] as const;
export type StepId = typeof STEP_IDS[number];
export type StepState = 'fine' | 'progress' | 'optional' | 'not_needed' | 'missing' | 'later';

export interface StructureStep {
  id: StepId;
  state: StepState;
  detail: Record<string, unknown>;
  said: string;
}

interface Ref { owner: string; filename: string }

/** The page that shows the structure, the address the building AI gives the person. */
export const structurePageUrl = (config: AimeatConfig, appId: string): string =>
  `${config.baseUrl}/v1/appcat/structure?app=${encodeURIComponent(appId)}`;

/** The state of a pair of choices (layout + nav, look + genre): waiting wins, then any choice, else optional. */
function choiceState(choices: Array<AppPlanChoice | undefined>): StepState {
  const made = choices.filter((c): c is AppPlanChoice => !!c);
  if (made.some((c) => c.state === 'waiting')) return 'progress';
  return made.length ? 'fine' : 'optional';
}

// The note goes along: a custom layout or nav is described only there.
const choiceDetail = (c: AppPlanChoice | undefined) => (c ? { value: c.value, by: c.by, state: c.state, ...(c.note ? { note: c.note } : {}) } : null);

/** The eight steps, from what was read. Pure, so a unit test holds the rules. */
export function computeStructure(input: {
  plan: AppPlan | null;
  app: AppRecord | null;
  hasDraft: boolean;
  specWritten: boolean;
  map: { declared: boolean; rows: number; personal: number; aiUnanswered: number; usesAi: boolean } | null;
  builders: number;
  legalMissing: string[];
}): StructureStep[] {
  const { plan, app, hasDraft, specWritten, map, builders, legalMissing } = input;
  const c = plan?.choices ?? {};
  const steps: StructureStep[] = [];

  const purpose = plan?.purpose ?? (app?.manifest?.description || '');
  steps.push(purpose || specWritten
    ? { id: 'purpose', state: 'fine', detail: { text: purpose, spec: specWritten }, said: 'The purpose is written.' }
    : { id: 'purpose', state: 'missing', detail: {}, said: 'Nobody has written who the app is for. Write `purpose` in the plan.' });

  if (map?.declared) {
    steps.push({ id: 'data', state: 'fine', detail: { source: 'map', rows: map.rows, personal: map.personal }, said: `The data map is stated: ${map.rows} kinds of data, ${map.personal} with personal data.` });
  } else if (plan?.data) {
    steps.push({ id: 'data', state: 'fine', detail: { source: 'plan', summary: plan.data.summary, personalData: plan.data.personalData }, said: 'The data is stated in the plan; the data map follows at the first publish.' });
  } else {
    steps.push({ id: 'data', state: 'missing', detail: { published: !!app }, said: app ? 'The app has no data map. Write it with aimeat_datamap_set.' : 'Nobody has said what data the app keeps. Write `data` in the plan after the data map questions.' });
  }

  const layoutState = choiceState([c.layout, c.nav]);
  steps.push({ id: 'layout', state: layoutState, detail: { layout: choiceDetail(c.layout), nav: choiceDetail(c.nav) },
    said: layoutState === 'progress' ? 'The person chose a layout that is not built yet. Build it, then write the same value with state "done".'
      : layoutState === 'fine' ? 'The layout is chosen.' : 'No layout is chosen. Choose one yourself and write it with your reason, or leave it to the person.' });

  const lookState = choiceState([c.look, c.genre]);
  steps.push({ id: 'look', state: lookState, detail: { look: choiceDetail(c.look), genre: choiceDetail(c.genre) },
    said: lookState === 'progress' ? 'The person chose a look that is not built yet. Build it, then write the same value with state "done".'
      : lookState === 'fine' ? 'The look is chosen.' : 'No look is chosen. Choose one yourself and write it with your reason, or leave it to the person.' });

  if (app) {
    steps.push({ id: 'build', state: hasDraft ? 'progress' : 'fine', detail: { version: app.versionNumber, draft: hasDraft, now: plan?.now ?? null },
      said: hasDraft ? `Version ${app.versionNumber} is live and a draft is waiting.` : `Version ${app.versionNumber} is live.` });
  } else if (hasDraft || plan?.now) {
    steps.push({ id: 'build', state: 'progress', detail: { draft: hasDraft, now: plan?.now ?? null }, said: hasDraft ? 'The draft is being built.' : 'The building has started; no draft is saved yet.' });
  } else {
    steps.push({ id: 'build', state: 'missing', detail: { draft: false }, said: 'Nothing is built yet.' });
  }

  steps.push(builders > 0
    ? { id: 'builders', state: 'fine', detail: { count: builders }, said: `${builders} other people may build this app.` }
    : { id: 'builders', state: 'not_needed', detail: { count: 0 }, said: 'Only the owner builds this app.' });

  if (app) {
    steps.push({ id: 'visibility', state: 'fine', detail: { listing: appListingOf(app), forkable: app.forkable !== false }, said: `The app is ${appListingOf(app)}.` });
  } else if (c.visibility) {
    steps.push({ id: 'visibility', state: 'fine', detail: { intended: c.visibility.value, by: c.visibility.by }, said: `The app is to be ${c.visibility.value} when it is published.` });
  } else {
    steps.push({ id: 'visibility', state: 'missing', detail: {}, said: 'Nobody has said who may see the app. Ask the person before the first publish.' });
  }

  if (app) {
    const open = legalMissing.length + (map?.aiUnanswered ?? 0);
    steps.push({ id: 'requirements', state: open ? 'missing' : 'fine', detail: { legalMissing, aiUnanswered: map?.aiUnanswered ?? 0, usesAi: !!map?.usesAi },
      said: open ? `Open: ${legalMissing.length ? `legal pages ${legalMissing.join(', ')}` : ''}${legalMissing.length && map?.aiUnanswered ? '; ' : ''}${map?.aiUnanswered ? `${map.aiUnanswered} EU AI Act questions` : ''}.` : 'The legal pages and the EU AI Act answers are in place.' });
  } else {
    const personal = plan?.data?.personalData === 'yes';
    steps.push({ id: 'requirements', state: 'later', detail: { personal }, said: personal ? 'The app keeps personal data, so it will need a privacy notice when it is published.' : 'The requirements are read from the data map at the first publish.' });
  }
  return steps;
}

/** The step a person is pointed at next, or null when nothing waits on them. */
export function nextStep(steps: StructureStep[]): StepId | null {
  const by = (id: StepId) => steps.find((s) => s.id === id)!;
  for (const id of ['purpose', 'data'] as const) if (by(id).state === 'missing') return id;
  for (const id of ['layout', 'look'] as const) if (by(id).state === 'optional') return id;
  for (const id of ['visibility', 'requirements'] as const) if (by(id).state === 'missing') return id;
  return null;
}

/** The app this call names, in the bucket the caller may build in, or the refusal. */
async function target(storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: Ref) {
  if (!FILENAME_RE.test(ref.filename)) return refuse(400, 'INVALID_INPUT', 'Invalid filename.');
  const t = await resolveAppTarget(storage, config, {
    callerOwner: localAccountName(caller.owner),
    requestedOwner: ref.owner === 'me' ? '' : ref.owner,
    filename: ref.filename,
    act: 'draft',
  });
  if (!t.ok) return refuse(t.status, t.code, t.message);
  const app = await storage.getAppByOwnerName(t.ownerName, ref.filename);
  const appId = `${app?.ownerName ?? t.ownerName}/${app?.filename ?? ref.filename}`;
  return { ok: true as const, app, appId, ownerName: t.ownerName, ownerGhii: t.ownerGhii };
}

type Target = Exclude<Awaited<ReturnType<typeof target>>, AppOpRefusal>;

async function structureOf(storage: Storage, config: AimeatConfig, t: Target, plan: AppPlan | null) {
  const { app } = t;
  const hasDraft = !!(await storage.getAppDraft(t.ownerGhii, app?.filename ?? t.appId.slice(t.appId.indexOf('/') + 1)));
  let map: Parameters<typeof computeStructure>[0]['map'] = null;
  let specWritten = false;
  let builders = 0;
  let legalMissing: string[] = [];
  if (app) {
    specWritten = !!(await readAppDesignSpec(storage, t.appId));
    const read = await readProgramMap(storage, config, NODE_READ, t.appId, new Date().toISOString());
    if (!('refusal' in read)) {
      const held = read.dataMap?.held ?? [];
      map = {
        declared: !!read.dataMap && read.dataMap.source === 'declared',
        rows: held.length,
        personal: held.filter((r) => r.personalData === 'yes').length,
        aiUnanswered: read.aiAct?.unanswered.length ?? 0,
        usesAi: !!read.aiAct,
      };
    }
    builders = (await listDevGrants(storage, t.appId)).length;
    legalMissing = legalReadiness(app).missing;
  }
  const steps = computeStructure({ plan, app, hasDraft, specWritten, map, builders, legalMissing });
  return {
    app: t.appId,
    name: app?.manifest?.name || plan?.name || t.appId.slice(t.appId.indexOf('/') + 1),
    published: !!app,
    has_draft: hasDraft,
    plan,
    steps,
    fine: steps.filter((s) => s.state === 'fine' || s.state === 'not_needed').length,
    total: steps.length,
    next: nextStep(steps),
    page_url: structurePageUrl(config, t.appId),
  };
}

/** GET .../structure: the eight steps and the plan. 404 when there is no app, draft or plan by that name. */
export async function readStructureFor(storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: Ref): Promise<AppOpOutcome> {
  const t = await target(storage, config, caller, ref);
  if (!t.ok) return t;
  const plan = await readAppPlan(storage, t.appId);
  const hasDraft = !t.app && !!(await storage.getAppDraft(t.ownerGhii, ref.filename));
  if (!t.app && !plan && !hasDraft) {
    return refuse(404, 'NOT_FOUND', `No app, draft or plan named "${ref.filename}". Start one: PUT this address with { "name", "purpose" }.`);
  }
  return done(await structureOf(storage, config, t, plan));
}

/**
 * PUT .../structure: write the plan (fields left out stay as they are, null clears one). The first
 * write starts the plan, and from then on the structure page exists, before any code.
 */
export async function writePlanFor(storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: Ref, rawBody: unknown): Promise<AppOpOutcome> {
  const t = await target(storage, config, caller, ref);
  if (!t.ok) return t;
  const read = readPlanPatch(rawBody);
  if (!read.ok) return refuse(400, 'INVALID_INPUT', read.message);
  const expected = (rawBody as Record<string, unknown> | null)?.expected_revision;
  if (expected !== undefined && expected !== null && (!Number.isInteger(expected) || (expected as number) < 0)) {
    return refuse(400, 'INVALID_INPUT', 'expected_revision is the revision you read, a whole number; omit it to write over whatever is there.');
  }
  const principal = resolveIdentity(caller, config.nodeId);
  const out = await writeAppPlan(storage, {
    appId: t.appId, patch: read.patch, by: accountOf(principal), principal,
    actor: isOwnerInPerson(caller) ? 'owner' : 'ai',
    ...(typeof expected === 'number' ? { expectedRevision: expected } : {}),
  });
  if ('conflict' in out) {
    return refuse(409, 'REVISION_MISMATCH', `The plan is at revision ${out.conflict?.revision ?? 0}, not ${expected}. Read it again and write from that.`, { plan: out.conflict });
  }
  emitChange('app-plans', t.ownerGhii);
  return done(await structureOf(storage, config, t, out.plan), out.created ? 201 : 200);
}

/** GET /v1/app-plans: the caller's own plans, each with its step count; the apps not yet published first. */
export async function listPlansFor(storage: Storage, config: AimeatConfig, caller: AppOpCaller): Promise<AppOpOutcome> {
  const owner = localAccountName(caller.owner);
  if (!owner) return refuse(400, 'INVALID_INPUT', 'No owner on the caller.');
  const plans = await listAppPlansOf(storage, owner);
  const items = [];
  for (const plan of plans) {
    const filename = plan.appId.slice(plan.appId.indexOf('/') + 1);
    const t = await target(storage, config, caller, { owner: '', filename });
    if (!t.ok) continue;
    const s = await structureOf(storage, config, t, plan);
    items.push({ app: s.app, filename, name: s.name, published: s.published, has_draft: s.has_draft, fine: s.fine, total: s.total, next: s.next, updated_at: plan.updatedAt, page_url: s.page_url });
  }
  items.sort((a, b) => Number(a.published) - Number(b.published));
  return done({ plans: items });
}
