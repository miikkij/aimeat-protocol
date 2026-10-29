/**
 * @file compliance-tab.print.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the compliance page becomes on paper: a document somebody can hand to an
 *   auditor without the reader needing the screen it came from.
 *
 *   WHY THIS IS SEPARATE FROM THE SCREEN. The screen shows one entry's answers when you open that
 *   entry, which is right for working and wrong for printing: a printout produced that way carried
 *   forty-three risk classes and not one of the answers that produced them. The class is the
 *   conclusion; the answers are the evidence, and a compliance document that prints the conclusion
 *   alone is the same overstatement the "what this does not cover" section exists to prevent.
 *
 *   IT PRINTS WHAT THE NODE FOUND, NOT ONLY WHAT SOMEBODY SAVED. Until v3 the document was the
 *   stored register and the question set. On innokas.aimeat.io (2026-10-28) the register was empty,
 *   so the operator's printout was an empty register, twelve questions in English and "no register
 *   is kept here yet", while the node knew of twelve AI uses, two high-risk candidates and ninety
 *   open gaps. Now it opens with the overall state, then every AI use the node finds (the stored
 *   entries, and the draft's entries nobody has saved, each marked as the system's finding and not
 *   approved), then what is missing, the measurements, the limits, the records of processing, and
 *   the question set last as an appendix.
 *
 *   EVERY WORD IN THE READER'S LANGUAGE. The question set is data and may have been edited, so a
 *   question prints translated only while the node says it is still as shipped (`built_in` of GET
 *   questionnaire); an edited question prints in the words its editor wrote. The node's evidence sentences are
 *   matched to their known shapes and translated, and print as the node wrote them otherwise.
 *
 *   WHO SEES THE DATA DECIDES THE LENGTH (v4, 2026-10-29). On aimeat.io the v3 document ran past
 *   180 pages: every AI use as a full sheet, then every app again in three or four gap tables, and a
 *   notes app only its user sees read the same as one that publishes people's names. The order is
 *   Jouni's: the state by law with the apps counted by who sees their data, what each person does
 *   (the administrator, then each app's maker with the apps a task concerns), a full description
 *   only for an AI use that is not an app, one in an Annex III area, and an app whose data anyone,
 *   its maker or an outside service sees, then every app as one line, and the limits and the
 *   question set after.
 *
 *   IT IS ALWAYS IN THE DOM, HIDDEN ON SCREEN. Rendering both and letting CSS choose has no timing
 *   in it, which is why the printout is the same from the button or from Ctrl+P
 *   (components/PrintPage.js).
 *
 *   IT SAYS WHO ANSWERED, PER QUESTION. A page of answers that all read as considered would answer
 *   an auditor's first question wrongly.
 * @structure
 *   - questionText · questionHelp · answerText — the question set in the reader's language; the CSV
 *     and the screen use them too
 *   - evidenceText · subjectsText — the node's own sentences about an AI use, translated
 *   - printableUseCase · printableRegister — one entry as the document's data
 *   - reachWord · appFields · tellsWord · askedText — an app's reach and a question's condition in words
 *   - PrintableReport (default export) — the print-only document; its arithmetic is
 *     compliance-tab.print-tasks.js
 * @usage rendered unconditionally by compliance-tab.js; the print sheet shows it only on paper
 * @version-history
 *   v4.0.0 — 2026-10-29 — The state by law and by who sees each app's data, the tasks by person, a
 *     full description only where it is needed, every app as one line, and the question set with
 *     when each question is asked. The gap tables by kind are gone into the tasks. aimeat.io's
 *     printout was more than 180 pages.
 *   v3.3.0 — 2026-10-29 — An entry's purpose, apps and reasons for counting as AI use print one per
 *     line; the reason column only when an answer has a reason. Innokas Outreach's fourteen uses
 *     read as one sentence, beside a column of dashes.
 *   v3.2.0 — 2026-10-28 — Each answer prints with its reason (`answerNotes`) in a column of its own,
 *     and an answer the app's maker gave is marked as the maker's.
 *   v3.1.0 — 2026-10-28 — Laid out for its readers (the data protection officer, the management, an
 *     auditor): what the answer marks mean, linked contents, the state as a table, what to do next
 *     with who and where, the AI uses as one overview table linked to each use, each use's facts
 *     and answers as tables, the gaps as tables with who fixes them, how the report is completed
 *     and by whom, and the question set with the rule each answer follows.
 *   v3.0.0 — 2026-10-28 — The overall state first, every AI use the node finds (saved or not, each
 *     marked), the gaps by kind with what each concerns, the measurements and the limits; the
 *     question set in the reader's language as an appendix. The printout was the empty stored
 *     register and twelve English questions on innokas.aimeat.io.
 *   v2.2.1 — 2026-10-28 — A saved answer whose source is `proposed` prints as a rule's proposal not
 *     yet approved; it printed with no label.
 *   v2.2.0 — 2026-10-24 — `only`: one register or one place's record printed alone (C7.7).
 *   v2.1.0 — 2026-10-24 — The node's records of processing print after the question set (C7.6).
 *   v2.0.0 — 2026-09-27 — Drawn by components/PrintPage.js from data.
 *   v1.0.0 — 2026-08-23 — BR-02. The printout was the report's conclusions without its evidence.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, tOr, getLocale } from '/js/i18n.js';
import { PrintOnly, PrintHead, PrintHeading, PrintToc, PrintTable, PrintEntry, PrintList } from '/components/PrintPage.js';
import { Note } from '/components/Note.js';
import { answersOf, questionsFor } from './compliance-tab.gaps.js';
import { personTasks, fullDescriptions, stateCounts } from './compliance-tab.print-tasks.js';

const C = (key, params) => t('admin.compliance.' + key, params);
const P = (key, params) => t('admin.compliance.paper.' + key, params);

/** Who produced one answer, in a word. Absent reads as unknown rather than as a person. */
const SOURCE_LABEL = {
  human: 'admin.compliance.answerFromHuman',
  ai: 'admin.compliance.answerFromAi',
  evidence: 'admin.compliance.answerFromEvidence',
  proposed: 'admin.compliance.answerFromProposed',
  maker: 'admin.compliance.answerFromMaker',
};

