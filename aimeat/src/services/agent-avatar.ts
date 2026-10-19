/**
 * @file src/services/agent-avatar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's own picture: one memory record, `agent.avatar`, in the agent's own
 *   namespace. The record exists = the agent has an avatar.
 *
 *   WHY A MEMORY RECORD. An agent writes into its own namespace by default
 *   (routes/memory/owner-target.ts), so the key is per agent with no new field, no migration and no
 *   new MCP tool: `aimeat_memory_write { key: "agent.avatar", value: { svg } | { emoji } }` is the
 *   whole write path, on every surface that already writes memory (Jouni, 2026-10-19). The owner sets
 *   one for an agent through PUT /v1/agents/:name/avatar, which writes the same record.
 *
 *   TWO KINDS, NO HTML. `{ emoji: "🦊" }` (one short sign) or `{ svg: "<svg…>" }` (at most 256 kB,
 *   animation allowed). HTML was ruled out as too much for what it buys (Jouni, 2026-10-19). A plain
 *   string value is read leniently: `<…` is an SVG, anything else an emoji.
 *
 *   PUBLIC BY DESIGN. An avatar is the agent's face, read like its description on the public profile
 *   GET /v1/agents/:gaii: whatever is written here is shown to anyone who sees the agent, whatever
 *   visibility the record was given. An `<img>` cannot send a bearer token, so a picture that only
 *   the signed-in could load would be a broken image everywhere else.
 *
 *   A LIST CARRIES NO SVG. 84 agents on one production account made a 108 kB list (2026-10-19); with
 *   the pictures inlined it could grow by 21 MB. The list carries the emoji, or for an SVG the address
 *   of GET /v1/agents/:gaii/avatar.svg with the record's version in it, so the browser caches it for
 *   good and a new picture is a new address.
 * @structure AVATAR_KEY · AVATAR_SVG_MAX_BYTES · parseAvatarValue(value) · avatarUrl(gaii, version)
 *   · avatarView(gaii, record) · readAvatars(storage, gaiis) · readAvatar(storage, gaii)
 *   · emojiAsSvg(emoji) · AVATAR_SVG_HEADERS
 * @usage
 *   const avatars = await readAvatars(storage, agents.map(a => a.gaii));
 *   rows.map(a => ({ ...row, avatar: avatars.get(a.gaii) ?? null }));
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse).
 */
import type { Storage } from '../storage/interface.js';
import type { MemoryRecord } from '../storage/types/commerce.js';

/** The reserved key, in the agent's own namespace. */
export const AVATAR_KEY = 'agent.avatar';

/** Largest SVG accepted, in UTF-8 bytes (Jouni, 2026-10-19: 256 kB). */
export const AVATAR_SVG_MAX_BYTES = 256 * 1024;

/** Longest emoji accepted, in code points: a flag, a skin tone or a ZWJ family fits. */
const EMOJI_MAX_CODE_POINTS = 12;

/** What a stored value means, or why it means nothing. */
export type ParsedAvatar =
    | { ok: true; kind: 'emoji'; emoji: string }
    | { ok: true; kind: 'svg'; svg: string }
    | { ok: false; problem: string };

/** What a listing or a profile answers for an agent's avatar. */
export type AvatarView =
    | { kind: 'emoji'; emoji: string; url: string; version: number; updated_at: string }
    | { kind: 'svg'; url: string; version: number; updated_at: string; bytes: number };

/** Read a value written at `agent.avatar`. Never throws; an unusable value says why. */
export function parseAvatarValue(value: unknown): ParsedAvatar {
    let emoji: unknown;
    let svg: unknown;
    if (typeof value === 'string') {
        if (value.trimStart().startsWith('<')) svg = value; else emoji = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        emoji = (value as { emoji?: unknown }).emoji;
        svg = (value as { svg?: unknown }).svg;
    } else {
        return { ok: false, problem: 'The value is neither { "emoji": "…" } nor { "svg": "<svg…>" }.' };
    }
    if (typeof svg === 'string' && svg.trim()) return parseSvg(svg.trim());
    if (typeof emoji === 'string' && emoji.trim()) return parseEmoji(emoji.trim());
    return { ok: false, problem: 'The value has no "emoji" and no "svg".' };
}

function parseEmoji(emoji: string): ParsedAvatar {
    if ([...emoji].length > EMOJI_MAX_CODE_POINTS) {
        return { ok: false, problem: `An emoji avatar is one sign; this one has ${[...emoji].length} characters.` };
    }
    if (/[<>&\s]/.test(emoji)) return { ok: false, problem: 'An emoji avatar has no spaces and no markup.' };
    return { ok: true, kind: 'emoji', emoji };
}

