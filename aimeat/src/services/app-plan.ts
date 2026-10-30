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
 *   only, because the Design Book is data an operator edits. Layout and navigation also take
 *   `custom` with a note, for a screen no preset fits.
 *
 *   THE AI DRAWS OPTIONS OF ITS OWN (Jouni, 2026-10-30: "miksei tekoäly pysty tekemään niitä eri
 *   asetteluja ja muovaamaan dynaamisesti", and the presets stay beside them). `proposals.layout` and
 *   `proposals.nav` hold up to four options the building AI drew for this one app, each a name, a
 *   sentence and a sketch in the rows LayoutSketch draws. The page offers them first and the presets
 *   after, and a choice's value may name one. A person's choice may carry a note: what they want
 *   changed in it.
 *
 *   STORAGE: the platform namespace `app-plan`, keyed like the design spec by the app id, so the
 *   memory API cannot write it and the account erasure reaches it. A plan whose app was deleted is
 *   deleted with the app.
 * @structure AppPlan / AppPlanChoice / PlanProposal / PLAN_CHOICE_KEYS / PROPOSAL_KEYS · appPlanKey ·
 *   readAppPlan · listAppPlansOf · readPlanPatch · readProposals · strayChoice · writeAppPlan ·
 *   deleteAppPlan · eraseAppPlansOf
 * @usage
 *   const plan = await readAppPlan(storage, 'alice/talkoot.html');
 *   const out = await writeAppPlan(storage, { appId, patch, by, principal, actor: 'owner' });
 * @version-history
 *   v1.2.0 — 2026-10-30 — `proposals`: layouts and navigations the AI drew for this app, which a choice may name.
 *   v1.1.0 — 2026-10-29 — CUSTOM_CHOICE for layout and nav, with a note; the refusal names it and says
 *     how to leave a choice to the AI (cold Opus runs of a 3D game hit "single" and "agent-decides").
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

/** The choices the building AI may draw options of its own for. */
export const PROPOSAL_KEYS = ['layout', 'nav'] as const;
export type ProposalKey = typeof PROPOSAL_KEYS[number];

/** One block of a sketch, as components/LayoutSketch.js draws it. */
export interface SketchCell { w: 'full' | 'main' | 'side' | 'half' | 'tiny'; label?: string; tone?: 'ink' | 'sun' }
export interface SketchRow { height: 's' | 'm' | 'l'; cells: SketchCell[] }

/** A layout or a navigation the AI drew for this one app: a name, a sentence, and its sketch. */
export interface PlanProposal { id: string; name: string; note: string; sketch: SketchRow[] }

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
  /** The layouts and navigations the building AI drew for this app, which the page offers beside the presets. */
  proposals?: Partial<Record<ProposalKey, PlanProposal[]>>;
  /** What the building AI is doing now, one line. */
  now?: { text: string; at: string; by: string };
  updatedBy: string;
  updatedByPrincipal: string;
  updatedAt: string;
  revision: number;
  createdAt: string;
}

// note: 600, because a custom layout is described in it (cold runs wrote 300 to 400 characters).
const LIMITS = { name: 120, purpose: 800, summary: 800, now: 200, note: 600 } as const;
const GENRE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** A proposal's bounds: a few options, each a sketch small enough to read at a glance. */
const PROPOSAL = { max: 4, rows: 6, cells: 4, name: 60, note: 400, label: 40, id: /^[a-z][a-z0-9-]{1,39}$/ } as const;
const SKETCH_HEIGHTS = ['s', 'm', 'l'] as const;
const SKETCH_WIDTHS = ['full', 'main', 'side', 'half', 'tiny'] as const;
const SKETCH_TONES = ['ink', 'sun'] as const;

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

/**
 * A layout or a navigation no preset fits (a game board, one tool on one screen), described in the
 * choice's `note`. The first cold runs of a game reached for "single" and was refused, with no way
 * to say what it had chosen.
 */
export const CUSTOM_CHOICE = 'custom';

