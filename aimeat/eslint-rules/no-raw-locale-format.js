/**
 * @file no-raw-locale-format.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule: a date, a time or a number is written through the one shared
 *   formatter, never through `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` or a
 *   bare `Intl.DateTimeFormat` / `Intl.NumberFormat` at the call site.
 *
 *   THE RULE IT ENFORCES. Language, regional format and time zone are three separate settings and a
 *   person may mix them freely, the way an operating system lets them. A page shows the words in
 *   the language they picked, the numbers in the format they picked, and the clock they keep.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   WHY A LINT RULE AND NOT A LIBRARY. The library existed. What failed was that nothing stopped
 *   the next call site from writing its own two-line helper, and by 2026-09-12 there were more than
 *   thirty of them — six spelled `localeTag()`, two spelled `loc()`, several inlined as
 *   `lang === 'fi' ? 'fi-FI' : 'en-GB'` — every one deriving the FORMAT from the LANGUAGE, and they
 *   had already drifted apart from one another: five said en-GB, the money one said en-US, one had
 *   a Finnish decimal comma hardcoded so an English page read `public · 3,9 kB`. A rule that is
 *   remembered is a rule that decays; this one is checked.
 *
 *   HOW TO SATISFY IT.
 *     a page or component  import { num, date, time, dateTime, calendar } from '/js/format.js'
 *     an app               AIMEAT.fmt.num / .date / .time / .dateTime  (cortex aimeat-i18n)
 *     the server           displayPrefsFor(storage, the person the message is FOR),
 *                          then formatForPerson(prefs, iso, opts)
 *
 *   AND THE ONE DISTINCTION THAT IS NOT ABOUT FORMAT. A moment gets the reader's clock; a CALENDAR
 *   DATE — a heat-map square, a month rail, the day a usage row was counted into — must not, or it
 *   slides a day for anyone west of the node. `calendar()` is for those.
 *
 *   THE SEED IS SIX FILES, and it is six rather than a backlog because the sweep finished first.
 *   A seeded list here would forgive exactly the thing the rule exists to catch.
 * @structure ALLOWED — the four files that may hold a raw call · noRawLocaleFormat: the rule module
 * @usage 'aimeat/no-raw-locale-format': 'error'
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the sweep that emptied its backlog.
 */

/**
 * The files allowed to call Intl directly. Each is the implementation of a formatter or of the
 * setting behind one, rather than a caller: `format.js` and `display-prefs.js` for the pages,
 * `_core/format.js` for the served app libraries, `aimeat-i18n.js` for apps, `display-prefs.ts`
 * for the server.
 *
 * `DisplayPrefsFields.js` is on the list for a different reason worth stating: its sample line must
 * format with the values being CHOSEN in the dialog, not the ones already saved, so it cannot go
 * through a formatter that reads the saved ones. It is the settings screen showing you what your
 * setting will do.
 *
 * Anything else that genuinely needs Intl is using it as a CLOCK or a VALIDATOR rather than to
 * write something a person reads — "which minute is it in Asia/Tokyo", "is this zone real" — and
 * takes a per-line disable saying which. That keeps the two apart where a reader can see it.
 */
const ALLOWED = [
  'public/js/format.js',
  'public/js/display-prefs.js',
  'public/components/DisplayPrefsFields.js',
  'public/cortex-bundled/aimeat-i18n.js',
  'src/services/display-prefs.ts',
  'src/static/sdk-libs/_core/format.js',
];

const METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']);
const INTL_CTORS = new Set(['DateTimeFormat', 'NumberFormat', 'RelativeTimeFormat']);

export const noRawLocaleFormat = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Dates, times and numbers go through the shared formatter, which reads the '
        + "reader's own region and time zone rather than the page's language",
    },
    schema: [],
    messages: {
      method:
        "Do not call {{name}} here. It writes in whatever format the BROWSER or the page's language "
        + 'happens to give, and a person\'s regional format and time zone are settings of their own. '
        + "On a page: import { num, date, time, dateTime, calendar } from '/js/format.js'. In an app: "
        + 'AIMEAT.fmt. On the server: displayPrefsFor() the person the message is for, then '
        + 'formatForPerson(). A calendar DATE (a heat-map square, a month rail, a usage day) uses '
        + 'calendar(), which no zone can slide.',
      intl:
        'Do not build Intl.{{name}} here. The shared formatter already holds the reader\'s region '
        + "and clock: /js/format.js on a page, AIMEAT.fmt in an app, services/display-prefs.ts on "
        + 'the server. Building one at the call site is how thirty copies drifted apart from each '
        + 'other, five saying en-GB and one saying en-US for the same reader.',
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    if (ALLOWED.some((p) => filename.endsWith(p))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== 'MemberExpression' || callee.computed) return;
        const name = callee.property?.name;
        if (!METHODS.has(name)) return;
        context.report({ node: callee.property, messageId: 'method', data: { name } });
      },
      NewExpression(node) {
        const callee = node.callee;
        if (callee?.type !== 'MemberExpression' || callee.computed) return;
        if (callee.object?.type !== 'Identifier' || callee.object.name !== 'Intl') return;
        const name = callee.property?.name;
        if (!INTL_CTORS.has(name)) return;
        context.report({ node, messageId: 'intl', data: { name } });
      },
    };
  },
};
