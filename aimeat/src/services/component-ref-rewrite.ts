/**
 * @file component-ref-rewrite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Rewrite the hardcoded cortex and extension names in an app's HTML or a cortex lib's
 *   JavaScript so they point at the names a package install registered them under. Used by
 *   component-registrar.ts for both kinds of content at install time.
 *
 *   An author's own cortex or extension installed since 2026-10-25 is named `<owner>/<name>`
 *   (services/component-address.ts), so the author's app loads it as `/v1/cortex/<owner>/<name>/libs/`
 *   or `/v1/cortex/<owner>%2F<name>/...`, calls `/v1/ext/<owner>%2F<name>/...` or
 *   `/v1/ext/<owner>/<name>/<action>`, and reads `ext:<owner>/<name>`. The package carries the short
 *   name from the manifest, so each pattern takes an optional owner part before it, and the whole
 *   reference becomes the registered name.
 * @structure rewriteComponentRefs(content, cortexMap, extMap)
 * @usage
 *   const html = rewriteComponentRefs(source, input.urlRewrites?.cortexNames, input.urlRewrites?.extensionNames);
 * @version-history
 *   v1.1.0 — 2026-10-25 — An optional `<owner>/` or `<owner>%2F` before the short name is rewritten
 *     with it, for names in the owner's namespace (secaudit2026oct22). Moved here from
 *     component-registrar.ts, which was at the 800-line limit.
 *   v1.0.0 — 2026-05-05 — Initial, in component-registrar.ts.
 */

/** An account name followed by the slash or its encoded form: the owner part of a namespaced name. */
const OWNER_PART = '(?:[a-z0-9][a-z0-9-]{0,62}[a-z0-9](?:\\/|%2[Ff]))?';

/**
 * Rewrite hardcoded short-name references in a content string so they point at the per-instance
 * registered component names.
 *
 * Patterns covered, each with an optional owner part before the short name:
 *   /v1/cortex/<shortName>/...   → /v1/cortex/<registeredAs>/...
 *   /v1/ext/<shortName>/...      → /v1/ext/<registeredAs>/...
 *   "ext:<shortName>" (literal)  → "ext:<registeredAs>"  (memory namespace strings)
 *   ext%3A<shortName>            → ext%3A<registeredAs>  (URL-encoded variant)
 */
export function rewriteComponentRefs(
  content: string,
  cortexMap: Map<string, string> | undefined,
  extMap: Map<string, string> | undefined,
): string {
  if (!content) return content;
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = content;
  if (cortexMap) {
    for (const [shortName, regAs] of cortexMap) {
      if (!shortName || shortName === regAs) continue;
      const esc = escapeRe(shortName);
      out = out.replace(
        new RegExp('(\\/v1\\/cortex\\/)' + OWNER_PART + esc + '(?=[\\/?#"\\\'\\s]|$)', 'g'),
        '$1' + regAs,
      );
    }
  }
  if (extMap) {
    for (const [shortName, regAs] of extMap) {
      if (!shortName || shortName === regAs) continue;
      const esc = escapeRe(shortName);
      // /v1/ext/<name>(/ or terminator)
      out = out.replace(
        new RegExp('(\\/v1\\/ext\\/)' + OWNER_PART + esc + '(?=[\\/?#"\\\'\\s]|$)', 'g'),
        '$1' + regAs,
      );
      // ext:<name> in memory-namespace strings, common in cortex libs:
      //   AIMEAT.data.getPublic('ext:comicland-v2', 'config.app')
      // Terminator is whatever closes the string / next segment.
      out = out.replace(
        new RegExp('(ext:)' + OWNER_PART + esc + '(?=[/"\\\'\\s,\\]}]|$)', 'g'),
        '$1' + regAs,
      );
      // URL-encoded variant for any place that already escapes the colon.
      out = out.replace(
        new RegExp('(ext%3A)' + OWNER_PART + esc + '(?=[%/"\\\'\\s,\\]}]|$)', 'gi'),
        '$1' + regAs,
      );
    }
  }
  return out;
}
