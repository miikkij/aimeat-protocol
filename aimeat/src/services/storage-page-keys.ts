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
 *
 *   The writer is taken from the caller the door hands the write (`publishGate`'s caller). A write the
 *   node makes for itself names no writer and is not asked.
 * @structure PageWriter · pageWriterOf · pageKeyWriteRefusal
 * @usage
 *   const writer = pageWriterOf(deps, input.publishGate);
 *   const refused = await pageKeyWriteRefusal(deps, ownerGaii, key, writer);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11,
 *     storage-file-write:company-front-page-key-unfenced-below-company-write).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CallerContext } from './caller-context.js';
import type { PublishRequester } from './publish-requests/store.js';
import { requesterOf } from './publish-requests/ask.js';
import { companyPageIdOf, companyPageWriteRefusal, COMPANY_PAGE_WRITE_SCOPE, type CompanyPageRefusal } from './company/company-page-key.js';

type Ctx = { storage: Storage; config: AimeatConfig };

/** Who writes a page key, as the rules for the served pages need it. */
export interface PageWriter {
    /** Who asks the owner when the write needs an answer: an app by its app, an agent by its GAII, the owner. */
    requester: PublishRequester;
    /** The account holder in person. */
    inPerson: boolean;
    /** Holds company:write, the word of the company page route. */
    writesCompany: boolean;
}

/** The writer of a door's caller (the `publishGate` a door hands the write), or null when no caller is named. */
export function pageWriterOf(ctx: Ctx, gate: { caller: CallerContext; app?: string } | { requester: PublishRequester } | undefined): PageWriter | null {
    if (!gate || !('caller' in gate)) return null;
    const c = gate.caller;
    return { requester: requesterOf(ctx, c, gate.app), inPerson: c.inPerson, writesCompany: c.has(COMPANY_PAGE_WRITE_SCOPE) };
}

/** A refusal for writing or deleting `key` in `ownerGaii`'s files, or null when the key is no served page or the writer may. */
export async function pageKeyWriteRefusal(ctx: Ctx, ownerGaii: string, key: string, writer: PageWriter | null): Promise<CompanyPageRefusal | null> {
    const companyId = companyPageIdOf(key);
    return companyId ? companyPageWriteRefusal(ctx, ownerGaii, companyId, writer) : null;
}
