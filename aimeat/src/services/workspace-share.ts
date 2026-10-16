/**
 * @file src/services/workspace-share.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace's share (`organism.{id}.w.{ws}.meta.share`): reading it, deciding what it
 *   opens, and setting it. One implementation for PUT /v1/organisms/:id/workspace/share and the MCP
 *   tool aimeat_workspace_share, which until 2026-10-16 did not exist: a share could be set only from
 *   the browser, so an AI that wrote and published a page could not hand anybody its link.
 *
 *   END DATES (Jouni, 2026-10-16). A share opens the whole workspace, a space, or one page, and each
 *   of those can now end: `until` maps the same targets (`*`, `space:<name>`, `<space>/<id>`) to an
 *   ISO date, past which the target reads as not shared. An open link to an HTML page ends after
 *   HTML_PAGE_SHARE_DAYS when the share names no date, because HTML pages are many and most are made
 *   for one occasion; a Markdown page has no default end, because a public handbook must not expire.
 *   A share made before this has no `until` and stays exactly as it was.
 * @structure
 *   - resolveShare() · readShareMetaOf() · redactShareOf() — the share as stored, as decided, as shown
 *   - isDocPublicAt() — does the share open this page now
 *   - memberRoleOf() — the caller's active role in the organism (the share routes' membership check)
 *   - publicViewerPath() — the address a person opens a shared workspace or page at
 *   - setWorkspaceShareOp() — validate, merge, default the end dates, store, announce
 * @usage
 *   const share = await readShareMetaOf(storage, config, orgId, ws);
 *   if (!isDocPublicAt(share, 'docs', docId)) …
 * @version-history
 *   v1.0.0 — 2026-10-16 — Moved out of routes/organisms/shared.ts (readShareMeta, redactShare,
 *     memberRole) and routes/organisms/workspace-ops.ts (the PUT body) so the MCP tool runs the same
 *     code; `until` and the HTML page default are new.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import type { ShareAccess, ShareMeta, ResolvedShare } from '../routes/organisms/share-types.js';
import { readWorkspaceMetaRecord, findWorkspaceRegistration } from './workspace-meta-read.js';
import { findWorkspaceRecord } from './workspace-write.js';
import { hashPassword } from './password.js';
import { newIcsKey } from './calendar-feed.js';
import { emitChange } from './event-bus.js';
import { recordPublicActivity } from './public-activity.js';
import { isHtmlPageValue, HTML_PAGE_SHARE_DAYS } from './html-page.js';
import { logger } from '../utils/logger.js';

/** The share as the node decides with it: every field present. */
export function resolveShare(v: ShareMeta | null | undefined): ResolvedShare {
    const s = v ?? {};
    const access: ShareAccess = s.access === 'password' || s.access === 'account' ? s.access : 'open';
    const until: Record<string, string> = {};
    for (const [k, d] of Object.entries(s.until ?? {})) if (typeof d === 'string' && d) until[k] = d;
    return {
        public: !!s.public, spaces: s.spaces ?? {}, docs: s.docs ?? {},
        access, passwordHash: typeof s.passwordHash === 'string' ? s.passwordHash : null,
        icsKeyHash: typeof s.icsKeyHash === 'string' ? s.icsKeyHash : null,
        until,
    };
}

/** The copy that counts (services/workspace-meta.ts), so a member's own copy shares nothing. */
export async function readShareMetaOf(storage: Storage, config: AimeatConfig, orgId: string, ws: string): Promise<ResolvedShare> {
    return resolveShare((await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.share', config.nodeId))?.value as ShareMeta | undefined);
}

/** The share as the API may show it: the password hash and the feed key's hash never leave the server. */
export function redactShareOf(share: ResolvedShare): Record<string, unknown> {
    return {
        public: share.public, spaces: share.spaces, docs: share.docs, until: share.until,
        access: share.access, has_password: !!share.passwordHash, has_ics_key: !!share.icsKeyHash,
    };
}

const ended = (iso: string | undefined, nowMs: number): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t <= nowMs;
};

/**
 * Does the share open this page now? The most specific setting decides (the page's own, then its
 * space's, then the workspace's), and an end date at that level that has passed closes it.
 */
export function isDocPublicAt(share: ResolvedShare, typeName: string, docId: string, nowMs: number = Date.now()): boolean {
    const docKey = `${typeName}/${docId}`;
    if (docKey in share.docs) return !!share.docs[docKey] && !ended(share.until[docKey], nowMs);
    if (typeName in share.spaces) return !!share.spaces[typeName] && !ended(share.until[`space:${typeName}`], nowMs);
    return !!share.public && !ended(share.until['*'], nowMs);
}

/** The caller's active role in the organism: an organism agent is a member, a person by their membership. */
export async function memberRoleOf(
    storage: Storage, organism: Pick<OrganismRecord, 'agentGaiis'>, orgId: string, who: { sub?: string; owner?: string },
): Promise<string | null> {
    if (who.sub && organism.agentGaiis.includes(who.sub)) return 'member';
    if (!who.owner) return null;
    const m = await storage.getMembership(orgId, who.owner);
    return m && m.status === 'active' ? m.role : null;
}

/** The address a person opens the shared workspace at, or one page of it. Relative to the node. */
export function publicViewerPath(orgId: string, ws: string, type?: string, id?: string): string {
    const page = type && id ? `&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}` : '';
    return `/v1/publicworkspaceviewer?org=${encodeURIComponent(orgId)}&ws=${encodeURIComponent(ws)}${page}`;
}

export interface SetShareBody {
    public?: unknown; spaces?: unknown; docs?: unknown; access?: unknown;
    password?: unknown; ics_key?: unknown; until?: unknown;
}

export type SetShareResult =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; status: number; code: string; message: string };

