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
 *   - shareIsOpen() · shareServedVisibility() — whether what the share opens counts as public for
 *     the AI label (EU AI Act Art. 50(4)) and the compliance counts
 *   - memberRoleOf() — the caller's active role in the organism (the share routes' membership check)
 *   - publicViewerPath() — the address a person opens a shared workspace or page at
 *   - setWorkspaceShareOp() — validate, merge, default the end dates, store, announce
 * @usage
 *   const share = await readShareMetaOf(storage, config, orgId, ws);
 *   if (!isDocPublicAt(share, 'docs', docId)) …
 * @version-history
 *   v1.7.0 — 2026-10-18 — A share wider than the workspace's label, or a newly shared page's label,
 *     allows is refused with 409 LABEL_CAPS_AUDIENCE before the publish gate (plan doc-mvdipuyqraas,
 *     L3.5; workspace-share-gate.ts shareCapRefusal).
 *   v1.6.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, a share asked to
 *     open to anyone (access 'open', named or the starting level) is stored at 'account' and the answer
 *     carries `warnings` PUBLIC_IS_SIGNED_IN_HERE; a share open already stays open (plan V1.6).
 *   v1.5.0 — 2026-10-18 — A share made for the first time without `access` takes
 *     visibility.share_access_default (code default open; plan doc-mvcn6c7e4e5q, V5.5), before the gate.
 *   v1.4.0 — 2026-10-18 — setWorkspaceShareOp takes `publishGate`, the door's caller (plan
 *     doc-mvcn6c7e4e5q, V4): a change that lets anyone with the link read what they could not (access
 *     set to open, or a target shared under open access), by an agent without publish:public, is
 *     stored with that part held back, and the answer carries `publish_request` and `asked`
 *     (services/workspace-share-gate.ts).
 *   v1.3.0 — 2026-10-17 — access 'organism': only the members of the workspace's own organism (plan doc-mvcn6c7e4e5q V3.4).
 *   v1.2.0 — 2026-10-17 — Sharing one HTML page answers `window_url` beside `viewer_url`: the page alone
 *     in the whole browser window (Jouni, 2026-10-17: a link to share that opens only the page).
 *   v1.1.0 — 2026-10-16 — shareIsOpen and shareServedVisibility: the one rule for whether a share's
 *     pages are public when a label is decided, used by the share routes, the member read, the page
 *     host, shared files and the compliance counts.
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
import { shareAccessDefault } from './content-defaults.js';
import { newIcsKey } from './calendar-feed.js';
import { emitChange } from './event-bus.js';
import { recordPublicActivity } from './public-activity.js';
import { isHtmlPageValue, HTML_PAGE_SHARE_DAYS } from './html-page.js';
import { logger } from '../utils/logger.js';
import { publishAskOf, type PublishAsk } from './publish-requests/ask.js';
import type { PublishGateInput } from './publish-requests/door.js';
import { newlyOpened, withholdOpening, fileShareAsk, shareCapRefusal } from './workspace-share-gate.js';
import { capByOf } from './classification/audience-cap.js';
import { closedNodeLevel, closedNodeWarnings } from './closed-node-level.js';

