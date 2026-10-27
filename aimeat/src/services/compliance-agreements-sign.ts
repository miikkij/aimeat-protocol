/**
 * @file src/services/compliance-agreements-sign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a data processing agreement gets its signatures (plan doc-mvmr4i2wdk0p, D3), four
 *   ways, each recorded with the level it proves:
 *
 *   1. AIMEAT signing (passkey, key, session) and 2. the EU Digital Identity Wallet: sending a version
 *      makes a docsign request over its PDF for every party with an account here (sendOp).
 *      syncDocsign() reads which of them have signed and records it; a wallet signature is
 *      `qualified` or `advanced` by its certificate, the others `aimeat`.
 *   3. A PDF signed elsewhere (DocuSign or any PAdES signer): signedCopyOp(kind 'pdf') validates it
 *      (docsign/validate.ts: integrity, chain, EU trusted list, revocation), ties it to the version
 *      (the version's own PDF bytes at its start, which an incremental signature keeps, or the version
 *      tag in the file), and compares the certificate names with the signer Annex I names.
 *   4. A scanned paper copy: signedCopyOp(kind 'scan') asks a model to compare it with the version (its
 *      tag on every page, every page there, a signature, a printed name and a date for the signer, no
 *      handwritten changes), once the content's label lets a model read it.
 *
 *   A COPY THAT CAME BACK WAITS FOR A PERSON. Both 3 and 4 leave the version in `review` with the
 *   checks, and confirmOp() is the operator's yes or no. Nothing the model says signs anything.
 *   The version is signed when both the controller and the processor have a signature; the version
 *   in force before it is superseded.
 * @structure docsignLevel · signedLine · completeIfSigned · syncDocsign · signedCopyOp · confirmOp
 * @usage const a = await syncDocsign(deps, agreement);
 * @version-history
 *   2026-10-27 — A wallet signature on the EU reference wallet's test roots is recorded with the level `test`, not `advanced`, and its history line and the in-force line say it has no legal effect; the flow is unchanged (secaudit2026oct26, syncDocsign:test-anchor-wallet-signature-as-advanced).
 *   2026-10-27 — A returned copy keeps the sha256 of the checked bytes and a copy of them beside the
 *     version's PDF, and the accepted signature's evidence names both; confirmOp takes the reviewed
 *     copy's uploaded_at and answers 409 COPY_CHANGED when another copy replaced it, and a new upload
 *     that replaces a waiting copy says so in the history; a later holder of the counterparty's
 *     released name does not sign for the counterparty (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D3).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import { writeStorageFile } from './storage-file-write.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { CallerContext } from './caller-context.js';
import { UNCHANGED } from './record-cas.js';
import { readRequestRecord } from './docsign/records.js';
import { readOwnFile } from './docsign/files.js';
import { validatePdf, type ValidationReport } from './docsign/validate.js';
import { completeForOwner } from './ai/completion.js';
import { readerFor } from './classification/reader.js';
import { fileTarget } from './classification/labels.js';
import type { Agreement, AgreementReview, AgreementSignature, AgreementVersion } from './compliance-agreements-schemas.js';
import { historyEntry, newest, readAgreement, updateAgreement } from './compliance-agreements.js';
import { AgreementError, agreementAccess, counterpartyHolds, operatorAccess, ownerGhiiOf } from './compliance-agreements-access.js';
import { versionTag } from './compliance-agreements-render.js';
import { tellAgreement } from './compliance-agreements-notify.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Party = 'controller' | 'processor';

/** Which side of the agreement an account signs for. */
function partyOf(a: Agreement, v: AgreementVersion, account: string): Party | null {
  if (a.counterparty.account === account) return a.ourRole === 'processor' ? 'controller' : 'processor';
  if (v.annexes.I.controller.account === account) return 'controller';
  if (v.annexes.I.processor.account === account) return 'processor';
  // The operator's own account signs for the operator's side.
  const created = a.history.find(h => h.event === 'created')?.by;
  if (created === account) return a.ourRole;
  return null;
}

/**
 * The level a docsign signature proves on the agreement. Pure. A wallet signature on the EU reference
 * wallet's test roots is `test`, never `advanced`: the validator reports it as a test with no legal
 * effect (secaudit2026oct26, syncDocsign:test-anchor-wallet-signature-as-advanced).
 */
