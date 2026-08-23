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
 *   reader's own Ctrl+P.
 *
 *   IT SAYS WHO ANSWERED, PER QUESTION. The register has recorded that since the day it could be
 *   filled in by a model, and the printed document is exactly where it matters: a page of answers
 *   that all read as considered would answer an auditor's first question wrongly.
 * @structure
 *   - answerText(question, value) — one answer in the question's own vocabulary; the CSV export
 *     uses it too, so the two files say the same thing about the same answer
 *   - PrintableUseCase — one entry with its answers, its class and the reasons for it
 *   - PrintableReport (default export) — the print-only document
 * @usage rendered unconditionally by compliance-tab.js; CSS shows it only in print
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02. The printout was the report's conclusions without its evidence.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

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

/** A list field, or nothing at all. An empty label with a dash after it is noise on paper. */
function Field({ label, value }) {
  const text = Array.isArray(value) ? value.join(', ') : value;
  if (!text) return null;
  return html`<div class="adm-cmp-pr-field"><span>${label}</span> ${text}</div>`;
}

function PrintableUseCase({ useCase, questions }) {
  const answers = useCase.answers || {};
  const sources = useCase.answerSources || {};
  const risk = useCase.risk;
  return html`
    <article class="adm-cmp-pr-uc">
      <h4>
        ${useCase.title || useCase.id}
        <span class="adm-cmp-pr-class">${risk?.label || risk?.class || '—'}</span>
      </h4>
      ${useCase.description && html`<p class="adm-cmp-pr-desc">${useCase.description}</p>`}
      <${Field} label=${t('admin.compliance.ucPurpose')} value=${useCase.purpose} />
      <${Field} label=${t('admin.compliance.ucModels')} value=${useCase.models} />
      <${Field} label=${t('admin.compliance.ucApps')} value=${useCase.apps} />
      <${Field} label=${t('admin.compliance.ucSubjects')} value=${useCase.dataSubjects} />
      <${Field} label=${t('admin.compliance.printAccount')} value=${useCase.ownerGhii} />

      <table class="adm-cmp-pr-answers">
        <tbody>
          ${questions.map((q) => {
            const text = answerText(q, answers[q.id]);
            const src = sources[q.id];
            return html`
              <tr key=${q.id}>
                <td class="adm-cmp-pr-q">${q.text}</td>
                <td class="adm-cmp-pr-a">
                  ${text || html`<em>${t('admin.compliance.unanswered')}</em>`}
                  ${/* Parenthesised rather than only spaced: on paper the two run together when a
                        reader copies the text out, and who answered is the half that gets lost. */
                    text && src && html`<span class="adm-cmp-pr-src">(${t(SOURCE_LABEL[src])})</span>`}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>

      ${risk?.reasons?.length > 0 && html`
        <div class="adm-cmp-pr-why">
          <span>${t('admin.compliance.printWhy')}</span>
          <ul>
            ${risk.reasons.map((r, i) => {
              // The verdict carries the answer as it was STORED, so a boolean arrives as "true".
              // Printing that beside a question phrased "Does it…" reads as a machine's note rather
              // than as an answer, so it goes through the same formatting as the table above.
              const q = questions.find(x => x.id === r.questionId);
              const said = (q && answerText(q, answers[r.questionId])) || r.answer;
              return html`<li key=${i}>${r.question} — ${said}</li>`;
            })}
          </ul>
        </div>
      `}
    </article>
  `;
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
  return html`
    <div class="adm-cmp-print-only">
      <div class="adm-cmp-pr-head">
        <h2>${t('admin.compliance.printTitle')}</h2>
        <p>
          ${scope.node_id || ''}
          ${' · '}
          ${(scope.period?.from || '').slice(0, 10)}–${(scope.period?.to || '').slice(0, 10)}
          ${' · '}
          ${t('admin.compliance.printGenerated').replace('{at}', (scope.generated_at || '').replace('T', ' ').slice(0, 16))}
          ${questionnaire?.version && html`${' · '}${t('admin.compliance.printQsVersion').replace('{v}', questionnaire.version)}`}
        </p>
      </div>

      <h3>${t('admin.compliance.registerTitle')}</h3>
      ${usecases.length === 0
        ? html`<p>${t('admin.compliance.registerEmpty')}</p>`
        : usecases.map(u => html`<${PrintableUseCase} key=${u.id} useCase=${u} questions=${questions} />`)}

      <h3>${t('admin.compliance.qsTitle')}</h3>
      <ol class="adm-cmp-pr-qs">
        ${questions.map(q => html`
          <li key=${q.id}>
            ${q.text}
            ${q.help && html`<span class="adm-cmp-pr-qhelp">${q.help}</span>`}
          </li>
        `)}
      </ol>
    </div>
  `;
}
