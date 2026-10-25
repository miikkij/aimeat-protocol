/**
 * @file src/services/compliance-agreements-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operations on data processing agreements (plan doc-mvmr4i2wdk0p, D1–D4), written
 *   once for both doors: the REST routes (routes/compliance-agreements.ts) and the MCP tool
 *   aimeat_compliance_agreement (mcp/compliance-agreements.ts). A door names the caller; the access
 *   check, the validation, the versions and the notices are here. Signing is in
 *   compliance-agreements-sign.ts.
 *
 *   THE LIFE OF A VERSION. draft → sent → (review) → signed → superseded. A draft is edited in place;
 *   sending fixes its text, its hash and its PDF, and from then on it never changes. A change after an
 *   agreement is in force is a new version: when only the measures (Annex III) or the sub-processors
 *   (Annex IV) change and the agreement uses the general authorisation of Clause 7.7(a), it is
 *   announced (`notice`) and takes effect when the objection period ends; anything else is signed again.
 * @structure listOp · mineOp · getOp · createOp · patchOp · newVersionOp · sendOp · noticeOp · objectOp ·
 *   endOp · deletionDoneOp · breachNoticeOp · documentOp · changedParts
 * @usage const out = await createOp(deps, caller, body, { dryRun: true });
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1–D4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { CallerContext } from './caller-context.js';
import { UNCHANGED } from './record-cas.js';
import { writeStorageFile } from './storage-file-write.js';
import { createRequest } from './docsign/records.js';
import { documentHash } from './docsign/records.js';
import { SCC_2021_915_SHA256 } from '../data/legal/eu-scc-2021-915.js';
import {
  CreateInputSchema, PatchInputSchema, OptionsSchema,
  type Agreement, type AgreementAnnexes, type AgreementCreateInput, type AgreementVersion,
} from './compliance-agreements-schemas.js';
import {
  historyEntry, inForce, listAgreements, newAgreementId, newest, readAgreement, statusOf, summaryOf, updateAgreement, writeNewAgreement,
} from './compliance-agreements.js';
import { AgreementError, agreementAccess, operatorAccess, ownerGhiiOf } from './compliance-agreements-access.js';
import { generateAnnexes, measuresFromConfig, operatorParty, subprocessorsFor } from './compliance-agreements-generate.js';
import { canonicalText, renderAgreementPdf, textHashOf } from './compliance-agreements-render.js';
import { tellAgreement } from './compliance-agreements-notify.js';
import { syncDocsign } from './compliance-agreements-sign.js';
import { readDoc } from './compliance-docs.js';
import { derivedProcessors, processorsView } from './compliance-derived.js';

export type Deps = { storage: Storage; config: AimeatConfig };

const invalid = (what: string, issues: Array<{ path: PropertyKey[]; message: string }>): AgreementError =>
  new AgreementError(400, 'VALIDATION_ERROR', `${what}: ${issues.map(i => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`);

async function load(deps: Deps, id: string): Promise<Agreement> {
  const a = await readAgreement(deps.storage, deps.config.nodeId, id);
  if (!a) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement, or it is not one of yours.');
  return a;
}

/** JSON with object keys sorted, so two values compare equal whatever order a database gave the keys in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Which parts of a version differ from another: I, II, III, IV and the options. */
export function changedParts(a: AgreementVersion, b: AgreementVersion): Set<'I' | 'II' | 'III' | 'IV' | 'options'> {
  const out = new Set<'I' | 'II' | 'III' | 'IV' | 'options'>();
  for (const k of ['I', 'II', 'III', 'IV'] as const) if (stable(a.annexes[k]) !== stable(b.annexes[k])) out.add(k);
  if (stable(a.options) !== stable(b.options)) out.add('options');
  return out;
}

/**
 * The agreement as its reader sees it: everything, with the state, what waits, and where the newest
 * version is signed in the signing app (passkey or the EU wallet) when the node names that app.
 */
