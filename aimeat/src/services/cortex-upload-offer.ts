/**
 * @file src/services/cortex-upload-offer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The presigned upload offer for a cortex ZIP: one upload URL the caller PUTs the ZIP
 *   to, and what the ZIP must hold. POST /v1/cortex answers it for `mode: 'presigned'`, and
 *   aimeat_cortex_install answers it when called without a manifest, on the node MCP directly and on
 *   the connector and the CLI dispatch through that route (secaudit 2026-10, M3). Before this only
 *   the node MCP tool could mint it, inline, so the connector's cortex install could not take the ZIP
 *   path its own schema described.
 *
 *   The ZIP takes no options: its upload handler installs a new name and replaces a cortex of the
 *   uploader's own by name whatever a flag says, so the token carries no meta.
 * @structure cortexUploadOffer(config, principal)
 * @usage const offer = await cortexUploadOffer(config, resolveIdentity(req.auth!, config.nodeId));
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved out of src/mcp/cortex.ts (secaudit 2026-10, M3).
 */
import type { AimeatConfig } from '../config.js';
import { generateUploadToken } from './upload-token.js';

export interface CortexUploadOffer {
    mode: 'upload';
    upload_url: string;
    upload_method: 'PUT';
    content_type: 'application/zip';
    max_size_bytes: number;
    expires_in_seconds: number;
    zip_structure: string;
    note: string;
}

/** Mint the upload URL for a cortex ZIP, for the principal that will install it. */
export async function cortexUploadOffer(config: AimeatConfig, principal: string): Promise<CortexUploadOffer> {
    const maxBytes = config.cortexMaxLibSizeKb * 1024 * 50;
    const token = await generateUploadToken({
        sub: principal,
        utype: 'cortex',
        meta: {},
        maxBytes,
        contentType: 'application/zip',
    });
    return {
        mode: 'upload',
        upload_url: `${config.baseUrl}/v1/upload/${token}`,
        upload_method: 'PUT',
        content_type: 'application/zip',
        max_size_bytes: maxBytes,
        expires_in_seconds: 3600,
        zip_structure: 'manifest.yaml at root, lib files in libs/ directory',
        note: 'Create a ZIP with manifest.yaml and libs/*.js, then PUT it to upload_url. '
            + 'A ZIP that carries the name of a cortex you installed replaces it in place; an active one is activated again from the new manifest.',
    };
}
