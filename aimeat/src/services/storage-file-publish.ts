/**
 * @file src/services/storage-file-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate for a stored file (plan doc-mvcn6c7e4e5q, V4): an upload or a
 *   visibility change that makes a file public, by a caller the node asks the owner about, stores the
 *   file at the level it had (a new one: private) and files a request of kind 'file', which
 *   services/publish-requests/apply-file.ts applies on approval. The decision is
 *   services/publish-gate.ts; this file maps a stored file onto it.
 *
 *   TWO SHAPES OF CALLER. A route or an MCP tool hands its caller object and the gate asks now. A
 *   presigned upload asks at the mint, where the caller is known, and carries the requester in the
 *   signed token (`publish_ask`), so PUT /v1/upload/:token files the request when the bytes land.
 *
 *   THE VERSION OF A FILE. A stored file has no version number; its `createdAt` is rewritten on every
 *   write to the key (both providers upsert it), so `created_at` and `size` in the request's target
 *   say which bytes the owner was asked about.
 * @structure StoragePublishGate · FileRaise · fileRaiseAsk · fileCapRefusal · closedFileLevel · keptFileLevel ·
 *   mintPublishCarry · fileFilePublishRequest · requesterFromMeta
 * @usage
 *   const closed = await closedFileLevel(ctx, ownerGaii, key, visibility);
 *   const raise = await fileRaiseAsk(ctx, ownerGaii, key, closed.visibility, gate);
 *   if (raise.kind === 'ask') { ...store at keptFileLevel(raise.existing)..., then fileFilePublishRequest(...) }
 * @version-history
 *   v1.2.0 — 2026-10-18 — fileCapRefusal: a file given a level wider than its label allows is refused
 *     with 409 LABEL_CAPS_AUDIENCE before the publish gate (plan doc-mvdipuyqraas, L3.2).
 *   v1.1.0 — 2026-10-18 — closedFileLevel: on a node that shows its content to signed-in accounts
 *     only, a file asked as public is stored at 'members' with PUBLIC_IS_SIGNED_IN_HERE (plan V1.6).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: stored files).
 */
import type { StorageFileRecord } from '../storage/interface.js';
import type { CallerContext } from './caller-context.js';
import { isRaiseToPublic } from './publish-gate.js';
import { publishAskOf, fileAsk, publishRequestedBody } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { signedInOnly } from '../config-visibility.js';
import { closedNodeLevel, type ClosedNodeWarning } from './closed-node-level.js';
import {
    audienceCapOf, audienceOfVisibility, capByOf, capRefusalOf, type LABEL_CAPS_AUDIENCE,
} from './classification/audience-cap.js';
import { fileTarget } from './classification/labels.js';

/**
 * Who makes the file public: a caller the gate asks now (a route's callerOf, an MCP tool's caller()),
 * or the requester a presigned mint already asked about.
 */
export type StoragePublishGate =
    | { caller: CallerContext; app?: string }
    | { requester: PublishRequester };

export type FileRaise =
    /** Not a raise to public, or a caller that may make it public. */
    | { kind: 'none' }
    /** Nobody on this node to ask (a visitor, the anonymous identity). */
    | { kind: 'refused'; status: 403; code: 'PUBLISH_NOT_ALLOWED'; message: string }
    /** Store it at the level it had and file a request. `existing` is the file's metadata, or null. */
    | { kind: 'ask'; requester: PublishRequester; existing: StorageFileRecord | null };

/** Does this change raise the file to public, and if so, may the caller do it on its own. */
export async function fileRaiseAsk(
    ctx: PublishStoreCtx, ownerGaii: string, key: string, visibility: unknown, gate: StoragePublishGate | undefined,
): Promise<FileRaise> {
    if (!gate || visibility !== 'public') return { kind: 'none' };
    const existing = await ctx.storage.getStorageFileMeta(ownerGaii, key);
    if (!isRaiseToPublic(existing?.visibility, visibility)) return { kind: 'none' };
    if ('requester' in gate) return { kind: 'ask', requester: gate.requester, existing };
    const ask = publishAskOf(ctx, gate.caller, gate.app);
    if (ask.kind === 'allowed') return { kind: 'none' };
    if (ask.kind === 'refused') return { kind: 'refused', status: 403, code: 'PUBLISH_NOT_ALLOWED', message: ask.message };
    return { kind: 'ask', requester: ask.requester, existing };
}

/**
 * The label's audience cap for a stored file (plan doc-mvdipuyqraas, L3.2): null when the file may be
 * given `visibility`, or the 409 to answer. Asked at the doors that ask the publish gate, before it and
 * before anything is stored. The file's label address follows its workspace binding (labels.ts
 * fileTarget), so a file shared into a classified workspace is held to that workspace's label.
 */
