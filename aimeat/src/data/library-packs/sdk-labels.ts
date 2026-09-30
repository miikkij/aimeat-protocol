/**
 * @file sdk-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-labels.js (TARGET-082 V5), the classification of content
 *   for an app: the label a record, file or row carries, the policy, the audit log and the classifier
 *   scan. Its own file because library-packs/sdk.ts is near the line ceiling; placed right after
 *   aimeat-organism in SDK_PACKS, beside the data libraries whose content it labels.
 * @structure LABELS_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.1.0 — 2026-09-30 — aiDoc: humanSaid through an AI credential raises at once, and a lowering or
 *     a change to a person's label waits for the person (PERSON_APPROVES).
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import type { LibraryPack } from './types.js';

export const LABELS_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-labels',
    kind: 'sdk',
    category: 'core',
    title: 'Content classification',
    description: 'The classification of a memory record, a stored file or a workspace row (public, internal, confidential, or a level the owner or an organism added): read it, let the person set or review it, read the policy and the audit log, ask the classifier to scan keys, and show the warning a classified item carries.',
    url: '/v1/libs/aimeat-labels.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-labels.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.labels',
    aiDoc: 'USE IT when the app shows, edits or sends to an AI content that may be sensitive: a person\'s notes, customer records, an organism\'s documents or rows. A LABEL IS METADATA BESIDE THE CONTENT: it changes no value, and it decides which people and which AI may read the content and whether it may leave its organism. Labels come from the policy (AIMEAT.labels.policy({ level: "owner" | "organism" | "node", organismId })): each has an id, name { fi, en, es }, rank (higher is more sensitive), color and aiVisibility ("hidden" | "warning" | "allowed"). READ: AIMEAT.labels.get(key) for a memory key, get({ kind: "file", key }) for a stored file, get({ row: { organismId, ws, space, rowId } }) for a row; it answers { label, labelDetail, source, locked, suggestion, history }, where locked means a person set it and suggestion is a label waiting for the person. SET: AIMEAT.labels.set({ key, label, justification, humanSaid }). THE APP IS THE PERSON\'S SCREEN: the node reads an app as the signed-in person, so set() and review({ key, decision: "accept" | "reject" }) apply at once as that person\'s decision. Call them only with what the person chose on the screen. AN APP NEVER LOWERS A LABEL ON ITS OWN JUDGEMENT, and never passes an AI\'s proposal to set() by itself: show the proposal and let the person pick. Lowering from a label that asks for a reason needs justification (JUSTIFICATION_REQUIRED otherwise). When the app relays an instruction the person gave in words (a chat line, a voice command), put their own words, verbatim, in humanSaid; never a summary. When the words come through an AI credential instead (an agent, a personal access token), a label at least as strict applies at once as the person\'s, and a lowering or a change to a label a person set waits as a suggestion (suggestion.why "PERSON_APPROVES", their words in suggestion.humanSaid) that the person accepts signed in themselves: review() from an AI credential answers PERSON_REQUIRED for it. A label that limits its readers to an audience the person is not in is refused (AUDIENCE_LOCKOUT). WARNINGS: an item with a warning classification carries classificationWarning { label, name, says } (classification_warning on an MCP memory read) when it reaches an AI reader. AN ITEM THAT CARRIES A WARNING MUST SHOW IT: AIMEAT.labels.renderWarning(item, cardEl) puts one line first in the card in the page\'s own theme colours, and AIMEAT.labels.warningOf(item) returns the warning or null for your own markup. HIDDEN: content whose label hides it from AI reads as absent to an AI, and AN AI CALL THAT NAMES IT BY KEY (a file, an AI job\'s input keys, a decision run) FAILS WITH err.code "CLASSIFIED" (403). Then tell the person in plain words that the content is classified and was not sent to the AI, and do not retry: the same call is refused until the label changes. AIMEAT.labels.isClassified(err) tests for it. Text the app copies into a prompt itself is not checked by the node, so before sending a record\'s content to AIMEAT.ai or AIMEAT.decide, read get(key) and leave out anything whose labelDetail.aiVisibility is "hidden". AIMEAT.labels.scan({ keys } | { prefix }) asks the Content Classifier to judge memory keys (3 at once, more are queued) and answers { classified, queued, missing }; its label follows the AI rules. AIMEAT.labels.list({ pending: true, label, kind, limit, cursor }) pages the person\'s classified items and the suggestions waiting for them (items[].suggestion, next as the cursor); a target may name owner, the agent or app identity of the person that holds the key. AIMEAT.labels.audit({ level, since, action: "shown" | "used" | "refused" | "changed", limit }) reads the log. Errors carry err.code: CLASSIFIED, AUDIENCE_LOCKOUT, JUSTIFICATION_REQUIRED, PERSON_REQUIRED, LABEL_UNKNOWN, CLASSIFICATION_OFF, NOT_FOUND, POLICY_DILUTES. Needs memory:read to read and memory:write to set, review or scan.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['classification', 'classified', 'confidential', 'sensitive', 'label', 'luokitus', 'luottamuksellinen', 'arkaluonteinen', 'clasificación', 'confidencial'],
    sizeEstimate: '~4KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'core',
    promptLine: '- aimeat-labels.js — the classification of content (`AIMEAT.labels`): read a record\'s label, set or review it only from the person\'s own choice (never lower one on an AI\'s judgement; a person\'s words go in `humanSaid`), show `renderWarning(item)` on an item that carries a warning, and on `err.code === "CLASSIFIED"` from an AI call tell the person instead of retrying. Requires aimeat-auth.',
  },
];
