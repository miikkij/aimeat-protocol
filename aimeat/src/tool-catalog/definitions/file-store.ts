/**
 * @file src/tool-catalog/definitions/file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of where stored files keep their bytes (services/file-store/). A person reads
 *   their stores and the ones they may choose for a file, connects named stores of their own (an S3
 *   bucket or an Azure Blob container, with their own keys) and picks the default, moves files between
 *   places, and disconnects a store; an operator reads every store, adds and removes the node's named
 *   stores (keys kept encrypted on the node), picks the node's default and which stores everyone may
 *   choose, tests a store, moves files between node places, and approves who may use their own. On all
 *   three surfaces: the node's MCP endpoint (src/mcp/file-store.ts), the connector MCP and the CLI
 *   dispatch (src/tool-dispatch/tool-call-defs-file-store.ts), the last two over the REST routes in
 *   routes/file-store.ts.
 * @structure fileStoreTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.1.0 — 2026-10-30 — Named stores: `name` and `make_default` on set, `name` on remove, `to` and
 *     `from` on move, `choices` in the view; aimeat_admin_file_store_set and aimeat_admin_file_store_remove;
 *     a test by name and a move with `from` and `to` (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

/** The address and key fields of a store, shared by the person's and the operator's set. */
const STORE_INPUT = {
    kind: { type: 'string', enum: ['s3', 'azure'], description: '"s3" or "azure". Leave out to change only the options of an existing store.' },
    endpoint: { type: 'string', description: 'S3: the service address, https://… Leave out for Amazon S3.' },
    region: { type: 'string', description: 'S3: the region, e.g. eu-north-1 (Cloudflare R2: auto). Default us-east-1.' },
    bucket: { type: 'string', description: 'S3: the bucket. Make it first, private.' },
    addressing: { type: 'string', enum: ['auto', 'path', 'host'], description: 'S3: how the bucket is named in the address. Default auto.' },
    access_key_id: { type: 'string', description: 'S3: the access key id of a key that may read, write, delete and list in the bucket.' },
    secret_access_key: { type: 'string', description: 'S3: that key\'s secret.' },
    account: { type: 'string', description: 'Azure: the storage account name (not needed with a connection string or SAS URL).' },
    container: { type: 'string', description: 'Azure: the container (not needed with a container SAS URL). Make it first, private.' },
    credential: { type: 'string', description: 'Azure: the account key, a connection string, or a container SAS URL with read, add, create, write, delete and list rights.' },
} as const;