/** The values a choice may take, from the registries the node already keeps. */
export function allowedChoiceValues(key: PlanChoiceKey): readonly string[] | null {
  switch (key) {
    case 'layout': return [...UI_LAYOUT_PRESETS.map((p) => p.id), CUSTOM_CHOICE];
    case 'nav': return [...NAV_MODES, CUSTOM_CHOICE];
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
  proposals?: Partial<Record<ProposalKey, PlanProposal[] | null>>;
  now?: string | null;
}

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : null;

const PROPOSAL_SHAPE = '[{ "id": "board-side", "name": "Board and a side panel", "note": "one sentence on what it gives", "sketch": [{ "height": "s" | "m" | "l", "cells": [{ "w": "full" | "main" | "side" | "half" | "tiny", "label": "Turn", "tone": "ink" | "sun" }] }] }]';

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * The options the AI drew for one choice, or the sentence that says what is wrong. An id may not be a
 * preset's, so a value on the plan names one thing only.
 */
function readProposals(k: ProposalKey, raw: unknown): PlanProposal[] | string {
  const where = `proposals.${k}`;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > PROPOSAL.max) return `${where} is a list of 1 to ${PROPOSAL.max} options, each ${PROPOSAL_SHAPE}, or null to clear it.`;
  const presets = allowedChoiceValues(k) ?? [];
  const out: PlanProposal[] = [];
  for (const [i, o] of raw.entries()) {
    const at = `${where}[${i}]`;
    const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!PROPOSAL.id.test(id)) return `${at}.id is lowercase letters, digits and hyphens, 2 to 40 characters, such as "board-side".`;
    if (presets.includes(id)) return `${at}.id "${id}" is a ${k} preset's id. Give your own option an id of its own.`;
    if (out.some((p) => p.id === id)) return `${at}.id "${id}" is used twice.`;
    const name = text(r.name, PROPOSAL.name);
    const note = text(r.note, PROPOSAL.note);
    if (!name || !note) return `${at} carries "name" (at most ${PROPOSAL.name} characters) and "note" (one sentence on what it gives the person, at most ${PROPOSAL.note}).`;
    const rows = r.sketch;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > PROPOSAL.rows) return `${at}.sketch is 1 to ${PROPOSAL.rows} rows, top to bottom: ${PROPOSAL_SHAPE}.`;
    const sketch: SketchRow[] = [];
    for (const [j, row] of rows.entries()) {
      const rr = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      const cells = rr.cells;
      if (!has(SKETCH_HEIGHTS, rr.height) || !Array.isArray(cells) || cells.length < 1 || cells.length > PROPOSAL.cells) {
        return `${at}.sketch[${j}] is { "height": "s" | "m" | "l", "cells": 1 to ${PROPOSAL.cells} blocks side by side }.`;
      }
      const out2: SketchCell[] = [];
      for (const cell of cells) {
        const c = (cell && typeof cell === 'object' ? cell : {}) as Record<string, unknown>;
        if (!has(SKETCH_WIDTHS, c.w) || (c.tone !== undefined && !has(SKETCH_TONES, c.tone))) {
          return `${at}.sketch[${j}] has a block that is not { "w": "full" | "main" | "side" | "half" | "tiny", "label": "...", "tone": "ink" | "sun" }.`;
        }
        const label = c.label === undefined ? '' : text(c.label, PROPOSAL.label);
        out2.push({ w: c.w, ...(label ? { label } : {}), ...(c.tone ? { tone: c.tone as SketchCell['tone'] } : {}) });
      }
      sketch.push({ height: rr.height, cells: out2 });
    }
    out.push({ id, name, note, sketch });
  }
  return out;
}

/**
 * A layout or nav choice that names neither a preset nor one of the plan's proposals, as the sentence
 * the caller sees, or null. Read on the plan as it would be written, so a proposal and the choice of
 * it may arrive in one call, and a list may not drop the option the plan has chosen.
 */
