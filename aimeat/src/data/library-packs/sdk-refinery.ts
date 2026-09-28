/**
 * @file sdk-refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-refinery.js, an app's side of the mail refinery the node
 *   runs (services/refinery/). Its own file because library-packs/sdk.ts is at the line ceiling;
 *   placed right after aimeat-decide in SDK_PACKS, beside the models it drives.
 * @structure REFINERY_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import type { LibraryPack } from './types.js';

export const REFINERY_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-refinery',
    kind: 'sdk',
    category: 'ai',
    title: 'Mail refinery',
    description: 'An app\'s side of the mail refinery the node runs: start a batch that reads a connected mailbox, sorts each message into a kind, reads its fields from the text and the PDFs and files it as a workspace row in a queue; follow it, read and move the rows, teach a sender, put it on the node\'s clock, and a ready workbench console.',
    url: '/v1/libs/aimeat-refinery.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-refinery.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.refinery',
    aiDoc: 'USE IT for any app that turns mail into records (receipts, invoices, orders, bookings, job offers): the work runs ON THE NODE, so do not read mail, ask the decision model or extract fields in the page. Read skill node:aimeat-refinery for the definition and the queues. THE DEFINITION is the owner\'s private memory record <prefix>.config (the app\'s own word as prefix): { connectionId, provider, since "YYYY-MM-DD", batchSize 1-50, query, organismId, workspaceId, classes (pack ids from AIMEAT.refinery.classes() or objects of the same shape), thresholds { clear, unclear }, rules [], spaces { items: "viesti", events: "tapahtuma" }, app }. The workspace needs two row spaces (items indexed on queue, klass, status; events on kind) that name the app in their manifest apps list. AIMEAT.refinery.definition(prefix) / saveDefinition(prefix, def). RUN: const run = await AIMEAT.refinery.run(prefix, { onProgress: function (r) { … } }) starts a batch on the node and follows it; r has status (running | done | failed), n, i, step (read | classify | attach | extract | save), subject, counts { seen, clear, unclear, bad, skip, skipped_seen }, rows [{ rowId, queue, subject, klass }] and error. A batch where every message failed has status failed and filed nothing; show r.error. messageIds runs chosen messages again. start(prefix) and status(runId) are the two halves. ROWS: rows(def, { queue: "selkea" | "epaselva" | "kelvoton" | "ohitettu" | "hyvaksytty" | "lahetetty" | "hylatty", limit, cursor }) returns { rows, cursor } with each row\'s body (messageId, from, subject, date, klass, confidence, queue, fields, error, attachments, classifier, extractor, decisionId); counts(def) per queue; log(def) the event rows; runs(prefix) the last fifty batches; restart(prefix) reads from the start date again. A PERSON\'S ACTS: move(def, row, queue, { kind, detail }) moves a row and logs it (approve = "hyvaksytty", sent = "lahetetty", reject = "hylatty"); teach(prefix, row, klass, "from" | "domain" | "message") adds a rule that answers before the model and runs the message again. What an approved record is SENT to stays the app\'s (aimeat-webhook). ON A CLOCK: schedule(prefix, { cron, timezone }) runs a batch on the node even when the page is closed; schedules(prefix) (needs workflow:read), unschedule(id). Do not repeat batches with setInterval in the page. CONSOLE: with aimeat-atelier.js loaded, AIMEAT.refinery.console({ target, prefix, classLabel }) draws the batch figure with its button, the steps, the tallies and the batch rows as they land, from kit parts only. The app asks for connections:read-through, ai:use, organism:rows and memory:write; errors carry the node\'s code on err.code.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['mail', 'email', 'inbox', 'receipt', 'invoice', 'refinery', 'posti', 'sähköposti', 'kuitti', 'lasku'],
    sizeEstimate: '~5KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'ai',
    promptLine: '- aimeat-refinery.js — mail into workspace records: the node reads, sorts and extracts a connected mailbox in batches (`AIMEAT.refinery.run(prefix)`), queues, teaching, a node schedule and a ready console. Requires aimeat-auth.',
  },
];