export function docsignLevel(wallet?: { validation: { level: string; test: boolean } }): AgreementSignature['level'] {
  if (!wallet) return 'aimeat';
  if (wallet.validation.test) return 'test';
  return wallet.validation.level === 'qualified' ? 'qualified' : 'advanced';
}

const NO_LEGAL_EFFECT = 'a test wallet signature with no legal effect';

/** The history line of a recorded signature. Pure. */
export function signedLine(s: AgreementSignature): string {
  return s.level === 'test' ? `${s.party} signed (${s.method}, ${NO_LEGAL_EFFECT}).` : `${s.party} signed (${s.method}, ${s.level}).`;
}

/**
 * Signed by both sides: mark it, supersede the one before, and say so. Pure. A version that a test
 * wallet signature completed comes into force as before, and its in-force line names that signature.
 */
export function completeIfSigned(a: Agreement, v: AgreementVersion, now: string): Agreement {
  const sides = new Set(v.signatures.map(s => s.party));
  if (!(sides.has('controller') && sides.has('processor'))) return { ...a, versions: a.versions.map(x => (x.n === v.n ? v : x)) };
  const signed: AgreementVersion = { ...v, status: 'signed', signedAt: now, effectiveFrom: now };
  const tests = v.signatures.filter(s => s.level === 'test').map(s => s.party);
  const line = `Version ${v.n} signed by both parties; in force.`
    + (tests.length ? ` The ${tests.join(' and ')} signature is ${NO_LEGAL_EFFECT}.` : '');
  return {
    ...a,
    versions: a.versions.map(x => (x.n === v.n ? signed : x.status === 'signed' ? { ...x, status: 'superseded' as const } : x)),
    history: [...a.history, historyEntry('system', 'in-force', line)].slice(-500),
  };
}

/**
 * Read the AIMEAT signing request of the newest version and record the signatures it holds. Writes
 * only when something new is there; tells the counterparty's receipt and the version coming into force.
 */
export async function syncDocsign(deps: Deps, a: Agreement): Promise<Agreement> {
  const v = newest(a);
  if (!v.docsignId || (v.status !== 'sent' && v.status !== 'review')) return a;
  const rec = await readRequestRecord({ storage: deps.storage, config: deps.config }, v.docsignId).catch((err: unknown) => {
    logger.warn('agreements: the signing request could not be read; signatures stay as recorded', { agreement: a.id, request: v.docsignId, error: String(err) });
    return null;
  });
  if (!rec) return a;
  // A later holder of the counterparty's released name does not sign for the counterparty (counterpartyHolds).
  const sides = await counterpartyHolds(deps.storage, a) ? a : { ...a, counterparty: { ...a.counterparty, account: undefined } };
  const fresh: AgreementSignature[] = [];
  for (const [identity, sig] of Object.entries(rec.signatures)) {
    if (v.signatures.some(s => (s.evidence as { docsign?: string } | undefined)?.docsign === rec.id && s.signer === identity)) continue;
    const party = partyOf(sides, v, identity.includes('#') ? identity.slice(identity.indexOf('#') + 1) : identity);
    if (!party || v.signatures.some(s => s.party === party)) continue;
    const wallet = sig.wallet;
    const level = docsignLevel(wallet);
    fresh.push({
      party, method: wallet ? 'eudi-wallet' : 'aimeat', level, signer: identity, at: sig.statement.signedAt,
      evidence: { docsign: rec.id, method: sig.statement.method, ...(wallet ? { test: wallet.validation.test, trust: wallet.validation.trustSource } : {}) },
    });
  }
  if (!fresh.length) return a;
  const before = new Set(v.signatures.map(s => s.party));
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, a.id, cur => {
    const n = newest(cur);
    if (n.n !== v.n || (n.status !== 'sent' && n.status !== 'review')) return UNCHANGED;
    const add = fresh.filter(f => !n.signatures.some(s => s.party === f.party));
    if (!add.length) return UNCHANGED;
    const next = { ...n, signatures: [...n.signatures, ...add] };
    const withHistory = { ...cur, history: [...cur.history, ...add.map(s => historyEntry(s.signer, 'signed', signedLine(s)))].slice(-500) };
    return completeIfSigned(withHistory, next, new Date().toISOString());
  });
  if (!saved) return a;
  const cpSide: Party = a.ourRole === 'processor' ? 'controller' : 'processor';
  if (!before.has(cpSide) && fresh.some(f => f.party === cpSide) && newest(saved).status !== 'signed') await tellAgreement(deps, saved, 'counterparty-signed');
  if (newest(saved).status === 'signed') await tellInForce(deps, saved);
  return saved;
}

