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
 *
 *   "Explain this page to me" (buildPagePrompt, PageStart): the same material for one whole page,
 *   and who the person is. Their role and how technical they are come from their own memory record
 *   `profile.explain` ({ role, level }), which their AI writes when they tell it; when there is none,
 *   the prompt asks the AI to ask them first and, if it is connected, to offer to keep the answer.
 * @structure buildAskPrompt({ subject, explanation, terms, mine, language, base }) ·
 *   buildPagePrompt({ title, explanation, about, concept, locale, base }) · aboutLine(about) ·
 *   EXPLAIN_PROFILE_KEY · EXPLAIN_LEVELS
 * @usage const prompt = buildAskPrompt({ subject: 'Offerings', explanation, terms, mine, language: 'Finnish', base: location.origin });
 * @version-history
 *   v1.1.0 — 2026-11-09 — buildPagePrompt: "Explain this page to me", with the person's role from
 *     their memory record profile.explain (guidance audit 2026-11-09; wish-every-page-explains-itself-
 *     through-the-person-s-own-ai-at-th). buildAskPrompt is unchanged.
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

/** The memory record that says who the person is when a page is explained to them. */
export const EXPLAIN_PROFILE_KEY = 'profile.explain';

/** The three levels, and what each one asks of the AI. */
export const EXPLAIN_LEVELS = {
  new: 'I am new to this. Explain without technical words.',
  daily: 'I use it in my work, but I am not technical.',
  technical: 'I am technical. Use the industry terms.',
};

/**
 * The "About me" line: the person's role and level from their record, or, without one, the
 * instruction to ask them first and to offer to keep the answer.
 * @param {{ role?: string, level?: string } | null | undefined} about
 * @returns {string}
 */
export function aboutLine(about) {
  const role = typeof about?.role === 'string' ? about.role.trim().slice(0, 300) : '';
  const level = about?.level && EXPLAIN_LEVELS[about.level] ? EXPLAIN_LEVELS[about.level] : '';
  if (role || level) return `About me: ${role ? `my role is ${role}.` : ''}${role && level ? ' ' : ''}${level}`;
  return [
    'About me: I have not told AIMEAT my role yet. Before you explain, ask me what my work is and how technical I am.',
    `If you are connected to my AIMEAT over MCP, offer to remember my answer: a memory record with the key ${EXPLAIN_PROFILE_KEY}, visibility "owner" (so that my other AIs can read it too), and the value { "role": "<my role in my words>", "level": "new" | "daily" | "technical" }. Write it only when I say yes.`,
  ].join('\n');
}

/**
 * "Explain this page to me": a prompt the person copies into their own AI, whichever company makes
 * it, connected to AIMEAT or not. It carries the page's own explanation, so an AI with no
 * connection answers from AIMEAT's words; a connected one is told where to read more.
 * @param {{ title: string, explanation: string[], about?: { role?: string, level?: string } | null,
 *   concept?: string, locale?: string, base: string }} a
 *   `explanation` is the page's own words in the page's language (purpose, what follows, the
 *   concept's explanation and examples); `concept` is the page's `concept.<thing>` term, if any.
 */
export function buildPagePrompt({ title, explanation, about, concept, locale, base }) {
  const origin = String(base || '').replace(/\/+$/, '');
  const handbook = concept
    ? `call aimeat_handbook_get with tier "places" to see where this page is and what is on it, and with tier "settings/${concept}" for its full explanation`
    : 'call aimeat_handbook_get with tier "places" (or "places/admin" for an admin page) to see where this page is and what is on it';
  return [
    `I use AIMEAT (${origin}): a place where my own AI agents, apps and shared knowledge live, and which I own. I have its page "${title}" open, and I want to understand it.`,
    '',
    aboutLine(about),
    '',
    'Below is what AIMEAT itself says about this page. Treat it as the source of truth. When it does not cover my question, say so and point me to the links below instead of filling the gap yourself.',
    '',
    '--- AIMEAT material ---',
    ...explanation.filter(Boolean),
    '--- end of material ---',
    '',
    `More material: ${origin}/v1/glossary.md (every term) and ${origin}/llms.txt (how AIMEAT works).`,
    `If you are connected to AIMEAT over MCP, ${handbook}, and answer from my real data. Change nothing while you explain.`,
    '',
    `Explain this page for my role and at my level, in ${LANGUAGE[locale] || 'the language I write in'}, in plain words, one thing at a time. Start by asking what I want to do here.`,
  ].join('\n');
}
