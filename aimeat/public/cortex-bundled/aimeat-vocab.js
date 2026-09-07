/**
 * @file aimeat-vocab.js
 * @description Bundled cortex library: an app's door to a real vocabulary. Reaches the
 *   `vocab-finto` extension, which reaches Finto — the National Library of Finland's vocabulary
 *   service, and through it YSO, some 30 000 concepts in Finnish, Swedish and English under
 *   CC BY 4.0.
 *
 *   WHY THIS LAYER EXISTS. An app may only ask for the scopes in the node's app-grant vocabulary
 *   and there is no `ext:` word in it. Reaching an extension is cortex's job: the app trusts
 *   cortex, cortex trusts the extension, and no layer skips the one below. A browser also cannot
 *   call api.finto.fi at all — the node's content policy stops the page — so the call has to be
 *   made server-side whatever the layering said.
 *
 *   THIS IS THE OUTSIDE. `AIMEAT.onto` is the vocabulary the owner KEEPS, in their own memory;
 *   this is where a concept comes from before anybody has kept it. The flow is search outside,
 *   let the person choose, save inside with `AIMEAT.onto.saveVocab` — and after that the app reads
 *   the owner's own record and never calls Finto again. That is what makes it keep working when the
 *   service is down, and what makes the vocabulary theirs rather than borrowed.
 *
 *   A REFUSAL IS AN ANSWER, NOT AN EXCEPTION TO SWALLOW. The extension answers `{ error: { code,
 *   message } }` for anything it will not do, and that arrives here as a thrown Error carrying both,
 *   so an app can show the person what to change instead of "something went wrong".
 * @structure AIMEAT.vocab.{search,concept,scheme,available}
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: search, concept, scheme.
 */
(function (AIMEAT) {
  'use strict';

  var ACTION = '/v1/ext/vocab-finto/';

  function session() {
    var auth = AIMEAT && AIMEAT.auth;
    if (!auth) throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-vocab.js');
    var s = auth.getSession();
    if (!s) throw new Error('Sign in first: looking a concept up runs on this node, as you.');
    return s;
  }

  /** POST one extension action and unwrap it. A refusal comes back as a throw carrying its code. */
  function call(action, body) {
    var s;
    try { s = session(); } catch (e) { return Promise.reject(e); }
    // session.fetch RESOLVES TO THE PARSED ENVELOPE, not to a Response. Calling .json() on it is
    // the mistake that looks right and throws from inside a library, a frame away from the button
    // the person pressed.
    return s.fetch(ACTION + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (envelope) {
      var out = (envelope && envelope.data) ? envelope.data : envelope;
      if (out && typeof out === 'object' && 'result' in out) out = out.result;
      if (out && out.error) {
        var err = new Error(out.error.message || 'The vocabulary lookup was refused.');
        err.code = out.error.code;
        throw err;
      }
      return out;
    });
  }

  /**
   * Find concepts whose label matches a word.
   * @param {string} query
   * @param {{ lang?: string, vocab?: string, limit?: number }} [opts]
   */
  function search(query, opts) {
    var o = opts || {};
    return call('search', { query: query, lang: o.lang, vocab: o.vocab, limit: o.limit });
  }

  /**
   * Read one concept in full: its labels, the words that also mean it, and what sits above and
   * below it. Use it when the person needs to see the neighbourhood before choosing.
   * @param {string} uri
   * @param {{ langs?: string[], vocab?: string }} [opts]
   */
  function concept(uri, opts) {
    var o = opts || {};
    return call('concept', { uri: uri, langs: o.langs, vocab: o.vocab });
  }

  /**
   * Turn the concepts a person picked into a scheme they can save as their own.
   *
   * Hand the result straight to `AIMEAT.onto.saveVocab(id, scheme)`. Each concept keeps
   * `skos:exactMatch` pointing back at the one in YSO, and the scheme carries the CC BY credit the
   * licence asks for. Leave both in the record.
   *
   * @param {string[]} uris
   * @param {{ id: string, label?: Record<string,string>, langs?: string[], vocab?: string }} opts
   */
  function scheme(uris, opts) {
    var o = opts || {};
    return call('scheme', { uris: uris, id: o.id, label: o.label, langs: o.langs, vocab: o.vocab });
  }

  /** Is there a session at all? Cheap enough to call before rendering a search box. */
  function available() {
    try { session(); return true; } catch (e) { return false; }
  }

  var exports = { search: search, concept: concept, scheme: scheme, available: available };

  if (AIMEAT.register) AIMEAT.register('aimeat-vocab', exports);
  if (!AIMEAT.vocab) AIMEAT.vocab = exports;

})(window.AIMEAT || (window.AIMEAT = {}));