function view(a: Agreement, role: 'operator' | 'counterparty', config?: AimeatConfig): Record<string, unknown> {
  const v = newest(a);
  const signLink = config?.docsignAppUrl && v.docsignId && (v.status === 'sent' || v.status === 'review')
    ? `${config.docsignAppUrl}/?request=${encodeURIComponent(v.docsignId)}` : null;
  return { ...a, status: statusOf(a), summary: summaryOf(a), viewer: role, sign_link: signLink };
}

/** Apply a caller's annex overrides, marking each written part with who wrote it. */
function applyOverrides(base: AgreementAnnexes, sources: Record<string, 'evidence' | 'ai' | 'human'>, input: AgreementCreateInput['annexes'], by: 'human' | 'ai'): AgreementAnnexes {
  if (!input) return base;
  const out: AgreementAnnexes = structuredClone(base);
  if (input.II) { out.II = { ...out.II, ...input.II }; for (const k of Object.keys(input.II)) sources[`II.${k}`] = by; }
  if (input.III?.measures) {
    const given = new Set(input.III.measures.map(m => m.area));
    out.III.measures = [...out.III.measures.filter(m => !given.has(m.area)), ...input.III.measures.map(m => ({ ...m, source: m.source ?? by }))];
    for (const m of input.III.measures) sources[`III.${m.area}`] = m.source ?? by;
  }
  if (input.III?.assistance !== undefined) { out.III.assistance = input.III.assistance; sources['III.assistance'] = by; }
  if (input.IV?.subprocessors) { out.IV.subprocessors = input.IV.subprocessors; sources.IV = by; }
  return out;
}

// ── reading ──

export async function listOp(deps: Deps, caller: CallerContext): Promise<Record<string, unknown>> {
  await operatorAccess(deps, caller.auth, 'read');
  const all = await Promise.all((await listAgreements(deps.storage, deps.config.nodeId)).map(a => syncDocsign(deps, a)));
  const items = all.map(summaryOf);
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.status as string] = (counts[i.status as string] ?? 0) + 1;
  return { items, total: items.length, counts };
}

export async function mineOp(deps: Deps, caller: CallerContext): Promise<Record<string, unknown>> {
  const me = ownerGhiiOf(caller.auth, deps.config.nodeId);
  const all = await listAgreements(deps.storage, deps.config.nodeId);
  const mine = all.filter(a => a.counterparty.account && a.counterparty.account === me);
  const out = [];
  for (const a of mine) {
    await agreementAccess(deps, caller.auth, a, 'read');
    out.push(summaryOf(await syncDocsign(deps, a)));
  }
  return { items: out, total: out.length };
}

export async function getOp(deps: Deps, caller: CallerContext, id: string): Promise<Record<string, unknown>> {
  const a0 = await load(deps, id);
  const who = await agreementAccess(deps, caller.auth, a0, 'read');
  const a = await syncDocsign(deps, a0);
  return view(a, who.role, deps.config);
}

// ── making and changing ──

