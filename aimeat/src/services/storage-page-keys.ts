/**
 * @file src/services/storage-page-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage keys whose bytes a page origin serves, and what the generic file write and
 *   delete ask about them (secaudit2026oct31w2 round 11). The generic routes (POST /v1/storage, its
 *   presigned and chunked forms, POST /v1/memory/files, DELETE /v1/storage, aimeat_storage_upload and
 *   aimeat_storage_delete) store any key; two keys are also served as a page:
 *
 *   - `company/<id>/index.html`, a company's page at its address: a write or a delete asks what the
 *     company page route asks, company:write (services/company/company-page-key.ts).
 *   - `portfolio/index.html`, the owner's welcome page: a write or a delete that changes the page served
 *     notes its writer, so a page whose writer may not read memory waits for the owner before it reads
 *     the owner's memory (services/portfolio-read-hold.ts notePortfolioFileChange).
 *
 *   The writer is taken from the caller the door hands the write (`publishGate`'s caller), or, for a
 *   presigned upload, from the signed token (`page_writer`, set at the mint). A write the node makes for
 *   itself names no writer: it is not asked about the company page, and a welcome page it changes waits
 *   with a question that names no writer.
 * @structure PageWriter · pageWriterOf · pageWriterMeta · pageWriterFromMeta · pageKeyWriteRefusal ·
 *   notePageKeyChange
 * @usage
 *   const writer = pageWriterOf(deps, input.publishGate);
 *   const refused = await pageKeyWriteRefusal(deps, ownerGaii, key, writer);
 *   ...store...
 *   await notePageKeyChange(deps, ownerGaii, key, writer, data);
 * @version-history
 *   v1.1.0 — 2026-11-01 — The welcome page key: notePageKeyChange, and the writer carried in a presigned
 *     token (secaudit2026oct31w2 round 11, portfolio-read-hold:absent-record-adopted-at-first-read).
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11,
 *     storage-file-write:company-front-page-key-unfenced-below-company-write).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CallerContext } from './caller-context.js';
import type { PublishRequester } from './publish-requests/store.js';
import { requesterOf } from './publish-requests/ask.js';
import { companyPageIdOf, companyPageWriteRefusal, COMPANY_PAGE_WRITE_SCOPE, type CompanyPageRefusal } from './company/company-page-key.js';
import { PORTFOLIO_HTML_KEY } from './portfolio-config.js';
import { notePortfolioFileChange } from './portfolio-read-hold.js';
import { localAccountName } from '../utils/gaii.js';

type Ctx = { storage: Storage; config: AimeatConfig };

/** Who writes a page key, as the rules for the served pages need it. */
export interface PageWriter {
    /** Who asks the owner when the write needs an answer: an app by its app, an agent by its GAII, the owner. */
    requester: PublishRequester;
    /** The account holder in person. */
    inPerson: boolean;
    /** Holds company:write, the word of the company page route. */
    writesCompany: boolean;
    /** Holds memory:read: a welcome page it writes reads the owner's memory with no question. */
    readsMemory: boolean;
}

/** The writer of a door's caller (the `publishGate` a door hands the write), or null when no caller is named. */
export function pageWriterOf(ctx: Ctx, gate: { caller: CallerContext; app?: string } | { requester: PublishRequester } | undefined): PageWriter | null {
    if (!gate || !('caller' in gate)) return null;
    const c = gate.caller;
    return {
        requester: requesterOf(ctx, c, gate.app), inPerson: c.inPerson,
        writesCompany: c.has(COMPANY_PAGE_WRITE_SCOPE), readsMemory: c.has('memory:read'),
    };
}

/** What a presigned token carries for the welcome page key (`page_writer`); undefined for any other key. */
export function pageWriterMeta(key: string, writer: PageWriter | null): Record<string, unknown> | undefined {
    if (key !== PORTFOLIO_HTML_KEY || !writer) return undefined;
    const r = writer.requester;
    return { principal: r.principal, kind: r.kind, sub: r.sub, reads_memory: writer.readsMemory };
}

/** The writer a presigned token carries (pageWriterMeta), or undefined when it carries none. */
export function pageWriterFromMeta(v: unknown): PageWriter | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const m = v as Record<string, unknown>;
    if (typeof m.principal !== 'string' || typeof m.sub !== 'string' || !['agent', 'app', 'person'].includes(String(m.kind))) return undefined;
    return {
        requester: { principal: m.principal, kind: m.kind as PublishRequester['kind'], sub: m.sub },
        // The mint asked the company page key itself; only the welcome page key carries a writer.
        inPerson: false, writesCompany: false, readsMemory: m.reads_memory === true,
    };
}

/** A refusal for writing or deleting `key` in `ownerGaii`'s files, or null when the key is no served page or the writer may. */
export async function pageKeyWriteRefusal(ctx: Ctx, ownerGaii: string, key: string, writer: PageWriter | null): Promise<CompanyPageRefusal | null> {
    const companyId = companyPageIdOf(key);
    return companyId ? companyPageWriteRefusal(ctx, ownerGaii, companyId, writer) : null;
}

/**
 * After `key` was written (`data`: the bytes, when the node held them) or deleted (no data) in
 * `ownerGaii`'s files: the welcome page notes its writer. Never throws.
 */
export async function notePageKeyChange(ctx: Ctx, ownerGaii: string, key: string, writer: PageWriter | null, data?: Buffer): Promise<void> {
    if (key !== PORTFOLIO_HTML_KEY) return;
    const digest = data && data.length ? createHash('sha256').update(data).digest('hex') : null;
    await notePortfolioFileChange(ctx, localAccountName(ownerGaii),
        writer ? { requester: writer.requester, readsMemory: writer.readsMemory } : null, digest);
}
