/**
 * @file src/services/app-decide-posture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish-time check for an app that uses the decision model (TARGET-080,
 *   AIMEAT.decide). It reads the app's own source and names, in words the AI that built the app can
 *   act on in the same session, where the app departs from the rules the platform gives for TypeSafe.
 *
 *   WHOSE RESPONSIBILITY. What an app sends is the app's responsibility (Jouni, 2026-09-19). The node
 *   removes the personal data it can recognise, and it does not try to control how an app uses the
 *   model beyond that: it states the rules when the app is built (the aimeat-decide aiDoc, the
 *   typesafe-jev skill, the appdev pitfall) and checks here that the app followed them.
 *
 *   IT WARNS, IT NEVER BLOCKS, for the reason app-ai-posture.ts gives (decision D2): a refusal gets
 *   worked around, a warning that names the fix gets the fix. The hints ride the same `ai_hints`
 *   field every publish door already returns.
 *
 *   WHAT IT LOOKS FOR, each from the source text alone:
 *   - the app calls TypeSafe itself (its address, or a TypeSafe key in the page): a key in a
 *     published app is a key given to everyone who opens it;
 *   - the app uses the decision model without the `ai:use` scope, so every call will be refused;
 *   - questions written in another language than English (Finnish letters or common Finnish words
 *     inside a question builder's text);
 *   - the app never passes `names` or narrows a run with `fields`, so the only personal data
 *     removed is what the node already knows: a reminder, because the app knows its own people.
 *   The data map rule (TypeSafe named in `leaves`) is not checked here: the node refuses at the first
 *   call with DATAMAP_REQUIRED, which names the fix.
 * @structure appUsesDecide(html) · lintAppDecideUse(html, scopes) → string[]
 * @usage const hints = lintAppDecideUse(html, parseAppScopes(html)); // [] when the app does not use it
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
// No import of protected-resource.ts: its import chain closes a cycle back through the app types.
// The caller already parses the app's scopes and passes them in.

const USES_DECIDE = /aimeat-decide\.js|\/v1\/ai\/decide\b|AIMEAT\s*\.\s*decide\b/;
const DIRECT_TYPESAFE = /api\.typesafe\.ai|\bTYPESAFE_API_KEY\b|["'`]Bearer\s+ts[_-]/i;
/** The text inside a question builder: yesNo("…"), pickOne('…', …), scale(`…`, …), or instructions: "…". */
const QUESTION_TEXT = /(?:yesNo|pickOne|scale)\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1|instructions\s*:\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3/g;
/** Finnish letters, or a handful of words that do not occur in English questions. */
const NOT_ENGLISH = /[äöåÄÖÅ]|\b(onko|mikä|mitä|kuinka|viesti|asiakas|lähettäjä|kysyy|pyytää)\b/i;

export function appUsesDecide(html: string): boolean {
  return USES_DECIDE.test(html);
}

/**
 * The hints for one app's source. Empty when the app does not use the decision model.
 * `scopes` are the scopes the app requests (parseAppScopes in protected-resource.ts).
 */
export function lintAppDecideUse(html: string, scopes: string[]): string[] {
  if (!appUsesDecide(html) && !DIRECT_TYPESAFE.test(html)) return [];
  const hints: string[] = [];

  if (DIRECT_TYPESAFE.test(html)) {
    hints.push(
      'DECIDE: this app appears to call TypeSafe directly or to carry a TypeSafe key. A published app '
      + 'is served to everyone who opens it, so a key in it is a key given away, and a direct call skips '
      + 'the personal-data removal, the budget and the decision record. Call the node instead: load '
      + '`/v1/libs/aimeat-decide.js` and use `AIMEAT.decide.ask(state, questions, { subject, gates, thresholds, app_id })`. '
      + 'Remove the key from the source and revoke it at TypeSafe.',
    );
  }

  if (appUsesDecide(html) && !scopes.includes('ai:use')) {
    hints.push(
      'DECIDE: this app uses the decision model but does not request the `ai:use` scope, so every call '
      + 'will be refused. Add `ai:use` to the scopes the app asks for.',
    );
  }

  const nonEnglish: string[] = [];
  for (const m of html.matchAll(QUESTION_TEXT)) {
    const text = m[2] ?? m[4] ?? '';
    if (NOT_ENGLISH.test(text)) nonEnglish.push(text.length > 60 ? `${text.slice(0, 57)}...` : text);
  }
  if (nonEnglish.length) {
    hints.push(
      `DECIDE: ${nonEnglish.length} question${nonEnglish.length === 1 ? '' : 's'} for the decision model `
      + `${nonEnglish.length === 1 ? 'is' : 'are'} not written in English (for example "${nonEnglish[0]}"). `
      + 'The model is trained on English first and judges other languages less well. Write every '
      + 'instruction and option in English, whatever language the content is in; a multilingual app '
      + 'translates what it authors before it asks.',
    );
  }

  if (appUsesDecide(html) && !/\bnames\s*:/.test(html) && !/\bfields\s*:/.test(html)) {
    hints.push(
      'DECIDE: what this app sends to the decision model is its own responsibility. The node removes '
      + 'e-mails, phones, identity codes, IBANs, street addresses and the names of the owner\'s contacts, '
      + 'but it does not know the people inside this app\'s data. Send only the fields each question '
      + 'needs (a smaller state is also more accurate), and pass the people the record mentions as '
      + '`names: [...]` in the ask options so they are removed too. The owner reads what was decided, '
      + 'and how much was removed each time, in AI settings.',
    );
  }

  return hints;
}
