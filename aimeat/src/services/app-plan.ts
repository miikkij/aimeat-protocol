/**
 * @file src/services/app-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app plan: one record per app, written from the moment its building starts, before
 *   any code and before any publish. It holds what the structure page (services/app-structure.ts)
 *   cannot read from anywhere else while the app is only an idea or a draft: the name and purpose,
 *   a short statement of the data, the choices the person made on the page or the AI made itself
 *   (layout, navigation, look, Design Book genre, visibility), and one line on what the AI is
 *   doing now.
 *
 *   WHY IT EXISTS (Jouni, 2026-10-29): a person who starts an app should see from the first moment
 *   what the app consists of, where it stands and what is still open, and pick a layout or a look
 *   by seeing them, with the choice going back to the AI that builds. The design spec, the data map
 *   and the app's settings all need a published app; the plan is what exists before one.
 *
 *   A CHOICE KNOWS WHO MADE IT AND WHETHER IT IS BUILT. `by` is `owner` when a person chose on the
 *   page and `ai` when the building AI chose itself. `state` is `waiting` until the AI has built it
 *   and `done` after. The AI that applies a person's choice writes the same value with state done,
 *   and the choice stays the person's.
 *
 *   EVERY VALUE COMES FROM A REGISTRY THE NODE ALREADY HAS: layouts from the layout presets, the
 *   navigation from the mosaic's nav modes, looks from the look registry. A look or layout added
 *   there is valid here with no change to this file. A genre is a Design Book id, held to its form
 *   only, because the Design Book is data an operator edits.
 *
 *   STORAGE: the platform namespace `app-plan`, keyed like the design spec by the app id, so the
 *   memory API cannot write it and the account erasure reaches it. A plan whose app was deleted is
 *   deleted with the app.
 * @structure AppPlan / AppPlanChoice / PLAN_CHOICE_KEYS · appPlanKey · readAppPlan · listAppPlansOf ·
 *   readPlanPatch · writeAppPlan · deleteAppPlan · eraseAppPlansOf
 * @usage
 *   const plan = await readAppPlan(storage, 'alice/talkoot.html');
 *   const out = await writeAppPlan(storage, { appId, patch, by, principal, actor: 'owner' });
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import type { Storage } from '../storage/interface.js';
import { appKeySegment, readAuthorAppRecord, appRecordsOfAuthor, equalAppId, canonicalAppId, listAppRecords } from './app-record-keys.js';
import { UI_LAYOUT_PRESETS } from './app-ui/layouts.js';
import { NAV_MODES, LOOKS } from './app-ui/registry.js';

export const APP_PLAN_SPEC = 'aimeat.appplan/1' as const;

/** The platform's own namespace, so the record is not writable through the memory API. */
const NS_PLAN = 'app-plan';
const PREFIX = 'appplan.';

export const PLAN_CHOICE_KEYS = ['layout', 'nav', 'look', 'genre', 'visibility'] as const;
export type PlanChoiceKey = typeof PLAN_CHOICE_KEYS[number];

export const PLAN_VISIBILITY = ['listed', 'community', 'unlisted'] as const;

export interface AppPlanChoice {
  /** The id: a layout preset, a nav mode, a look, a Design Book genre, or a listing. */
  value: string;
  /** Who chose: the person on the page, or the AI that builds. */
  by: 'owner' | 'ai';
  /** waiting until the AI has built it, done after. */
  state: 'waiting' | 'done';
  at: string;
  /** One sentence on why, from whoever chose. */
  note?: string;
}

export interface AppPlan {
  spec: typeof APP_PLAN_SPEC;
  appId: string;
  /** The app's name while it has no manifest of its own. */
  name?: string;
  /** Who the app is for and the one job it does for them. */
  purpose?: string;
  /** The data, in short, before the data map can be written: what is kept, and whether any of it is personal. */
  data?: { summary: string; personalData: 'yes' | 'no' | 'unstated' };
  choices: Partial<Record<PlanChoiceKey, AppPlanChoice>>;
  /** What the building AI is doing now, one line. */
  now?: { text: string; at: string; by: string };
  updatedBy: string;
  updatedByPrincipal: string;
  updatedAt: string;
  revision: number;
  createdAt: string;
}

const LIMITS = { name: 120, purpose: 800, summary: 800, now: 200, note: 300 } as const;
const GENRE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const appPlanKey = (appId: string) => `${PREFIX}${appKeySegment(appId)}`;

function parsePlan(v: unknown, appId: string): AppPlan | null {
  const p = v as AppPlan | undefined;
  if (!p || p.spec !== APP_PLAN_SPEC || !equalAppId(p.appId, appId)) return null;
  return { ...p, choices: p.choices ?? {} };
}

