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
 *   - extract: what an invoice or a receipt states, read from the item's words by patterns (vendor,
 *     total and currency, VAT and its rate, dates, reference, number); a property not found is null,
 *     as a real model is told to answer; when the shape asks for new properties, one:
 *     `payment_terms`, labelled.
 *   - propose: a `recipe` class when the item's words say "resepti" or "recipe", else none; its two
 *     properties carry labels in fi, en and es.
 * @structure contentDecideAnswer · wordLabels · profileDecideAnswer · profileTextAnswer · profileAnswer ·
 *   contentChatAnswer
 * @usage const a = contentChatAnswer(promptText); if (a) answer with it;
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 *   v1.1.0 — 2026-10-21 — The proposed properties (payment_terms, dish, servings) carry labels.
 *   v1.2.0 — 2026-10-21 — The extraction reads the item's words (readDocumentFields) instead of
 *     filling every property with a fixed value, which made the sandbox look as if the pipeline read
 *     an invoice wrong (Jouni's look at it).
 *   v1.3.0 — 2026-11-02 — The fingerprint prompt (profileAnswer): every section labelled from its
 *     own words; the decision model's labels (profileDecideAnswer) and the text model's headings,
 *     claims and topics beside them (profileTextAnswer), by the same rules.
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
  if (ids.length && ids.every((id) => /^s\d+_(genre|mark|cert|fakta|konkr|aika|toim|yks|varm)$/.test(id))) return profileDecideAnswer(body, ids);
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

/** A section's labels from its own words, the same rules profileAnswer uses. */
function wordLabels(words: string): { genre: string; mark: string; firm: boolean; decided: boolean } {
  const sourced = /https?:\/\/|\blähde\b|\bsource\b/i.test(words);
  const decided = /\b(päätettiin|decided)\b/i.test(words);
  const factual = /\d/.test(words);
  return {
    genre: decided ? 'decision_or_plan' : factual || sourced ? 'fact' : 'opinion',
    mark: sourced ? 'checkable_source' : decided ? 'person_or_meeting' : 'nothing',
    firm: sourced || decided, decided,
  };
}

/**
 * The fingerprint's labels as the decision model gives them (src/services/content/profile-labels.ts):
 * a choice per genre and mark, a five-level score per certainty and axis, from each section's words.
 */
function profileDecideAnswer(body: Record<string, unknown>, ids: string[]): Record<string, unknown> {
  const state = (body.state && typeof body.state === 'object' ? body.state : {}) as { sections?: Record<string, string> };
  const answers: Record<string, unknown> = {};
  for (const id of ids) {
    const [, n, what] = /^s(\d+)_(.+)$/.exec(id) ?? [];
    const l = wordLabels(String(state.sections?.[n] ?? ''));
    if (what === 'genre') answers[id] = { type: 'choice', choice: l.genre, probabilities: { [l.genre]: 0.9 }, confidence: 0.9 };
    else if (what === 'mark') answers[id] = { type: 'choice', choice: l.mark, probabilities: { [l.mark]: 0.9 }, confidence: 0.9 };
    else if (what === 'aika' || what === 'toim') answers[id] = { type: 'score', score: l.decided ? 3.5 : 1, confidence: 0.9 };
    else answers[id] = { type: 'score', score: l.firm ? 3.5 : 1, confidence: 0.9 };
  }
  return { model: 'sandbox-jev', answers, usage: { input_tokens: 900, output_tokens: 0 } };
}

/** The headings, claims and topics a text model writes beside the decision model's labels. */
function profileTextAnswer(prompt: string): string {
  const parts = prompt.split(/=== Section (\d+) ===\n/).slice(1);
  const sections: Array<Record<string, unknown>> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const body = parts[i + 1];
    const given = /^Given heading: (.*)\n/.exec(body)?.[1] ?? '';
    const words = body.replace(/^Given heading: .*\n/, '');
    sections.push({ n: Number(parts[i]), heading: given && given !== '(none)' ? given : `Osio ${parts[i]}`, claim: words.trim().split(/[.!?]\s/)[0].slice(0, 120), topic: 0 });
  }
  sections.forEach((s, i) => { s.topic = i < Math.ceil(sections.length / 2) ? 0 : 1; });
  return JSON.stringify({ kind: 'testiaineisto', topics: ['Alkuosa', 'Loppuosa'], sections });
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

/** "248,00" → 248; "1 234,50" → 1234.5. */
const num = (s: string): number => Number(s.replace(/\s/g, '').replace(',', '.'));

/**
 * What an invoice or a receipt states, read from its words by patterns in Finnish and English: the
 * stand-in for a model's reading. Only what is there: a field it does not find is left out.
 */
function readDocumentFields(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const m = (re: RegExp) => re.exec(text);
  const vendor = m(/(?:Myyjä|Seller|Vendor)\s*:\s*([^,.\n]+)/i);
  if (vendor) out.vendor = vendor[1].trim();
  const total = m(/(?:Yhteensä|Total)\s*:\s*([\d\s]+,\d{2}|[\d\s]+\.\d{2}|\d+)\s*(EUR|USD|SEK|€)?/i);
  if (total) { out.amount = num(total[1]); if (total[2]) out.currency = total[2] === '€' ? 'EUR' : total[2].toUpperCase(); }
  const vat = m(/(?:ALV|VAT)\s*(\d+(?:[.,]\d+)?)\s*%\s*([\d\s]+,\d{2}|[\d\s]+\.\d{2})/i);
  if (vat) { out.vat_rate = num(vat[1]); out.vat = num(vat[2]); }
  const date = m(/(?:Päiväys|Laskun päivämäärä|Invoice date|Date)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (date) out.date = date[1];
  const due = m(/(?:Eräpäivä|Due date)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (due) out.due_date = due[1];
  const ref = m(/(?:Viitenumero|Viite|Reference)\s*:\s*([A-Z]{0,2}[\d ]{4,30}\d)/i);
  if (ref) out.reference = ref[1].trim();
  const number = m(/(?:LASKU|INVOICE)[^\n\d]*([0-9][\w-]{2,})/);
  if (number) out.invoice_number = number[1];
  return out;
}

/**
 * The stand-in fingerprint (src/services/content/profile.ts): every section the prompt carries is
 * labelled from its own words, so a test can predict the answer. A link or "lähde"/"source" makes
 * it `+`, "päätettiin"/"decided" a decision resting on the meeting (`~`), a digit a fact, and
 * anything else an opinion with no grounds (`?`). Two topics: the first half and the second.
 */
function profileAnswer(prompt: string): string {
  const parts = prompt.split(/=== Section (\d+) ===\n/).slice(1);
  const sections: Array<Record<string, unknown>> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const n = Number(parts[i]);
    const body = parts[i + 1];
    const words = body.replace(/^Given heading: .*\n/, '');
    const given = /^Given heading: (.*)\n/.exec(body)?.[1] ?? '';
    const sourced = /https?:\/\/|\blähde\b|\bsource\b/i.test(words);
    const decided = /\b(päätettiin|decided)\b/i.test(words);
    const factual = /\d/.test(words);
    const genre = decided ? 'P' : factual || sourced ? 'F' : 'M';
    const trust = sourced ? '+' : decided ? '~' : '?';
    sections.push({
      n, heading: given && given !== '(none)' ? given : `Osio ${n}`,
      claim: words.trim().split(/[.!?]\s/)[0].slice(0, 120), genre, trust, certainty: trust === '?' ? 0.4 : 0.85,
      topic: 0, axes: { fakta: trust === '?' ? -0.6 : 0.7, konkr: 0.3, aika: decided ? 0.6 : -0.2, toim: decided ? 0.8 : -0.4, yks: 0.2, varm: trust === '?' ? -0.4 : 0.7 },
    });
  }
  sections.forEach((s, i) => { s.topic = i < Math.ceil(sections.length / 2) ? 0 : 1; });
  return JSON.stringify({ kind: 'testiaineisto', topics: ['Alkuosa', 'Loppuosa'], sections });
}

/** The stand-in completion for a content class prompt, or null for any other prompt. */
export function contentChatAnswer(prompt: string): string | null {
  if (prompt.startsWith('You profile a document')) return profileAnswer(prompt);
  if (prompt.startsWith('You write the headings, one-sentence claims and topics')) return profileTextAnswer(prompt);
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
    // The item's words follow the shape line; what an invoice or a receipt states is read from
    // them by a few patterns (the one fixture: test/e2e-content-class.ts, the sandbox's invoice.pdf).
    const words = prompt.slice(prompt.indexOf('of this shape: ')).split('\n').slice(1).join('\n');
    const read = readDocumentFields(words);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shape)) {
      if (k === '_confidence') out[k] = 0.88;
      else if (k === '_newProperties') {
        out[k] = [{ name: 'payment_terms', type: 'string', describe: 'The payment terms the document states, e.g. 14 days net.',
          label: { fi: 'Maksuehto', en: 'Payment terms', es: 'Condiciones de pago' } }];
      }
      else if (k in read) out[k] = read[k];
      // A property the words do not state is null, as the prompt asks of a real model.
      else out[k] = typeof v === 'boolean' ? false : null;
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