async function tellInForce(deps: Deps, a: Agreement): Promise<void> {
  const v = newest(a);
  const data = await storedPdf(deps, a, v);
  await tellAgreement(deps, a, 'in-force', data ? { pdf: { data, name: `${a.id}-v${v.n}.pdf` } } : {});
}

/** A version's stored PDF, or null when it has none or the read failed (logged). */
async function storedPdf(deps: Deps, a: Agreement, v: AgreementVersion): Promise<Buffer | null> {
  if (!v.pdfKey) return null;
  const at = v.pdfKey.indexOf(':');
  try {
    return (await deps.storage.getStorageFile(v.pdfKey.slice(0, at), v.pdfKey.slice(at + 1)))?.data ?? null;
  } catch (err) {
    logger.warn('agreements: the version\'s stored PDF could not be read', { agreement: a.id, version: v.n, error: String(err) });
    return null;
  }
}

/** The bytes of `needle` in `hay`, as Latin-1 or as UTF-16BE (how a PDF writes a non-ASCII info string). */
function bytesContain(hay: Buffer, needle: string): boolean {
  if (hay.includes(Buffer.from(needle, 'latin1'))) return true;
  const be = Buffer.alloc(needle.length * 2);
  for (let i = 0; i < needle.length; i++) be.writeUInt16BE(needle.charCodeAt(i), i * 2);
  return hay.includes(be);
}

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

/** The checks of a PDF signed elsewhere. */
async function checkSignedPdf(deps: Deps, a: Agreement, v: AgreementVersion, data: Buffer, party: Party): Promise<Pick<AgreementReview, 'checks' | 'verdict' | 'level'>> {
  let report: ValidationReport | null = null;
  try { report = await validatePdf(deps.config, data, { online: true }); } catch (err) { logger.warn('agreements: signed PDF did not validate', { agreement: a.id, error: String(err) }); }
  const sigs = (report?.signatures ?? []).filter(s => s.kind === 'signature');
  const valid = sigs.filter(s => s.verdict === 'valid');
  const checks: AgreementReview['checks'] = [];
  checks.push({ id: 'signature', ok: report ? valid.length > 0 : false, note: report ? `${valid.length} of ${sigs.length} signatures valid${sigs[0] ? `: ${sigs[0].summary}` : ''}`.slice(0, 600) : 'The file is not a PDF the node can read.' });
  const ownBytes = await storedPdf(deps, a, v);
  const incremental = !!ownBytes && data.length > ownBytes.length && data.subarray(0, ownBytes.length).equals(ownBytes);
  const tagged = bytesContain(data, `${a.id} v${v.n}`);
  checks.push({
    id: 'version', ok: incremental || tagged ? true : null,
    note: incremental ? 'The file is this version\'s own PDF with the signature added after it.' : tagged ? 'The file carries this version\'s tag.' : 'The file could not be tied to this version by the node. Look at it before confirming.',
  });
  const expected = norm(party === 'controller' ? v.annexes.I.controller.signerName : v.annexes.I.processor.signerName);
  const names = valid.map(s => norm(s.signer?.commonName ?? s.signer?.name));
  checks.push({
    id: 'signer', ok: expected ? names.some(n => n.includes(expected) || expected.includes(n)) : null,
    note: expected ? `Expected ${expected}; the certificates name ${names.join(', ') || 'nobody'}.` : 'Annex I names no signer, so the certificate names were not compared.',
  });
  const best = valid.some(s => s.level === 'qualified') ? 'qualified' : 'advanced';
  const verdict = checks[0]!.ok === false ? 'fail' : checks.every(c => c.ok === true) ? 'pass' : 'attention';
  return { checks, verdict, level: best };
}

