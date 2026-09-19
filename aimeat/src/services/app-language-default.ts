/**
 * @file src/services/app-language-default.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a publish says about a NEW app that carries one language.
 *
 *   Two languages, English and Finnish, is the default on this node: every shell declares
 *   `aimeat-locales` "en fi", and the sign-in bar draws its language switch only when two are
 *   declared. On 2026-09-19 a builder talking Finnish with the developer declared `content="fi"`
 *   on its own, wrote every string in Finnish straight into the markup, and called a page with a
 *   Finnish bar over English library text done. Nobody had asked for one language.
 *
 *   A WARNING, on the FIRST publish only. One language is a legitimate choice and it is the
 *   owner's; an app that exists already made it long ago. An app that declares no languages at all
 *   is left to the artifact lint's app-meta-declarations finding.
 * @structure oneLanguageFindings(input) → AppArtifactFinding[]
 * @usage const hints = oneLanguageFindings({ isUpdate, html });
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AppArtifactFinding } from './app-artifact-lint.js';

const PITFALL = 'one-language';

export function oneLanguageFindings(input: { isUpdate: boolean; html: string }): AppArtifactFinding[] {
  if (input.isUpdate) return [];
  const declared = /<meta\b[^>]*name\s*=\s*["']aimeat-locales["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(input.html.slice(0, 8192))?.[1];
  if (declared === undefined) return [];
  const langs = declared.trim().split(/\s+/).filter(Boolean);
  if (langs.length !== 1) return [];
  return [{
    pitfall: PITFALL,
    severity: 'warn',
    message: `This new app declares one language ("${langs[0]}"). The default on this node is two, \`<meta name="aimeat-locales" content="en fi">\`, `
      + 'with every string the page shows read from a dictionary so the sign-in bar\'s switch can change it. One language is the owner\'s '
      + 'decision, not the builder\'s, and the language of the conversation does not make it. If the owner asked for one language, tell '
      + 'them that is what they got; if they did not, add the second one before you hand this over.',
    url: `/v1/appdev/pitfalls/${PITFALL}`,
  }];
}
