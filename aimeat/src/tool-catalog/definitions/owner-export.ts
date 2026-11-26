/**
 * @file src/tool-catalog/definitions/owner-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalog entry of the person's data export as a background job:
 *   aimeat_account_export. REST: routes/owners/exports.ts; the rules: services/owner-export/ops.ts.
 * @structure ownerExportTools — the one definition
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const ownerExportTools = [
  {
    name: 'aimeat_account_export',
    description: 'The person\'s own data export: everything their account holds, as ZIP files they download. action "plan" answers the parts with their size on this account (memory records, AI provenance records, the code of every app version, the files the node keeps, the files in a store the person connected) and the export there is now; tell the person the sizes and ask which parts they want. action "start" queues an export of the chosen parts (default: all but the files in their own store); the node writes one export at a time, so it may wait. action "status" answers its state; when it is ready the person is told, and the download links go to them only, on the Data wallet page, never to you. action "cancel" stops it or removes a finished one.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Data export', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'memory:read',
    surfaces: ['agent'],
    input: {
      action: { type: 'string', enum: ['plan', 'start', 'status', 'cancel'], required: true, description: 'plan: the parts and their sizes. start: queue an export. status: its state. cancel: stop it or remove a finished one.' },
      parts: {
        type: 'array',
        description: 'With start: the parts to include, any of memories, ai_provenance, app_code, files, files_own_store. The account itself (profile, agents, messages, tasks, bookkeeping, the facts of every app and file) is always included. Default: all but files_own_store.',
        zod: z.array(z.enum(['memories', 'ai_provenance', 'app_code', 'files', 'files_own_store'])).max(5),
      },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
