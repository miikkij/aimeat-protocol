/**
 * @file refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The refinery: the class packs, running one batch of a mail refinery definition, and
 *   following it. One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const refineryTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_refinery_classes',
        description: "The class packs a mail refinery sorts messages into: receipt, invoice, order, booking, job, system, support, newsletter and personal. Each says what the decision model is told the class is, whether a message of it is processed or only filed, and the fields an extraction reads from it (an invoice's vendor, amount, due date and reference, for example). A refinery definition names packs by id in its `classes`, or carries classes of its own in the same shape. Read this before writing a definition, so the classes are ones the node already describes well.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_refinery_run',
        description: "Run one batch of a mail refinery: read the next page of mail from where the last batch stopped, classify each message, read the fields its class names from the text and the PDF attachments, and file it as a row in the definition's workspace, in one of four queues (clear, unclear, unusable, skipped). The definition is the owner's memory record `<prefix>.config`: the mailbox (a connection id from aimeat_connection_list), the organism and workspace, the start date, the classes and the thresholds. It answers at once with the run; follow it with aimeat_refinery_status. It NEVER SENDS anything: approving a record and sending it on is a person's act in the app. A batch spends the owner's decision and model allowance for every message, so run one batch and report what it filed before running more. A batch where every message fails files nothing and leaves the place in the mailbox where it was, so the same mail is read again once the cause is fixed. message_ids runs exactly those messages again. Needs connections:read-through, ai:use, organism:rows and memory:write, all four; and the mailbox must be one YOU connected, because a connection belongs to the principal that made it.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            prefix: { type: 'string', required: true, description: 'Names the definition, `<prefix>.config`: lowercase letters, digits, - or _ (e.g. postinjalostamo).' },
            message_ids: { type: 'array', description: 'Run exactly these messages again (at most 50), whether or not they already have rows.' },
        },
    },
    {
        name: 'aimeat_refinery_status',
        description: 'How far a refinery batch is: running, done or failed; the step and the message it is on; the counts per queue; and the rows it filed, newest first. A failed run says why. A finished run is kept for an hour; after that the workspace rows and the `<prefix>.runs` record hold what it did.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            run_id: { type: 'string', required: true, description: 'The run id aimeat_refinery_run answered with.' },
        },
    },
];
