/**
 * @file app-decide-posture.test.ts
 * @description The publish-time hints for an app that uses the decision model (TARGET-080). The app
 *   is responsible for what it sends; these check it followed the rules the platform gave it, and
 *   they only ever warn.
 * @usage cd aimeat && pnpm vitest run test/unit/app-decide-posture.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-19 — A living document's decide node, written as JSON fields.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { lintAppDecideUse as lintWithScopes, appUsesDecide } from '../../src/services/app-decide-posture.js';
import { lintAppAiDisclosure } from '../../src/services/app-ai-posture.js';
import { parseAppScopes } from '../../src/services/protected-resource.js';

/** As the publish path calls it: the scopes read from the same source. */
const lintAppDecideUse = (html: string) => lintWithScopes(html, parseAppScopes(html));

const HEAD = '<meta name="aimeat-scopes" content="ai:use memory:read">';
const LIB = '<script src="/v1/libs/aimeat-decide.js"></script>';

describe('lintAppDecideUse', () => {
  it('says nothing about an app that does not use the decision model', () => {
    expect(lintAppDecideUse('<html><body><script src="/v1/libs/aimeat-ai.js"></script></body></html>')).toEqual([]);
    expect(appUsesDecide('<p>decide what to eat</p>')).toBe(false);
  });

  it('a well-built app gets no hint at all', () => {
    const html = `${HEAD}${LIB}<script>
      AIMEAT.decide.ask({ text: row.body }, { urgent: AIMEAT.decide.yesNo('The sender needs an answer today.') },
        { subject: row.key, names: [row.contactName], app_id: 'inbox' });</script>`;
    expect(lintAppDecideUse(html)).toEqual([]);
  });

  it('names a direct call to TypeSafe or a key in the page', () => {
    const direct = lintAppDecideUse(`<script>fetch("https://api.typesafe.ai/v1/systemone", { headers: { Authorization: "Bearer ts_live_abc" } })</script>`);
    expect(direct.some(h => h.includes('call TypeSafe directly'))).toBe(true);
  });

  it('says the calls will be refused without the ai:use scope', () => {
    const hints = lintAppDecideUse(`${LIB}<script>AIMEAT.decide.ask(s, q, { names: [] })</script>`);
    expect(hints.some(h => h.includes('`ai:use`'))).toBe(true);
  });

  it('flags questions that are not written in English, quoting one', () => {
    const hints = lintAppDecideUse(`${HEAD}${LIB}<script>
      const q = { urgent: AIMEAT.decide.yesNo('Onko viestissä kiireellinen pyyntö?'),
                  topic: { type: 'choice', instructions: 'What is the message about?', criteria: {} } };
      AIMEAT.decide.ask(s, q, { names: [] });</script>`);
    const h = hints.find(x => x.includes('not written in English'));
    expect(h).toBeDefined();
    expect(h).toContain('1 question for the decision model is');
    expect(h).toContain('Onko viestissä');
  });

  it('reminds the app that the people in its own data are its responsibility', () => {
    const hints = lintAppDecideUse(`${HEAD}${LIB}<script>AIMEAT.decide.ask(record, q, { app_id: 'crm' })</script>`);
    expect(hints.some(h => h.includes('its own responsibility') && h.includes('names: [...]'))).toBe(true);
  });

  it('reads a living document\'s decide node, whose questions and names are JSON fields', () => {
    const finnish = lintAppDecideUse(`${HEAD}${LIB}<script>var STARTERS = { tuki: { model: { nodes: { triage: {
      "type": "decide", "names": ["customer"], "questions": { "angry": { "yesNo": "Onko asiakas vihainen?" } } } } } } };</script>`);
    expect(finnish.some(h => h.includes('not written in English') && h.includes('Onko asiakas'))).toBe(true);
    expect(finnish.some(h => h.includes('its own responsibility'))).toBe(false);
    const english = lintAppDecideUse(`${HEAD}${LIB}<script>var S = { "names": ["customer"],
      "questions": { "next": { "pickOne": "Which step does this message call for?", "options": {} } } };</script>`);
    expect(english).toEqual([]);
  });

  it('reaches every publish door through the AI posture check', () => {
    const { hints } = lintAppAiDisclosure(`${LIB}<script>AIMEAT.decide.ask(s, q, {})</script>`);
    expect(hints.some(h => h.startsWith('DECIDE:'))).toBe(true);
  });
});
