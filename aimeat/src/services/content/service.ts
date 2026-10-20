/**
 * @file src/services/content/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class capability as every surface calls it: the REST routes
 *   (routes/content.ts) and the MCP tools (mcp/content.ts) parse their own input and render their own
 *   answer, and everything between (the permission words, the input checks, which call does the
 *   work) is here once (CLAUDE.md, Backend: one capability, one implementation).
 *
 *   PERMISSION WORDS. Reading an item's facts or text needs the word that reads the item itself
 *   (storage:read for a file, memory:read for a memory record). Running a stage that calls a model
 *   needs ai:use as well, because it spends the owner's AI allowance. Changing the settings, a class
 *   or a proposal needs memory:write-reserved, as the AI policy does (routes/ai-policy.ts): the
 *   settings decide what spends the owner's key. The account holder in person holds every word.
 *   A visitor from another node is refused: the facts are a local account's own.
 * @structure parseSource · factsFor · textFor · inspectFor · scanFor · scanStatusFor · settingsFor ·
 *   updateSettingsFor · classesFor · setClassFor · removeClassFor · proposalsFor · decideProposalFor ·
 *   ontologyFor · overviewFor · listFactsFor · RESERVED_WORD
 * @usage const out = await inspectFor(deps, caller, { source: { kind: 'file', key: 'a.pdf' } });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { inspectSource, stagesToRun, ContentError, type InspectResult } from './pipeline.js';
import { startScan, getScan, runningScanOf, type ScanOptions, type ScanState } from './scan.js';
import { getFacts, getText, listFacts, coverage, sourceIdOf, type FactsFilter } from './facts-store.js';
import { readSettings, writeSettings } from './settings.js';
import {
  listClasses, setOwnerClass, removeOwnerClass, listProposals, decideProposal, owlOntology, ContentClassError,
} from './classes.js';
import {
  AI_STAGES, type ContentFacts, type ContentSource, type ContentSettings, type ContentClass, type ClassProposal,
  type StageName, type ContentKind,
} from './types.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The word that changes what spends the owner's AI key: the settings, the classes, the proposals. */
export const RESERVED_WORD = 'memory:write-reserved';

const STAGES: readonly StageName[] = ['technical', 'describe', 'classify', 'extract', 'propose'];
const KINDS: readonly ContentKind[] = ['pdf', 'image', 'video', 'text', 'other'];
const KEY_MAX = 1024;

export { ContentError, ContentClassError };

function refuse(code: string, status: number, message: string): never { throw new ContentError(code, status, message); }

function assertOn(deps: Deps): void {
  if (deps.config.contentClassMode === 'off') refuse('NOT_FOUND', 404, 'Content classes are off on this node.');
}

function assertLocal(caller: CallerContext): void {
  if (caller.visitor) refuse('LOCAL_ACCOUNT_REQUIRED', 403, 'Content facts belong to a local account; a visitor from another node has none here.');
}

function requireWord(caller: CallerContext, word: string, why: string): void {
  if (!caller.has(word)) refuse('SCOPE_DENIED', 403, `${why} needs the permission ${word}.`);
}

/**
 * The item a request names. `owner` defaults to the caller; the account holder may name one of
 * their own agents. Anything else is refused as absent, the answer an item that does not exist gets.
 */
export function parseSource(caller: CallerContext, input: unknown): ContentSource {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const kind = o.kind === 'memory' ? 'memory' : o.kind === 'file' || o.kind === undefined ? 'file' : null;
  if (!kind) refuse('INVALID_INPUT', 400, 'source.kind is "file" (a stored file) or "memory" (a memory record or a workspace document\'s key).');
  const key = typeof o.key === 'string' ? o.key.trim() : '';
  if (!key || key.length > KEY_MAX) refuse('INVALID_INPUT', 400, 'source.key names the stored file or the memory record.');
  const owner = typeof o.owner === 'string' && o.owner.trim() ? o.owner.trim() : caller.principal;
  if (owner !== caller.principal && !(caller.inPerson && ownerGhiiOf(owner) === caller.ownerGhii)) {
    refuse('NOT_FOUND', 404, `Nothing of yours is stored as ${kind} "${key}".`);
  }
  return { kind, owner, key };
}

function readWord(source: ContentSource): string { return source.kind === 'file' ? 'storage:read' : 'memory:read'; }