/** This app's plan, or null when nobody has started one. */
export async function readAppPlan(storage: Storage, appId: string): Promise<AppPlan | null> {
  const rec = await readAuthorAppRecord(storage, NS_PLAN, appPlanKey(appId), appId);
  return parsePlan(rec?.value, appId);
}

/**
 * Every plan of the apps `account` authors, newest first. The key segment encodes the canonical app
 * id `<account>/<filename>`, so the account's plans are one prefix scan; the author test of
 * appRecordsOfAuthor keeps a plan of an earlier holder of the name out.
 */
export async function listAppPlansOf(storage: Storage, account: string): Promise<AppPlan[]> {
  const prefix = `${PREFIX}${appKeySegment(`${account}/`)}`;
  const { items } = await listAppRecords(storage, NS_PLAN, prefix);
  const out: AppPlan[] = [];
  for (const rec of items) {
    const id = String((rec.value as { appId?: unknown } | null)?.appId ?? '');
    if (!canonicalAppId(id).startsWith(`${account.toLowerCase()}/`)) continue;
    // Read through the author test, so a plan older than the account holding the name is dropped.
    const plan = await readAppPlan(storage, id);
    if (plan) out.push(plan);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The values a choice may take, from the registries the node already keeps. */
export function allowedChoiceValues(key: PlanChoiceKey): readonly string[] | null {
  switch (key) {
    case 'layout': return UI_LAYOUT_PRESETS.map((p) => p.id);
    case 'nav': return NAV_MODES;
    case 'look': return LOOKS;
    case 'visibility': return PLAN_VISIBILITY;
    case 'genre': return null;
  }
}

/** A choice as the caller sent it: a value, or null to clear the choice. */
interface ChoicePatch { value: string; state?: 'waiting' | 'done'; note?: string }

export interface PlanPatch {
  name?: string | null;
  purpose?: string | null;
  data?: { summary: string; personalData: 'yes' | 'no' | 'unstated' } | null;
  choices?: Partial<Record<PlanChoiceKey, ChoicePatch | null>>;
  now?: string | null;
}

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : null;

/**
 * What a write accepts. Every field is optional and a field left out stays as it is; null clears it.
 * The refusal is the sentence the caller sees, naming the values a choice may take.
 */
export function readPlanPatch(body: unknown): { ok: true; patch: PlanPatch } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send the plan fields as one JSON object.' };
  const b = body as Record<string, unknown>;
  const patch: PlanPatch = {};
  for (const f of ['name', 'purpose', 'now'] as const) {
    if (!(f in b)) continue;
    if (b[f] === null) { patch[f] = null; continue; }
    const v = text(b[f], LIMITS[f]);
    if (v === null) return { ok: false, message: `${f} is text, or null to clear it.` };
    patch[f] = v || null;
  }
  if ('data' in b) {
    if (b.data === null) patch.data = null;
    else {
      const d = b.data as Record<string, unknown>;
      const summary = d && typeof d === 'object' ? text(d.summary, LIMITS.summary) : null;
      const pd = d && typeof d === 'object' ? d.personalData ?? 'unstated' : null;
      if (!summary || (pd !== 'yes' && pd !== 'no' && pd !== 'unstated')) {
        return { ok: false, message: 'data is { "summary": "what the app keeps and whose it is", "personalData": "yes" | "no" | "unstated" }, or null.' };
      }
      patch.data = { summary, personalData: pd };
    }
  }
  if ('choices' in b) {
    const c = b.choices;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, message: 'choices is an object keyed by layout, nav, look, genre or visibility.' };
    patch.choices = {};
    for (const [key, raw] of Object.entries(c as Record<string, unknown>)) {
      if (!(PLAN_CHOICE_KEYS as readonly string[]).includes(key)) {
        return { ok: false, message: `"${key}" is not a choice. The choices are ${PLAN_CHOICE_KEYS.join(', ')}.` };
      }
      const k = key as PlanChoiceKey;
      if (raw === null) { patch.choices[k] = null; continue; }
      const r = (typeof raw === 'string' ? { value: raw } : raw) as Record<string, unknown>;
      const value = r && typeof r === 'object' ? text(r.value, 80) : null;
      if (!value) return { ok: false, message: `choices.${k} is { "value": "<id>" }, or null to clear it.` };
      const allowed = allowedChoiceValues(k);
      if (allowed ? !allowed.includes(value) : !GENRE_RE.test(value)) {
        return {
          ok: false,
          message: allowed
            ? `"${value}" is not a ${k}. The ${k} values on this node are: ${allowed.join(', ')}.`
            : `"${value}" is not a Design Book id. GET /v1/designbook lists them.`,
        };
      }
      const state = r.state;
      if (state !== undefined && state !== 'waiting' && state !== 'done') return { ok: false, message: `choices.${k}.state is "waiting" or "done".` };
      const note = r.note === undefined ? undefined : text(r.note, LIMITS.note);
      patch.choices[k] = { value, ...(state ? { state } : {}), ...(note ? { note } : {}) };
    }
  }
  return { ok: true, patch };
}

