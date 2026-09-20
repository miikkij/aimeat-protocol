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
 *   v1.1.0 — 2026-09-20 — designBookStep asks for the REASON now (the `made` list of the page's
 *     build notes) and no longer for a proposal. Ruled the same day: a finished build is not the
 *     moment anything goes into the Book, because an app is often rebuilt before anybody likes it.
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

/** A dot followed by one of these is a file name inside `url(...)`, not a class. */
const NOT_A_CLASS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'woff', 'woff2', 'ttf', 'css', 'html', 'com', 'org', 'w3']);

/**
 * From this many styles of its own, an app has made something that could be a part. Measured on
 * 2026-09-19: two live apps that built real things of their own carried 35 and 43, and a small tip
 * calculator forked from a genre carried 11, all of them names like `line`, `bill` and `cur`.
 */
export const OWN_PARTS_MIN = 20;

/**
 * The class names the app's own stylesheets define that are neither the kit's (`ak-`) nor the
 * genre's it forked: what this app MADE. A register of its own (`custom:<name>`) has no genre to
 * subtract, so everything but the kit counts.
 */
export function ownClassNames(html: string): string[] {
  const register = /<meta\b[^>]*name\s*=\s*["']aimeat-register["'][^>]*content\s*=\s*["']genre-([a-z0-9-]+)["']/i.exec(html.slice(0, 8192))?.[1];
  const genre = new Set(register ? genreClassNames(register) : []);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const own = new Set<string>();
  for (const m of styles.matchAll(/\.([a-zA-Z][\w-]{2,})/g)) {
    const name = m[1];
    if (name.startsWith('ak-') || name.startsWith('aimeat-') || genre.has(name) || NOT_A_CLASS.has(name.toLowerCase())) continue;
    own.add(name);
  }
  return [...own];
}

/**
 * What the publish says to a builder whose app carries enough of its own to be a part. The Design
 * Book held 90 parts on 2026-09-19 and none had come from a builder: every app that needed
 * something custom made it again. The moment to propose a part is the moment it was made, by
 * whoever still knows how it works, and the publish response is the one text a builder is measured
 * to act on.
 */
export function designBookStep(html: string): string | undefined {
  const own = ownClassNames(html);
  if (own.length < OWN_PARTS_MIN) return undefined;
  const shown = own.slice(0, 6).map(n => '.' + n).join(', ');
  return `This app carries ${own.length} styles of its own beyond the kit and the genre it forked (${shown}${own.length > 6 ? ', …' : ''}). `
    + 'WRITE DOWN WHY, NOW, while you know: for each thing you made by hand, one row in the page\'s build notes '
    + '(<script type="application/json" id="aimeat-build-notes">, list `made`: { "name", "what", "why" }, where `why` is why the Design Book had nothing for it), '
    + 'and publish again so the node keeps it with this version. DO NOT PROPOSE IT TO THE BOOK BECAUSE THE BUILD IS FINISHED: a finished build is often thrown away and rebuilt, '
    + 'and only an app its owner is satisfied with should teach the Book anything. Tell the owner in one line that when they are happy with the app they can say so, '
    + 'and that is when what was made here is offered to the next builder (`aimeat_designbook_keep`).';
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
