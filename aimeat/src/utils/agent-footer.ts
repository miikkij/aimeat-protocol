/**
 * @file agent-footer.ts
 * @description Appends the node's agent-facing link block to a served HTML page: glossary, site
 *   map, llms.txt, AGENTS.md and the API contract.
 *
 *   These links have to be in the STATIC markup. Anything that reads a page without running
 *   JavaScript — a crawler, an agent-readability scanner, a web_fetch tool — never sees a
 *   Preact-rendered nav, so a page whose only navigation is client-side offers such a reader no
 *   route onward at all. The glossary link in particular is what lets an agent resolve a term it
 *   does not recognise instead of guessing, and guessing between GHII, GAII and GEAI is quiet
 *   rather than loud.
 *
 * @structure
 *   - agentFooterHtml(baseUrl) — the markup
 *   - injectAgentFooter(html, baseUrl) — append it before </body>, idempotent
 * @usage
 *   html = injectAgentFooter(html, config.baseUrl);
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phases 06 + 08)
 */

const MARK = 'class="agent-footer"';

/** The link block. Absolute URLs so it survives being read off a mirrored or proxied copy. */
export function agentFooterHtml(baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, '');
  const links: Array<[string, string]> = [
    [`${b}/v1/glossary`, 'Glossary'],
    [`${b}/sitemap.md`, 'Site map'],
    [`${b}/llms.txt`, 'llms.txt'],
    [`${b}/llms-full.txt`, 'llms-full.txt'],
    [`${b}/AGENTS.md`, 'AGENTS.md'],
    [`${b}/v1/spec`, 'API contract'],
  ];
  return `<footer ${MARK}>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</footer>`;
}

/**
 * Append the block before `</body>`. Returns the input unchanged when the document already carries
 * one (spa.html has it in source) or when the payload is not an HTML document — a served page can
 * pass through this more than once.
 */
export function injectAgentFooter(html: string, baseUrl: string): string {
  if (html.includes(MARK)) return html;
  if (!/<\/body\s*>/i.test(html)) return html;
  return html.replace(/<\/body\s*>/i, `${agentFooterHtml(baseUrl)}</body>`);
}
