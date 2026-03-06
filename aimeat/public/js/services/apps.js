/**
 * AIMEAT Apps Service
 * App listing and upload.
 */
import { apiGet, api } from '/js/api.js';

/** List all apps. Returns array. */
export async function listApps() {
  const data = await apiGet('/v1/apps');
  return data?.data?.apps || [];
}

/** Upload an app (HTML file + optional screenshot). */
export async function uploadApp(filename, contentBase64, mimeType, opts = {}) {
  const body = { filename, content: contentBase64, mime_type: mimeType || 'text/html' };
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