export async function createOp(deps: Deps, caller: CallerContext, body: unknown, opts: { dryRun?: boolean } = {}): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const parsed = CreateInputSchema.safeParse(body);
  if (!parsed.success) throw invalid('That agreement was not made', parsed.error.issues);
  const input = parsed.data;
  if (input.counterparty.account && !input.counterparty.account.endsWith(`@${deps.config.nodeId}`)) {
    throw new AgreementError(400, 'INVALID_INPUT', `counterparty.account is an account on this node (name@${deps.config.nodeId}). A party on another node is reached by its e-mail.`);
  }
  if (input.counterparty.account && !await deps.storage.getGHII(input.counterparty.account)) {
    throw new AgreementError(404, 'NOT_FOUND', `No one is registered as ${input.counterparty.account}.`);
  }
  const gen = await generateAnnexes(deps, input);
  const sources = { ...gen.sources };
  const annexes = applyOverrides(gen.annexes, sources, input.annexes, input.written_by ?? 'human');
  const now = new Date().toISOString();
  const options = OptionsSchema.parse(input.options ?? {});
  const subject = input.subject ?? (input.language === 'fi'
    ? { place: 'Hostattu AIMEAT-ympäristö', box: 'AIMEAT asiakkaan omalla palvelimella, etäylläpito', managed: 'AIMEAT-ympäristö ja sovitut palvelimet, ylläpito', custom: 'Henkilötietojen käsittely sovitun palvelun tuottamiseksi' }[input.product]
    : { place: 'Hosted AIMEAT environment', box: "AIMEAT on the customer's own server, remote care", managed: 'AIMEAT environment and agreed servers, care', custom: 'Processing of personal data to provide the agreed service' }[input.product]);
  const agreement: Agreement = {
    id: newAgreementId(), type: 'dpa-art28', template: 'eu-scc-2021-915', language: input.language, ourRole: input.ourRole,
    product: input.product, subject, counterparty: input.counterparty,
    ...(input.registerId ? { registerId: input.registerId } : {}), ...(input.externalRef ? { externalRef: input.externalRef } : {}),
    versions: [{ n: 1, status: 'draft', annexes, sources, options, createdAt: now, createdBy: who.by, signatures: [], remindersSent: [] }],
    history: [historyEntry(who.ownerGhii, 'created', `Version 1 drafted from ${input.registerId ? `register ${input.registerId}` : `the ${input.product} defaults`}.`)],
    createdAt: now, updatedAt: now,
  };
  if (opts.dryRun) return { would_store: agreement, stored: false, missing_measures: gen.missing, note: 'Nothing was stored. Show this to the person, and send it again without dry_run to make the agreement.' };
  const saved = await writeNewAgreement(deps.storage, deps.config.nodeId, agreement);
  return { ...view(saved, 'operator'), stored: true, missing_measures: gen.missing };
}

export async function patchOp(deps: Deps, caller: CallerContext, id: string, body: unknown): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const parsed = PatchInputSchema.safeParse(body);
  if (!parsed.success) throw invalid('That change was not stored', parsed.error.issues);
  const p = parsed.data;
  const cur = await load(deps, id);
  if (newest(cur).status !== 'draft') throw new AgreementError(409, 'NOT_A_DRAFT', `Version ${newest(cur).n} has been sent and does not change. Make a new version (POST /v1/compliance/agreements/${id}/versions).`);
  const regenerate = (p.product && p.product !== cur.product) || (p.language && p.language !== cur.language) || (p.registerId !== undefined && p.registerId !== cur.registerId) || !!p.counterparty;
  const gen = regenerate ? await generateAnnexes(deps, {
    counterparty: p.counterparty ?? cur.counterparty, product: p.product ?? cur.product, language: p.language ?? cur.language,
    ourRole: cur.ourRole, registerId: p.registerId ?? cur.registerId,
  }) : null;
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => {
    const v = newest(a);
    if (v.status !== 'draft') return UNCHANGED;
    const sources = gen ? { ...gen.sources } : { ...v.sources };
    const annexes = applyOverrides(gen ? gen.annexes : v.annexes, sources, p.annexes, p.written_by ?? 'human');
    const options = OptionsSchema.parse({ ...v.options, ...(p.options ?? {}) });
    const next: AgreementVersion = { ...v, annexes, sources, options };
    return {
      ...a,
      ...(p.counterparty ? { counterparty: p.counterparty } : {}), ...(p.product ? { product: p.product } : {}),
      ...(p.language ? { language: p.language } : {}), ...(p.subject ? { subject: p.subject } : {}),
      ...(p.registerId !== undefined ? { registerId: p.registerId } : {}), ...(p.externalRef !== undefined ? { externalRef: p.externalRef } : {}),
      versions: [...a.versions.slice(0, -1), next],
      history: [...a.history, historyEntry(who.ownerGhii, 'edited', `Version ${v.n} draft changed${gen ? ', annexes generated again' : ''}.`)].slice(-500),
    };
  });
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  return view(saved, 'operator');
}

