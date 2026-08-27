/**
 * @file ai-tool-setup.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fetches the per-tool setup table from the node, and shares that one read with every
 *   surface on the page that needs it. The table itself lives in src/services/ai-tool-setup.ts,
 *   because the other consumer cannot import from here: the Experience Center is a standalone
 *   published app on its own origin. Two copies would drift, and drifting setup instructions are
 *   worse than none — the reader follows them, fails, and concludes the product is broken rather
 *   than the page stale.
 *
 *   THE CACHE IS HERE RATHER THAN IN EACH CALLER because three of them can be on screen at once:
 *   the setup guide, the Hello MCP panel and the install shortcuts. Three copies of one request is
 *   not ownership, and the answer is per language, not per component.
 *
 *   Strings arrive already localized and URLs already resolved against the serving node, so a
 *   self-hosted node shows its own address. No offline fallback: this module is served BY the
 *   node, so if the node cannot answer, nothing on this page would render anyway.
 * @structure fetchAiTools(lang?) · useAiTools()
 * @usage import { useAiTools } from '/views/profile/ai-tool-setup.js';
 * @version-history
 *   v2.1.0 — 2026-08-27 — useAiTools(): the shared, language-keyed read, moved here out of
 *     ai-setup-guide.js so the install shortcuts can use it without a second cache.
 *   v2.0.0 — 2026-07-31 — Table moved to the node (GET /v1/ai-tools); this is now the fetcher.
 *   v1.0.0 — 2026-07-31 — Initial, as an in-SPA table.
 */
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { getLocale } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

/**
 * @returns {Promise<Array<{id: string, label: string, mcp: object, instructions: object}>>}
 */
export async function fetchAiTools(lang) {
  const r = await apiGet(`/v1/ai-tools?lang=${encodeURIComponent(lang || getLocale())}`);
  return (r && r.data && r.data.tools) || [];
}

/** lang → the promise of that language's table. A failed read resolves to [], never rejects. */
const cache = new Map();
function loadTools(lang) {
  if (!cache.has(lang)) {
    cache.set(lang, fetchAiTools(lang).catch((err) => { swallowed('ai-tools', err); return []; }));
  }
  return cache.get(lang);
}

/**
 * The table for the current language. `null` while it is still coming: every caller renders nothing
 * until it arrives, because there is no local copy to fall back to.
 * @returns {Array|null}
 */
export function useAiTools() {
  const [tools, setTools] = useState(null);
  const [lang, setLang] = useState(getLocale());

  useEffect(() => {
    const onLang = () => setLang(getLocale());
    window.addEventListener('lang-change', onLang);
    return () => window.removeEventListener('lang-change', onLang);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadTools(lang).then((list) => { if (!cancelled) setTools(list); });
    return () => { cancelled = true; };
  }, [lang]);

  return tools;
}
