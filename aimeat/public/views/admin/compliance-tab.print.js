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
 *   IT IS ALWAYS IN THE DOM, HIDDEN ON SCREEN. The alternative is to re-render on the beforeprint
 *   event, and that is a race: a state update scheduled there is not guaranteed to have painted
 *   before the browser takes its snapshot. Rendering both and letting CSS choose has no timing in
 *   it at all, which is why the printout is the same whether it comes from the button or from the
 *   reader's own Ctrl+P. (The mechanism is components/PrintPage.js.)
 *
 *   IT SAYS WHO ANSWERED, PER QUESTION. The register has recorded that since the day it could be
 *   filled in by a model, and the printed document is exactly where it matters: a page of answers
 *   that all read as considered would answer an auditor's first question wrongly.
 * @structure
 *   - answerText(question, value) — one answer in the question's own vocabulary; the CSV export
 *     uses it too, so the two files say the same thing about the same answer
 *   - printableUseCase — one entry with its answers, its class and the reasons for it, as data
 *   - PrintableReport (default export) — the print-only document
 * @usage rendered unconditionally by compliance-tab.js; the print sheet shows it only on paper
 * @version-history
 *   v2.0.0 — 2026-09-27 — The document is drawn by components/PrintPage.js (PrintOnly, PrintHead,
 *     PrintHeading, PrintEntry, PrintList) from data; the file writes no class. Every word, field,
 *     answer, source and reason it printed is still printed.
 *   v1.0.0 — 2026-08-23 — BR-02. The printout was the report's conclusions without its evidence.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PrintOnly, PrintHead, PrintHeading, PrintEntry, PrintList } from '/components/PrintPage.js';
import { Note } from '/components/Note.js';

/** Who produced one answer, in a word. Absent reads as unknown rather than as a person. */
const SOURCE_LABEL = {
  human: 'admin.compliance.answerFromHuman',
  ai: 'admin.compliance.answerFromAi',
  evidence: 'admin.compliance.answerFromEvidence',
};

/**
 * One answer as the question itself would put it.
 *
 * A choice answer prints its option label rather than its stored value: `annex-iii-employment` is
 * the id, and "Employment, worker management" is what the question asked.
 */
export function answerText(question, value) {
  if (value === undefined || value === null || value === '') return null;
  if (question.type === 'boolean') return value ? t('admin.compliance.yes') : t('admin.compliance.no');
  const opt = (question.options || []).find(o => o.value === value);
  return opt?.label || String(value);
}

/** One entry of the register as the document's data: its fields, its answers, the reasons for its class. */
function printableUseCase(useCase, questions) {
  const answers = useCase.answers || {};
  const sources = useCase.answerSources || {};
  const risk = useCase.risk;
  return {
    title: useCase.title || useCase.id,
    tag: risk?.label || risk?.class || '—',
    desc: useCase.description,
    // A list field, or nothing at all. An empty label with a dash after it is noise on paper.
    fields: [
      { key: 'purpose', label: t('admin.compliance.ucPurpose'), value: useCase.purpose },
      { key: 'models', label: t('admin.compliance.ucModels'), value: useCase.models },
      { key: 'apps', label: t('admin.compliance.ucApps'), value: useCase.apps },
      { key: 'subjects', label: t('admin.compliance.ucSubjects'), value: useCase.dataSubjects },
      { key: 'account', label: t('admin.compliance.printAccount'), value: useCase.ownerGhii },
    ],
    // Parenthesised rather than only spaced (PrintEntry): on paper the two run together when a
    // reader copies the text out, and who answered is the half that gets lost.
    answers: questions.map((q) => {
      const src = sources[q.id];
      return { key: q.id, question: q.text, answer: answerText(q, answers[q.id]), source: src ? t(SOURCE_LABEL[src]) : null };
    }),
    // The verdict carries the answer as it was STORED, so a boolean arrives as "true". Printing that
    // beside a question phrased "Does it…" reads as a machine's note rather than as an answer, so it
    // goes through the same formatting as the table above.
    reasons: (risk?.reasons || []).map((r) => {
      const q = questions.find(x => x.id === r.questionId);
      const said = (q && answerText(q, answers[r.questionId])) || r.answer;
      return `${r.question} — ${said}`;
    }),
  };
}

/**
 * The document.
 *
 * It repeats what the screen already shows — the gaps, the limits, the totals are on the page above
 * and print from there. What it adds is the register in full and the question set behind it, plus a
 * heading and a generated-at stamp, because a printed page with no date is not evidence of anything.
 */
export default function PrintableReport({ report, questionnaire }) {
  const questions = questionnaire?.questions || [];
  const usecases = report?.register?.usecases || [];
  const scope = report?.scope || {};
  const line = [
    scope.node_id || '',
    `${(scope.period?.from || '').slice(0, 10)}–${(scope.period?.to || '').slice(0, 10)}`,
    t('admin.compliance.printGenerated').replace('{at}', (scope.generated_at || '').replace('T', ' ').slice(0, 16)),
    questionnaire?.version ? t('admin.compliance.printQsVersion').replace('{v}', questionnaire.version) : null,
  ].filter((x) => x !== null).join(' · ');
  return html`
    <${PrintOnly}>
      <${PrintHead} title=${t('admin.compliance.printTitle')} line=${line} />

      <${PrintHeading}>${t('admin.compliance.registerTitle')}<//>
      ${usecases.length === 0
        ? html`<${Note} kind="quiet">${t('admin.compliance.registerEmpty')}<//>`
        : usecases.map(u => html`<${PrintEntry} key=${u.id} ...${printableUseCase(u, questions)}
            reasonsLabel=${t('admin.compliance.printWhy')} emptyAnswer=${t('admin.compliance.unanswered')} />`)}

      <${PrintHeading}>${t('admin.compliance.qsTitle')}<//>
      <${PrintList} items=${questions.map(q => ({ key: q.id, text: q.text, help: q.help }))} />
    <//>
  `;
}