/** The checks of a scanned copy, by a model, when the content's label lets one read it. */
async function checkScan(deps: Deps, caller: CallerContext, a: Agreement, v: AgreementVersion, file: { data: Buffer; mimeType: string; owner: string; key: string }, party: Party): Promise<Pick<AgreementReview, 'checks' | 'verdict' | 'level' | 'checkedBy'>> {
  const signer = party === 'controller' ? v.annexes.I.controller.signerName : v.annexes.I.processor.signerName;
  const tag = versionTag(a, v);
  const prompt = [
    'You check a scanned, hand-signed copy of a data processing agreement against the version that was sent.',
    `Every page of the sent version carries the footer "${tag} · <page>/<pages>".`,
    `The expected signer is ${signer ? `"${signer}"` : 'not named'}.`,
    'Answer with JSON only, no prose: {"tag_on_every_page": true|false, "pages_seen": [numbers], "pages_total": number|null,',
    '"signature_present": true|false, "printed_name": string|null, "date_written": string|null, "date_clear": true|false,',
    '"handwritten_changes": true|false, "notes": string}. Say false or null when you cannot see a thing; never guess.',
  ].join(' ');
  const isPdf = file.mimeType === 'application/pdf';
  const unrun = (note: string): Pick<AgreementReview, 'checks' | 'verdict' | 'level'> => ({
    checks: ['version', 'pages', 'signature', 'date', 'changes'].map(id => ({ id, ok: null, note })),
    verdict: 'attention', level: 'scanned',
  });
  try {
    await readerFor({ storage: deps.storage, config: deps.config }, caller.auth)
      .useForAi([fileTarget(file.owner, file.key)], { capability: isPdf ? 'files' : 'image' });
  } catch (err) {
    return unrun(`No model may read this copy (${String((err as Error).message ?? err).slice(0, 200)}). Look at it yourself.`);
  }
  try {
    const out = await completeForOwner(deps.storage, deps.config, ownerGhiiOf(caller.auth, deps.config.nodeId)!, {
      prompt, caller: 'owner', temperature: 0,
      ...(isPdf ? { files: [{ data: new Uint8Array(file.data), mediaType: 'application/pdf', filename: 'scan.pdf' }] } : { images: [`data:${file.mimeType};base64,${file.data.toString('base64')}`] }),
    });
    const m = /\{[\s\S]*\}/.exec(out.content);
    const j = (m ? JSON.parse(m[0]) : {}) as Record<string, unknown>;
    const seen = Array.isArray(j.pages_seen) ? (j.pages_seen as unknown[]).filter(n => typeof n === 'number') as number[] : [];
    const total = typeof j.pages_total === 'number' ? j.pages_total : null;
    const name = typeof j.printed_name === 'string' ? j.printed_name : null;
    const checks: AgreementReview['checks'] = [
      { id: 'version', ok: j.tag_on_every_page === true, note: j.tag_on_every_page === true ? `Tag ${tag} on every page.` : `The tag ${tag} was not seen on every page.` },
      { id: 'pages', ok: total !== null && seen.length === total, note: `${seen.length} pages seen${total !== null ? ` of ${total}` : ''}.` },
      { id: 'signature', ok: j.signature_present === true && (!signer || (!!name && (norm(name).includes(norm(signer)) || norm(signer).includes(norm(name))))), note: `Signature ${j.signature_present === true ? 'present' : 'not seen'}; printed name ${name ?? 'not seen'}${signer ? `, expected ${signer}` : ''}.` },
      { id: 'date', ok: j.date_clear === true, note: `Date ${typeof j.date_written === 'string' ? j.date_written : 'not seen'}${j.date_clear === true ? '' : ', not clear'}.` },
      { id: 'changes', ok: j.handwritten_changes === false, note: j.handwritten_changes === false ? 'No handwritten changes to the text.' : 'The text may have handwritten changes.' },
    ];
    if (typeof j.notes === 'string' && j.notes.trim()) checks.push({ id: 'notes', ok: null, note: j.notes.slice(0, 600) });
    const failed = checks.filter(c => c.ok === false).map(c => c.id);
    return { checks, verdict: failed.includes('version') || failed.includes('signature') ? 'fail' : failed.length ? 'attention' : 'pass', level: 'scanned', checkedBy: out.model };
  } catch (err) {
    return unrun(`The model check could not run (${String((err as Error).message ?? err).slice(0, 200)}). Look at the copy yourself.`);
  }
}

/**
 * Keep the bytes the node checked beside the version's PDF (the same owner's files), named by the
 * agreement, the version, the party and the hash. Answers `owner:key`, or undefined when the version
 * has no stored PDF or the write failed (logged; the hash still binds the review).
 */
