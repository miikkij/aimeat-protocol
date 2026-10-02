/**
 * @file src/services/settings-explain.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The setting explanations a page shows behind the question mark next to a setting
 *   (components/HelpTip.js, components/ExplainDialog.js), served in parts over MCP and REST so an
 *   AI answers "what does this setting do" with the same words, in the person's language.
 *
 *   SOURCE. Locale data under `explain.<term>.*` in locales/en.json, fi.json and es.json, read once
 *   at start through i18n.ts (resolveFlat), with the same fallback to English the page has. A term
 *   is every key path that has a `short`; its parts are title, short, what, range, low, high,
 *   lowLabel, highLabel, ex1 … ex6 and tip. The section words (`explain.range`, `explain.low`,
 *   `explain.high`, `explain.examples`, `explain.when`) come from each locale, as on the page.
 *
 *   PARTS. `start` lists the terms by area (the first segment of the term id) with the English
 *   title and short text; `<term>` is one explanation in full, in English, Finnish and Spanish.
 *   The same split as the feature map (services/feature-map.ts).
 * @structure settingsExplainPieceIds() · settingsExplainParts() · settingsExplainPiece(id)
 * @usage const piece = settingsExplainPiece('ai.temperature'); piece?.text
 * @version-history
 *   v1.1.0 — 2026-10-03 — The `concept` area (explain.concept.<id>.*: the system's own words in plain
 *     language) is listed first, and the start part's lead says what it is for.
 *   v1.0.0 — 2026-10-02 — Initial (wish "Ohjenappi ja vihjeteksti asetuksille").
 */
import { LOCALES, resolveFlat, type Locale } from '../i18n.js';

/** The language headings of a term's part, in each language's own name. */
const LANGUAGE_NAME: Record<Locale, string> = { en: 'English', fi: 'Suomi', es: 'Español' };

/**
 * Areas in the order the start part lists them; an area not named here follows in locale order.
 * `concept` comes first: the system's own words (organism, agent, morsel …) in plain language, which
 * an AI needs before any single setting makes sense to the person.
 */
const AREA_ORDER = ['concept', 'ai', 'decide', 'agent', 'crew', 'schedule', 'workflow', 'commerce', 'app', 'workspace',
    'organism', 'living', 'consent', 'classification', 'notify', 'memory', 'access', 'federation', 'sso', 'config'];

const EXAMPLE_PARTS = ['ex1', 'ex2', 'ex3', 'ex4', 'ex5', 'ex6'];

/** explain.* per locale, as flat keys ("explain.ai.temperature.title"), read once at start. */
const EXPLAIN: Record<Locale, Record<string, string>> = Object.fromEntries(
    LOCALES.map(l => [l, resolveFlat(l, 'explain')]),
) as Record<Locale, Record<string, string>>;

/** Every term id in en.json order: the key paths that carry a `short`. */
const TERMS: string[] = Object.keys(EXPLAIN.en)
    .filter(k => k.endsWith('.short'))
    .map(k => k.slice('explain.'.length, -'.short'.length));

const TERM_SET = new Set(TERMS);

const areaOf = (term: string) => term.split('.')[0];

function part(locale: Locale, term: string, name: string): string {
    return EXPLAIN[locale][`explain.${term}.${name}`] ?? '';
}

function word(locale: Locale, name: string): string {
    return EXPLAIN[locale][`explain.${name}`] ?? EXPLAIN.en[`explain.${name}`] ?? name;
}

export function settingsExplainPieceIds(): string[] {
    return ['start', ...TERMS];
}

function areasInOrder(): string[] {
    const seen = [...new Set(TERMS.map(areaOf))];
    return [...AREA_ORDER.filter(a => seen.includes(a)), ...seen.filter(a => !AREA_ORDER.includes(a))];
}

function startText(): string {
    const sections = areasInOrder().flatMap(area => [
        '',
        `## ${area}`,
        ...TERMS.filter(t => areaOf(t) === area).map(t =>
            `- \`settings/${t}\` **${part('en', t, 'title') || t}**: ${part('en', t, 'short')}`),
    ]);
    const concepts = TERMS.filter(t => areaOf(t) === 'concept').length;
    return [
        `# What a word or a setting means (${concepts} concepts, ${TERMS.length - concepts} settings)`,
        '',
        'The `concept` area comes first: the words this system uses (shared place or organism, workspace, agent, memory, morsel, connecting your AI, permission, package, app, AI provider, knowledge), each explained in plain words for a person who is not technical. Read one before you use the word with the person, or when they ask what it is. Use these words and these meanings, in their language, so that you and the pages say the same thing.',
        'The other areas are the explanations a page shows behind the question mark next to a setting. Read one when the person asks what a setting means or which value to pick.',
        'Ask for one with aimeat_handbook_get { tier: "settings/<term>" }, for example "settings/concept.organism": it holds the full explanation in English, Finnish and Spanish. Answer in the person\'s language with the matching section. Do not recite this list.',
        ...sections,
    ].join('\n');
}

/** One language's explanation, laid out as the dialog lays it out. */
function languageText(locale: Locale, term: string): string {
    const p = (name: string) => part(locale, term, name);
    const lines = [`## ${LANGUAGE_NAME[locale]}`, '', `**${p('title') || term}.** ${p('short')}`];
    if (p('what')) lines.push('', p('what'));
    const facts = [
        p('range') ? `- **${word(locale, 'range')}**: ${p('range')}` : '',
        p('low') ? `- **${p('lowLabel') || word(locale, 'low')}**: ${p('low')}` : '',
        p('high') ? `- **${p('highLabel') || word(locale, 'high')}**: ${p('high')}` : '',
    ].filter(Boolean);
    if (facts.length) lines.push('', ...facts);
    const examples = EXAMPLE_PARTS.map(p).filter(Boolean);
    if (examples.length) lines.push('', `**${word(locale, 'examples')}**`, '', ...examples.map(e => `- ${e}`));
    if (p('tip')) lines.push('', `**${word(locale, 'when')}**: ${p('tip')}`);
    return lines.join('\n');
}

function termText(term: string): string {
    return [
        `# ${part('en', term, 'title') || term} (\`${term}\`)`,
        '',
        'The same explanation in three languages. Answer in the person\'s language with the matching section.',
        '',
        LOCALES.map(l => languageText(l, term)).join('\n\n'),
    ].join('\n');
}

/** One part by id: `start` (the terms by area), or a term id. Null for an id the locales do not have. */
export function settingsExplainPiece(id: string): { id: string; text: string } | null {
    if (id === 'start') return { id, text: startText() };
    return TERM_SET.has(id) ? { id, text: termText(id) } : null;
}

/** The parts with their size, for the listing route. */
export function settingsExplainParts(): Array<{ id: string; what: string; chars: number }> {
    return settingsExplainPieceIds().map(id => ({
        id,
        what: id === 'start' ? 'The concepts in plain words, then the settings by area, with their part ids' : (part('en', id, 'title') || id),
        chars: settingsExplainPiece(id)?.text.length ?? 0,
    }));
}
