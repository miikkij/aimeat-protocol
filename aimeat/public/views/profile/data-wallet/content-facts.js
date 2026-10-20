/**
 * @file public/views/profile/data-wallet/content-facts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the content class pages share (wish-sis-ll-n-purku-luokittelu-ja-owl): the
 *   calls to the content class routes (/v1/content*, routes/content.ts) and one item's facts in
 *   words. Two screens draw them: the Data Wallet's section "What is known about your content"
 *   (content-classes.js) and the fold under a stored file's preview on the Memory page
 *   (memory-tab/file-facts.js), so an item reads the same in both.
 *
 *   TERMS. A content class is the kind of thing an item is (an invoice, a contract, a photo); the
 *   node's sensitivity labels are "classification" and are another section of the same page, so no
 *   word here says classification. The facts are what the node read from the item without a model
 *   (the technical facts) plus what a model wrote when the owner turned those steps on.
 *
 *   itemRow() is one row of the List cut name-desc-state-doors: the item's key with its kind, the
 *   alt text or the description with the item's content classes as tags under it, a mark when the
 *   item declares that AI made it, and the row's actions. detailRows() is the Facts rows for one item:
 *   for a PDF its title, author, pages and signatures; for a picture its size, camera, time taken and
 *   whether it carries a location (never the place itself); for a video its length, size and codecs.
 *
 *   A 404 from GET /v1/content means the operator has turned content classes off on this node
 *   (services/content/service.ts assertOn); readOverview() answers { off: true } for it.
 * @structure cc · classLabel · kindWord · aiWord · isAiMade · readOverview · readLatest · readItemFacts ·
 *   readClasses · readProposals · decideProposal · startScan · readScan · inspectItem · saveSettings ·
 *   readRules · downloadOntology · fileSource · correctItem · readItemText · readOwlClass · percent ·
 *   propertyWords · propertyLabel · readDecision · classesForKind · itemRow · detailRows
 * @usage import { readOverview, itemRow, detailRows } from './content-facts.js';
 * @version-history
 *   v1.2.1 — 2026-10-21 — propertyHint: a property's English describe, on an English page only.
 *   v1.2.0 — 2026-10-21 — propertyLabel (a property's label in the page language) and readDecision
 *     (GET /v1/ai/decisions/{id}), for the file fold's third round.
 *   v1.1.0 — 2026-10-21 — The calls and words of the file fold's second round (Jouni's look,
 *     2026-10-21): fileSource, correctItem (POST /v1/content/correct), readItemText
 *     (GET /v1/content/text), readOwlClass (one class's nodes out of the ontology), percent,
 *     propertyWords, classesForKind; inspectItem takes the stages to run.
 *   v1.0.1 — 2026-10-20 — The AI column shows the verdict on every row (an empty label read as broken
 *     at phone width; browser check).
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { api, apiGet, apiPost, apiPut } from '/js/api.js';
import { downloadBlob } from '/js/utils.js';
import { date as fmtDate, time as fmtTime, num as fmtNum, duration, fmtBytes } from '/js/format.js';
import { Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { FactLine } from '/components/Facts.js';

const html = htm.bind(h);
const enc = encodeURIComponent;

/** The words of the content class screens: dwpage.cc.* in the locales. */
export const cc = (key, vars) => t('dwpage.cc.' + key, vars);

const has = (v) => v !== undefined && v !== null && v !== '';

/* ── Words ───────────────────────────────────────────────────────────────────────────────────── */

/** A content class's name in the page language, English when it has none, its id when it has no label. */
export function classLabel(classes, id) {
  const c = (classes || []).find((k) => k.id === id);
  if (!c) return id;
  const lang = String(getLocale() || 'en').slice(0, 2);
  return c.label?.[lang] || c.label?.en || id;
}

/** pdf · image · video · text · other, in words. */
export const kindWord = (kind) => cc('kind.' + (['pdf', 'image', 'video', 'text'].includes(kind) ? kind : 'other'));