async function keepCheckedCopy(
  deps: Deps, a: Agreement, v: AgreementVersion, party: Party, file: { data: Buffer; mimeType: string; sha256: string },
): Promise<string | undefined> {
  if (!v.pdfKey) return undefined;
  const owner = v.pdfKey.slice(0, v.pdfKey.indexOf(':'));
  const ext = file.mimeType === 'application/pdf' ? 'pdf' : (file.mimeType.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const key = `agreements/${a.id}-v${v.n}-${party}-${file.sha256.slice(0, 16)}.${ext}`;
  const w = await writeStorageFile(deps, owner, { key, data: file.data, mimeType: file.mimeType, visibility: 'private', tags: ['agreement', 'signed-copy'] });
  if (!w.ok) {
    logger.warn('agreements: the node could not keep a copy of the signed copy; the review keeps its hash', { agreement: a.id, version: v.n, error: w.message });
    return undefined;
  }
  return `${owner}:${key}`;
}

/** Whether the node's copy of a review's bytes is still there and still those bytes. True for a review from before copies were kept. */
async function checkedCopyHolds(deps: Deps, review: AgreementReview): Promise<boolean> {
  if (!review.copyKey || !review.sha256) return true;
  const at = review.copyKey.indexOf(':');
  const file = await deps.storage.getStorageFile(review.copyKey.slice(0, at), review.copyKey.slice(at + 1));
  return !!file && createHash('sha256').update(file.data).digest('hex') === review.sha256;
}

/** A signed copy came back: check it, and leave it for the operator to confirm. */
export async function signedCopyOp(deps: Deps, caller: CallerContext, id: string, body: { storage_key?: unknown; kind?: unknown; party?: unknown }): Promise<Record<string, unknown>> {
  const a = await readAgreement(deps.storage, deps.config.nodeId, id);
  if (!a) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement, or it is not one of yours.');
  const who = await agreementAccess(deps, caller.auth, a, 'write');
  const key = typeof body.storage_key === 'string' ? body.storage_key.trim() : '';
  const kind = body.kind === 'scan' ? 'scan' : body.kind === 'pdf' ? 'pdf' : null;
  if (!key || !kind) throw new AgreementError(400, 'INVALID_INPUT', 'storage_key (a file in your storage) and kind (pdf or scan) are needed. Upload the file first with aimeat_storage_upload.');
  const v = newest(a);
  if (v.status !== 'sent' && v.status !== 'review') throw new AgreementError(409, 'NOT_WAITING', `Version ${v.n} does not wait for a signature.`);
  const cpSide: Party = a.ourRole === 'processor' ? 'controller' : 'processor';
  const party: Party = who.role === 'counterparty' ? cpSide : body.party === 'processor' || body.party === 'controller' ? body.party : cpSide;
  let file;
  try { file = await readOwnFile({ storage: deps.storage, config: deps.config }, caller, key); }
  catch (err) { throw new AgreementError((err as { status?: number }).status ?? 400, (err as { code?: string }).code ?? 'NOT_FOUND', (err as Error).message); }
  const result = kind === 'pdf'
    ? await checkSignedPdf(deps, a, v, file.data, party)
    : await checkScan(deps, caller, a, v, { data: file.data, mimeType: file.mimeType, owner: caller.principal, key }, party);
  // The checked bytes are the evidence: their hash, and a copy the node keeps beside the version's PDF.
  // The uploader's own file can be replaced or deleted later (secaudit2026oct26).
  const sha256 = createHash('sha256').update(file.data).digest('hex');
  const copyKey = await keepCheckedCopy(deps, a, v, party, { data: file.data, mimeType: file.mimeType, sha256 });
  const review: AgreementReview = {
    kind, storageKey: key, storageOwner: caller.principal, sha256, ...(copyKey ? { copyKey } : {}),
    uploadedBy: caller.principal, uploadedAt: new Date().toISOString(), party, ...result,
  };
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, cur => {
    const n = newest(cur);
    if (n.n !== v.n || (n.status !== 'sent' && n.status !== 'review')) return UNCHANGED;
    // A copy that waited for the operator is replaced; the history says which one, so the operator sees it.
    const replaces = n.status === 'review' && n.review
      ? ` It replaces the copy for the ${n.review.party} uploaded at ${n.review.uploadedAt}, which waited for a decision.` : '';
    return {
      ...cur, versions: [...cur.versions.slice(0, -1), { ...n, status: 'review', review }],
      history: [...cur.history, historyEntry(who.ownerGhii, 'copy-received', `A ${kind === 'pdf' ? 'signed PDF' : 'scanned copy'} for the ${party}; check: ${review.verdict}.${replaces}`)].slice(-500),
    };
  });
  if (!saved) throw new AgreementError(409, 'NOT_WAITING', 'The version changed meanwhile.');
  const told = await tellAgreement(deps, saved, 'copy-received');
  return { id, version: v.n, review, status: 'review', told };
}

