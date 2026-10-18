/**
 * @file src/services/memory-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate for a memory write, as one set of functions every memory write path
 *   calls (plan doc-mvcn6c7e4e5q, V4): the single write (services/memory-write.ts), the batch write
 *   (services/memory-batch-write.ts, behind POST /v1/memory/bulk and POST /v1/memory/import) and the
 *   copy (POST /v1/memory/copy). The decision itself is services/publish-gate.ts; this file maps a
 *   memory writer onto it, keeps a record at the level it had, and files the request after the write.
 *
 *   ONE GATE, SEVERAL WRITE PATHS. A write that raises a record to public, by a caller the node asks
 *   the owner about, stores the record at the level it had (a new one: private) and then files a
 *   request of kind 'memory' that services/publish-requests/apply-memory.ts applies on approval.
 * @structure MemoryPublishWriter · memoryWriterAsk · keptMemoryLevel · MemoryCapRefusal ·
 *   memoryCapRefusal · fileMemoryPublishRequest · MemoryPublishFiled
 * @usage
 *   const ask = memoryWriterAsk({ storage, config }, writer);
 *   if (ask.kind === 'ask' && isRaiseToPublic(existing?.visibility, visibility)) { ...keptMemoryLevel(existing)... }
 *   const filed = await fileMemoryPublishRequest({ storage, config }, ask.requester, record);
 * @version-history
 *   v1.1.0 — 2026-10-18 — memoryCapRefusal(): the label's audience cap for every memory write path,
 *     asked before the publish gate (plan doc-mvdipuyqraas, L3.2).
 *   v1.0.0 — 2026-10-18 — Initial: extracted from services/memory-write.ts so the batch write and the
 *     copy ask the same gate (plan doc-mvcn6c7e4e5q, V4).
 */
import type { MemoryRecord } from '../storage/interface.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { publishAskOf, fileAsk, publishRequestedBody, type PublishAsk } from './publish-requests/ask.js';
import { callerFromAuth } from './caller-context.js';
import { localAccountName, ownerGhiiOf } from '../utils/gaii.js';
import type { ContentLabelTarget } from '../storage/types/content-labels.js';
import { audienceCapOf, audienceOfVisibility, type LABEL_CAPS_AUDIENCE } from './classification/audience-cap.js';

/** The token facts a memory write path has about its writer. */
export interface MemoryPublishWriter {
    /** The principal that writes (provenance names it). */
    principal: string;
    /** The namespace the record lands in; its owner is the one asked. */
    targetGaii: string;
    roles: readonly string[];
    scopes: readonly string[];
    federated?: boolean;
    /** `owner/filename` of an app grant, so the request names the app that asked. */
    app?: string;
}

/**
 * May this writer make a record public on its own (services/publish-gate.ts). Built from the facts
 * every write path has, as callerFromAuth builds the caller object for a route.
 */
export function memoryWriterAsk(ctx: PublishStoreCtx, writer: MemoryPublishWriter): PublishAsk {
    const caller = callerFromAuth({
        sub: writer.principal, owner: localAccountName(ownerGhiiOf(writer.targetGaii)),
        roles: [...writer.roles], scopes: [...writer.scopes],
        ...(writer.federated !== undefined ? { federated: writer.federated } : {}),
    }, ctx.config.nodeId, ctx.storage);
    return publishAskOf(ctx, caller, writer.app);
}

/** The level a record keeps when making it public waits for the owner: what it had, or private. */
export function keptMemoryLevel(existing: Pick<MemoryRecord, 'visibility' | 'groupId' | 'workspaceRef'> | null | undefined): {
    visibility: MemoryRecord['visibility']; groupId: string | undefined; workspaceRef: string | undefined;
} {
    const visibility = existing?.visibility ?? 'private';
    return {
        visibility,
        groupId: visibility === 'group' ? existing?.groupId : undefined,
        workspaceRef: visibility === 'workspace' ? existing?.workspaceRef : undefined,
    };
}

/** A memory write path's refusal for a level over a label's audience cap. */
export type MemoryCapRefusal = { ok: false; status: 409; code: typeof LABEL_CAPS_AUDIENCE; message: string };

/**
 * The label's audience cap for a memory write (plan doc-mvdipuyqraas, L3.2): null when the record may
 * have `to`, or the 409 to answer. Asked before the publish gate and before anything is stored. Each
 * target is held to its own effective label: a copy names its source too, whose label it carries.
 */
export async function memoryCapRefusal(
    ctx: PublishStoreCtx, writer: { principal: string; roles: readonly string[] },
    targets: readonly ContentLabelTarget[], to: unknown, from: unknown, where: string,
): Promise<MemoryCapRefusal | null> {
    const level = audienceOfVisibility(to);
    if (level === 'private') return null;
    const by = { principal: writer.principal, kind: writer.roles.some(r => r === 'agent' || r === 'ecosystem') ? 'ai' as const : 'human' as const };
    for (const target of targets) {
        const cap = await audienceCapOf(ctx, target, level, { from: from === undefined || from === null ? null : audienceOfVisibility(from), by, where });
        if (cap.kind === 'refused') return { ok: false, status: cap.status, code: cap.code, message: cap.message };
    }
    return null;
}

/** What filing answers: the request body for the caller, or the warning a write carries instead. */
export type MemoryPublishFiled =
    | { ok: true; publishRequest: ReturnType<typeof publishRequestedBody> }
    | { ok: false; warning: { code: 'PUBLISH_NOT_ASKED'; message: string } };

/**
 * File the request for a record that was stored at the level it had. Called after the write, so the
 * request names the version the owner is asked about.
 */
export async function fileMemoryPublishRequest(
    ctx: PublishStoreCtx, requester: PublishRequester,
    record: Pick<MemoryRecord, 'ownerGaii' | 'key' | 'version' | 'visibility'>,
): Promise<MemoryPublishFiled> {
    const filed = await fileAsk(ctx, ownerGhiiOf(record.ownerGaii), requester, {
        kind: 'memory',
        target: { namespace: record.ownerGaii, key: record.key, version: record.version },
        title: `the record ${record.key}`,
        name: record.key,
        change: { field: 'visibility', from: record.visibility, to: 'public' },
    });
    if (filed.ok) return { ok: true, publishRequest: publishRequestedBody(ctx, filed) };
    return { ok: false, warning: { code: 'PUBLISH_NOT_ASKED', message: `Saved as ${record.visibility}, not public: ${filed.message}` } };
}