/**
 * A shipped question's words in the reader's language. The question set is editable data, so only a
 * question the node marks as still shipped (`builtIn`, from GET questionnaire's `built_in`) is
 * translated; an operator who reworded one gets their own words back.
 */
function shipped(q, key, stored) {
  if (!stored || !q?.builtIn) return stored;
  return tOr(key, stored);
}

export const questionText = (q) => shipped(q, `admin.compliance.question.${q.id}.text`, q.text);
export const questionHelp = (q) => shipped(q, `admin.compliance.question.${q.id}.help`, q.help);
export const optionLabel = (q, o) => shipped(q, `admin.compliance.option.${o.value}`, o.label);

/**
 * One answer as the question itself would put it.
 *
 * A choice answer prints its option label rather than its stored value: `employment` is the id,
 * and "Hiring, task allocation, promotion, or ending employment" is what the question asked.
 */
export function answerText(question, value) {
  if (value === undefined || value === null || value === '') return null;
  if (question.type === 'boolean') return value ? t('admin.compliance.yes') : t('admin.compliance.no');
  const opt = (question.options || []).find(o => o.value === value);
  return opt ? optionLabel(question, opt) : String(value);
}

/**
 * One of the node's sentences about why something counts as an AI use, in the reader's language.
 * The shapes are the ones services/compliance-app-signals.ts writes; anything else prints as written.
 */
export function evidenceText(s) {
  if (typeof s !== 'string') return '';
  if (s === 'the app asks for permission to use AI (ai:use)') return P('ev.aiUse');
  if (s === 'the data map lists ai-generation in its machinery') return P('ev.machinery');
  let m = /^the app declares it generates (.+)$/.exec(s);
  if (m) return P('ev.generates', { what: m[1].split(', ').map(w => tOr(`admin.compliance.paper.media.${w}`, w)).join(', ') });
  m = /^the data map sends (?:one thing|(\d+) things) to an AI service$/.exec(s);
  if (m) return m[1] ? P('ev.sends', { n: m[1] }) : P('ev.sendsOne');
  m = /^the data map keeps AI-generated data \((.+)\)$/.exec(s);
  if (m) return P('ev.keeps', { rows: m[1] });
  return s;
}

const domainWord = (d) => tOr(`admin.compliance.records.domain.${d}`, d);

