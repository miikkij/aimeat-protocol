/**
 * @file src/routes/organisms/share-file-pass.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The image of a shared page, for whoever the share lets read the page (Jouni,
 *   2026-10-16: "tehdään korjaus samalla markdown sivuille").
 *
 *   THE GAP IT CLOSES. A document's own images are scoped to its workspace when it is written
 *   (services/doc-images.ts): visibility `workspace`, readable by members. That is right inside the
 *   organism and wrong the moment the page is shared outside it: a visitor on an open link, a
 *   signed-in non-member on an account share, or someone who typed the share's password read the
 *   page and saw every picture broken, because none of them is a member.
 *
 *   THE RULE. GET /v1/pub/:owner/:key asked with `?share=<org>/<ws>/<space>/<id>` serves a
 *   workspace-scoped file when ALL of these hold: the file is bound to that workspace, the share
 *   opens that page now (end dates included), the caller passes the share's gate (open, account,
 *   password via X-Share-Token, as the page itself), the classification reader lets the page leave,
 *   and the page's published text embeds exactly this file. The file keeps its visibility; nothing is
 *   made public, and a page that stops being shared stops opening its pictures with it.
 * @structure sharedPageAdmitsFile(H, deps, req, file, ownerGaii, key)
 * @usage const served = await sharedPageAdmitsFile(H, { storage, config }, req, file, gaii, key); if (served) { …serve… }
 * @version-history
 *   v1.1.0 — 2026-10-16 — Answers the visibility the file is served on (or null), so its AI label is
 *     decided for the share's reader; it was decided as private.
 *   v1.0.0 — 2026-10-16 — Initial.
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { readerFor } from '../../services/classification/reader.js';
import { pubEmbedUrl } from '../../services/doc-images.js';
import { decodeUriSegment } from '../../utils/uri-decode.js';
import type { OrganismHelpers } from './shared.js';
import { shareServedVisibility } from '../../services/workspace-share.js';

/** `<org>/<ws>/<space>/<id>`, each segment URL-encoded, or null. */
function parseShareRef(raw: unknown): { org: string; ws: string; type: string; id: string } | null {
    if (typeof raw !== 'string' || raw.length > 600) return null;
    const parts = raw.split('/').map(decodeUriSegment);
    if (parts.length !== 4 || parts.some(p => !p)) return null;
    const [org, ws, type, id] = parts as string[];
    return { org, ws, type, id };
}

/**
 * Does the shared page this request names admit this workspace-scoped file? Answers the visibility
 * the file is then served on, which its AI label is decided against (public on an open share,
 * services/workspace-share.ts shareServedVisibility), or null when it is not admitted.
 */
export async function sharedPageAdmitsFile(
    H: Pick<OrganismHelpers, 'readShareMeta' | 'collectPublicDocs' | 'shareGateDenied'>,
    deps: { storage: Storage; config: AimeatConfig },
    req: Request,
    file: { visibility: string; workspaceRef?: string },
    ownerGaii: string,
    key: string,
): Promise<'public' | 'private' | null> {
    if (file.visibility !== 'workspace') return null;
    const ref = parseShareRef(req.query.share);
    if (!ref) return null;
    if (!(file.workspaceRef ?? '').split(/\s+/).includes(`${ref.org}/${ref.ws}`)) return null;
    const organism = await deps.storage.getOrganism(ref.org);
    if (!organism) return null;
    const share = await H.readShareMeta(ref.org, ref.ws);
    const found = await H.collectPublicDocs(ref.org, ref.ws, share, { type: ref.type, id: ref.id });
    if (found.count === 0) return null;
    if (await H.shareGateDenied(req, organism, ref.org, ref.ws, share)) return null;
    const [doc] = await found.release(readerFor(deps, req.auth));
    if (!doc) return null;
    return doc.markdown.includes(pubEmbedUrl(ownerGaii, key)) ? shareServedVisibility(share) : null;
}
