/**
 * @file src/services/app-build-level.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The level an Atelier app was built at, chosen by its owner before any code.
 *
 *   Ruled by the developer on 2026-09-19. Until then one rule stood: a page in the kit's default
 *   look is refused, always. It was right about what it stopped and wrong about who decides, and
 *   the slipping it was meant to end moved elsewhere: a builder asked for an app picked the
 *   cheapest result that published, and the owner found out by looking at it. So the level is the
 *   OWNER'S choice, asked first, and the page says which one it is:
 *
 *     <meta name="aimeat-level" content="proto | plain | fine">
 *
 *   proto  a quick prototype to try one thing: the kit's components as they come, two languages,
 *          no genre and no styling of its own.
 *   plain  an ordinary page that works: a layout and a look taken from the Design Book, following
 *          the person's theme. Nothing made by hand.
 *   fine   the finest: a genre forked, parts from the Design Book, components of its own where
 *          the Book has none, each written down with its reason (app-build-notes.ts); the Book
 *          hears of them when the owner is satisfied, never because a build ended. An app that states no
 *          level is held to this one, which is what every Atelier app was held to before.
 *
 *   ALL THREE ARE ATELIER, so raising the level is a change of look and never a rewrite: the data,
 *   the dictionary and the logic stay.
 *
 *   A publish WARNS ONLY WHEN THE RESULT IS BELOW THE LEVEL IT STATES. On `proto` and `plain` the
 *   register gate stands down (app-artifact-lint.ts checkRegister), and what is watched is the
 *   opposite drift: a page at those levels that carries a sheet of styles of its own has become
 *   hand-made work with none of what `fine` asks of hand-made work.
 * @structure levelFindings(html) · levelStep(html) · re-exports declaredLevel, registerIsOwed, BuildLevel
 * @usage const level = declaredLevel(html);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (wish-kolme-l-ht-tasoa-sovelluksen-rakentamiseen-nopea-proto-taval).
 */
import type { AppArtifactFinding } from './app-artifact-lint.js';
import { ownClassNames, OWN_PARTS_MIN } from './app-genre-fork.js';

import { declaredLevel } from './app-build-level-meta.js';

export { declaredLevel, registerIsOwed, type BuildLevel } from './app-build-level-meta.js';

const PITFALL = 'below-level';

export function levelFindings(html: string): AppArtifactFinding[] {
  const level = declaredLevel(html);
  if (level !== 'proto' && level !== 'plain') return [];
  const own = ownClassNames(html);
  if (own.length < OWN_PARTS_MIN) return [];
  const shown = own.slice(0, 6).map(n => '.' + n).join(', ');
  const name = level === 'proto' ? 'a quick prototype' : 'an ordinary page';
  return [{
    pitfall: PITFALL,
    severity: 'warn',
    message: `This app says it is ${name} (aimeat-level "${level}") and carries ${own.length} styles of its own (${shown}${own.length > 6 ? ', …' : ''}). `
      + (level === 'proto'
        ? 'A prototype uses the kit\'s components as they come, so that it is quick to make and quick to throw away. '
        : 'An ordinary page takes its layout and its look from the Design Book and makes nothing by hand. ')
      + 'Hand-made styling belongs to the level "fine", where it starts from a forked genre and what was made goes into the Design Book. '
      + 'Either take the styles out, or ask the owner whether the app has become the finest level, and if they say yes fork a genre, state "fine" and do that level\'s work.',
    url: `/v1/appdev/pitfalls/${PITFALL}`,
  }];
}

/** What the publish says back about the level, in words the builder can repeat to the owner. */
export function levelStep(html: string): string | undefined {
  const level = declaredLevel(html);
  if (level === 'proto') {
    return 'Published as a QUICK PROTOTYPE, the level the owner chose. Tell them that is what they are looking at: the kit as it comes, made to try the idea. '
      + 'Raising it later keeps the data, the dictionary and the logic: "plain" takes a layout and a look from the Design Book, "fine" forks a genre.';
  }
  if (level === 'plain') {
    return 'Published as an ORDINARY PAGE, the level the owner chose. Its layout and look come from the Design Book (`aimeat_designbook_search` given nothing lists all of it; `aimeat_designbook_adopt` takes one). '
      + 'Raising it to "fine" keeps the data, the dictionary and the logic and forks a genre for the look.';
  }
  return undefined;
}