/** The stages a request asks for, checked. Absent: undefined (the owner's settings). */
function parseStages(v: unknown): StageName[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && (STAGES as readonly string[]).includes(s))) {
    refuse('INVALID_INPUT', 400, `stages lists any of ${STAGES.join(', ')}.`);
  }
  return [...new Set(v as StageName[])];
}

/** The facts kept about one item, or NOT_FOUND when none were read yet. */
export async function factsFor(deps: Deps, caller: CallerContext, sourceInput: unknown): Promise<ContentFacts> {
  assertOn(deps); assertLocal(caller);
  const source = parseSource(caller, sourceInput);
  requireWord(caller, readWord(source), 'Reading what is known about an item');
  const f = await getFacts(deps.storage, caller.ownerGhii, sourceIdOf(source));
  if (!f) refuse('NOT_FOUND', 404, `Nothing has been read from ${source.kind} "${source.key}" yet. Inspect it first.`);
  return f;
}

/** The text kept for one item (a PDF's text layer, the words a model read from a picture, a transcript). */
export async function textFor(deps: Deps, caller: CallerContext, sourceInput: unknown): Promise<{ text: string; from: string }> {
  const f = await factsFor(deps, caller, sourceInput);
  const text = f.textKey ? await getText(deps.storage, caller.ownerGhii, f.textKey) : null;
  if (text === null) refuse('NOT_FOUND', 404, 'No text was kept for this item: it has no words a reader or a model could take out of it.');
  return { text, from: f.technical.text?.from ?? 'file' };
}

/** Inspect one item now, as the caller. A stage that calls a model needs ai:use. */
export async function inspectFor(deps: Deps, caller: CallerContext, input: { source?: unknown; stages?: unknown; force?: unknown }, appRef?: string): Promise<InspectResult> {
  assertOn(deps); assertLocal(caller);
  const source = parseSource(caller, input.source);
  requireWord(caller, readWord(source), 'Inspecting an item');
  const stages = parseStages(input.stages);
  const effective = stagesToRun(await readSettings(deps.storage, caller.ownerGhii), stages, false);
  if (effective.some((s) => (AI_STAGES as readonly string[]).includes(s))) requireWord(caller, 'ai:use', 'A stage that calls an AI model');
  return inspectSource(deps, caller, source, { ...(stages ? { stages } : {}), force: input.force === true, ...(appRef ? { appRef } : {}) });
}

/** Start a scan of the caller's account. */
export async function scanFor(deps: Deps, caller: CallerContext, input: Record<string, unknown>): Promise<{ scan: ScanState; already: boolean }> {
  assertOn(deps); assertLocal(caller);
  const memoryPrefix = typeof input.memory_prefix === 'string' ? input.memory_prefix.trim() : '';
  requireWord(caller, memoryPrefix ? 'memory:read' : 'storage:read', 'A scan');
  const stages = parseStages(input.stages);
  const effective = stagesToRun(await readSettings(deps.storage, caller.ownerGhii), stages, false);
  if (effective.some((s) => (AI_STAGES as readonly string[]).includes(s))) requireWord(caller, 'ai:use', 'A scan with a stage that calls an AI model');
  const keys = Array.isArray(input.keys) ? (input.keys as unknown[]).filter((k): k is string => typeof k === 'string' && !!k && k.length <= KEY_MAX) : undefined;
  const kinds = Array.isArray(input.kinds) ? (input.kinds as unknown[]).filter((k): k is ContentKind => (KINDS as readonly unknown[]).includes(k)) : undefined;
  const limit = Number.isInteger(input.limit) ? Number(input.limit) : undefined;
  const opts: ScanOptions = {
    ...(keys?.length ? { keys } : {}), ...(kinds?.length ? { kinds } : {}), ...(memoryPrefix ? { memoryPrefix } : {}),
    ...(stages ? { stages } : {}), ...(limit ? { limit } : {}),
    missingOnly: input.missing_only !== false, force: input.force === true, prune: input.prune === true,
  };
  return startScan(deps, caller, opts);
}

export function scanStatusFor(deps: Deps, caller: CallerContext, id: string): ScanState {
  assertOn(deps); assertLocal(caller);
  const s = getScan(id, caller.ownerGhii);
  if (!s) refuse('NOT_FOUND', 404, 'No such scan. A finished scan is kept for an hour; the facts it wrote stay.');
  return s;
}

export async function settingsFor(deps: Deps, caller: CallerContext): Promise<ContentSettings> {
  assertOn(deps); assertLocal(caller);
  return readSettings(deps.storage, caller.ownerGhii);
}