/** The draft's "whose data" sentence (services/compliance-draft.ts), in the reader's language. */
export function subjectsText(s) {
  if (typeof s !== 'string') return s;
  const m = /^Personal data per the app's data map(?:; domains: (.+))?\.$/.exec(s);
  if (!m) return s;
  if (!m[1]) return P('personal');
  const parts = [...m[1].matchAll(/([\w-]+) \((stated|proposed): ([^)]+)\)/g)]
    .map(([, d, how, rows]) => P(how === 'stated' ? 'domainStated' : 'domainProposed', { domain: domainWord(d), rows }));
  return parts.length ? P('personalDomains', { list: parts.join('; ') }) : P('personal');
}

/** Why a proposed answer was proposed, from the draft's facts (as compliance-tab.register.js says it). */
function proposalWhy(p) {
  const b = p && p.basis;
  if (!b && p && p.value === 'none') return C('proposedNoArea');
  if (!b) return (p && p.reason) || '';
  const rows = (b.rows || []).join(', ');
  return b.source === 'evidence'
    ? C('proposedStated', { rows, domain: domainWord(b.domain) })
    : C('proposedRead', { rows, domain: domainWord(b.domain), words: (b.words || []).slice(0, 6).join(', ') });
}

const classWord = (questionnaire, id) => {
  if (!id) return '';
  const cls = (questionnaire?.classes || []).find(c => c.id === id);
  return tOr(`admin.compliance.class.${id}`, cls?.label || id);
};

/** The class a proposed answer would give, read from the question set's own rule. */
function proposedClass(questionnaire, u) {
  const sev = (id) => (questionnaire?.classes || []).find(c => c.id === id)?.severity ?? 0;
  let worst = null;
  for (const q of questionnaire?.questions || []) {
    if (u.answerSources?.[q.id] !== 'proposed') continue;
    const v = u.answers?.[q.id];
    const cls = q.implies?.[q.type === 'boolean' ? String(Boolean(v)) : v];
    if (cls && (!worst || sev(cls) > sev(worst))) worst = cls;
  }
  return worst;
}

/**
 * A purpose written as a run of uses ("planning campaigns …; collecting signals …; and reporting …")
 * as one use per line. Fewer than three parts stays the sentence it was written as.
 */
function purposeItems(s) {
  if (typeof s !== 'string') return s;
  const parts = s.split(/;\s+/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return s;
  parts[parts.length - 1] = parts[parts.length - 1].replace(/^(and|ja|sekä|y|e)\s+/i, '').replace(/\.$/, '');
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1));
}

/**
 * One AI use as the document's data. `saved` says whether it is in the stored register; one that is
 * not is the system's finding, and the tag says so before anything else.
 */
function printableUseCase(u, questionnaire, { saved, why = {}, app = null }) {
  const questions = questionnaire?.questions || [];
  const answers = u.answers || {};
  const sources = u.answerSources || {};
  const risk = u.risk;
  const proposed = proposedClass(questionnaire, u);
  const tag = saved
    ? P('statusSaved', { cls: risk?.class ? classWord(questionnaire, risk.class) : classWord(questionnaire, 'unclassified') })
    : P('statusFound') + (proposed ? P('statusProposed', { cls: classWord(questionnaire, proposed) }) : '');
  const answered = questions.filter(q => answerText(q, answers[q.id]) !== null);
  const proposals = Object.values(why);
  const notes = u.answerNotes || {};
  // Of the questions this use is asked (askedWhen): outside an Annex III area, three.
  const a = answersOf(u, questions);
  const notAsked = questions.length - questionsFor(u, questions).length;
  // The reason column only when an answer has one: a column of dashes is noise on every entry.
  const withNotes = answered.some(q => notes[q.id]);
  return {
    id: anchorOf(u),
    title: u.title || u.id,
    tag,
    desc: u.description,
    answersHead: withNotes
      ? [P('colQuestion'), P('colAnswer'), P('colReason'), P('colWho')]
      : [P('colQuestion'), P('colAnswer'), P('colWho')],
    fields: [
      { key: 'account', label: P('fOwner'), value: u.ownerGhii },
      { key: 'purpose', label: C('ucPurpose'), value: purposeItems(u.purpose), list: true },
      // An app's own entry is titled with the app, so the field would repeat it.
      ...(app ? appFields(app) : [{ key: 'apps', label: C('ucApps'), value: u.apps, list: true }]),
      { key: 'models', label: C('ucModels'), value: (u.models || []).length ? u.models : P('modelsNone') },
      { key: 'why', label: P('fWhyAi'), value: (u.systems || []).map(evidenceText), list: true },
      { key: 'subjects', label: C('ucSubjects'), value: subjectsText(u.dataSubjects) },
      ...proposals.map((p, i) => ({ key: 'proposal' + i, label: P('fProposal'), value: `${answerText(questions.find(q => q.id === p.question) || {}, p.value) || p.value}: ${proposalWhy(p)}` })),
      { key: 'open', label: P('fOpen'), value: P('openCount', { n: String(a.unanswered), total: String(a.total) }) },
      ...(notAsked > 0 ? [{ key: 'notAsked', label: P('fNotAsked'), value: P('notAskedValue', { n: String(notAsked) }) }] : []),
    ],
    // Only the answered questions: twelve "not answered" rows per entry buried the answers that
    // exist. How many are open is the field above, and the questions are the appendix.
    answers: answered.map((q) => {
      const src = sources[q.id];
      return {
        key: q.id, question: questionText(q), answer: answerText(q, answers[q.id]),
        note: notes[q.id] || '—', source: src ? t(SOURCE_LABEL[src]) : null,
      };
    }),
    reasons: (risk?.reasons || []).map((r) => {
      const q = questions.find(x => x.id === r.questionId);
      const said = (q && answerText(q, answers[r.questionId])) || r.answer;
      return `${q ? questionText(q) : r.question} — ${said}`;
    }),
  };
}

