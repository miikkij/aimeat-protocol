/**
 * @file src/services/ai-jobs/picture-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish request for an image job's picture (secaudit 2026-10, ai-image public
 *   picture past the publish gate; the developer's one-press decision, 2026-10-21). A gated public image
 *   job stores its picture private (run-op.ts) and its answer's record private, and the owner decides
 *   both with one press: the picture's request is filed AFTER the record's, as a part of it
 *   (services/publish-requests/parts.ts). When the record asked nothing (it is public already, the
 *   write failed, the job was cancelled), the picture's request is filed on its own, as an upload's is.
 * @structure fileJobPictureRequest(deps, pending, recordRequestId?)
 * @usage await fileJobPictureRequest({ storage, config }, outcome.picturePublish, written.requestId);
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { GenerateForOwnerResult } from '../ai-image.js';
import { fileFilePublishRequest } from '../storage-file-publish.js';
import { logger } from '../../utils/logger.js';

/** File the picture's request: a part of the record's request when there is one, else on its own. */
export async function fileJobPictureRequest(
    deps: { storage: Storage; config: AimeatConfig },
    pending: GenerateForOwnerResult['pendingPublish'],
    recordRequestId?: string,
): Promise<void> {
    if (!pending) return;
    try {
        const filed = await fileFilePublishRequest(deps, pending.requester, pending.file, recordRequestId);
        if (!filed.ok) logger.warn('[ai-jobs] the picture stays private with no request', { key: pending.file.key, reason: filed.warning.message });
    } catch (err) {
        logger.warn('[ai-jobs] the picture\'s publish request could not be filed; the picture stays private', { key: pending.file.key, error: String(err) });
    }
}
