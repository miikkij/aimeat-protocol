/**
 * @file build-app-prompt-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two parts of the build specification about content the app did not write itself,
 *   or content the node says more about than its value:
 *     - buildRenderedContentParagraphs(): the end of the Data Storage section. Where agent-written
 *       content came from (getPublicEntry and provenance), and how sensitive content is (TARGET-082
 *       V5: show a warning, respect what is hidden from AI, never lower a label on the app's or an
 *       AI's own judgement). No heading of its own, so it stays in the Data Storage section of the
 *       core (build-app-layers.ts keys its table by heading).
 *     - buildAgentDataSection(): the section "Reading data your AGENTS produced".
 *   The provenance paragraph and the agents section moved here verbatim from
 *   services/build-app-prompt.ts when that file reached the 800-line limit; the text is unchanged.
 * @structure buildRenderedContentParagraphs() · buildAgentDataSection()
 * @usage
 *   body += buildRenderedContentParagraphs();   // last in the Data Storage section
 *   body += buildAgentDataSection();            // after the row-spaces section
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial: the provenance paragraph and the agents section moved verbatim,
 *     and the classification paragraph added (TARGET-082 V5).
 */

export function buildRenderedContentParagraphs(): string {
  let body = '';
  body += 'If you RENDER content an agent wrote, read it with `getPublicEntry(gaii, key)` instead: it returns the same entry plus `provenance` — how that content was made, including the model and the `sources` the writer declared. `getPublic()` returns the bare value and cannot carry it. Showing agent-written text with no origin, when the node is holding the record that explains it, is the gap the label is meant to close.\n\n';
  // Classification (TARGET-082). An app reads as the signed-in person, so a label it sets is that
  // person's decision and applies at once: the rule the app owes is to set one only from the
  // person's own choice. Text the app pastes into a prompt is not checked by the node.
  body += '**Classified content: show the warning, respect what is hidden, and never lower a label yourself.** A memory record, a stored file or a workspace row can carry a classification (public, internal, confidential, or a level the owner or an organism added), and it decides which people and which AI may read it. It is metadata beside the content; the value does not change. Load `aimeat-labels.js` when the app shows or changes it: `AIMEAT.labels.get(key)` reads the label, and `set()` or `review()` from the app is the signed-in person\'s own decision, so call them only with what the person chose on the screen, never with the app\'s or an AI\'s judgement. When the app relays what the person said in words, their words go verbatim in `humanSaid`. An item that carries `classificationWarning` must show it: `AIMEAT.labels.renderWarning(item, el)`. An AI call that names hidden content fails with `err.code === "CLASSIFIED"`: tell the person the content is classified and was not sent to the AI, and do not retry. Before you copy a record\'s text into a prompt yourself, read its label and leave out what has `labelDetail.aiVisibility === "hidden"`. An agent reads and sets classifications with the `aimeat_classification` tool (actions get, set, review, policy_get, policy_set, audit, scan), under the same rules.\n\n';
  return body;
}

// Reading what the owner's AGENTS produced. This is the single most common "my app shows
// nothing" cause for fleet-facing apps: agent output is NOT in the owner's namespace, and an
// app-grant token gets no automatic broadening, so an unscoped list() legitimately returns [].
export function buildAgentDataSection(): string {
  let body = '';
  body += '### Reading data your AGENTS produced (not your own keys)\n';
  body += 'An agent publishes under **its own** namespace (`agentname#owner@node`), NOT the owner\'s. Your app token is role `app`, which gets no automatic owner-scope broadening — so a plain `list({prefix})` returns NOTHING for agent data and the app looks empty while the data is right there. Say which namespace you mean:\n';
  body += '```javascript\n';
  body += '// every same-owner namespace (owner GHII + all their agents) — the usual choice:\n';
  body += 'const { items } = await AIMEAT.data.list({ prefix: "crews.", ownerScope: true, meta: true });\n';
  body += '// one specific agent (full GAII), e.g. from AIMEAT.agents.list():\n';
  body += 'const mine = await AIMEAT.data.list({ prefix: "watch.", agent: "uutisankka#alice@node-id" });\n';
  body += 'const value = await AIMEAT.data.get(items[0].key, { agent: items[0].owner_gaii });\n';
  body += '```\n';
  body += '**`meta: true` on any listing you render as a table/board/archive.** The default response inlines EVERY value, so a fleet-wide prefix can be megabytes on each load; `meta` returns keys + `bytes` + `tags` + `updated_at` and you fetch a value only when the user opens that row. `count: true` (or `AIMEAT.data.count({prefix})`) returns just a number — the cheap way to ask "did anything change?".\n';
  body += 'Each listed item carries `owner_gaii` (which namespace it lives in) and `tags`. Agent task-runners commonly tag their published output `task:<taskId>`, which is how you tie a record back to the task that produced it — `task.deliverableKey` is OPTIONAL and many agents never set it, so never require that field to find a result. `AIMEAT.agents.deliverable()` already falls back to the tag.\n\n';
  return body;
}