/**
 * One register as the document's data, in the order GDPR art. 30(1) lists the contents of a record
 * of processing: the controller, the purpose, the subjects and data, the recipients, the transfers,
 * the time limits and the security measures.
 */
export function printableRegister(r) {
  const F = (k) => t('admin.compliance.records.field.' + k);
  const W = (group, v) => tOr(`admin.compliance.records.${group}.${v}`, v);
  const list = (v) => (Array.isArray(v) && v.length ? v.join(', ') : undefined);
  const basis = [...(r.legalBasis || []).map(b => W('basis', b)), ...(r.specialBasis ? [W('special', r.specialBasis)] : [])];
  return {
    title: r.title || r.id,
    tag: W('type', r.type),
    desc: r.purposeText,
    fields: [
      { key: 'controller', label: F('controller'), value: r.controller },
      { key: 'role', label: F('role'), value: r.role ? W('role', r.role) : undefined },
      { key: 'purpose', label: F('purpose'), value: r.purpose ? W('purpose', r.purpose) : undefined },
      { key: 'legalBasis', label: F('legalBasis'), value: list(basis) || r.legalBasisText },
      { key: 'subjects', label: F('subjects'), value: list(r.subjects) },
      { key: 'categories', label: F('categories'), value: list(r.dataCategories) },
      { key: 'domains', label: F('domains'), value: list((r.domains || []).map(d => W('domain', d))) },
      { key: 'recipients', label: F('recipients'), value: list(r.recipients) },
      { key: 'processors', label: F('processors'), value: list(r.processors) },
      { key: 'transfers', label: F('transfers'), value: list((r.transfers || []).map(x => `${x.country} (${x.basis})`)) },
      { key: 'retention', label: F('retention'), value: r.retentionText || (typeof r.retentionMonths === 'number' ? t('admin.compliance.records.months', { n: String(r.retentionMonths) }) : undefined) },
      { key: 'security', label: F('security'), value: r.security },
      { key: 'reviewed', label: F('reviewed'), value: r.reviewedAt ? r.reviewedAt.slice(0, 10) : undefined },
    ],
  };
}

/**
 * What one gap concerns, from its evidence, as a table row: the thing (the app, the model, the law,
 * the processor) and what about it, when there is more to say than the kind already says.
 */