/** A new draft from the newest version, with what the node reads about itself read again. */
export async function newVersionOp(deps: Deps, caller: CallerContext, id: string): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const cur = await load(deps, id);
  if (cur.endedAt) throw new AgreementError(409, 'ENDED', 'This agreement has ended.');
  if (newest(cur).status === 'draft') throw new AgreementError(409, 'DRAFT_OPEN', `Version ${newest(cur).n} is still a draft: change it instead.`);
  if (newest(cur).status === 'sent' || newest(cur).status === 'review') throw new AgreementError(409, 'SIGNING_OPEN', `Version ${newest(cur).n} waits for signatures. Wait for it, or end the agreement.`);
  const stored = (await readDoc(deps.storage, deps.config.nodeId, 'processors', { kind: 'node' })).items;
  const processors = processorsView(derivedProcessors(deps.config), stored);
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => {
    const v = newest(a);
    if (v.status === 'draft' || v.status === 'sent' || v.status === 'review') return UNCHANGED;
    const sources = { ...v.sources };
    const annexes: AgreementAnnexes = structuredClone(v.annexes);
    if (a.ourRole === 'processor') annexes.I.processor = { ...annexes.I.processor, ...operatorParty(deps.config) };
    const fresh = measuresFromConfig(deps.config, a.language);
    const keep = annexes.III.measures.filter(m => m.source !== 'evidence');
    annexes.III.measures = [...fresh.filter(f => !keep.some(k => k.area === f.area)).map(m => ({ ...m, source: 'evidence' as const })), ...keep];
    if (a.ourRole === 'processor' && sources.IV !== 'human') {
      const manual = annexes.IV.subprocessors.filter(s => !s.processorId);
      annexes.IV.subprocessors = [...subprocessorsFor(a.product, processors, a.language), ...manual];
    }
    const next: AgreementVersion = {
      n: v.n + 1, status: 'draft', annexes, sources, options: v.options, createdAt: new Date().toISOString(), createdBy: who.by, signatures: [], remindersSent: [],
    };
    return { ...a, versions: [...a.versions, next], history: [...a.history, historyEntry(who.ownerGhii, 'version', `Version ${next.n} drafted from version ${v.n}.`)].slice(-500) };
  });
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const v = newest(saved);
  const prev = inForce(saved);
  const changed = prev ? [...changedParts(prev, v)] : [];
  return { ...view(saved, 'operator'), changed, can_notice: !!prev && saved.versions[saved.versions.length - 1]!.options.subprocessorAuthorisation === 'general' && changed.length > 0 && changed.every(c => c === 'III' || c === 'IV') };
}

/** Fix a draft's text, hash and PDF, and store the PDF in the caller's files. */
async function freeze(deps: Deps, caller: CallerContext, a: Agreement, v: AgreementVersion): Promise<{ v: AgreementVersion; pdf: Buffer; name: string }> {
  const text = canonicalText(a, v);
  const fixed: AgreementVersion = { ...v, textHash: textHashOf(text), sccSha256: SCC_2021_915_SHA256[a.language] };
  const pdf = await renderAgreementPdf(a, fixed);
  const name = `${a.id}-v${v.n}.pdf`;
  const key = `agreements/${name}`;
  const owner = ownerGhiiOf(caller.auth, deps.config.nodeId)!;
  const w = await writeStorageFile(deps, owner, { key, data: pdf, mimeType: 'application/pdf', visibility: 'private', tags: ['agreement'] });
  if (!w.ok) throw new AgreementError(w.status, w.code, `The agreement's PDF could not be stored: ${w.message}`);
  return { v: { ...fixed, pdfKey: `${owner}:${key}` }, pdf, name };
}

