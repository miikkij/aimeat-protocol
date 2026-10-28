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
 *   - printableUseCase · printableRegister — one entry of either register as the document's data
 *   - PrintableReport (default export) — the print-only document
 * @usage rendered unconditionally by compliance-tab.js; the print sheet shows it only on paper
 * @version-history
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
 * One AI use as the document's data. `saved` says whether it is in the stored register; one that is
 * not is the system's finding, and the tag says so before anything else.
 */
function printableUseCase(u, questionnaire, { saved, why = {} }) {
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
  return {
    id: anchorOf(u),
    title: u.title || u.id,
    tag,
    desc: u.description,
    answersHead: [P('colQuestion'), P('colAnswer'), P('colReason'), P('colWho')],
    fields: [
      { key: 'account', label: P('fOwner'), value: u.ownerGhii },
      { key: 'purpose', label: C('ucPurpose'), value: u.purpose },
      { key: 'apps', label: C('ucApps'), value: u.apps },
      { key: 'models', label: C('ucModels'), value: (u.models || []).length ? u.models : P('modelsNone') },
      { key: 'why', label: P('fWhyAi'), value: (u.systems || []).map(evidenceText) },
      { key: 'subjects', label: C('ucSubjects'), value: subjectsText(u.dataSubjects) },
      ...proposals.map((p, i) => ({ key: 'proposal' + i, label: P('fProposal'), value: `${answerText(questions.find(q => q.id === p.question) || {}, p.value) || p.value}: ${proposalWhy(p)}` })),
      { key: 'open', label: P('fOpen'), value: P('openCount', { n: String(questions.length - answered.length), total: String(questions.length) }) },
    ],
    // Only the answered questions: twelve "not answered" rows per entry buried the answers that
    // exist. How many are open is the field above, and the questions are the appendix.
    answers: answered.map((q) => {
      const src = sources[q.id];
      return {
        key: q.id, question: questionText(q), answer: answerText(q, answers[q.id]),
        note: (u.answerNotes || {})[q.id] || '—', source: src ? t(SOURCE_LABEL[src]) : null,
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

/**
 * Who fixes one kind of gap, and where. An app's own data map and record are its owner's; the AI
 * register, the node's records and the processors are the operator's; a label is the publisher's.
 */
function gapOwner(kind) {
  if (kind.startsWith('app-') && kind !== 'app-uses-ai-not-in-register' && kind !== 'app-declares-generation-with-gap') return ['who.appOwner', 'where.app'];
  if (kind === 'unlabelled-public-content' || kind === 'app-declares-generation-with-gap') return ['who.publisher', 'where.publish'];
  if (kind === 'font-licence-unknown') return ['who.operator', 'where.fonts'];
  if (['undocumented-ai-activity', 'app-uses-ai-not-in-register', 'unclassified-usecase'].includes(kind)) return ['who.operator', 'where.register'];
  return ['who.operator', 'where.records'];
}

/** The gaps by kind, the AI register's first and the records of processing after. */
function gapGroups(report) {
  const groups = new Map();
  const add = (g, name) => {
    const k = g.kind;
    if (!groups.has(k)) groups.set(k, { kind: k, name, rows: [] });
    groups.get(k).rows.push(gapRow(g, report.processing?.frameworks));
  };
  for (const g of report.gaps || []) add(g, tOr(`admin.compliance.paper.gapKind.${g.kind}`, g.kind));
  for (const g of report.processing?.gaps || []) add(g, tOr(`admin.compliance.records.kind.${g.kind}`, g.kind));
  return [...groups.values()];
}

/** The anchor of one AI use in the document, for the overview table's links. */
const anchorOf = (u) => 'cmp-uc-' + String(u.id).replace(/[^a-z0-9-]/gi, '-');

/** The regulated data an entry's "whose data" sentence names, short, for the overview table. */
function personalShort(u) {
  const s = u.dataSubjects;
  if (typeof s !== 'string' || !s) return '—';
  const domains = [...s.matchAll(/([\w-]+) \((?:stated|proposed): /g)].map(m => domainWord(m[1]));
  return domains.length ? `${C('yes')}: ${domains.join(', ')}` : C('yes');
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
  const usage = report?.derived?.ai_usage || {};
  const tr = report?.derived?.ai_transparency || {};
  const groups = report ? gapGroups(report) : [];
  const aiGaps = (report?.gaps || []).length;
  const recordGaps = (report?.processing?.gaps || []).length;
  const answeredOf = (u) => questions.filter(q => answerText(q, (u.answers || {})[q.id]) !== null).length;
  const openAnswers = all.reduce((n, u) => n + (questions.length - answeredOf(u)), 0);
  const page = `${window.location.origin}/v1/admin?tab=compliance`;
  const money = `$${(Number(usage.cost_usd) || 0).toFixed(2)}`;
  const classOf = (u) => {
    if (savedIds.has(u.id)) return classWord(questionnaire, u.risk?.class || 'unclassified');
    const p = proposedClass(questionnaire, u);
    return p ? P('classProposed', { cls: classWord(questionnaire, p) }) : '—';
  };

  // What to do next, each with who does it and where: the report's first use is a to-do list.
  const actions = [
    ...(unsaved.length ? [[P('act.save', { n: String(unsaved.length) }), P('who.operator'), P('where.register', { page })]] : []),
    ...(high.length ? [[P('act.high', { list: high.map(u => u.title || u.id).join(', ') }), P('who.operatorDpo'), P('where.register', { page })]] : []),
    ...(openAnswers ? [[P('act.answer', { n: String(openAnswers), entries: String(all.length) }), P('who.operator'), P('where.registerOrAi', { page })]] : []),
    ...groups.filter(g => g.kind !== 'app-uses-ai-not-in-register' && g.kind !== 'unclassified-usecase')
      .map(g => { const [who, where] = gapOwner(g.kind); return [`${g.name} (${g.rows.length})`, P(who), P(where, { page })]; }),
  ];

  const parts = [
    { id: 'cmp-p-state', label: P('summaryTitle') },
    { id: 'cmp-p-next', label: P('nextTitle') },
    { id: 'cmp-p-uses', label: P('usesTitle') },
    { id: 'cmp-p-each', label: P('eachTitle') },
    { id: 'cmp-p-gaps', label: P('gapsTitle') },
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
        [P('sumUses'), P('sumUsesValue', { apps: String(all.filter(isApp).length), others: String(all.filter(u => !isApp(u)).length) })],
        [P('sumApproved'), P('sumApprovedValue', { saved: String(saved.length), total: String(all.length) })],
        [P('sumHigh'), high.length ? high.map(u => u.title || u.id) : P('none')],
        [P('sumOpen'), P('sumOpenValue', { n: String(openAnswers), total: String(all.length * questions.length) })],
        [P('sumCalls'), P('sumCallsValue', { calls: String(usage.calls ?? 0), cost: money, models: String((usage.models || []).length) })],
        [P('sumGaps'), P('sumGapsValue', { ai: String(aiGaps), records: String(recordGaps) })],
        [P('sumPublic'), P('sumPublicValue', { total: String(tr.public_total ?? 0), unlabelled: String(tr.unlabelled ?? 0) })],
      ]} />

      ${heading('cmp-p-next')}
      <${Note} kind="quiet">${P('nextLead', { page })}<//>
      ${actions.length === 0
        ? html`<${Note} kind="quiet">${C('gapsNone')}<//>`
        : html`<${PrintTable} lead head=${[P('colAction'), P('colWhoDoes'), P('colWhere')]} rows=${actions} />`}

      ${heading('cmp-p-uses')}
      <${Note} kind="quiet">${P('usesLead')}<//>
      ${all.length === 0
        ? html`<${Note} kind="quiet">${P('usesNone')}<//>`
        : html`<${PrintTable} head=${[P('colUse'), P('fOwner'), C('ucModels'), P('colPersonal'), P('colClass'), P('colState'), P('colAnswered')]}
            rows=${all.map(u => [
              html`<a href=${'#' + anchorOf(u)}>${u.title || u.id}</a>`,
              String(u.ownerGhii || '').split('@')[0] || '—',
              (u.models || []).length ? String(u.models.length) : '0',
              personalShort(u),
              classOf(u),
              savedIds.has(u.id) ? P('stSaved') : P('stFound'),
              `${answeredOf(u)}/${questions.length}`,
            ])} />`}

      ${heading('cmp-p-each', { newSheet: true })}
      ${all.map(u => html`<${PrintEntry} key=${u.id}
          ...${printableUseCase(u, questionnaire, { saved: savedIds.has(u.id), why: why[u.id] || {} })}
          reasonsLabel=${t('admin.compliance.printWhy')} emptyAnswer=${t('admin.compliance.unanswered')} />`)}

      ${heading('cmp-p-gaps', { newSheet: true })}
      <${Note} kind="quiet">${P('gapsLead')}<//>
      ${groups.length === 0
        ? html`<${Note} kind="quiet">${C('gapsNone')}<//>`
        : groups.map(g => {
          const [who] = gapOwner(g.kind);
          const detailed = g.rows.some(r => r[1]);
          return html`<${PrintEntry} key=${g.kind} title=${g.name} tag=${P('gapTag', { n: String(g.rows.length), who: P(who) })} />
            <${PrintTable} lead head=${detailed ? [P('colConcerns'), P('colDetail')] : [P('colConcerns')]}
              rows=${g.rows.map(r => (detailed ? [r[0], r[1] || '—'] : [r[0]]))} />`;
        })}

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
      <${PrintTable} head=${[P('colQuestion'), P('colHelp'), P('colRule')]} rows=${questions.map(q => [
        q.type === 'choice' ? `${questionText(q)} (${(q.options || []).map(o => optionLabel(q, o)).join(' · ')})` : questionText(q),
        questionHelp(q) || '—',
        impliesText(questionnaire, q),
      ])} />
    <//>
  `;
}
