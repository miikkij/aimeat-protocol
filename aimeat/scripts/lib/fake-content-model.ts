/**
 * @file scripts/lib/fake-content-model.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stand-in answers for the content class pipeline's prompts (src/services/content/
 *   ai-stages.ts), so the sandbox and an E2E run walk every model stage with no paid key. No
 *   understanding: each prompt is told apart by its opening words, and the answer has the shape the
 *   stage asks for, filled from words the prompt already carries.
 *
 *   - classify (a decision with yes-or-no questions `c_<class>`): yes when the item's words name the
 *     class ("lasku", "invoice" for invoice, and so on), no otherwise.
 *   - describe: a fixed alt text and description; a scanned PDF's "text" is a short invoice.
 *   - extract: every property of the asked shape filled (a string with a stand-in, a number 248, a
 *     date 2026-10-31), and when the shape asks for new properties, one: `payment_terms`, labelled.
 *   - propose: a `recipe` class when the item's words say "resepti" or "recipe", else none; its two
 *     properties carry labels in fi, en and es.
 * @structure contentDecideAnswer · contentChatAnswer
 * @usage const a = contentChatAnswer(promptText); if (a) answer with it;
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 *   v1.1.0 — 2026-10-21 — The proposed properties (payment_terms, dish, servings) carry labels.
 */

/** Words that make an item a member of a class, per class id. */
const CLASS_WORDS: Record<string, RegExp> = {
  invoice: /\b(lasku|invoice|eräpäivä|due date)\b/i,
  receipt: /\b(kuitti|receipt)\b/i,
  contract: /\b(sopimus|contract|agreement)\b/i,
  'meeting-notes': /\b(palaveri|kokous|meeting)\b/i,
  report: /\b(raportti|report)\b/i,
  photo: /\btest card\b/i,
};

/**
 * Answers for a decision's yes-or-no questions about content classes (ids `c_<class>`). Null for a
 * decision that is not the content class one, so the caller answers it as before.
 */
export function contentDecideAnswer(body: Record<string, unknown>): Record<string, unknown> | null {
  const questions = (body.questions ?? {}) as Record<string, { type?: string }>;
  const ids = Object.keys(questions);
  if (!ids.length || !ids.every((id) => id.startsWith('c_') && questions[id]?.type === 'noul')) return null;
  const state = (body.state && typeof body.state === 'object' ? body.state : {}) as Record<string, unknown>;
  const words = `${String(state.text ?? '')}\n${String(state.description ?? '')}\n${String(state.facts ?? '')}`;
  const answers: Record<string, unknown> = {};
  for (const id of ids) {
    const re = CLASS_WORDS[id.slice(2)];
    answers[id] = { type: 'noul', noul: re && re.test(words) ? 0.94 : 0.04 };
  }
  return { model: body.model ?? 'sandbox-decide', answers, usage: { input_tokens: 600, output_tokens: 20 } };
}

/** The JSON shape a prompt asks for, after "of this shape: ". */
function askedShape(prompt: string): Record<string, unknown> | null {
  const at = prompt.indexOf('of this shape: ');
  if (at < 0) return null;
  const rest = prompt.slice(at + 'of this shape: '.length);
  const end = rest.indexOf('\n');
  try {
    return JSON.parse(end < 0 ? rest : rest.slice(0, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The stand-in completion for a content class prompt, or null for any other prompt. */
export function contentChatAnswer(prompt: string): string | null {
  if (prompt.startsWith('Describe this picture')) {
    return JSON.stringify({ altText: 'A television test card with coloured bars.', description: 'A test card: vertical colour bars over a grey background, the kind used to check a screen.', text: '' });
  }
  if (prompt.startsWith('This document has no text layer')) {
    return JSON.stringify({ description: 'A one-page invoice from Acme Oy.', text: 'LASKU 2026-041\nAcme Oy\nEräpäivä 2026-10-31\nYhteensä 248,00 EUR' });
  }
  if (prompt.includes('still frames taken evenly from a video')) {
    return JSON.stringify({ altText: 'A short clip of a test card.', description: 'A three-second clip of a moving test card with a steady tone.' });
  }
  if (prompt.startsWith('Summarise the content below')) {
    return JSON.stringify({ description: 'A text the sandbox model summarised without reading it.' });
  }
  if (prompt.startsWith('Extract these properties of a')) {
    const shape = askedShape(prompt) ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shape)) {
      if (k === '_confidence') out[k] = 0.88;
      else if (k === '_newProperties') {
        out[k] = [{ name: 'payment_terms', type: 'string', describe: 'The payment terms the document states, e.g. 14 days net.',
          label: { fi: 'Maksuehto', en: 'Payment terms', es: 'Condiciones de pago' } }];
      }
      else if (typeof v === 'number') out[k] = 248;
      else if (typeof v === 'boolean') out[k] = false;
      else out[k] = /date/.test(k) ? '2026-10-31' : `stand-in ${k}`;
    }
    return JSON.stringify(out);
  }
  if (prompt.startsWith('None of these content classes fits')) {
    if (!/\b(resepti|recipe)\b/i.test(prompt)) return JSON.stringify({ none: true });
    return JSON.stringify({
      id: 'recipe', label: { fi: 'Resepti', en: 'Recipe', es: 'Receta' },
      describe: 'A recipe: the ingredients and the steps to cook or bake one dish.', type: 'schema:Recipe',
      properties: [
        { name: 'dish', type: 'string', required: false, describe: 'The name of the dish.',
          label: { fi: 'Ruokalaji', en: 'Dish', es: 'Plato' } },
        { name: 'servings', type: 'number', required: false, describe: 'How many people it serves.',
          label: { fi: 'Annoksia', en: 'Servings', es: 'Porciones' } },
      ],
      why: 'A person keeps many recipes and finds them by dish.',
    });
  }
  return null;
}