/** Send the newest draft to be signed by both parties. */
export async function sendOp(deps: Deps, caller: CallerContext, id: string, body: { message?: string } = {}): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const cur = await load(deps, id);
  const v = newest(cur);
  if (cur.endedAt) throw new AgreementError(409, 'ENDED', 'This agreement has ended.');
  if (v.status !== 'draft') throw new AgreementError(409, 'NOT_A_DRAFT', `Version ${v.n} has already been sent.`);
  if (!cur.counterparty.account && !cur.counterparty.contactEmail) {
    throw new AgreementError(400, 'NO_RECIPIENT', 'The counterparty has neither an account on this node nor a contact e-mail, so nothing could reach them. Add counterparty.contactEmail.');
  }
  const frozen = await freeze(deps, caller, cur, v);
  // AIMEAT signing (passkey, EUDI wallet) for whoever has an account here; the others sign by PDF or on paper.
  let docsignId: string | undefined;
  const parties = [frozen.v.annexes.I.processor.account, frozen.v.annexes.I.controller.account, caller.ownerGhii, cur.counterparty.account]
    .filter((x): x is string => !!x && x.endsWith(`@${deps.config.nodeId}`));
  if (deps.config.docsignEnabled) try {
    const owner = ownerGhiiOf(caller.auth, deps.config.nodeId)!;
    const rec = await createRequest({ storage: deps.storage, config: deps.config }, caller, {
      title: `${cur.language === 'fi' ? 'Käsittelysopimus' : 'Data processing agreement'} ${cur.id} v${v.n}`,
      message: body.message ?? null,
      document: { sha256: documentHash(frozen.pdf), name: frozen.name, size: frozen.pdf.length, mediaType: 'application/pdf', source: { owner, key: `agreements/${frozen.name}` } },
      parties: [...new Set(parties)],
    });
    docsignId = rec.id;
  } catch (err) {
    logger.warn('agreements: no AIMEAT signing request was made; the PDF and paper paths remain', { agreement: id, error: String(err) });
  }
  const now = new Date().toISOString();
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => {
    const n = newest(a);
    if (n.status !== 'draft' || n.n !== v.n) return UNCHANGED;
    const sent: AgreementVersion = { ...frozen.v, status: 'sent', sentAt: now, ...(docsignId ? { docsignId } : {}) };
    return { ...a, versions: [...a.versions.slice(0, -1), sent], history: [...a.history, historyEntry(who.ownerGhii, 'sent', `Version ${v.n} sent for signature${docsignId ? ` (AIMEAT signing ${docsignId})` : ''}.`)].slice(-500) };
  });
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const told = await tellAgreement(deps, saved, 'sent', { pdf: { data: frozen.pdf, name: frozen.name } });
  return { ...view(saved, 'operator'), told };
}

