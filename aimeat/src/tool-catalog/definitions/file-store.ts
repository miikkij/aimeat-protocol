/**
 * @file src/tool-catalog/definitions/file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of where stored files keep their bytes (services/file-store/). A person reads
 *   and connects storage of their own (an S3 bucket or an Azure Blob container, with their own keys),
 *   moves their files into it or back out, and disconnects it; an operator reads the node's store and
 *   every person's, tests the node's store, moves older files out of the database, and approves who
 *   may use their own. On all three surfaces: the node's MCP endpoint (src/mcp/file-store.ts), the
 *   connector MCP and the CLI dispatch (src/tool-dispatch/tool-call-defs-file-store.ts), the last two
 *   over the REST routes in routes/file-store.ts.
 * @structure fileStoreTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const fileStoreTools = [
    {
        name: 'aimeat_file_store_get',
        description: 'Where the person\'s files keep their bytes, and whether they may keep them in storage of their own. Answers `mode` (this node\'s rule: "self" anyone may connect their own storage, "operator" an operator approves each person, "off" nobody), `approval` (on an "operator" node: requested, approved or declined, with the operator\'s note), `store` (the connected S3 bucket or Azure container: where, folder, since when, the last connection test; null when none), `taking_new_files` (whether a new file goes there now) and `files` (how many files and bytes are in their own storage and elsewhere). Files in their own storage do not count toward the node\'s storage quota. Same data as GET /v1/file-store.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Own File Storage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_file_store_set',
        description: 'Connect the person\'s own storage for their files: an S3 bucket (Amazon S3, Cloudflare R2, Hetzner, Backblaze B2 or any S3-compatible service) or an Azure Blob container, with their own keys. From then on every new file of the person and of their agents goes there and does not count toward the node\'s storage quota; files already stored stay where they are until moved (aimeat_file_store_move). The node tests the storage first (write, read, read part, list, remove under the folder) and saves nothing when a step fails (STORE_TEST_FAILED names the step). The keys are kept encrypted and are never returned. S3: `bucket`, `access_key_id`, `secret_access_key`, and `endpoint` (an https address; leave it out for Amazon S3) and `region`. Azure: `credential` (the account key with `account` and `container`, a connection string with `container`, or a container SAS URL alone). On a node where operators approve, the answer is `outcome` "waiting_for_operator" (HTTP 202) and files keep going to the node until approved. Replacing a store that holds files with a different bucket is refused (FILES_IN_STORE): move them home first. Needs the person in person or the secrets:manage permission. Prefer that the person types the keys on their own profile page when they would rather not paste them into a chat. Same as PUT /v1/file-store.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Connect Own File Storage', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'secrets:manage',
        surfaces: ['agent'],
        input: {
            kind: { type: 'string', required: true, enum: ['s3', 'azure'], description: '"s3" or "azure".' },
            endpoint: { type: 'string', description: 'S3: the service address, https://… Leave out for Amazon S3.' },
            region: { type: 'string', description: 'S3: the region, e.g. eu-north-1 (Cloudflare R2: auto). Default us-east-1.' },
            bucket: { type: 'string', description: 'S3: the bucket. Make it first, private.' },
            addressing: { type: 'string', enum: ['auto', 'path', 'host'], description: 'S3: how the bucket is named in the address. Default auto.' },
            access_key_id: { type: 'string', description: 'S3: the access key id of a key that may read, write, delete and list in the bucket.' },
            secret_access_key: { type: 'string', description: 'S3: that key\'s secret.' },
            account: { type: 'string', description: 'Azure: the storage account name (not needed with a connection string or SAS URL).' },
            container: { type: 'string', description: 'Azure: the container (not needed with a container SAS URL). Make it first, private.' },
            credential: { type: 'string', description: 'Azure: the account key, a connection string, or a container SAS URL with read, add, create, write, delete and list rights.' },
            prefix: { type: 'string', description: 'The folder inside the bucket or container. Default aimeat/<account>@<node>/.' },
            reason: { type: 'string', description: 'Why, for the operators, on a node where they approve.' },
        },
    },
    {
        name: 'aimeat_file_store_remove',
        description: 'Disconnect the person\'s own storage. New files then go where the node keeps them. Refused while files are still in it (FILES_IN_STORE): move them home first with aimeat_file_store_move direction "home". The keys are deleted from the node; the bucket or container and anything else in it are not touched. Needs the person in person or the secrets:manage permission. Same as DELETE /v1/file-store.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Disconnect Own File Storage', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:manage',
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_file_store_move',
        description: 'Move up to `limit` of the person\'s files (theirs and their agents\'): direction "own" into their own storage (files stored before it was connected), "home" out of it to where the node keeps files (before disconnecting). Each file keeps its name, visibility and links. Answers moved, skipped, failed (with the reason per file) and remaining; call again while remaining is above 0. Same as POST /v1/file-store/move.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Move Files to or from Own Storage', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'storage:write',
        surfaces: ['agent'],
        input: {
            direction: { type: 'string', required: true, enum: ['own', 'home'], description: '"own" into the person\'s storage, "home" back to the node.' },
            limit: { type: 'number', description: 'How many files in this call, 1 to 200. Default 50.' },
        },
    },
    {
        name: 'aimeat_admin_file_store',
        description: 'Operator-only. Where this node keeps the bytes of stored files: `kind` (database, s3 or azure), `ready` and `missing` (which settings or environment variables are still needed), `where` (bucket or container), `prefix` (the folder), `files` (count and bytes in the database, in the node\'s store and in people\'s own storage) and `owner_stores` (the rule, every person\'s connected storage with its last test, and the requests waiting for an operator). The store is chosen on the Config tab (file_store.*) or with aimeat_admin_config_set; the keys come from the environment only. Same data as GET /v1/admin/file-store. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: File Storage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_file_store_test',
        description: 'Operator-only. Test the node\'s file store: write, read, read part of, list and remove one small object under its folder, and answer each step with what the store said. Run it after changing the file_store settings and before moving files. Answers NO_FILE_STORE when files are kept in the database and FILE_STORE_INCOMPLETE with the missing settings. Same as POST /v1/admin/file-store/test.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Test File Storage', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_file_store_move',
        description: 'Operator-only. Move up to `limit` files whose bytes are still in the node\'s database to where a new file of the same owner goes now: their own storage when they have one the node lets them use, else the node\'s store. A file keeps its name, owner, visibility, links and creation time; a file changed while it was being moved is left as it is. Answers moved, skipped, failed (with the reason per file), moved_bytes_mb, remaining, and `next`: pass it back as `after` to go on past files that failed. Call again while remaining is above 0. Same as POST /v1/admin/file-store/move.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Move Files out of the Database', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            limit: { type: 'number', description: 'How many files in this call, 1 to 500. Default 100.' },
            after: { type: 'string', description: 'The `next` of the previous answer, to go on from there.' },
        },
    },
    {
        name: 'aimeat_admin_file_store_decide',
        description: 'Operator-only. On a node where operators approve who may keep files in their own storage: "approve" lets the person\'s storage take their new files; "decline" answers a request; "revoke" takes an approval back, after which new files go to the node again (files already in their storage stay readable). Decline and revoke need `note`, which the person reads. The person is told either way. Same as POST /v1/admin/file-store/owners/{owner}/decision.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Decide on Own File Storage', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            owner: { type: 'string', required: true, description: 'The account name.' },
            decision: { type: 'string', required: true, enum: ['approve', 'decline', 'revoke'], description: '"approve", "decline" or "revoke".' },
            note: { type: 'string', description: 'The reason, for the person. Required with "decline" and "revoke".' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