/** The share as the node decides with it: every field present. */
export function resolveShare(v: ShareMeta | null | undefined): ResolvedShare {
    const s = v ?? {};
    const access: ShareAccess = s.access === 'password' || s.access === 'account' || s.access === 'organism' ? s.access : 'open';
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

/**
 * Does this share serve its pages to anyone who has the link? An open share does; a password or a
 * sign-in narrows who may read. The same rule GET /v1/provenance/:id and the hash lookup use
 * (services/share-provenance.ts), so a page's label, its record and the compliance counts
 * agree about one page.
 */
export function shareIsOpen(share: Pick<ResolvedShare, 'access'>): boolean {
    return share.access === 'open';
}

/** The visibility a label is decided against for what this share serves. */
export function shareServedVisibility(share: Pick<ResolvedShare, 'access'>): 'public' | 'private' {
    return shareIsOpen(share) ? 'public' : 'private';
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
    /** `asked`: the opening part waits for the owner (data.publish_request); a door answers 202. */
    | { ok: true; data: Record<string, unknown>; asked?: boolean }
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
    /** The door's caller, for the publish gate. Absent (an approved request's applier): not asked. */
    publishGate?: PublishGateInput,
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
    if (body.access !== undefined && body.access !== 'open' && body.access !== 'password' && body.access !== 'account' && body.access !== 'organism') {
        return refuse(400, 'INVALID_INPUT', "access must be 'open', 'password', 'account' or 'organism'");
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

    const stored = await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.share', config.nodeId);
    const prev = resolveShare(stored?.value as ShareMeta | undefined);
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
        // A share made for the first time without `access` takes the node's starting level (plan
        // V5.5), decided here so the publish gate below sees it; a later change keeps the stored one.
        access: (body.access as ShareAccess | undefined) ?? (stored ? prev.access : shareAccessDefault(config)),
        passwordHash: nextHash,
        icsKeyHash: feedKey ? feedKey.hash : body.ics_key === null ? null : prev.icsKeyHash,
        until,
    };
    if (next.access === 'password' && !next.passwordHash) return refuse(400, 'INVALID_INPUT', "access 'password' requires a password to be set");

    // A node that shows its content to signed-in accounts only stores a share asked to open to anyone
    // (named, or the starting level) at 'account', and says so (services/closed-node-level.ts, plan
    // V1.6). A share that is open already keeps it. Before the gate, so a lowered share asks nothing.
    const closed = publishGate
        ? closedNodeLevel(config, next.access, 'account' as const, { from: stored ? prev.access : undefined, publicValue: 'open' })
        : { level: next.access, warning: null };
    next.access = closed.level;

    // The labels' audience cap (plan doc-mvdipuyqraas, L3.5): the workspace's label and each newly
    // shared page's cap the level, before the publish gate and before anything is stored.
    if (publishGate) {
        const capped = await shareCapRefusal(deps, orgId, ws, prev, next, !!stored, capByOf(publishGate.caller));
        if (capped) return refuse(capped.status, capped.code, capped.message);
    }

    // The publish gate (plan doc-mvcn6c7e4e5q, V4), before anything is stored: a change that lets
    // anyone with the link read what they could not, by a caller the node asks the owner about, is
    // stored with that part held back (services/workspace-share-gate.ts).
    const opened = publishGate ? newlyOpened(prev, next) : [];
    let ask: Extract<PublishAsk, { kind: 'ask' }> | null = null;
    let held: Record<string, unknown> | null = null;
    if (opened.length && publishGate) {
        const asked = publishAskOf(deps, publishGate.caller, publishGate.app);
        if (asked.kind === 'refused') return refuse(asked.status, asked.code, asked.message);
        if (asked.kind === 'ask') { ask = asked; held = withholdOpening(prev, next, opened, untilIn); }
    }
    // A held-back `open` leaves the password level in place, which still needs its password.
    if (next.access === 'password' && !next.passwordHash) return refuse(400, 'INVALID_INPUT', "access 'password' requires a password to be set; the share stays password-protected until the owner approves opening it");

    const key = `organism.${orgId}.w.${ws}.meta.share`;
    const existing = stored;
    const now =new Date(nowMs).toISOString();
    const version = existing ? existing.version + 1 : 1;
    await storage.setMemory({
        key, ownerGaii: existing?.ownerGaii ?? reg.record.ownerGaii, value: next, visibility: 'private', tags: ['share'], ttlHours: null,
        version, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('organisms');
    const requested = ask && held && publishGate
        ? await fileShareAsk(deps, publishGate, ask, { orgId, ws, wsName: reg.entry.name ?? ws, version, from: prev.access, opened }, held)
        : {};

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
    const onePage = page && page.length === 2 ? publicViewerPath(orgId, ws, page[0], page[1]) : null;
    // An HTML page also has an address that shows it alone in the whole browser window (the viewer's
    // view=page): only the page and its AI label at the bottom-left, as full screen shows it.
    const alone = onePage && isHtmlPageValue(await pageValueOf(storage, config, orgId, ws, sharedNow[0])) ? `${onePage}&view=page` : null;
    // A new feed key is in this answer and in no later one: only its hash is kept.
    return {
        ok: true,
        data: {
            organism_id: orgId, ws, share: redactShareOf(next),
            viewer_url: `${config.baseUrl}${onePage ?? publicViewerPath(orgId, ws)}`,
            ...(alone ? { window_url: `${config.baseUrl}${alone}` } : {}),
            ...(page && until[sharedNow[0]] ? { ends_at: until[sharedNow[0]] } : {}),
            ...(feedKey ? { ics_key: feedKey.key, ics_url: `/v1/organisms/${orgId}/workspace/public/records?ws=${encodeURIComponent(ws)}&space=<space>&format=ics&key=${feedKey.key}` } : {}),
            ...(requested.publishRequest ? { publish_request: requested.publishRequest } : {}),
            ...(requested.warnings ? { warnings: requested.warnings } : closedNodeWarnings(closed.warning)),
        },
        ...(requested.publishRequest ? { asked: true } : {}),
    };
}