/** Announce a change of Annex III or IV under the general authorisation; it takes effect after the period. */
export async function noticeOp(deps: Deps, caller: CallerContext, id: string): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const cur = await load(deps, id);
  const v = newest(cur);
  const prev = inForce(cur);
  if (v.status !== 'draft') throw new AgreementError(409, 'NOT_A_DRAFT', 'Only a new draft version can be announced.');
  if (!prev) throw new AgreementError(409, 'NOT_IN_FORCE', 'Nothing is in force yet: send the agreement for signature instead.');
  if (v.options.subprocessorAuthorisation !== 'general') throw new AgreementError(409, 'SPECIFIC_AUTHORISATION', 'This agreement uses prior specific authorisation (Clause 7.7(a), option 1): send the new version for signature.');
  const changed = [...changedParts(prev, v)];
  if (!changed.length) throw new AgreementError(409, 'NOTHING_CHANGED', 'The draft is the same as the version in force.');
  if (!changed.every(c => c === 'III' || c === 'IV')) throw new AgreementError(409, 'NEEDS_SIGNATURE', `The draft changes ${changed.join(', ')}; only changes to Annex III and IV are announced. Send it for signature.`);
  const frozen = await freeze(deps, caller, cur, v);
  const now = new Date();
  const until = new Date(now.getTime() + v.options.noticeDays * 86_400_000).toISOString();
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => {
    const n = newest(a);
    if (n.status !== 'draft' || n.n !== v.n) return UNCHANGED;
    const sent: AgreementVersion = { ...frozen.v, status: 'sent', sentAt: now.toISOString(), notice: { sentAt: now.toISOString(), objectionUntil: until } };
    return { ...a, versions: [...a.versions.slice(0, -1), sent], history: [...a.history, historyEntry(who.ownerGhii, 'notice', `Version ${v.n} announced (${changed.join(', ')}); in force on ${until} unless objected to.`)].slice(-500) };
  });
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const told = await tellAgreement(deps, saved, 'notice', { pdf: { data: frozen.pdf, name: frozen.name } });
  return { ...view(saved, 'operator'), told };
}

/** The counterparty objects to an announced change, inside its period. */
export async function objectOp(deps: Deps, caller: CallerContext, id: string, body: { reason?: unknown }): Promise<Record<string, unknown>> {
  const cur = await load(deps, id);
  const who = await agreementAccess(deps, caller.auth, cur, 'write');
  if (who.role !== 'counterparty') throw new AgreementError(403, 'NOT_THE_COUNTERPARTY', 'Only the counterparty objects to a change.');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '';
  if (!reason) throw new AgreementError(400, 'INVALID_INPUT', 'reason says why, in a sentence or two.');
  const v = newest(cur);
  if (v.status !== 'sent' || !v.notice) throw new AgreementError(409, 'NO_NOTICE', 'No change is announced on this agreement.');
  if (Date.parse(v.notice.objectionUntil) <= Date.now()) throw new AgreementError(409, 'PERIOD_ENDED', 'The objection period has ended.');
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => {
    const n = newest(a);
    if (!n.notice || n.notice.objectedAt) return UNCHANGED;
    const next: AgreementVersion = { ...n, notice: { ...n.notice, objectedAt: new Date().toISOString(), objection: reason } };
    return { ...a, versions: [...a.versions.slice(0, -1), next], history: [...a.history, historyEntry(who.ownerGhii, 'objection', reason)].slice(-500) };
  });
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const told = await tellAgreement(deps, saved, 'objection', { reason });
  return { ...view(saved, 'counterparty'), told };
}

/** End the agreement; the deletion or return clock starts. */
export async function endOp(deps: Deps, caller: CallerContext, id: string, body: { choice?: unknown; reason?: unknown }): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const choice = body.choice === 'return' ? 'return' : 'delete';
  const cur = await load(deps, id);
  if (cur.endedAt) throw new AgreementError(409, 'ENDED', 'This agreement has already ended.');
  const days = (inForce(cur) ?? newest(cur)).options.deletionDays;
  const now = new Date();
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => (a.endedAt ? UNCHANGED : {
    ...a, endedAt: now.toISOString(), ...(typeof body.reason === 'string' && body.reason.trim() ? { endReason: body.reason.trim().slice(0, 1000) } : {}),
    deletion: { choice, dueAt: new Date(now.getTime() + days * 86_400_000).toISOString() },
    history: [...a.history, historyEntry(who.ownerGhii, 'ended', `Ended; data to be ${choice === 'return' ? 'returned' : 'deleted'} within ${days} days.`)].slice(-500),
  }));
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const told = await tellAgreement(deps, saved, 'ended');
  return { ...view(saved, 'operator'), told };
}