function gapRow(g, frameworks) {
  const ev = g.evidence || {};
  const lang = (getLocale() || 'en').slice(0, 2);
  const place = ev.owner && ev.app ? `${ev.owner}/${ev.app}` : (ev.app || null);
  if (g.kind === 'app-uses-ai-not-in-register') {
    return [place, ev.annex3 ? P('gapAiAnnex', { area: tOr(`admin.compliance.annex3.${ev.annex3}`, ev.annex3) }) : ''];
  }
  if (ev.model) return [ev.model, ''];
  if (ev.framework) {
    const f = (frameworks || []).find(x => x.id === ev.framework);
    const name = (f?.name && (f.name[lang] || f.name.en)) || ev.framework;
    return [name, Array.isArray(ev.unanswered) ? t('admin.compliance.records.unanswered', { n: String(ev.unanswered.length) }) : ''];
  }
  if (ev.name) return [ev.name, ''];
  if (place) {
    const families = Array.isArray(ev.holds) && ev.holds.length ? ev.holds.map(h => String(h).split(':')[0])
      : (Array.isArray(ev.families) ? ev.families : []);
    return [place, families.join(', ')];
  }
  if (ev.family) return [ev.family, ''];
  if (typeof ev.count === 'number') return [P('gapCount', { n: String(ev.count) }), ''];
  return [g.detail, ''];
}

/** A gap kind's name in the reader's language: the AI Act's kinds, then the records of processing's. */
const gapKindName = (kind) => tOr(`admin.compliance.paper.gapKind.${kind}`, tOr(`admin.compliance.records.kind.${kind}`, kind));

/** The anchor of one AI use in the document, for the app table's links. */
const anchorOf = (u) => 'cmp-uc-' + String(u.id).replace(/[^a-z0-9-]/gi, '-');
/** The anchor of one app's full description, when it is not an AI use. */
const appAnchor = (a) => 'cmp-app-' + String(a.app).replace(/[^a-z0-9-]/gi, '-');

/** Who can see an app's personal data, in a few words (compliance-app-reach.ts). */
const reachWord = (r) => P('reach.' + (r || 'unknown'));

/** An app line's facts as entry fields: who sees its data, which data others see, its AI label. */
function appFields(a) {
  return [
    { key: 'reach', label: P('fReach'), value: reachWord(a.reach) },
    { key: 'seen', label: P('fSeen'), value: (a.rows || []).map(r => P('seenRow', { what: r.what, reach: P('reachShort.' + r.reach) })), list: true },
    ...(a.uses_ai ? [{ key: 'tells', label: P('colTells'), value: tellsWord(a) }] : []),
  ];
}

/** Whether an app that uses AI shows people an AI label, as the publish check found. */
const tellsWord = (a) => (!a.uses_ai ? '—' : a.tells_ai === true ? C('yes') : a.tells_ai === false ? C('no') : P('tellsUnknown'));

/** When a question is asked, from its `askedWhen`, as the appendix prints it. */
function askedText(questions, q) {
  const cond = q.askedWhen;
  const on = cond && questions.find(x => x.id === cond.question);
  if (!on) return P('askedAll');
  const word = (v) => (v === 'true' ? C('yes') : v === 'false' ? C('no')
    : optionLabel(on, (on.options || []).find(o => o.value === v) || { value: v, label: v }));
  return cond.in
    ? P('askedIn', { question: questionText(on), answers: cond.in.map(word).join(', ') })
    : P('askedNotIn', { question: questionText(on), answers: (cond.notIn || []).map(word).join(', ') });
}

/** The question set's own rule for one question, as the appendix prints it. */
function impliesText(questionnaire, q) {
  const entries = Object.entries(q.implies || {});
  if (entries.length === 0) return C('qs.impliesNone');
  if (q.type === 'boolean') return entries.map(([a, cls]) => C('qs.implies', { answer: a === 'true' ? C('yes') : C('no'), cls: classWord(questionnaire, cls) })).join(' · ');
  const byClass = new Map();
  for (const [v, cls] of entries) byClass.set(cls, [...(byClass.get(cls) || []), v]);
  return [...byClass.keys()].map(cls => C('qs.impliesChoice', { cls: classWord(questionnaire, cls) })).join(' · ');
}

/**
 * The document.
 *
 * `found` is the node's draft of the register (GET /v1/admin/compliance/draft): the AI uses it
 * finds that the stored register does not hold yet. It prints whether or not anybody saved it,
 * marked as the system's finding, because an empty register on paper reads as "no AI here".
 */