export async function fileCapRefusal(
    ctx: PublishStoreCtx, ownerGaii: string, key: string, visibility: unknown, workspaceRef: string | undefined,
    gate: StoragePublishGate | undefined,
): Promise<{ ok: false; status: 409; code: typeof LABEL_CAPS_AUDIENCE; message: string } | null> {
    const level = audienceOfVisibility(visibility);
    if (!gate || level === 'private') return null;
    const existing = await ctx.storage.getStorageFileMeta(ownerGaii, key);
    return capRefusalOf(await audienceCapOf(ctx, fileTarget(ownerGaii, key, workspaceRef ?? existing?.workspaceRef), level, {
        from: existing ? audienceOfVisibility(existing.visibility) : null,
        ...('caller' in gate ? { by: capByOf(gate.caller) } : {}), where: 'stored file',
    }));
}

/**
 * The level of a file asked as public on a node that shows its content to signed-in accounts only
 * (services/closed-node-level.ts, plan V1.6): 'members' with the warning, unless the file is public
 * already. Asked before fileRaiseAsk / mintPublishCarry, so a lowered file asks nothing.
 */
export async function closedFileLevel<V>(
    ctx: PublishStoreCtx, ownerGaii: string, key: string, visibility: V,
): Promise<{ visibility: V | 'members'; warning: ClosedNodeWarning | null }> {
    if (visibility !== 'public' || !signedInOnly(ctx.config)) return { visibility, warning: null };
    const existing = await ctx.storage.getStorageFileMeta(ownerGaii, key);
    const closed = closedNodeLevel(ctx.config, visibility, 'members' as const, { from: existing?.visibility });
    return { visibility: closed.level, warning: closed.warning };
}

/** The level a file keeps while making it public waits for the owner: what it had, or private. */
export function keptFileLevel(existing: StorageFileRecord | null): {
    visibility: StorageFileRecord['visibility']; groupId: string | undefined; workspaceRef: string | undefined;
} {
    const visibility = existing?.visibility ?? 'private';
    return {
        visibility,
        groupId: visibility === 'group' ? existing?.groupId : undefined,
        workspaceRef: visibility === 'workspace' ? existing?.workspaceRef : undefined,
    };
}

/**
 * The gate at a presigned mint. The bytes land later, so the mint carries the requester in the signed
 * token when the caller would be asked, and the landing decides whether that upload raises the file.
 * Refused (nobody to ask) only when the file is not public already.
 */
export async function mintPublishCarry(
    ctx: PublishStoreCtx, ownerGaii: string, key: string, visibility: unknown,
    gate: { caller: CallerContext; app?: string } | undefined,
): Promise<{ ok: true; requester?: PublishRequester } | { ok: false; status: 403; code: 'PUBLISH_NOT_ALLOWED'; message: string }> {
    if (!gate || visibility !== 'public') return { ok: true };
    const ask = publishAskOf(ctx, gate.caller, gate.app);
    if (ask.kind === 'allowed') return { ok: true };
    if (ask.kind === 'ask') return { ok: true, requester: ask.requester };
    const existing = await ctx.storage.getStorageFileMeta(ownerGaii, key);
    if (existing?.visibility === 'public') return { ok: true };
    return { ok: false, status: 403, code: 'PUBLISH_NOT_ALLOWED', message: ask.message };
}

/** The requester a presigned token carries (`publish_ask`), or undefined when it carries none. */
export function requesterFromMeta(value: unknown): PublishRequester | undefined {
    const v = value as Partial<PublishRequester> | null | undefined;
    if (!v || typeof v.principal !== 'string' || typeof v.sub !== 'string' || (v.kind !== 'agent' && v.kind !== 'app')) return undefined;
    return { principal: v.principal, kind: v.kind, sub: v.sub };
}

/** What filing answers: the request body for the caller, or the warning a write carries instead. */
export type FilePublishFiled =
    | { ok: true; publishRequest: ReturnType<typeof publishRequestedBody> }
    | { ok: false; warning: { code: 'PUBLISH_NOT_ASKED'; message: string } };

/** File the request for a file that was stored (or kept) at the level it had. */
export async function fileFilePublishRequest(
    ctx: PublishStoreCtx, requester: PublishRequester,
    file: Pick<StorageFileRecord, 'ownerGaii' | 'key' | 'createdAt' | 'size' | 'visibility'>,
): Promise<FilePublishFiled> {
    const filed = await fileAsk(ctx, ownerGhiiOf(file.ownerGaii), requester, {
        kind: 'file',
        target: { owner: file.ownerGaii, key: file.key, created_at: file.createdAt, size: file.size },
        title: `the file ${file.key}`,
        name: file.key,
        change: { field: 'visibility', from: file.visibility, to: 'public' },
    });
    if (filed.ok) return { ok: true, publishRequest: publishRequestedBody(ctx, filed) };
    return { ok: false, warning: { code: 'PUBLISH_NOT_ASKED', message: `Stored as ${file.visibility}, not public: ${filed.message}` } };
}
