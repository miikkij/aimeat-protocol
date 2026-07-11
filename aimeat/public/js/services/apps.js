/**
 * AIMEAT Apps Service
 * App listing and upload.
 */
import { apiGet, apiDelete, apiPatch, api } from '/js/api.js';

/** List apps. Returns array. The server decides visibility from who is
 *  authenticated: the owner sees their own parked/operator-hidden apps (the latter
 *  flagged operator_hidden so the UI can badge them); everyone else does not. */
export async function listApps() {
  const data = await apiGet('/v1/apps');
  return data?.data?.apps || [];
}

/** Upload an app (HTML file + optional screenshot). */
export async function uploadApp(filename, contentBase64, mimeType, opts = {}) {
  const body = { filename, content: contentBase64, mime_type: mimeType || 'text/html' };
  if (opts.description) body.description = opts.description;
  if (opts.accessCode) body.access_code = opts.accessCode;
  if (opts.screenshotBase64) {
    body.screenshot = opts.screenshotBase64;
    body.screenshot_mime_type = opts.screenshotMimeType || 'image/png';
  }
  return api('/v1/apps', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Delete an app by filename. */
export async function deleteApp(filename) {
  return apiDelete('/v1/apps/' + encodeURIComponent(filename));
}

/** Update app metadata (name, description, access_code, parked). The URL never changes. */
export async function patchApp(filename, updates) {
  return apiPatch('/v1/apps/' + encodeURIComponent(filename), updates);
}
