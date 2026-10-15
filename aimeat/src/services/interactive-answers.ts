/**
 * @file src/services/interactive-answers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the answers to a structured question (a federated AskUserQuestion, sent with
 *   aimeat_dm_ask or a broadcast poll) fit the question they reply to: every answered question is
 *   one of the question set, every chosen option is one of that question's options, a single-choice
 *   question takes one answer, a free-text answer is given only where the question allows one, and
 *   a required question is answered.
 *
 *   WHY ON THE NODE. Until 2026-10-15 only the inbox page restricted an answer; the node stored
 *   whatever an answer said. An agent answers without the page, and the asker's agent acts on
 *   `interactive.answers` as the machine-readable result, so an option id that the question never
 *   offered reached it as a choice (feature-list audit #123). POST /v1/messages asks this before it
 *   stores the reply.
 * @structure AnswerProblem · checkInteractiveAnswers(questions, answers)
 * @usage
 *   const problems = checkInteractiveAnswers(question.interactive.questions, input.interactive.answers);
 *   if (problems.length) refuse 400 with problems in details
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #123).
 */
import type { InteractiveQuestion, InteractiveAnswer } from '../storage/interface.js';

/** One way an answer does not fit its question: which question, and what is wrong, in words. */
export interface AnswerProblem { question: string; problem: string }

/**
 * Every way the answers do not fit the questions; an empty list when they fit. The question set is
 * the one stored with the question message, so a question written before the defaults existed
 * reads `allowOther` as true and `multiSelect` and `required` as false, as the page does.
 */
export function checkInteractiveAnswers(
  questions: readonly InteractiveQuestion[],
  answers: Readonly<Record<string, InteractiveAnswer>>,
): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));

  for (const [qid, answer] of Object.entries(answers)) {
    const q = byId.get(qid);
    if (!q) { problems.push({ question: qid, problem: 'The question set has no question with this id.' }); continue; }
    const offered = new Set((q.options ?? []).map((o) => o.id));
    const selected = Array.isArray(answer?.selected) ? answer.selected : [];
    const other = typeof answer?.other === 'string' ? answer.other.trim() : '';

    const unknown = selected.filter((id) => !offered.has(id));
    if (unknown.length) problems.push({ question: qid, problem: `These choices are not options of this question: ${unknown.join(', ')}.` });
    if (new Set(selected).size !== selected.length) problems.push({ question: qid, problem: 'The same choice is given more than once.' });
    if (other && q.allowOther === false) problems.push({ question: qid, problem: 'This question takes no free-text answer.' });
    if (!q.multiSelect && selected.length + (other ? 1 : 0) > 1) {
      problems.push({ question: qid, problem: 'This question takes one answer: one option, or the free-text answer.' });
    }
  }

  for (const q of questions) {
    if (!q.required) continue;
    const a = answers[q.id];
    const answered = !!a && ((Array.isArray(a.selected) && a.selected.length > 0) || (typeof a.other === 'string' && a.other.trim().length > 0));
    if (!answered) problems.push({ question: q.id, problem: 'This question is required and has no answer.' });
  }
  return problems;
}
