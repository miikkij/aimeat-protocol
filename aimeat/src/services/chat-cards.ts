/**
 * @file src/services/chat-cards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Turning a finished tool call into something the person can OPEN.
 *
 *   The work log proves what happened; it does not hand anything over. An agent that publishes a
 *   page, writes a record or renders a screenshot produces a THING, and until now the only trace of
 *   it in the conversation was a line saying a tool with that name had completed. The address was
 *   inside the tool's JSON, which nobody reads, or repeated in the agent's prose, which is where it
 *   goes missing when the answer is long.
 *
 *   WHY THIS RECOGNISES SHAPES RATHER THAN NAMES. ACP reports a tool call's title, not the tool id,
 *   and the title is human text that changes when a description changes. The RESULT is the stable
 *   part: this node's tools answer with JSON, and a payload carrying a `url` is a thing with an
 *   address whatever the tool was called. Matching on shape also means a tool added next month gets
 *   a card without this file being edited, which is the opposite of the usual arrangement.
 *
 *   IT NEVER INVENTS AN ADDRESS. Only a URL that is already in the payload is used, and only when it
 *   is http(s) or node-relative — a card is a promise that the link works, and a constructed one is
 *   a promise nobody checked.
 * @structure
 *   - ChatCard — what the page renders
 *   - cardFromToolResult(raw) — the recogniser; null when there is nothing to open
 * @usage
 *   const card = cardFromToolResult(update.raw);
 *   if (card) send({ kind: 'tool_call', …, card });
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */

/** Something produced by a turn that a person can open, look at, or copy. */
export interface ChatCard {
    /** What kind of thing it is, which decides how the page draws it. */
    kind: 'page' | 'app' | 'image' | 'file' | 'memory' | 'workspace';
    /** One line naming it, already fit to display. */
    title: string;
    /** Where it can be opened. Absent for a card that is an address-less record. */
    url?: string;
    /** An image to show inside the card (a screenshot, or the picture itself). */
    image?: string;
    /** The record's own address on this node, for a memory or workspace card. */
    ref?: string;
}

/** A string that is safe to put in an href: this node's own path, or an http(s) address. */
function usableUrl(v: unknown): string | undefined {
    if (typeof v !== 'string' || v.length === 0 || v.length > 2000) return undefined;
    if (v.startsWith('/')) return v;
    if (/^https?:\/\//i.test(v)) return v;
    return undefined;
}

function looksLikeImage(url: string): boolean {
    return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url);
}

/**
 * Every JSON object anywhere inside the update.
 *
 * A tool result arrives as ACP content blocks, each carrying text that happens to be JSON, and the
 * nesting has changed between goose versions. Walking for objects and parsing every string that
 * starts like JSON survives that; matching a fixed path does not.
 */
function payloads(node: unknown, depth = 0, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (depth > 6 || found.length > 20) return found;
    if (typeof node === 'string') {
        const s = node.trim();
        if (s.startsWith('{') && s.length < 100_000) {
            try {
                const parsed: unknown = JSON.parse(s);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    found.push(parsed as Record<string, unknown>);
                    payloads(parsed, depth + 1, found);
                }
            } catch { /* not JSON: nothing to recognise, and not an error */ }   // eslint-disable-line aimeat/no-silent-catch -- a non-JSON string is the ordinary case
        }
        return found;
    }
    if (Array.isArray(node)) {
        for (const item of node) payloads(item, depth + 1, found);
        return found;
    }
    if (node && typeof node === 'object') {
        found.push(node as Record<string, unknown>);
        for (const value of Object.values(node as Record<string, unknown>)) payloads(value, depth + 1, found);
    }
    return found;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The card for a finished tool call, or null when it produced nothing openable.
 *
 * Null is the common answer and the right one: a read, a search or a list is work, not a thing, and
 * a card for it would be a link back to what the person is already looking at.
 */
export function cardFromToolResult(raw: unknown): ChatCard | null {
    for (const p of payloads(raw)) {
        // An image first: a picture that is shown beats the same picture behind a link.
        const image = usableUrl(p.image_url ?? p.imageUrl);
        const url = usableUrl(p.url ?? p.address ?? p.public_url);
        const storageKey = str(p.storage_key ?? p.storageKey);

        if (image || (url && looksLikeImage(url))) {
            const src = image ?? url;
            if (src) {
                return {
                    kind: 'image',
                    title: str(p.title) ?? str(p.filename) ?? storageKey ?? 'Image',
                    url: url ?? src,
                    image: src,
                };
            }
        }

        if (url) {
            // A published app names its file; a welcome page answers `published: true`.
            const filename = str(p.filename ?? p.app ?? p.app_id);
            if (filename) {
                return { kind: 'app', title: filename, url, image: usableUrl(p.screenshot_url ?? p.screenshotUrl) };
            }
            if (p.published === true || /\/p\//.test(url)) {
                return { kind: 'page', title: str(p.title) ?? 'Your page', url };
            }
            if (storageKey) return { kind: 'file', title: storageKey, url };
            return { kind: 'page', title: str(p.title) ?? url.replace(/^https?:\/\//, ''), url };
        }

        // Records with no address of their own. Worth a card because the KEY is the handle a person
        // needs to ask for it back, and it is the part that scrolls out of sight in prose.
        const workspaceId = str(p.workspace_id ?? p.workspaceId);
        const objectId = str(p.object_id ?? p.objectId ?? p.document_id);
        if (workspaceId && objectId) {
            return { kind: 'workspace', title: str(p.title) ?? objectId, ref: `${workspaceId}/${objectId}` };
        }

        const key = str(p.key);
        if (key && (p.written === true || p.saved === true || p.stored === true || str(p.owner_gaii) || str(p.gaii))) {
            return { kind: 'memory', title: key, ref: key };
        }
    }
    return null;
}