export const fileStoreTools = [
    {
        name: 'aimeat_file_store_get',
        description: 'Where the person\'s files keep their bytes, and which stores a file may be put in. Answers `mode` (this node\'s rule: "self" anyone may connect their own storage, "operator" an operator approves each person, "off" nobody), `approval` (on an "operator" node: requested, approved or declined, with the operator\'s note), `stores` (each store of their own: name, where, folder, whether it is the default, the last connection test, how many files are in it), `default_store`, `taking_new_files`, `new_files_go_to` (where a file goes when its writer names no store), `choices` (what may be given as `store` when saving a file with aimeat_storage_upload: "own:<name>" for their own stores, "node:<name>" for node stores the operators opened to everyone) and `files` (count and bytes per place). Files in their own storage do not count toward the node\'s storage quota. Same data as GET /v1/file-store.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Own File Storage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_file_store_set',
        description: 'Connect a store of the person\'s own for their files, under a `name`: an S3 bucket (Amazon S3, Cloudflare R2, Hetzner, Backblaze B2 or any S3-compatible service) or an Azure Blob container, with their own keys. A person may have several; the first becomes the default, and `make_default: true` makes another one the default. A new file of the person and of their agents goes to the default unless its writer names another store (`store` on aimeat_storage_upload); files in their own storage do not count toward the node\'s storage quota; files already stored stay where they are until moved (aimeat_file_store_move). The node tests the storage first (write, read, read part, list, remove under the folder) and saves nothing when a step fails (STORE_TEST_FAILED names the step). The keys are kept encrypted and are never returned. S3: `bucket`, `access_key_id`, `secret_access_key`, and `endpoint` (an https address; leave it out for Amazon S3) and `region`. Azure: `credential` (the account key with `account` and `container`, a connection string with `container`, or a container SAS URL alone). Without `kind`, only `make_default` changes, on the store `name` names. On a node where operators approve, the answer is `outcome` "waiting_for_operator" (HTTP 202) and files keep going to the node until approved. Pointing a store that holds files at a different bucket is refused (FILES_IN_STORE): move them first. Needs the person in person or the secrets:manage permission. Prefer that the person types the keys on their own profile page when they would rather not paste them into a chat. Same as PUT /v1/file-store.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Connect Own File Storage', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'secrets:manage',
        surfaces: ['agent'],
        input: {
            name: { type: 'string', description: 'The store\'s name: lower-case letters, digits and hyphens. Default "main" for the first store; needed when the person already has several.' },
            ...STORE_INPUT,
            prefix: { type: 'string', description: 'The folder inside the bucket or container. Default aimeat/<account>@<node>/<name>/.' },
            make_default: { type: 'boolean', description: 'Make this store the one new files go to when their writer names none.' },
            reason: { type: 'string', description: 'Why, for the operators, on a node where they approve.' },
        },
    },
    {
        name: 'aimeat_file_store_remove',
        description: 'Disconnect one of the person\'s own stores (`name`; it may be left out when they have one). Refused while files are still in it (FILES_IN_STORE): move them first with aimeat_file_store_move from "own:<name>". Removing the default leaves no default: new files then go where the node keeps them. The keys are deleted from the node; the bucket or container and anything else in it are not touched. Needs the person in person or the secrets:manage permission. Same as DELETE /v1/file-store?name=<name>.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Disconnect Own File Storage', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:manage',
        surfaces: ['agent'],
        input: {
            name: { type: 'string', description: 'The store to disconnect.' },
        },
    },
    {
        name: 'aimeat_file_store_move',
        description: 'Move up to `limit` of the person\'s files (theirs and their agents\'). `to` is a store they may choose ("own:<name>", "node:<name>", see `choices` in aimeat_file_store_get) or "home", where the node keeps files. `from` narrows to the files of one place ("own:<name>", "node:<name>" or "database"); without it, "home" moves every file in their own stores, and a store moves every file not yet in it. Each file keeps its name, visibility and links. Answers moved, skipped, failed (with the reason per file) and remaining; call again while remaining is above 0. `direction` "own" or "home" is the older form of `to`. Same as POST /v1/file-store/move.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Move Files between Stores', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'storage:write',
        surfaces: ['agent'],
        input: {
            to: { type: 'string', description: '"home", "own:<name>" or "node:<name>".' },
            from: { type: 'string', description: 'Only the files in this place: "own:<name>", "node:<name>" or "database".' },
            direction: { type: 'string', enum: ['own', 'home'], description: 'Older form of `to`: "own" is the default own store, "home" is home.' },
            limit: { type: 'number', description: 'How many files in this call, 1 to 200. Default 50.' },
        },
    },
    {
        name: 'aimeat_admin_file_store',
        description: 'Operator-only. Where this node keeps the bytes of stored files: the store the environment names (`kind` database, s3 or azure, `ready`, `missing` settings, `where`, `prefix`), the named node stores (`stores`: each with where, folder, `default`, `selectable` for everyone, last test, files in it), `default_store`, `new_files_go_to`, `files` (count and bytes per place) and `owner_stores` (the rule, every person\'s stores with their last test, and the requests waiting for an operator). The environment\'s store is set on the Config tab (file_store.*) with its keys in the environment; named stores are added with aimeat_admin_file_store_set. Same data as GET /v1/admin/file-store. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: File Storage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_file_store_set',
        description: 'Operator-only. Add a named store for the whole node, give one a new key, or change its options: an S3 bucket or an Azure Blob container. The node tests it first (write, read, read part, list, remove under its folder) and saves nothing when a step fails (STORE_TEST_FAILED). The keys are kept encrypted on the node and never returned. `selectable: true` lets every person name it for a file (`store: "node:<name>"`); an operator may always. `make_default: true` sends every new file there when neither its writer nor its owner\'s own storage decides; `make_default: false` on the default lets the environment\'s setting decide again. Without `kind`, only `selectable` and `make_default` change. Pointing a store that holds files at a different bucket is refused (FILES_IN_STORE). The names s3, azure and database are taken. Same as PUT /v1/admin/file-store/stores/{name}.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Add or Change a File Store', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', required: true, description: 'The store\'s name: lower-case letters, digits and hyphens.' },
            ...STORE_INPUT,
            endpoint: { type: 'string', description: 'S3: the service address (empty for Amazon S3). Azure: the blob service address, only for a test against Azurite.' },
            prefix: { type: 'string', description: 'The folder inside the bucket or container. Default aimeat/<node>/stores/<name>/.' },
            selectable: { type: 'boolean', description: 'Whether every person may choose this store for a file.' },
            make_default: { type: 'boolean', description: 'true: new files go here. false on the default: the environment\'s setting decides again.' },
        },
    },
    {
        name: 'aimeat_admin_file_store_remove',
        description: 'Operator-only. Remove a named node store. Refused while files are in it (FILES_IN_STORE): move them first with aimeat_admin_file_store_move from "node:<name>". Removing the default lets the environment\'s setting decide again. The keys are deleted; the bucket or container is not touched. Same as DELETE /v1/admin/file-store/stores/{name}.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Remove a File Store', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', required: true, description: 'The store to remove.' },
        },
    },
    {
        name: 'aimeat_admin_file_store_test',
        description: 'Operator-only. Test a node store: write, read, read part of, list and remove one small object under its folder, and answer each step with what the store said. With `name`, one of the named stores (its last test is kept); without, the store the environment names, which answers NO_FILE_STORE when files are kept in the database and FILE_STORE_INCOMPLETE with the missing settings. Same as POST /v1/admin/file-store/test.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Test File Storage', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', description: 'A named store. Leave out for the environment\'s store.' },
        },
    },
    {
        name: 'aimeat_admin_file_store_move',
        description: 'Operator-only. Move up to `limit` files out of one node place: `from` "database" (the default) or a node store "node:<name>" (the environment\'s is "node:s3" or "node:azure"). With `to` ("node:<name>") every file goes there; without it each goes where a new file of the same owner goes now: their default own store when they have one the node lets them use, else the node\'s store for new files. A person\'s own stores are never a `from`: those files are the person\'s to move. A file keeps its name, owner, visibility, links and creation time; a file changed while it was being moved is left as it is. Answers moved, skipped, failed (with the reason per file), moved_bytes_mb, remaining, and `next`: pass it back as `after` to go on past files that failed. Call again while remaining is above 0. Same as POST /v1/admin/file-store/move.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Move Files between Node Stores', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            from: { type: 'string', description: '"database" (default) or "node:<name>".' },
            to: { type: 'string', description: '"node:<name>". Leave out for where each file\'s new files go.' },
            limit: { type: 'number', description: 'How many files in this call, 1 to 500. Default 100.' },
            after: { type: 'string', description: 'The `next` of the previous answer, to go on from there.' },
        },
    },
    {
        name: 'aimeat_admin_file_store_decide',
        description: 'Operator-only. On a node where operators approve who may keep files in their own storage: "approve" lets the person\'s stores take their new files; "decline" answers a request; "revoke" takes an approval back, after which new files go to the node again (files already in their storage stay readable). Decline and revoke need `note`, which the person reads. The person is told either way. Same as POST /v1/admin/file-store/owners/{owner}/decision.',
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