const isBoolMap = (m: unknown): m is Record<string, boolean> =>
    !!m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every(v => typeof v === 'boolean');

/** A target an end date may name: the whole workspace, a space, or a page. */
const UNTIL_KEY_RE = /^(\*|space:[^/\s]{1,200}|[^/\s]{1,200}\/[^/\s]{1,200})$/;

/** The page value at `<space>/<id>`, published copy first, for the HTML default. Null when it is not there. */
async function pageValueOf(storage: Storage, config: AimeatConfig, orgId: string, ws: string, docKey: string): Promise<unknown> {
    const slash = docKey.indexOf('/');
    const type = docKey.slice(0, slash), id = docKey.slice(slash + 1);
    const manifest = (await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.manifest', config.nodeId))?.value as { objectTypes?: Array<Record<string, unknown>> } | undefined;
    const ot = (manifest?.objectTypes ?? []).find(o => o && o.name === type && typeof o.namespace === 'string');
    if (!ot) return null;
    const base = `organism.${orgId}.w.${ws}.${ot.namespace as string}.${id}`;
    return (await findWorkspaceRecord(storage, `${base}.latest`))?.value ?? (await findWorkspaceRecord(storage, `${base}.draft`))?.value ?? null;
}

/**
 * Set a workspace's share: the body is MERGED into what is stored. The workspace creator or an
 * organism admin only. The record stays under the identity that holds the copy that counts (or, with
 * none yet, the one that registered the workspace), so there is one canonical share record.
 *
 * `until` merges the same way: a date sets the end, null removes it. A page that this call opens and
 * that is an HTML page gets HTML_PAGE_SHARE_DAYS when the call and the stored share name no end for it.
 */
export async function setWorkspaceShareOp(
    deps: { storage: Storage; config: AimeatConfig },
    who: { sub?: string; owner?: string },
    args: { orgId: string; ws: string; body: SetShareBody },
): Promise<SetShareResult> {
    const { storage, config } = deps;
    const { orgId, ws } = args;
    const body = args.body ?? {};
    const refuse = (status: number, code: string, message: string): SetShareResult => ({ ok: false, status, code, message });
    const organism = await storage.getOrganism(orgId);
    if (!organism) return refuse(404, 'NOT_FOUND', 'Organism not found');
    if (!ws) return refuse(400, 'INVALID_INPUT', 'ws is required');
    const role = await memberRoleOf(storage, organism, orgId, who);
    if (!role) return refuse(403, 'ACCESS_DENIED', 'Not an active member of this organism');
    const reg = await findWorkspaceRegistration(storage, orgId, ws);
    if (!reg) return refuse(404, 'NOT_FOUND', 'Workspace not found');
    if (reg.creator !== who.owner && role !== 'creator' && role !== 'admin') {
        return refuse(403, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can change sharing');
    }
    if (body.spaces !== undefined && !isBoolMap(body.spaces)) return refuse(400, 'INVALID_INPUT', 'spaces must be a map of name → boolean');
    if (body.docs !== undefined && !isBoolMap(body.docs)) return refuse(400, 'INVALID_INPUT', 'docs must be a map of key → boolean');
    if (body.access !== undefined && body.access !== 'open' && body.access !== 'password' && body.access !== 'account') {
        return refuse(400, 'INVALID_INPUT', "access must be 'open', 'password' or 'account'");
    }
    if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
        return refuse(400, 'INVALID_INPUT', 'password must be a string (set) or null (clear)');
    }
    if (typeof body.password === 'string' && (body.password.length < 4 || body.password.length > 128)) {
        return refuse(400, 'INVALID_INPUT', 'password must be 4–128 characters');
    }
    if (body.ics_key !== undefined && body.ics_key !== true && body.ics_key !== null) {
        return refuse(400, 'INVALID_INPUT', 'ics_key is true (make a new feed key; it ends the one before) or null (clear it)');
    }
    const nowMs = Date.now();
    const untilIn: Record<string, string | null> = {};
    if (body.until !== undefined) {
        if (!body.until || typeof body.until !== 'object' || Array.isArray(body.until)) {
            return refuse(400, 'INVALID_INPUT', 'until maps a target ("*", "space:<name>" or "<space>/<id>") to an ISO date, or to null to remove its end');
        }
        const entries = Object.entries(body.until as Record<string, unknown>);
        if (entries.length > 500) return refuse(400, 'INVALID_INPUT', 'until names at most 500 targets in one call');
        for (const [k, d] of entries) {
            if (!UNTIL_KEY_RE.test(k)) return refuse(400, 'INVALID_INPUT', `until: "${k}" is not a target; use "*", "space:<name>" or "<space>/<id>"`);
            if (d === null) { untilIn[k] = null; continue; }
            const t = typeof d === 'string' ? Date.parse(d) : NaN;
            if (!Number.isFinite(t)) return refuse(400, 'INVALID_INPUT', `until: "${k}" needs an ISO date such as 2027-01-31, or null`);
            if (t <= nowMs) return refuse(400, 'INVALID_INPUT', `until: the end of "${k}" is already past; to stop sharing, set it to false instead`);
            untilIn[k] = new Date(t).toISOString();
        }
    }

    const prev = await readShareMetaOf(storage, config, orgId, ws);
    const nextHash = typeof body.password === 'string' ? await hashPassword(body.password)
        : body.password === null ? null : prev.passwordHash;
    const feedKey = body.ics_key === true ? newIcsKey() : null;
    const docsIn = (body.docs as Record<string, boolean> | undefined) ?? {};
    const until: Record<string, string> = { ...prev.until };
    for (const [k, d] of Object.entries(untilIn)) { if (d === null) delete until[k]; else until[k] = d; }
    // A target that stops being shared keeps no end date: a later share of it starts fresh.
    for (const [k, v] of Object.entries(docsIn)) if (v === false) delete until[k];
    for (const [k, v] of Object.entries((body.spaces as Record<string, boolean> | undefined) ?? {})) if (v === false) delete until[`space:${k}`];
    if (body.public === false) delete until['*'];
    // The HTML page default: a page this call opens, with no end named for it anywhere.
    const defaultEnd = new Date(nowMs + HTML_PAGE_SHARE_DAYS * 86_400_000).toISOString();
    for (const [k, v] of Object.entries(docsIn)) {
        if (v !== true || k in untilIn || until[k] || prev.docs[k] === true) continue;
        if (!/^[^/\s]+\/[^/\s]+$/.test(k)) continue;
        if (isHtmlPageValue(await pageValueOf(storage, config, orgId, ws, k))) until[k] = defaultEnd;
    }
    const next: ResolvedShare = {
        public: typeof body.public === 'boolean' ? body.public : prev.public,
        spaces: { ...prev.spaces, ...((body.spaces as Record<string, boolean> | undefined) ?? {}) },
        docs: { ...prev.docs, ...docsIn },
        access: (body.access as ShareAccess | undefined) ?? prev.access,
        passwordHash: nextHash,
        icsKeyHash: feedKey ? feedKey.hash : body.ics_key === null ? null : prev.icsKeyHash,
        until,
    };
    if (next.access === 'password' && !next.passwordHash) return refuse(400, 'INVALID_INPUT', "access 'password' requires a password to be set");

    const key = `organism.${orgId}.w.${ws}.meta.share`;
    const existing = await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.share', config.nodeId);
    const now = new Date(nowMs).toISOString();
    await storage.setMemory({
        key, ownerGaii: existing?.ownerGaii ?? reg.record.ownerGaii, value: next, visibility: 'private', tags: ['share'], ttlHours: null,
        version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('organisms');

    // Public landing feed: once, on the FIRST public edge of this call (the workspace, a space, or a page).
    const newlyPublic = (
        (next.public === true && prev.public === false)
        || Object.entries(next.spaces).some(([k, v]) => v === true && prev.spaces[k] !== true)
        || Object.entries(next.docs).some(([k, v]) => v === true && prev.docs[k] !== true)
    );
    if (newlyPublic) {
        const name = reg.entry.name ?? ws;
        void recordPublicActivity(storage, config, {
            category: 'organisms', actor: who.owner ?? '',
            summary: `Workspace "${name}" published publicly`,
            detail: organism.name ? `In organism "${organism.name}"` : '',
            link: publicViewerPath(orgId, ws),
        }).catch(err => { logger.warn('setWorkspaceShareOp: feed is best-effort', { error: String(err) }); });
    }
    // The address to hand out: the one page this call shared, else the workspace's viewer.
    const sharedNow = Object.entries(docsIn).filter(([, v]) => v === true).map(([k]) => k);
    const page = sharedNow.length === 1 ? sharedNow[0].split('/') : null;
    // A new feed key is in this answer and in no later one: only its hash is kept.
    return {
        ok: true,
        data: {
            organism_id: orgId, ws, share: redactShareOf(next),
            viewer_url: `${config.baseUrl}${page && page.length === 2 ? publicViewerPath(orgId, ws, page[0], page[1]) : publicViewerPath(orgId, ws)}`,
            ...(page && until[sharedNow[0]] ? { ends_at: until[sharedNow[0]] } : {}),
            ...(feedKey ? { ics_key: feedKey.key, ics_url: `/v1/organisms/${orgId}/workspace/public/records?ws=${encodeURIComponent(ws)}&space=<space>&format=ics&key=${feedKey.key}` } : {}),
        },
    };
}
