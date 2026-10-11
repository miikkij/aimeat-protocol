/**
 * @file src/services/build-events-first.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule both build specifications give an app builder about data that changes on
 *   the node: it reaches the screen through an event, and a timer is the last resort. One home for
 *   the rule and for the list of change domains an app may hear, so the Atelier and the Classic
 *   specification cannot drift apart on it. Its own file because build-atelier-prompt.ts and
 *   build-app-prompt.ts are at the 800-line limit; the Classic section "Live updates without a
 *   firehose" moved here unchanged and gained the rule as its opening.
 *
 *   WHY. 2026-10-11, TV-opas (happydude500001/tv-opas.html). The app hands recordings to one of the
 *   owner's agents and showed the task's stage by reading the task list every 30 seconds. On
 *   aimeat.io a booking read "starting" for 37 seconds after the agent had reported "recording".
 *   The event stream was there the whole time: the node emits the change domain `agent-tasks` for
 *   every progress event an agent posts, and an app holding task:read hears it. After the change
 *   the agent's line at 11:27:49.98 showed on the page at 11:27:50.28, and 90 seconds with nothing
 *   under way made no request to the node. The developer's ruling, the same day: "aina pitäisi
 *   pyrkiä event based systeemeihin eikä pollauksiin", and polling is the last resort in a UI.
 *   Neither specification said so. The Atelier one described the mosaic's `live` map for memory
 *   keys only, and the Classic one told a builder to "observe shared AIMEAT.data keys on a timer".
 *
 *   EVERY CLAIM BELOW WAS READ FROM THE CODE THAT ENFORCES IT: the domain to permission table from
 *   src/auth/sse-domain-scopes.ts (DOMAIN_SCOPE); the mosaic's `domains` field and its interval
 *   floor from src/static/sdk-libs/atelier/mosaic-bind.js (wireLive); subscribe, minIntervalMs and
 *   keyPrefix from src/static/sdk-libs/live/index.js; watch from src/static/sdk-libs/agents/index.js;
 *   the ticket that opens the stream needs a signed-in session (routes/sse.ts). The sentence on
 *   deletes was read from the 148 DELETE routes: 79 emit in the handler, and of the 25 services
 *   read behind the others 18 emit. In the eleven domains named here a record's delete emits
 *   (memory-bin.ts, storage-file-write.ts, agent-tasks/lifecycle.ts, schedule-write.ts,
 *   workflows.ts, board-write.ts, direct-message-delete.ts, workspace-rows/row-service.ts,
 *   packages.ts, knowledge/); the live library's registry text names five of the seven read that do not.
 * @structure EVENTS_FIRST_DOMAINS · atelierEventsFirst() · classicLiveUpdatesSection()
 * @usage import { atelierEventsFirst, classicLiveUpdatesSection } from './build-events-first.js';
 * @version-history
 *   v1.1.0 — 2026-10-11 — Both specifications say a delete emits its domain as a write does. The
 *     first version left the subject out, because the registry text denied it and the routes had
 *     not all been read.
 *   v1.0.0 — 2026-10-11 — Initial creation: the rule, the domain list, and the Classic section
 *     "Live updates without a firehose" moved from build-app-prompt.ts.
 */

/** The change domains an app may subscribe to, each with the permission that opens it. */
export const EVENTS_FIRST_DOMAINS =
  '`memory` (memory:read), `agent-tasks` (task:read), `files` (storage:read), `organisms` '
  + '(organism:read), `workflows` and `scheduler` (workflow:read), `messages` (messages:read), '
  + '`boards` (social:read), `wallet` (wallet:read), `knowledge` and `packages` (knowledge:read)';

/** The three places a timer belongs, the same words in both specifications. */
const TIMER_CASES =
  'A timer is right in three cases, and each gets a comment saying which one it is: the data has no '
  + 'event (a public record a signed-out visitor reads, since the stream opens for a signed-in '
  + 'person; an answer from a service outside the node); the text depends on the clock itself (a '
  + 'countdown, "starts in 5 min"), which is a repaint and makes no request; one slow read, every '
  + 'ten minutes, that reconciles after a stream that was down.';