/**
 * Apply a patch to the stored plan. `actor` says who writes: the person (`owner`) or the building AI
 * (`ai`). A person's new choice waits for the AI; the AI's own choice is built as it is made. The AI
 * confirming a person's choice (same value, state done) keeps it the person's.
 */
function applyPatch(cur: AppPlan | null, appId: string, patch: PlanPatch, actor: 'owner' | 'ai', who: { by: string; principal: string }, now: string): AppPlan {
  const base: AppPlan = cur ?? {
    spec: APP_PLAN_SPEC, appId, choices: {}, updatedBy: '', updatedByPrincipal: '', updatedAt: now, revision: 0, createdAt: now,
  };
  const next: AppPlan = { ...base, choices: { ...base.choices } };
  if (patch.name !== undefined) { if (patch.name) next.name = patch.name; else delete next.name; }
  if (patch.purpose !== undefined) { if (patch.purpose) next.purpose = patch.purpose; else delete next.purpose; }
  if (patch.data !== undefined) { if (patch.data) next.data = patch.data; else delete next.data; }
  if (patch.now !== undefined) { if (patch.now) next.now = { text: patch.now, at: now, by: who.principal }; else delete next.now; }
  for (const [key, c] of Object.entries(patch.choices ?? {}) as Array<[PlanChoiceKey, ChoicePatch | null]>) {
    if (c === null) { delete next.choices[key]; continue; }
    const prev = base.choices[key];
    const sameValue = !!prev && prev.value === c.value;
    const by: 'owner' | 'ai' = actor === 'ai' && sameValue ? prev.by : actor;
    const state = c.state ?? (actor === 'owner' ? 'waiting' : 'done');
    next.choices[key] = { value: c.value, by, state, at: now, ...(c.note ? { note: c.note } : sameValue && prev.note ? { note: prev.note } : {}) };
  }
  next.updatedBy = who.by;
  next.updatedByPrincipal = who.principal;
  next.updatedAt = now;
  next.revision = base.revision + 1;
  return next;
}

/**
 * Write a patch. Answers the plan as written, or the stored plan when the caller named a revision it
 * expected to replace and another write came first.
 */
export async function writeAppPlan(
  storage: Storage,
  input: { appId: string; patch: PlanPatch; by: string; principal: string; actor: 'owner' | 'ai'; expectedRevision?: number },
): Promise<{ plan: AppPlan; created: boolean } | { conflict: AppPlan | null }> {
  if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) throw new Error('App plan writes require atomic storage.');
  for (let attempt = 0; attempt < 40; attempt++) {
    const existing = await readAuthorAppRecord(storage, NS_PLAN, appPlanKey(input.appId), input.appId);
    const live = parsePlan(existing?.value, input.appId);
    if (typeof input.expectedRevision === 'number' && (live?.revision ?? 0) !== input.expectedRevision) {
      return { conflict: live };
    }
    const now = new Date().toISOString();
    const plan = applyPatch(live, input.appId, input.patch, input.actor, { by: input.by, principal: input.principal }, now);
    const record = {
      key: appPlanKey(input.appId), ownerGaii: NS_PLAN, value: plan,
      visibility: 'private' as const, tags: ['app-plan'], ttlHours: null,
      version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    const saved = existing
      ? await storage.setMemoryIfVersion(record, existing.version)
      : await storage.createMemoryIfAbsent(record);
    if (saved) return { plan, created: !live };
  }
  throw new Error('The app plan changed repeatedly. Retry this write.');
}

/** Take the plan away. Returns whether there was one. */
export async function deleteAppPlan(storage: Storage, appId: string): Promise<boolean> {
  const existing = await readAuthorAppRecord(storage, NS_PLAN, appPlanKey(appId), appId);
  if (!existing) return false;
  await storage.deleteMemory(NS_PLAN, appPlanKey(appId));
  return true;
}

/** Erase the plans of every app `account` authored, for the account erasure. Returns how many went. */
export async function eraseAppPlansOf(storage: Storage, account: string): Promise<number> {
  const rows = await appRecordsOfAuthor(storage, NS_PLAN, PREFIX, account);
  for (const r of rows) await storage.deleteMemory(NS_PLAN, r.key);
  return rows.length;
}