export async function updateSettingsFor(deps: Deps, caller: CallerContext, patch: unknown): Promise<ContentSettings> {
  assertOn(deps); assertLocal(caller);
  requireWord(caller, RESERVED_WORD, 'Changing what runs, and what spends your AI key,');
  return writeSettings(deps, writerOf(caller), patch);
}

function writerOf(caller: CallerContext) {
  return { principal: caller.principal, ownerGhii: caller.ownerGhii, scopes: [...caller.scopes], roles: [...caller.roles] };
}

export async function classesFor(deps: Deps, caller: CallerContext): Promise<ContentClass[]> {
  assertOn(deps); assertLocal(caller);
  return listClasses(deps.storage, caller.ownerGhii);
}

export async function setClassFor(deps: Deps, caller: CallerContext, cls: unknown): Promise<ContentClass> {
  assertOn(deps); assertLocal(caller);
  requireWord(caller, RESERVED_WORD, 'Changing a content class');
  return setOwnerClass(deps, { ...writerOf(caller), principal: caller.ownerGhii, roles: ['owner'] }, cls);
}

export async function removeClassFor(deps: Deps, caller: CallerContext, id: string): Promise<void> {
  assertOn(deps); assertLocal(caller);
  requireWord(caller, RESERVED_WORD, 'Removing a content class');
  await removeOwnerClass(deps, { ...writerOf(caller), principal: caller.ownerGhii, roles: ['owner'] }, id);
}

export async function proposalsFor(deps: Deps, caller: CallerContext, status?: string): Promise<ClassProposal[]> {
  assertOn(deps); assertLocal(caller);
  const s = status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined;
  return listProposals(deps.storage, caller.ownerGhii, s);
}

export async function decideProposalFor(deps: Deps, caller: CallerContext, id: string, decision: unknown): Promise<ClassProposal> {
  assertOn(deps); assertLocal(caller);
  requireWord(caller, RESERVED_WORD, 'Approving or rejecting a proposed class');
  if (decision !== 'approve' && decision !== 'reject') refuse('INVALID_INPUT', 400, 'decision is "approve" or "reject".');
  return decideProposal(deps, { ...writerOf(caller), principal: caller.ownerGhii, roles: ['owner'] }, id, decision, caller.principal);
}

/** The owner's content classes as an OWL ontology in JSON-LD. */
export async function ontologyFor(deps: Deps, caller: CallerContext): Promise<object> {
  const classes = await classesFor(deps, caller);
  return owlOntology(classes, { ownerGhii: caller.ownerGhii, baseUrl: deps.config.baseUrl });
}

/** How far the owner's content is read, the running scan, the settings and what waits for them. */
export async function overviewFor(deps: Deps, caller: CallerContext): Promise<Record<string, unknown>> {
  assertOn(deps); assertLocal(caller);
  const [cov, settings, pending] = await Promise.all([
    coverage(deps.storage, caller.ownerGhii), readSettings(deps.storage, caller.ownerGhii),
    listProposals(deps.storage, caller.ownerGhii, 'pending'),
  ]);
  return { coverage: cov, settings, pending_proposals: pending.length, scan: runningScanOf(caller.ownerGhii) };
}

/** A page of facts, newest first, filtered. Facts only of items the caller may read. */
export async function listFactsFor(deps: Deps, caller: CallerContext, q: Record<string, unknown>): Promise<{ items: ContentFacts[]; total: number; next?: string }> {
  assertOn(deps); assertLocal(caller);
  requireWord(caller, 'storage:read', 'Listing what is known about your items');
  const filter: FactsFilter = {
    ...((KINDS as readonly unknown[]).includes(q.kind) ? { kind: q.kind as ContentKind } : {}),
    ...(typeof q.class === 'string' && q.class ? { classId: q.class } : {}),
    ...(q.stale === true || q.stale === 'true' ? { stale: true } : {}),
    ...(Number.isInteger(Number(q.limit)) && Number(q.limit) > 0 ? { limit: Math.min(1000, Number(q.limit)) } : {}),
    ...(typeof q.after === 'string' && q.after ? { after: q.after } : {}),
  };
  const page = await listFacts(deps.storage, caller.ownerGhii, filter);
  // An agent sees the facts of its own items; the account holder sees all of theirs.
  const items = caller.inPerson ? page.items : page.items.filter((f) => f.source.owner === caller.principal);
  return { ...page, items };
}
