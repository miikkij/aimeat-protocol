/**
 * @file src/tool-catalog/definitions/key-reencrypt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_admin_key_reencrypt (mcp/key-reencrypt.ts): the operator's
 *   view and start of the data key's re-encrypt job (services/key-reencrypt/job.ts), the same as
 *   GET and POST /v1/admin/encryption/reencrypt.
 * @structure keyReencryptTools
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const keyReencryptTools = [
    {
        name: 'aimeat_admin_key_reencrypt',
        description: 'Operator-only. The data key that seals every stored secret (AI keys, the secrets vault, connected accounts, two-step sign-in secrets, secret settings), and the job that moves the stored secrets to a new key. '
            + 'Action "status" (the default) answers which data keys this node holds (`ring.keys`), which one seals new secrets (`ring.current`), the last run of the job with its counts (moved, already current, unreadable, changed while it ran) and where the unreadable values are, `old_key_values`, `old_key_removable`, and `says`: what the operator can do now, in plain words. '
            + 'Action "start" moves every stored secret to the current key, in batches, in the background; every secret keeps opening while it runs, and a restarted node takes it up again. A value that opens with neither key is never changed or deleted, only counted. ONE_DATA_KEY when the node has one key: the keys themselves are set in the environment (AIMEAT_ENCRYPTION_KEY_1, AIMEAT_ENCRYPTION_KEY_CURRENT), never through this tool or any request. '
            + 'Removing the old key is the operator\'s own step, and safe only when `old_key_removable` is true. '
            + 'Same as GET and POST /v1/admin/encryption/reencrypt.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Data Key Re-encrypt', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            action: { type: 'string', enum: ['status', 'start'], description: '"status" (the default) or "start".' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
