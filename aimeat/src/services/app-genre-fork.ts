/**
 * @file src/services/app-genre-fork.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an app that NAMES a genre was forked from it.
 *
 *   `<meta name="aimeat-register" content="genre-nightradio">` is a line anybody can type. On
 *   2026-09-19 a builder typed it over a page made of the default look with a hero, forms and
 *   cards stacked in it, said afterwards that it had taken "the scale and a few ideas of
 *   composition" from the genre, and the publish had nothing to say: the register gate asks that
 *   a register is NAMED, and it was.
 *
 *   A genre is a page with its own stylesheet, and a fork keeps it: the words change and the
 *   physics stay. So the measure is how many of the genre's OWN class names are still in the app.
 *   Measured on real pages before the threshold was chosen (the unit test carries the numbers):
 *   three cold-agent forks of genre-receipt kept most of them, and a page built from kit
 *   components keeps none, because the kit's classes are `ak-` and the genres' are their own.
 *
 *   A WARNING. A fork may be reworked a long way, and the threshold is low on purpose: it is there
 *   for the page that kept nothing, not for the one that kept half.
 * @structure genreKeptShare(html, genreId) · genreForkFindings(html)
 * @usage const hints = genreForkFindings(html);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { GENRE_BODIES } from '../data/app-templates/genres.js';
import type { AppArtifactFinding } from './app-artifact-lint.js';

const PITFALL = 'genre-not-forked';
/** Below this share of the genre's own class names, the page is not a fork of it. */
export const GENRE_KEPT_MIN = 0.2;

/** The class names a genre's own stylesheet defines, without the kit's (`ak-`) and the shared utilities. */
export function genreClassNames(genreId: string): string[] {
  const body = (GENRE_BODIES as Record<string, string>)[genreId];
  if (!body) return [];
  const styles = [...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const names = new Set<string>();
  for (const m of styles.matchAll(/\.([a-zA-Z][\w-]{2,})/g)) {
    if (!m[1].startsWith('ak-')) names.add(m[1]);
  }
  return [...names];
}

/** The share of the genre's own class names the app still carries, or null when the genre is unknown. */
export function genreKeptShare(html: string, genreId: string): number | null {
  const names = genreClassNames(genreId);
  if (names.length < 8) return null;
  const kept = names.filter(n => new RegExp(`[\\s"'.]${n.replace(/[-]/g, '\\-')}[\\s"'{,:.>]`).test(html)).length;
  return kept / names.length;
}

export function genreForkFindings(html: string): AppArtifactFinding[] {
  const register = /<meta\b[^>]*name\s*=\s*["']aimeat-register["'][^>]*content\s*=\s*["']genre-([a-z0-9-]+)["']/i.exec(html.slice(0, 8192))?.[1];
  if (!register) return [];
  const share = genreKeptShare(html, register);
  if (share === null || share >= GENRE_KEPT_MIN) return [];
  return [{
    pitfall: PITFALL,
    severity: 'warn',
    message: `The head names genre-${register}, and the page carries ${Math.round(share * 100)} % of that genre's own styles, so it was not forked from it: `
      + 'a genre\'s name over a look preset with components stacked in it is the default page every app looks like. Fork the genre '
      + `(\`aimeat_app_template_get { id: "genre-${register}" }\`), keep its composition, its type and its physics, and change the words, `
      + 'the sources and the images. If this page has a look of its own, say so instead: `content="custom:<name>"`. Then put it beside '
      + 'the genre at 390 and 1440 px and ask whether it holds up.',
    url: `/v1/appdev/pitfalls/${PITFALL}`,
  }];
}
