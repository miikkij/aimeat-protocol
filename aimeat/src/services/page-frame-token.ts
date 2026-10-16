/**
 * @file src/services/page-frame-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The token in the address of an HTML page's frame (routes/page-host.ts). The node mints
 *   one only after the caller has passed the gate the page answers to: a member of the workspace, or
 *   whoever the page's share admits (open, account, password). The token names the one record to
 *   serve, so the page host checks a signature and never evaluates a share, a password or a session
 *   itself; it has no session to evaluate, because nothing of the node's own origin reaches it.
 *
 *   It rides in the PATH (`/p/<token>/`), not in a header or the query: the frame is a navigation, and
 *   a page's relative file names (`kuva.png`) then resolve under the same token. An EdDSA JWT, signed
 *   with the node keys like the share and download tokens, reusable within its hour, never single-use
 *   (a page loads its own files with it). A page share that ends, or a password that changes, ends
 *   what an open frame can load within that hour at the latest; the page host re-reads a public
 *   page's share on every load (`k: 'pub'`), so it ends at once for those.
 * @structure initPageFrameTokenKeys() · generatePageFrameToken() · verifyPageFrameToken() · PageFrameTokenError · PAGE_FRAME_TTL_SECONDS
 * @usage
 *   const token = await generatePageFrameToken({ org, ws, sp: 'docs', ns: 'shared.docs', id, r: 'latest', k: 'pub' });
 *   const claims = await verifyPageFrameToken(token);   // throws PageFrameTokenError on a bad or expired token
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import { SignJWT, jwtVerify } from 'jose';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

export function initPageFrameTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;
}

/** An hour: long enough for a presentation, short enough that a copied frame address soon opens nothing. */
export const PAGE_FRAME_TTL_SECONDS = 3600;

export interface PageFrameClaims {
    /** Organism id. */
    org: string;
    /** Workspace id. */
    ws: string;
    /** The document space's name (what a share and the viewer address name it by). */
    sp: string;
    /** The space's namespace (what the record key names it by). */
    ns: string;
    /** The page's id. */
    id: string;
    /** Which copy: the published one, or a member's look at the draft. */
    r: 'latest' | 'draft';
    /** Who it was minted for: whoever a share admits ('pub'), or a member of the workspace ('mem'). */
    k: 'pub' | 'mem';
}

const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;

export async function generatePageFrameToken(claims: PageFrameClaims, ttlSeconds: number = PAGE_FRAME_TTL_SECONDS): Promise<string> {
    if (!_privateKey) throw new Error('Page frame token keys not initialized');
    return new SignJWT({ typ: 'pageframe', ...claims })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
}

/** A token that opens nothing: expired, forged, malformed or of another kind. The page host answers it with 404. */
export class PageFrameTokenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PageFrameTokenError';
    }
}

/** The claims of a valid token. Throws PageFrameTokenError for any token that opens nothing. */
export async function verifyPageFrameToken(token: string): Promise<PageFrameClaims> {
    if (!_publicKey) throw new Error('Page frame token keys not initialized');
    if (typeof token !== 'string' || token.length > 4096) throw new PageFrameTokenError('Malformed page frame token');
    let p: Record<string, unknown>;
    try {
        p = (await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] })).payload as Record<string, unknown>;
    } catch (err) {
        throw new PageFrameTokenError(`Page frame token does not verify: ${(err as Error).message}`);
    }
    if (p.typ !== 'pageframe') throw new PageFrameTokenError('Not a page frame token');
    const str = (k: string) => (typeof p[k] === 'string' && ID_RE.test(p[k] as string) ? p[k] as string : null);
    const org = str('org'), ws = str('ws'), sp = str('sp'), ns = str('ns'), id = str('id');
    if (!org || !ws || !sp || !ns || !id) throw new PageFrameTokenError('Page frame token names no page');
    if (p.r !== 'latest' && p.r !== 'draft') throw new PageFrameTokenError('Page frame token names no copy');
    if (p.k !== 'pub' && p.k !== 'mem') throw new PageFrameTokenError('Page frame token names no reader');
    // A public token reads the published page only: a share never hands out a draft.
    if (p.k === 'pub' && p.r !== 'latest') throw new PageFrameTokenError('A shared page is its published copy');
    return { org, ws, sp, ns, id, r: p.r, k: p.k };
}
