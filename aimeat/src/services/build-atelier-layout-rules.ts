/**
 * @file src/services/build-atelier-layout-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The layout rules for a settings page and a work-queue page, as the paragraph the
 *   Atelier specification carries after "COMPOSE, do not pile". Its own file because
 *   build-atelier-prompt.ts is at the line ceiling.
 *
 *   WHY. The kit's form fills the width of its container and groups nothing, and the page itself
 *   defaults to the full width of the screen (--ak-main-max: 100%). On a 2600 px screen an app built
 *   by the book showed every field as a line across the room, with no grouping, and its owner
 *   called it ugly, impractical and confusing (Postinjalostamo, 2026-09-28). The rules are from
 *   NN/g, Baymard, GOV.UK, Shopify Polaris, Material 3 and IBM Carbon, researched the same day; the
 *   Design Book part component-settings-group is the same rules as markup.
 * @structure atelierLayoutRules()
 * @usage body += atelierLayoutRules();
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */

/** The paragraph, ending in a blank line like every other paragraph of the specification. */
export function atelierLayoutRules(): string {
  return 'A SETTINGS PAGE AND A QUEUE PAGE HAVE RULES, and a wide screen is where they break. The '
    + 'kit\'s form fills its container and the page is as wide as the screen, so on a desktop every '
    + 'field becomes a line across the room. Twelve rules, each from a design system or a usability '
    + 'study: (1) no input fills a wide page: about 10ch for a number, 18ch for a date, 30ch for a '
    + 'name or email, at most 32rem for a URL or a line of text, full width only below 600 px; '
    + '(2) the column of controls is at most 42rem and help text at most 60ch per line; (3) one '
    + 'column, the label above its field, and only short related fields share a row; (4) every group '
    + 'of settings has a heading and ONE sentence of help, and no field stands outside a group; '
    + '(5) from 840 px the help sits in a left third beside the controls (the grid a mosaic uses: '
    + '`main` + `side` spans, or the Design Book part component-settings-group), below that above '
    + 'them; (6) the page stops at about 80rem on a large screen: set `--ak-main-max`; (7) advanced '
    + 'settings go behind ONE closed disclosure (`reveal`); (8) the primary button aligns left with '
    + 'the inputs, says its verb and spans the width on a phone; (9) a setup screen shows "N of M '
    + 'done" (`steps`) and gives each missing step one sentence and one fix a tap away; (10) a batch '
    + 'of ten seconds or more shows "3 of 10", the item being worked on and a moving indicator '
    + '(`ring`); (11) a number that changed flashes in place without moving (`attention(el, '
    + '"flash")`), colour only under reduced motion; (12) every item an AI classified offers "Why?" '
    + '(the answer, the reason, the data it saw) and "Correct", which says what it changes and from '
    + 'when. A work queue is `listDetail`: the list keeps a fixed width and the detail grows, and a '
    + 'phone shows one pane at a time.\n\n';
}