/** What the item declares about AI: ai-generated · ai-assisted · human · unknown, in words. */
export const aiWord = (verdict) => cc('ai.' + (['ai-generated', 'ai-assisted', 'human'].includes(verdict) ? verdict : 'unknown'));

/** True when the item declares that AI made it or helped make it. */
export const isAiMade = (verdict) => verdict === 'ai-generated' || verdict === 'ai-assisted';

/* ── Calls ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * GET /v1/content: { coverage, settings, pending_proposals, scan }, or { off: true } when the
 * operator has turned content classes off (the route answers 404).
 */
export async function readOverview() {
  try {
    const r = await apiGet('/v1/content');
    return r?.data || null;
  } catch (e) {
    if (e?.status === 404) return { off: true };
    throw e;
  }
}

/** GET /v1/content/facts?limit=n: the newest items' facts. */
export async function readLatest(limit = 10) {
  const r = await apiGet(`/v1/content/facts?limit=${limit}`);
  return r?.data?.items || [];
}

/**
 * GET /v1/content/facts?kind=file&key=…: one stored file's facts, or null when nothing has been read
 * from it yet (or content classes are off: both answer 404). `owner` names one of the person's own
 * agents when the file is the agent's.
 */
export async function readItemFacts(key, owner) {
  try {
    const r = await apiGet(`/v1/content/facts?kind=file&key=${enc(key)}${owner ? `&owner=${enc(owner)}` : ''}`);
    return r?.data?.facts || null;
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** GET /v1/content/classes: the built-in and the person's own content classes. */
export async function readClasses() {
  const r = await apiGet('/v1/content/classes');
  return r?.data?.classes || [];
}

/** GET /v1/content/proposals?status=pending: the classes and fields a model proposed, waiting. */
export async function readProposals() {
  const r = await apiGet('/v1/content/proposals?status=pending');
  return r?.data?.proposals || [];
}

/** POST /v1/content/proposals/{id} { decision: 'approve' | 'reject' }. */
export const decideProposal = (id, decision) => apiPost(`/v1/content/proposals/${enc(id)}`, { decision });

/** POST /v1/content/scans {}: read every item that has no facts yet, with the person's settings. */
export async function startScan() {
  const r = await apiPost('/v1/content/scans', {});
  return r?.data?.scan || null;
}

/** GET /v1/content/scans/{id}: how a scan ended (kept for an hour after it finishes). */
export async function readScan(id) {
  const r = await apiGet(`/v1/content/scans/${enc(id)}`);
  return r?.data?.scan || null;
}

/**
 * POST /v1/content/inspect { source, ...extra }: read one item now, with the person's settings or
 * the stages `extra` names ({ stages: ['extract'], force: true } extracts again). A step that calls a
 * model can take a while, so the call waits up to two minutes.
 */
export async function inspectItem(source, extra = {}) {
  const r = await api('/v1/content/inspect', { method: 'POST', body: JSON.stringify({ source, ...extra }), timeoutMs: 120_000 });
  return r?.data?.facts || null;
}

/** The `source` of a stored file: its key, and its owner when the file is one of the person's agents'. */
export const fileSource = (key, owner) => ({ kind: 'file', key, ...(owner ? { owner } : {}) });

/**
 * POST /v1/content/correct { source, classes?, fields? }: the person's own correction of an item's
 * content classes or of a class's extracted fields. Answers { facts, review }: `review` is the
 * decision record after the person's review (a model's membership kept is confirmed, one removed is
 * overridden), or null when no decision was involved.
 */
export async function correctItem(body) {
  const r = await apiPost('/v1/content/correct', body);
  return { facts: r?.data?.facts || null, review: r?.data?.review || null };
}

/** GET /v1/content/text?kind=file&key=…: the text kept for a file, { text, from }, or null when none was kept. */
export async function readItemText(source) {
  try {
    const r = await apiGet(`/v1/content/text?kind=${enc(source.kind)}&key=${enc(source.key)}${source.owner ? `&owner=${enc(source.owner)}` : ''}`);
    return r?.data || null;
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/**
 * The OWL class of one content class and its datatype properties, out of GET /v1/content/ontology
 * ?format=jsonld: the graph nodes whose @id is cc:<id> or starts with cc:<id>.
 */
export async function readOwlClass(classId) {
  const doc = await apiGet('/v1/content/ontology?format=jsonld');
  const own = `cc:${classId}`;
  return (doc?.['@graph'] || []).filter((node) => node?.['@id'] === own || String(node?.['@id'] || '').startsWith(own + '.'));
}

/** A certainty (0..1) as a whole percent, the number in the reader's format and the sign as the language writes it. */
export function percent(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return cc('pct', { n: fmtNum(Math.round(v * 100)) });
}

/** A property's name as words: due_date → Due date. */
export const propertyWords = (name) => {
  const s = String(name || '').replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};

/** A class property's name in the page language: its label, the English one, or its name in words. */
export function propertyLabel(p) {
  const lang = String(getLocale() || 'en').slice(0, 2);
  return p?.label?.[lang] || p?.label?.en || propertyWords(p?.name);
}

/**
 * A property's `describe` as a hint, on an English page only: it is written in English for the model
 * that extracts the property, and the label already says what the field is in the page language.
 */
export function propertyHint(p) {
  return String(getLocale() || 'en').slice(0, 2) === 'en' ? (p?.describe || undefined) : undefined;
}

/** GET /v1/ai/decisions/{id}: one decision of the decision model, with its record and review. */
export async function readDecision(id) {
  const r = await apiGet(`/v1/ai/decisions/${enc(id)}`);
  return r?.data || null;
}

/** The content classes that can apply to an item of this kind: a class without `kinds` applies to all. */
export const classesForKind = (classes, kind) => (classes || []).filter((c) => !c.kinds?.length || c.kinds.includes(kind));

/** PUT /v1/content/settings with a partial patch; answers the settings as stored. */
export async function saveSettings(patch) {
  const r = await apiPut('/v1/content/settings', patch);
  return r?.data?.settings || null;
}

/** GET /v1/ai/decide/rules: the person's decision rules, for the approval choice. */
export async function readRules() {
  const r = await apiGet('/v1/ai/decide/rules');
  return r?.data?.rules || [];
}

/**
 * GET /v1/content/ontology?format=jsonld, fetched with the session (a plain link carries no token),
 * handed to the person as content-classes.jsonld.
 */
export async function downloadOntology() {
  const doc = await apiGet('/v1/content/ontology?format=jsonld');
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/ld+json' }), 'content-classes.jsonld');
}

/* ── One item ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The AI mark of a row: the verdict in words, every row, so the column is never an empty label. An
 * item that declares AI made it stands out; one that declares nothing, or a person, is the off tone.
 */
function aiMark(ai) {
  return html`<${Mark} kind="status" tone=${isAiMade(ai?.verdict) ? 'attention' : 'off'}>${aiWord(ai?.verdict)}<//>`;
}

/**
 * One item as a row of the List cut name-desc-state-doors. `classes` gives the content classes'
 * names; `doors` are the row's actions (none in the wallet's list).
 * @param {any} f the item's facts (GET /v1/content/facts)
 * @param {any[]} classes
 * @param {any} [doors]
 */
export function itemRow(f, classes, doors) {
  const ai = f.technical?.ai;
  const words = f.description?.altText || f.description?.text || '';
  const marks = (f.classes || []).map((m) => html`<${Mark} key=${m.id}>${classLabel(classes, m.id)}<//>`);
  return html`
    <${Row} key=${f.sourceId}>
      <${Name} asKey clip meta=${kindWord(f.technical?.kind)}>${f.source?.key}<//>
      <${Desc} lines=${2} faint=${!words} marks=${marks} sub=${ai?.euAiAct?.markMissing ? cc('euMarkMissing') : undefined}>${words || cc('noDescription')}<//>
      <${Cell} line>${aiMark(ai)}<//>
      <${Doors}>${doors || null}<//>
    <//>`;
}

/** "320 × 240". */
const sizeWord = (w, h) => (w && h ? `${fmtNum(w)} × ${fmtNum(h)}` : '');
/** An ISO time, or the camera's local time as written, in the reader's format. */
function when(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : `${fmtDate(s)} ${fmtTime(s, { hour: '2-digit', minute: '2-digit' })}`;
}

/** A signature check's result in words: the ETSI words, "could not be confirmed" for indeterminate. */
const sigWord = (verdict) => cc('sig.' + (['unsigned', 'valid', 'invalid', 'indeterminate'].includes(verdict) ? verdict : 'unchecked'));

function pdfRows(p) {
  const sig = p.signatures || { verdict: 'unchecked', count: 0, signers: [] };
  const signers = (sig.signers || []).map((s, i) => html`
    <${FactLine} key=${String(i)} sub=${[s.organisation, s.signedAt ? when(s.signedAt) : ''].filter(Boolean).join(' · ') || undefined}>${s.name || s.email || cc('signerUnnamed')}<//>`);
  return [
    has(p.title) && { key: 'title', k: cc('f.title'), v: p.title },
    has(p.author) && { key: 'author', k: cc('f.author'), v: p.author },
    has(p.pages) && { key: 'pages', k: cc('f.pages'), v: fmtNum(p.pages) },
    { key: 'sig', k: cc('f.signatures'), v: sigWord(sig.verdict), sub: sig.count ? cc('sigCount', { n: fmtNum(sig.count) }) : undefined, warn: sig.verdict === 'invalid' },
    signers.length && { key: 'signers', k: cc('f.signers'), v: signers },
  ];
}

function imageRows(im) {
  const camera = [im.camera?.make, im.camera?.model].filter(Boolean).join(' ');
  return [
    sizeWord(im.width, im.height) && { key: 'size', k: cc('f.size'), v: sizeWord(im.width, im.height) },
    camera && { key: 'camera', k: cc('f.camera'), v: camera },
    has(im.takenAt) && { key: 'taken', k: cc('f.taken'), v: when(im.takenAt) },
    { key: 'location', k: cc('f.location'), v: im.gps ? cc('hasLocation') : cc('noLocation'), missing: !im.gps },
  ];
}

function videoRows(v) {
  const codecs = [v.video?.codec, v.audio?.codec].filter(Boolean).join(' · ');
  if (v.unavailable) return [{ key: 'unavailable', k: cc('f.length'), v: cc('videoUnread'), missing: true }];
  return [
    has(v.durationSeconds) && { key: 'length', k: cc('f.length'), v: duration(v.durationSeconds * 1000) },
    sizeWord(v.video?.width, v.video?.height) && { key: 'size', k: cc('f.size'), v: sizeWord(v.video.width, v.video.height) },
    codecs && { key: 'codecs', k: cc('f.codecs'), v: codecs },
  ];
}

/**
 * The Facts rows (components/Facts.js) of one item: the kind's own details, the file size, what it
 * declares about AI, its description and when it was read.
 * @param {any} f the item's facts
 * @returns {any[]}
 */
export function detailRows(f) {
  const tech = f.technical || {};
  const ai = tech.ai || {};
  const own = tech.pdf ? pdfRows(tech.pdf) : tech.image ? imageRows(tech.image) : tech.video ? videoRows(tech.video) : [];
  return [
    { key: 'kind', k: cc('f.kind'), v: kindWord(tech.kind), sub: has(tech.size) ? fmtBytes(tech.size) : undefined },
    ...own,
    { key: 'ai', k: cc('f.ai'), v: aiWord(ai.verdict), warn: !!ai.euAiAct?.markMissing, sub: ai.euAiAct?.markMissing ? cc('euMarkMissing') : undefined },
    f.description?.text && { key: 'desc', k: cc('f.description'), v: f.description.text, sub: f.description.altText ? cc('altTextIs', { text: f.description.altText }) : undefined },
    { key: 'read', k: cc('f.read'), v: when(f.updatedAt) },
  ];
}