export default function PrintableReport({ report, questionnaire, registers = [], found = null, only = null }) {
  const questions = questionnaire?.questions || [];
  const scope = report?.scope || {};
  if (only) {
    const at = t('admin.compliance.printGenerated').replace('{at}', new Date().toISOString().replace('T', ' ').slice(0, 16));
    return html`
      <${PrintOnly}>
        <${PrintHead} title=${t('admin.compliance.records.printTitle')} line=${[scope.node_id || '', only.title, at].filter(Boolean).join(' · ')} />
        ${only.registers.map(r => html`<${PrintEntry} key=${r.id} ...${printableRegister(r)} />`)}
      <//>`;
  }
  const saved = report?.register?.usecases || [];
  const savedIds = new Set(saved.map(u => u.id));
  const unsaved = (found?.usecases || []).filter(u => !savedIds.has(u.id));
  const why = {};
  for (const p of found?.proposals || []) why[p.usecase_id] = { ...(why[p.usecase_id] || {}), [p.question]: p };
  const all = [...saved, ...unsaved];
  const isApp = (u) => (u.apps || []).length > 0;
  const high = all.filter(u => (savedIds.has(u.id) ? u.risk?.class : proposedClass(questionnaire, u)) === 'high');
  const highIds = new Set(high.map(u => u.id));
  const usage = report?.derived?.ai_usage || {};
  const tr = report?.derived?.ai_transparency || {};
  const aiGaps = (report?.gaps || []).length;
  const recordGaps = (report?.processing?.gaps || []).length;
  // Of the questions each use is asked (askedWhen), not of the whole set.
  const open = (u) => answersOf(u, questions).unanswered;
  const openAnswers = all.reduce((n, u) => n + open(u), 0);
  const page = `${window.location.origin}/v1/admin?tab=compliance`;
  const catalog = `${window.location.origin}/v1/appcat`;
  const money = `$${(Number(usage.cost_usd) || 0).toFixed(2)}`;
  const classOf = (u) => {
    if (savedIds.has(u.id)) return classWord(questionnaire, u.risk?.class || 'unclassified');
    const p = proposedClass(questionnaire, u) || (u.risk?.class && u.risk.class !== 'unclassified' ? u.risk.class : null);
    return p ? P('classProposed', { cls: classWord(questionnaire, p) }) : '—';
  };

  const apps = report?.processing?.apps || [];
  const counts = stateCounts(report);
  const useOfApp = new Map();
  for (const u of all) for (const ref of u.apps || []) useOfApp.set(String(ref).toLowerCase(), u);
  const rowOfApp = new Map(apps.map(a => [String(a.app).toLowerCase(), a]));
  // An app that keeps no personal data on the installation and uses no AI asks nothing: its name in
  // one paragraph, not a row each (55 of aimeat.io's 197).
  const isQuiet = (a) => a.reach === 'none' && !a.uses_ai && !(a.domains || []).length;
  const listed = apps.filter(a => !isQuiet(a));
  const quiet = apps.filter(isQuiet);
  const full = fullDescriptions({ report, uses: all, highIds });
  const fullIds = new Set(full.uses.map(u => u.id));
  const tasks = personTasks({ report, uses: all, savedIds, open, highIds, gapThing: (g) => gapRow(g, report?.processing?.frameworks)[0] });

  // What each person does: the administrator's rows first, then each maker's, one row per task.
  const taskWord = (k, n) => (k.task === 'gap' ? `${gapKindName(k.kind)} (${n})`
    : k.task.startsWith('kind:') ? gapKindName(k.task.slice(5))
    : P('task.' + k.task, { n: String(n ?? '') }));
  // The person once, on their first row, in bold: the column is narrow and the task wide.
  const person = (name, i) => (i === 0 ? html`<strong>${name}</strong>` : '');
  const taskRows = [
    ...tasks.operator.map((k, i) => [person(P('who.operator'), i), k.task === 'save' ? P('act.save', { n: String(k.n) })
      : k.task === 'high' ? P('act.high', { list: k.items.join(', ') })
        : k.task === 'answer' ? P('act.answer', { n: String(k.n), entries: String(k.items.length) })
          : taskWord(k, k.n), k.task === 'high' ? '' : k.items.join(', ')]),
    ...tasks.makers.flatMap(m => m.tasks.map((k, i) => [person(m.owner, i), taskWord(k, k.items.length),
      k.items.map(x => (x.n ? `${x.title} (${x.n})` : x.title)).join(', ')])),
  ];

  const parts = [
    { id: 'cmp-p-state', label: P('summaryTitle') },
    { id: 'cmp-p-next', label: P('tasksTitle') },
    { id: 'cmp-p-each', label: P('fullTitle') },
    { id: 'cmp-p-apps', label: P('appsTitle') },
    { id: 'cmp-p-how', label: P('howTitle') },
    { id: 'cmp-p-measures', label: C('derivedTitle') },
    { id: 'cmp-p-limits', label: C('limitsTitle') },
    { id: 'cmp-p-records', label: t('admin.compliance.records.printTitle') },
    { id: 'cmp-p-questions', label: P('appendixTitle') },
  ].map((p, i, list) => ({ ...p, num: i === list.length - 1 ? P('appendixNum') : String(i + 1) }));
  const part = (id) => parts.find(p => p.id === id);
  const heading = (id, extra = {}) => html`<${PrintHeading} id=${id} num=${part(id).num} ...${extra}>${part(id).label}<//>`;

  const line = [
    scope.node_id || '',
    `${(scope.period?.from || '').slice(0, 10)}–${(scope.period?.to || '').slice(0, 10)}`,
    t('admin.compliance.printGenerated').replace('{at}', (scope.generated_at || '').replace('T', ' ').slice(0, 16)),
    questionnaire?.version ? t('admin.compliance.printQsVersion').replace('{v}', questionnaire.version) : null,
  ].filter((x) => x !== null).join(' · ');

  return html`
    <${PrintOnly}>
      <${PrintHead} title=${t('admin.compliance.printTitle')} line=${line} />
      <${Note} kind="quiet">${P('readFirst')}<//>
      <${PrintTable} lead head=${[P('colMark'), P('colMeans')]} rows=${Object.keys(SOURCE_LABEL).map(k => [t(SOURCE_LABEL[k]), P('means.' + k)])} />

      <${PrintToc} title=${P('tocTitle')} items=${parts} />

      ${heading('cmp-p-state', { newSheet: true })}
      <${PrintTable} lead rows=${[
        ...(apps.length ? [[P('sumGdpr'), P('sumGdprValue', {
          n: String(counts.exposed + counts.shared), exposed: String(counts.exposed), shared: String(counts.shared),
          register: String(counts.noRegister), notice: String(counts.noNotice) })]] : []),
        [P('sumAiAct'), P('sumAiActValue', {
          apps: String(all.filter(isApp).length), others: String(all.filter(u => !isApp(u)).length),
          high: String(high.length), open: String(openAnswers), nolabel: String(counts.noLabel) })],
        [P('sumApproved'), P('sumApprovedValue', { saved: String(saved.length), total: String(all.length) })],
        [P('sumHigh'), high.length ? high.map(u => u.title || u.id) : P('none')],
        [P('sumCalls'), P('sumCallsValue', { calls: String(usage.calls ?? 0), cost: money, models: String((usage.models || []).length) })],
        [P('sumGaps'), P('sumGapsValue', { ai: String(aiGaps), records: String(recordGaps) })],
        [P('sumPublic'), P('sumPublicValue', { total: String(tr.public_total ?? 0), unlabelled: String(tr.unlabelled ?? 0) })],
      ]} />
      ${apps.length ? html`
        <${Note} kind="quiet">${P('reachLead', { n: String(counts.apps) })}<//>
        <${PrintTable} lead head=${[P('colReach'), P('colRequires'), P('colApps')]}
          rows=${['exposed', 'shared', 'unknown', 'self', 'none'].map(r => [reachWord(r), P('reachMeans.' + r), String(counts[r])])} />` : null}

      ${heading('cmp-p-next')}
      <${Note} kind="quiet">${P('tasksLead', { page, catalog })}<//>
      ${taskRows.length === 0
        ? html`<${Note} kind="quiet">${C('gapsNone')}<//>`
        : html`<${PrintTable} head=${[P('colPerson'), P('colTask'), P('colConcerns')]} rows=${taskRows} />`}

      ${heading('cmp-p-each', { newSheet: true })}
      <${Note} kind="quiet">${P('fullLead')}<//>
      ${full.uses.length + full.apps.length === 0 ? html`<${Note} kind="quiet">${P('fullNone')}<//>` : null}
      ${full.uses.map(u => html`<${PrintEntry} key=${u.id}
          ...${printableUseCase(u, questionnaire, { saved: savedIds.has(u.id), why: why[u.id] || {}, app: rowOfApp.get(String((u.apps || [])[0] || '').toLowerCase()) || null })}
          reasonsLabel=${t('admin.compliance.printWhy')} emptyAnswer=${t('admin.compliance.unanswered')} />`)}
      ${full.apps.length ? html`
        <${Note} kind="quiet">${P('exposedLead')}<//>
        <${PrintTable} lead head=${[P('colUse'), P('fOwner'), P('fSeen')]}
          rows=${full.apps.map(a => [
            html`<span id=${appAnchor(a)}>${a.title}</span>`,
            a.owner,
            (a.rows || []).map(r => P('seenRow', { what: r.what, reach: P('reachShort.' + r.reach) })).join('; ') || '—',
          ])} />` : null}

      ${apps.length ? html`
        ${heading('cmp-p-apps')}
        <${Note} kind="quiet">${P('appsLead')}<//>
        <${PrintTable} head=${[P('colUse'), P('fOwner'), P('colReach'), P('colAiCell')]}
          rows=${listed.map((a) => {
            const u = useOfApp.get(String(a.app).toLowerCase());
            const anchor = u && fullIds.has(u.id) ? anchorOf(u) : (!u && a.reach === 'exposed' ? appAnchor(a) : null);
            const ans = u ? answersOf(u, questions) : null;
            // Short words, one line a row: 197 apps on aimeat.io ran to eight pages with the long
            // ones. The state page's table says what each reach means.
            const reach = P('reachShort.' + (a.reach || 'unknown'));
            const ai = !a.uses_ai ? '—' : [
              a.tells_ai === true ? P('labelYes') : a.tells_ai === false ? P('labelNo') : P('labelUnknown'),
              ...(u ? [classOf(u), `${ans.answered}/${ans.total}`].filter(x => x !== '—') : []),
            ].join(' · ');
            return [
              anchor ? html`<a href=${'#' + anchor}>${a.title}</a>` : a.title,
              a.owner,
              (a.domains || []).length ? `${reach} · ${a.domains.map(domainWord).join(', ')}` : reach,
              ai,
            ];
          })} />
        ${quiet.length ? html`<${Note} kind="quiet">${P('quietApps', { n: String(quiet.length), list: quiet.map(a => a.title).join(', ') })}<//>` : null}` : null}

      ${heading('cmp-p-how')}
      <${Note} kind="quiet">${P('howLead')}<//>
      <${PrintList} items=${['1', '2', '3', '4', '5', '6', '7', '8'].map(n => ({ key: n, text: P('how.' + n, { page }) }))} />
      <${PrintTable} lead head=${[P('colRole'), P('colRoleDoes')]} rows=${['operator', 'dpo', 'appOwner', 'ai'].map(r => [P('role.' + r), P('roleDoes.' + r)])} />

      ${heading('cmp-p-measures')}
      <${PrintTable} lead rows=${[
        [C('row.calls'), C('row.callsWhy', { prompt: String(usage.prompt_tokens ?? 0), completion: String(usage.completion_tokens ?? 0), cost: money, unpriced: String(usage.unpriced_calls ?? 0) })],
        [C('row.models'), (usage.models || []).length ? usage.models : C('row.modelsNone')],
        [C('row.public'), C('row.publicWhy', { labelled: String(tr.labelled ?? 0), unlabelled: String(tr.unlabelled ?? 0) })],
      ]} />

      ${heading('cmp-p-limits')}
      <${PrintList} items=${(report?.not_covered || []).map((s, i) => ({ key: s.code || i, text: typeof s === 'string' ? s : tOr(`admin.compliance.limit.${s.code}`, s.text, { days: s.days }) }))} />

      ${heading('cmp-p-records')}
      ${registers.length === 0
        ? html`<${Note} kind="quiet">${P('recordsNone', { drafts: String(report?.processing?.registers?.drafts?.total ?? 0) })}<//>`
        : registers.map(r => html`<${PrintEntry} key=${r.id} ...${printableRegister(r)} />`)}

      ${heading('cmp-p-questions', { newSheet: true })}
      <${Note} kind="quiet">${P('appendixLead')}<//>
      <${PrintTable} head=${[P('colQuestion'), P('colHelp'), P('colAsked'), P('colRule')]} rows=${questions.map(q => [
        q.type === 'choice' ? `${questionText(q)} (${(q.options || []).map(o => optionLabel(q, o)).join(' · ')})` : questionText(q),
        questionHelp(q) || '—',
        askedText(questions, q),
        impliesText(questionnaire, q),
      ])} />
    <//>
  `;
}
