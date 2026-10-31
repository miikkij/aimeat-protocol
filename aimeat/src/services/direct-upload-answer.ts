/**
 * @file src/services/direct-upload-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fields a presigned storage mint adds to its answer for a direct upload (the
 *   upload_url is in the file store itself), written once for POST /v1/storage and aimeat_storage_upload
 *   so the two answers name the same next steps.
 * @structure directUploadFields
 * @usage res.json(success(nodeId, { upload_url: minted.uploadUrl, ...directUploadFields(minted) }));
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-suuret-tiedostot-virtaavat-aimeat-io-n-l-pi-ilman-koko-tiedo).
 */

/** The direct-upload part of a mint answer: the headers and complete address, or why it goes through the node. */
export function directUploadFields(minted: { direct?: boolean; uploadHeaders?: Record<string, string>; completeUrl?: string; directUnavailable?: string }): Record<string, unknown> {
    if (minted.direct === true) {
        return {
            direct: true, upload_headers: minted.uploadHeaders, complete_url: minted.completeUrl, complete_method: 'POST',
            next: 'PUT the file to upload_url with upload_headers, then POST complete_url. The file is recorded only after the complete call.',
        };
    }
    return minted.direct === false ? { direct: false, direct_unavailable: minted.directUnavailable } : {};
}