const copyChanged = (): AgreementError => new AgreementError(409, 'COPY_CHANGED',
  'Another signed copy came in after you looked, and it replaced the one you saw. Open the agreement again and decide on the copy that waits now.');

/** The operator accepts or rejects the copy that came back. */
export async function confirmOp(deps: Deps, caller: CallerContext, id: string, body: { accept?: unknown; reason?: unknown; uploaded_at?: unknown }): Promise<Record<string, unknown>> {
  const who = await operatorAccess(deps, caller.auth, 'write');
  const a = await readAgreement(deps.storage, deps.config.nodeId, id);
  if (!a) throw new AgreementError(404, 'NOT_FOUND', 'No such agreement.');
  const v = newest(a);
  if (v.status !== 'review' || !v.review) throw new AgreementError(409, 'NOTHING_TO_CONFIRM', 'No signed copy waits for a decision on this agreement.');
  const accept = body.accept === true;
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
  if (!accept && !reason) throw new AgreementError(400, 'INVALID_INPUT', 'A rejection says why (reason), so the counterparty knows what to fix.');
  // The copy the operator looked at, by its upload time (the screen and the MCP tool send it): a copy
  // that came in after the operator looked is not the one decided on (secaudit2026oct26).
  const seen = typeof body.uploaded_at === 'string' && body.uploaded_at ? body.uploaded_at : v.review.uploadedAt;
  if (seen !== v.review.uploadedAt) throw copyChanged();
  if (accept && !await checkedCopyHolds(deps, v.review)) {
    throw new AgreementError(409, 'COPY_MISSING', 'The copy the node kept of this signed copy is gone or changed, so it cannot be recorded as evidence. Ask the counterparty to send the copy again.');
  }
  const now = new Date().toISOString();
  let changed = false;
  const saved = await updateAgreement(deps.storage, deps.config.nodeId, id, cur => {
    const n = newest(cur);
    if (n.status !== 'review' || !n.review) return UNCHANGED;
    if (n.review.uploadedAt !== seen) { changed = true; return UNCHANGED; }
    const review: AgreementReview = { ...n.review, decidedBy: who.by, decidedAt: now, decision: accept ? 'accepted' : 'rejected', ...(reason ? { reason } : {}) };
    if (!accept) {
      return { ...cur, versions: [...cur.versions.slice(0, -1), { ...n, status: 'sent', review }], history: [...cur.history, historyEntry(who.ownerGhii, 'copy-rejected', reason)].slice(-500) };
    }
    // The signer is the party's named signer, not whoever uploaded the copy: an operator uploading a
    // customer's scan has not signed for the customer.
    const side = n.review.party === 'controller' ? n.annexes.I.controller : n.annexes.I.processor;
    const sig: AgreementSignature = {
      party: n.review.party, method: n.review.kind === 'pdf' ? 'external-pdf' : 'scan',
      level: n.review.kind === 'pdf' ? (n.review.level === 'qualified' ? 'qualified' : 'advanced') : 'scanned',
      signer: (side.signerName || side.name).slice(0, 300), at: now,
      evidence: {
        uploadedBy: n.review.uploadedBy, storageOwner: n.review.storageOwner, storageKey: n.review.storageKey, verdict: n.review.verdict,
        ...(n.review.sha256 ? { sha256: n.review.sha256 } : {}), ...(n.review.copyKey ? { copyKey: n.review.copyKey } : {}),
        confirmedBy: who.by, ...(n.review.checkedBy ? { checkedBy: n.review.checkedBy } : {}),
      },
    };
    const next: AgreementVersion = { ...n, status: 'sent', review, signatures: [...n.signatures.filter(s => s.party !== sig.party), sig] };
    const withHistory = { ...cur, history: [...cur.history, historyEntry(who.ownerGhii, 'copy-accepted', `${sig.party} signature recorded (${sig.method}, ${sig.level}).`)].slice(-500) };
    return completeIfSigned(withHistory, next, now);
  });
  if (changed) throw copyChanged();
  if (!saved) throw new AgreementError(409, 'NOTHING_TO_CONFIRM', 'The copy was decided meanwhile.');
  if (!accept) await tellAgreement(deps, saved, 'copy-rejected', { reason });
  else if (newest(saved).status === 'signed') await tellInForce(deps, saved);
  return { id, status: newest(saved).status, version: newest(saved).n, accepted: accept };
}