function parseSvg(svg: string): ParsedAvatar {
    const bytes = Buffer.byteLength(svg, 'utf8');
    if (bytes > AVATAR_SVG_MAX_BYTES) {
        return { ok: false, problem: `The SVG is ${Math.ceil(bytes / 1024)} kB; the limit is ${AVATAR_SVG_MAX_BYTES / 1024} kB.` };
    }
    // An XML prolog and comments may come before the root; nothing else may.
    const head = svg.replace(/^(<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/i, '');
    if (!/^<svg[\s>]/i.test(head) || !/<\/svg>\s*$/i.test(svg)) {
        return { ok: false, problem: 'The SVG must be one <svg>…</svg> element.' };
    }
    // An entity declaration can expand without bound in some parsers; an avatar never needs one.
    if (/<!DOCTYPE|<!ENTITY/i.test(svg)) return { ok: false, problem: 'The SVG may not declare a DOCTYPE or entities.' };
    return { ok: true, kind: 'svg', svg };
}

/** The address of an agent's picture. The version makes a new picture a new address. */
export function avatarUrl(gaii: string, version: number): string {
    return `/v1/agents/${encodeURIComponent(gaii)}/avatar.svg?v=${version}`;
}

/** The answer for one agent, or null when it has no usable avatar. */
export function avatarView(gaii: string, record: MemoryRecord | null | undefined): AvatarView | null {
    if (!record) return null;
    const parsed = parseAvatarValue(record.value);
    if (!parsed.ok) return null;
    const base = { url: avatarUrl(gaii, record.version), version: record.version, updated_at: record.updatedAt };
    return parsed.kind === 'emoji'
        ? { kind: 'emoji', emoji: parsed.emoji, ...base }
        : { kind: 'svg', ...base, bytes: Buffer.byteLength(parsed.svg, 'utf8') };
}

/** Every listed agent's avatar record in one read, by GAII. Agents without one are absent. */
export async function readAvatarRecords(storage: Storage, gaiis: readonly string[]): Promise<Map<string, MemoryRecord>> {
    const unique = [...new Set(gaiis)];
    const out = new Map<string, MemoryRecord>();
    if (unique.length === 0) return out;
    const rows = storage.getMemoryForOwners
        ? await storage.getMemoryForOwners(unique, AVATAR_KEY)
        : (await Promise.all(unique.map(g => storage.getMemory(g, AVATAR_KEY)))).filter((r): r is MemoryRecord => !!r);
    for (const r of rows) out.set(r.ownerGaii, r);
    return out;
}

/** Every listed agent's avatar view in one read. Agents without a usable avatar are absent. */
export async function readAvatars(storage: Storage, gaiis: readonly string[]): Promise<Map<string, AvatarView>> {
    const records = await readAvatarRecords(storage, gaiis);
    const out = new Map<string, AvatarView>();
    for (const [gaii, record] of records) {
        const view = avatarView(gaii, record);
        if (view) out.set(gaii, view);
    }
    return out;
}

/**
 * Read avatars for a list and never fail it: a listing that loses its pictures is still a listing.
 * `where` names the caller in the warning.
 */
export async function readAvatarsOrEmpty(storage: Storage, gaiis: readonly string[], warn: (msg: string, meta: object) => void, where: string): Promise<Map<string, AvatarView>> {
    try {
        return await readAvatars(storage, gaiis);
    } catch (err) {
        warn(`${where}: agent avatars not read, the list goes without them`, { error: String(err) });
        return new Map();
    }
}

/** One agent's avatar record and what it means, for its own profile and the picture route. */
export async function readAvatar(storage: Storage, gaii: string): Promise<{ record: MemoryRecord | null; parsed: ParsedAvatar | null }> {
    const record = await storage.getMemory(gaii, AVATAR_KEY);
    return { record, parsed: record ? parseAvatarValue(record.value) : null };
}

/** An emoji drawn as an SVG, so the picture address answers for both kinds. */
export function emojiAsSvg(emoji: string): string {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        + '<text x="50" y="54" font-size="74" text-anchor="middle" dominant-baseline="middle">'
        + emoji + '</text></svg>';
}

/**
 * The headers the picture is served with. The SVG is someone else's markup: shown through `<img>`
 * its scripts never run, and these headers keep them from running when the address is opened on
 * its own in a tab. `img-src data:` lets a picture embed a raster image; nothing is fetched.
 */
export const AVATAR_SVG_HEADERS: Readonly<Record<string, string>> = {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
};
