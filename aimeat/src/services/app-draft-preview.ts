/**
 * @file app-draft-preview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Mint a short-lived preview link for an app's saved draft. One implementation for
 *   POST /v1/apps/:owner/:filename/draft/preview-token and the MCP tool aimeat_app_draft_save.
 *
 *   On a node with the app origin ON, the URL points at the isolated app origin (a real,
 *   session-less origin where getUserMedia works). With it OFF, it points at the apex inline URL.
 *   Either way it opens top-level as a clean page. The MCP tool used to build the apex URL by hand
 *   and ignore the app origin, so the two callers returned different links for the same draft.
 * @structure
 *   - DraftPreview / DraftPreviewRefusal — the contract
 *   - mintDraftPreview(storage, config, { owner, ownerGhii, filename }) — refuse when no draft
 *     exists, else sign a draft token and build the preview URL
 * @usage
 *   const out = await mintDraftPreview(storage, config, { owner, ownerGhii, filename });
 *   if ('refusal' in out) { res.status(out.refusal.status).json(error(...)); return; }
 * @version-history
 *   v1.1.0 — 2026-10-06 — On a per-app origin the link names the app's draft origin,
 *     `<sub>--draft.<appHost>`, where the draft's code gets no silent sign-in (secaudit 2026-10
 *     follow-up, A2). A path-form address is unchanged: it is bound to no app.
 *   v1.0.0 — 2026-09-27 — Extracted from routes/apps/drafts.ts (POST .../draft/preview-token) so
 *     aimeat_app_draft_save returns the same URL as the REST endpoint.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateDraftToken } from './draft-token.js';
import { appOriginUrl } from '../routes/apps/helpers.js';
import { DRAFT_LABEL_SUFFIX } from './app-origin-target.js';

/** How long a preview token stays valid, in seconds. */
const PREVIEW_TTL_SECONDS = 600;

/** The app's draft origin for its per-app address; any other address unchanged. */
function draftOriginUrl(appUrl: string, appHost: string | undefined): string {
    const host = (appHost || '').toLowerCase();
    if (!host || !URL.canParse(appUrl)) return appUrl;
    const u = new URL(appUrl);
    const label = u.hostname.endsWith(`.${host}`) ? u.hostname.slice(0, -(host.length + 1)) : '';
    if (!label || label.includes('.')) return appUrl;
    u.hostname = `${label}${DRAFT_LABEL_SUFFIX}.${host}`;
    return u.toString();
}

/** The preview answer, in the field names the REST endpoint returns. */
export interface DraftPreview {
    preview_url: string;
    token: string;
    expires_in_seconds: number;
    note: string;
}

/** The refusal when the app has no saved draft. Same shape as PublishAppRefusal. */
export interface DraftPreviewRefusal {
    refusal: { status: 404; code: 'NOT_FOUND'; message: string };
}

/**
 * Mint a preview token for the caller's draft and build the URL that opens it.
 * @param storage - the node storage
 * @param config - the node config (app origin, base URL)
 * @param input - owner is the bare account name, ownerGhii the canonical owner GHII the draft is
 *   stored under, filename the app filename
 * @returns the preview, or a NOT_FOUND refusal when no draft exists
 */
export async function mintDraftPreview(
    storage: Storage,
    config: AimeatConfig,
    input: { owner: string; ownerGhii: string; filename: string },
): Promise<DraftPreview | DraftPreviewRefusal> {
    const { owner, ownerGhii, filename } = input;
    const draft = await storage.getAppDraft(ownerGhii, filename);
    if (!draft) {
        return {
            refusal: {
                status: 404,
                code: 'NOT_FOUND',
                message: `No draft exists for "${filename}". Save one with PUT .../draft first.`,
            },
        };
    }
    const token = await generateDraftToken({ sub: ownerGhii, filename }, PREVIEW_TTL_SECONDS);
    let previewUrl: string;
    if (config.appOriginEnabled && config.appHost) {
        const originBase = draftOriginUrl(await appOriginUrl(config, storage, owner, filename), config.appHost);
        const sep = originBase.includes('?') ? '&' : '?';
        previewUrl = `${originBase}${sep}preview=${encodeURIComponent(token)}`;
    } else {
        previewUrl = `${config.baseUrl}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline&preview=${encodeURIComponent(token)}`;
    }
    return {
        preview_url: previewUrl,
        token,
        expires_in_seconds: PREVIEW_TTL_SECONDS,
        note: 'Open this URL in a new top-level tab to test the draft on a real origin (mic/camera prompts work). The link is single-app, owner-only, and expires shortly.',
    };
}
