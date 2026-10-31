/**
 * @file public/js/ask-ai-prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Ask your AI more" prompt of the help dialog (components/ExplainDialog.js): a
 *   text the person copies into their own AI, whichever company makes it, to talk about one thing
 *   on the page and then about anything else in AIMEAT.
 *
 *   THE AI GETS AIMEAT'S OWN WORDS, NOT ITS GUESSES. The prompt carries the dialog's explanation and
 *   the glossary's definitions of the terms the dialog names, fenced as material, and tells the AI to
 *   answer from it and to say when it does not cover the question. The definitions are the ones the
 *   node gives every agent (GET /v1/glossary.json, the same registry as /v1/glossary.md), so a person
 *   and an AI read one explanation. The prompt then points at the whole glossary and llms.txt, and an
 *   AI connected over MCP is told to read the node's handbook first and answer from real data.
 *
 *   ENGLISH, LIKE EVERY PROMPT IN THIS CODE. The answer's language is the page's: the last line
 *   names it. The person's own figures ("mine") go in as the page wrote them; they see the whole text
 *   before they copy it, and nothing is sent anywhere by the page.
 * @structure buildAskPrompt({ subject, explanation, terms, mine, language, base })
 * @usage const prompt = buildAskPrompt({ subject: 'Offerings', explanation, terms, mine, language: 'Finnish', base: location.origin });
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */

/** The language name an AI understands for each interface locale. */
const LANGUAGE = { en: 'English', fi: 'Finnish', es: 'Spanish' };

/**
 * @param {{ subject: string, explanation: string[], terms: Array<{ term: string, definition: string }>,
 *   mine?: string, locale?: string, base: string }} a
 *   `subject` names the topic; `explanation` is the dialog's own text, line by line, in the page's
 *   language; `terms` are glossary entries (English definitions); `mine` is the person's own figures.
 */
export function buildAskPrompt({ subject, explanation, terms, mine, locale, base }) {
  const origin = String(base || '').replace(/\/+$/, '');
  const lines = [
    `I use AIMEAT (${origin}): a place where my own AI agents, apps and shared knowledge live, and which I own. I want to understand one part of it: ${subject}.`,
    '',
    'Below is what AIMEAT itself says. Treat it as the source of truth. When it does not cover my question, say so and point me to the links below instead of filling the gap yourself.',
    '',
    '--- AIMEAT material ---',
    ...explanation.filter(Boolean),
  ];
  if (terms.length) {
    lines.push('', 'Terms, from the AIMEAT glossary:');
    for (const t of terms) lines.push(`- ${t.term}: ${t.definition}`);
  }
  if (mine) lines.push('', `My own account right now: ${mine}`);
  lines.push(
    '--- end of material ---',
    '',
    `More material: ${origin}/v1/glossary.md (every term) and ${origin}/llms.txt (how AIMEAT works).`,
    'If you are connected to AIMEAT over MCP, call aimeat_handbook_get first and answer from my real data.',
    '',
    `Answer me in ${LANGUAGE[locale] || 'the language I write in'}, in plain words, one thing at a time. Start by asking what I want to know. After this topic I may ask about anything else in AIMEAT.`,
  );
  return lines.join('\n');
}