export function strayChoice(plan: Pick<AppPlan, 'choices' | 'proposals'>): string | null {
  for (const k of PROPOSAL_KEYS) {
    const c = plan.choices[k];
    if (!c || allowedChoiceValues(k)!.includes(c.value)) continue;
    const ids = (plan.proposals?.[k] ?? []).map((p) => p.id);
    if (ids.includes(c.value)) continue;
    return `The ${k} chosen is "${c.value}", which is neither a ${k} preset nor one of this plan's ${k} proposals (${ids.join(', ') || 'none'}). `
      + `The ${k} values on this node are: ${allowedChoiceValues(k)!.join(', ')}. Draw the option in "proposals" in the same call, or write "${CUSTOM_CHOICE}" with a note of one sentence that describes it. While nobody has chosen, leave it unset: the page then says the AI decides.`;
  }
  return null;
}

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
      // An option the AI drew is held to the plan's proposals where the plan is written (strayChoice).
      const proposalId = has(PROPOSAL_KEYS, k) && PROPOSAL.id.test(value);
      if (!proposalId && (allowed ? !allowed.includes(value) : !GENRE_RE.test(value))) {
        return {
          ok: false,
          message: allowed
            ? `"${value}" is not a ${k}. The ${k} values on this node are: ${allowed.join(', ')}.`
              + (allowed.includes(CUSTOM_CHOICE) ? ` When none of them fits, write "${CUSTOM_CHOICE}" with a note of one sentence that describes it. While nobody has chosen, leave it unset: the page then says the AI decides.` : '')
            : `"${value}" is not a Design Book id. GET /v1/designbook lists them.`,
        };
      }
      const state = r.state;
      if (state !== undefined && state !== 'waiting' && state !== 'done') return { ok: false, message: `choices.${k}.state is "waiting" or "done".` };
      const note = r.note === undefined ? undefined : text(r.note, LIMITS.note);
      if (value === CUSTOM_CHOICE && !note) return { ok: false, message: `A "${CUSTOM_CHOICE}" ${k} carries a note: one sentence that describes it, which the structure page shows.` };
      patch.choices[k] = { value, ...(state ? { state } : {}), ...(note ? { note } : {}) };
    }
  }
  if ('proposals' in b) {
    const p = b.proposals;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, message: `proposals is an object keyed by ${PROPOSAL_KEYS.join(' or ')}, each ${PROPOSAL_SHAPE}, or null to clear it.` };
    patch.proposals = {};
    for (const [key, raw] of Object.entries(p as Record<string, unknown>)) {
      if (!has(PROPOSAL_KEYS, key)) return { ok: false, message: `"${key}" takes no proposals. Proposals are for ${PROPOSAL_KEYS.join(' and ')}.` };
      if (raw === null) { patch.proposals[key] = null; continue; }
      const list = readProposals(key, raw);
      if (typeof list === 'string') return { ok: false, message: list };
      patch.proposals[key] = list;
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
  if (patch.proposals) {
    const proposals = { ...base.proposals };
    for (const [key, list] of Object.entries(patch.proposals) as Array<[ProposalKey, PlanProposal[] | null]>) {
      if (list) proposals[key] = list; else delete proposals[key];
    }
    if (Object.keys(proposals).length) next.proposals = proposals; else delete next.proposals;
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
): Promise<{ plan: AppPlan; created: boolean } | { conflict: AppPlan | null } | { refused: string }> {
  if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) throw new Error('App plan writes require atomic storage.');
  for (let attempt = 0; attempt < 40; attempt++) {
    const existing = await readAuthorAppRecord(storage, NS_PLAN, appPlanKey(input.appId), input.appId);
    const live = parsePlan(existing?.value, input.appId);
    if (typeof input.expectedRevision === 'number' && (live?.revision ?? 0) !== input.expectedRevision) {
      return { conflict: live };
    }
    const now = new Date().toISOString();
    const plan = applyPatch(live, input.appId, input.patch, input.actor, { by: input.by, principal: input.principal }, now);
    const stray = strayChoice(plan);
    if (stray) return { refused: stray };
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