/** Record that the data was deleted or returned; the counterparty gets the confirmation. */
export async function deletionDoneOp(deps: Deps, caller: CallerContext, id: string, body: { note?: unknown }): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const cur = await load(deps, id);
  if (!cur.deletion) throw new AgreementError(409, 'NOT_ENDED', 'End the agreement first.');
  if (cur.deletion.doneAt) throw new AgreementError(409, 'ALREADY_DONE', 'The deletion is already recorded.');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : undefined;
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, a => (!a.deletion || a.deletion.doneAt ? UNCHANGED : {
    ...a, deletion: { ...a.deletion, doneAt: new Date().toISOString(), ...(note ? { note } : {}) },
    history: [...a.history, historyEntry(who.ownerGhii, 'deletion-done', note)].slice(-500),
  }));
  if (!saved) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const told = await tellAgreement(deps, saved, 'deletion-done');
  return { ...view(saved, 'operator'), told };
}

/** Tell the counterparties of a personal data breach, within the agreed hours. */
export async function breachNoticeOp(deps: Deps, caller: CallerContext, body: { agreements?: unknown; title?: unknown; discovered_at?: unknown; summary?: unknown; breach_id?: unknown }): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const ids = Array.isArray(body.agreements) ? body.agreements.filter((x): x is string => typeof x === 'string') : [];
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
  const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 4000) : '';
  const discoveredAt = typeof body.discovered_at === 'string' && !Number.isNaN(Date.parse(body.discovered_at)) ? body.discovered_at : '';
  if (!ids.length || !title || !summary || !discoveredAt) throw new AgreementError(400, 'INVALID_INPUT', 'agreements (ids), title, discovered_at (ISO time) and summary are all needed.');
  const breachRef = typeof body.breach_id === 'string' ? ` (breach ${body.breach_id.slice(0, 120)})` : '';
  const results: Array<Record<string, unknown>> = [];
  for (const id of ids.slice(0, 200)) {
    const a = await readAgreement(deps.storage, deps.config.nodeId, id);
    if (!a) { results.push({ id, sent: false, reason: 'not found' }); continue; }
    const hours = (inForce(a) ?? newest(a)).options.breachNoticeHours;
    const late = Date.now() - Date.parse(discoveredAt) > hours * 3_600_000;
    const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, cur => ({
      ...cur, history: [...cur.history, historyEntry(who.ownerGhii, 'breach-notice', `${title}${breachRef}; discovered ${discoveredAt}${late ? `; later than the agreed ${hours} hours` : ''}.`)].slice(-500),
    }));
    const told = saved ? await tellAgreement(deps, saved, 'breach', { breach: { title, discoveredAt, summary } }) : null;
    results.push({ id, sent: !!told, told, late });
  }
  return { results };
}

/** A version's canonical text or PDF. A draft is rendered on the spot; a sent version is the stored PDF. */
export async function documentOp(deps: Deps, caller: CallerContext, id: string, q: { version?: unknown; format?: unknown }): Promise<{ data: Buffer | string; mediaType: string; name: string }> {
  const a = await load(deps, id);
  await agreementAccess(deps, caller.auth, a, 'read');
  const n = Number(q.version ?? newest(a).n);
  const v = a.versions.find(x => x.n === n);
  if (!v) throw new AgreementError(404, 'NOT_FOUND', `No version ${String(q.version)}.`);
  if (q.format === 'text' || q.format === 'md') return { data: canonicalText(a, v), mediaType: 'text/markdown; charset=utf-8', name: `${a.id}-v${v.n}.md` };
  if (v.pdfKey) {
    const at = v.pdfKey.indexOf(':');
    const file = await deps.storage.getStorageFile(v.pdfKey.slice(0, at), v.pdfKey.slice(at + 1));
    if (file) return { data: file.data, mediaType: 'application/pdf', name: `${a.id}-v${v.n}.pdf` };
  }
  return { data: await renderAgreementPdf(a, v), mediaType: 'application/pdf', name: `${a.id}-v${v.n}${v.status === 'draft' ? '-draft' : ''}.pdf` };
}