/** What an event does and does not carry, the same words in both specifications. */
const EVENT_SHAPE =
  'An event names the domain and never the record, so every change in that domain on the account '
  + 'wakes the page: read while your app has something under way, and re-read the one source that '
  + 'moved. A delete emits its domain as a write does; the aimeat-live description names the few '
  + 'that emit nothing. ';

/**
 * The paragraph that follows LIVE BY DECLARATION in the Atelier specification's mosaic section.
 * @returns the paragraph, ending in a blank line
 */
export function atelierEventsFirst(): string {
  return 'EVENTS FIRST, A TIMER LAST. Data that lives on the node reaches the screen because the '
    + 'node said it changed. Before you write `setInterval` around a read, name the event that '
    + 'says this data moved. The owner\'s records: the `live` map above with a `keyPrefix`. Work '
    + 'an agent does for the app (each stage line of a task, done, failed, a task a schedule '
    + 'created): `live: { jobs: { domains: [\'agent-tasks\'] } }`, which needs no prefix, and for '
    + 'one task `AIMEAT.agents.watch(agent, taskId, onUpdate)`. The domains an app may hear, each '
    + 'with the permission that opens it: ' + EVENTS_FIRST_DOMAINS + '. Outside a mosaic the same '
    + 'thing is `AIMEAT.live.subscribe([\'agent-tasks\'], reload, { minIntervalMs: 3000 })`. '
    + EVENT_SHAPE + TIMER_CASES + ' Check it the way a person meets it: start the work and watch '
    + 'the screen follow each stage within a few seconds.\n\n';
}

/**
 * The Classic specification's section "Live updates without a firehose (aimeat-live.js)": the rule
 * first, then the firehose text as it stood in build-app-prompt.ts.
 * @returns the section, heading included, ending in a blank line
 */
export function classicLiveUpdatesSection(): string {
  let body = '### Live updates without a firehose (aimeat-live.js)\n';
  body += '**Events first, a timer last.** Data that lives on the node reaches the screen because the node said it changed. Before you write `setInterval` around a read, name the event that says this data moved, and subscribe: `AIMEAT.live.subscribe(["agent-tasks"], reload, { minIntervalMs: 3000 })` for work an agent does for the app (each stage line of a task, done, failed, a task a schedule created), `AIMEAT.agents.watch(agent, taskId, onUpdate)` for one task, and the `memory` form below for the owner\'s records. The domains an app may hear, each with the permission that opens it: ' + EVENTS_FIRST_DOMAINS + '. ' + EVENT_SHAPE + TIMER_CASES + ' Check it the way a person meets it: start the work and watch the screen follow each stage within a few seconds.\n\n';
  // Live updates — the firehose trap. Correct-looking code that makes the app poll forever
  // and repaint over the user, on any account with more than a couple of active agents.
  body += '`AIMEAT.live.subscribe(["memory"], reload)` means "call me whenever ANY of this owner\'s memory changed". On an account with an active agent fleet that is near-continuous, so a handler that re-fetches a full listing turns one agent\'s activity into a permanent poll. Gate it:\n';
  body += '```javascript\n';
  body += '// fire only when the number of keys under a prefix actually changed:\n';
  body += 'AIMEAT.live.subscribe(["memory"], reload, { keyPrefix: "crews.", ownerScope: true });\n';
  body += 'AIMEAT.live.subscribe(["memory"], reload, { minIntervalMs: 10000 });   // or just rate-limit\n';
  body += '```\n';
  body += 'The change frame carries a DOMAIN name, never the key that changed, so `keyPrefix` is a client-side count gate: it catches a NEW key, not an in-place update of an existing one. Use `minIntervalMs` for update-sensitive views.\n';
  body += '**Never let a live event repaint a surface the user is currently reading.** If a dialog/detail view is open, refresh its data in the background and leave the visible content alone — only an explicit user action should replace it. Rebuilding a list or blanking a pane to "Loading…" on every event is what makes an app flicker, and it looks like a crash, not a refresh. Also: render into a detached element and swap it in one operation instead of clearing then filling.\n\n';
  return body;
}
