/**
 * @file public/js/services/apps.js
 * @description Frontend service layer for the hosted-app catalogue: list, upload,
 *   delete, and patch metadata of the owner's published HTML apps via the /v1/apps API.
 *
 * @structure
 *   - listApps(): GET /v1/apps → array (visibility decided server-side by auth)
 *   - uploadApp(filename, contentBase64, mimeType, opts): POST a new app + optional screenshot
 *   - deleteApp(filename): DELETE an app by filename
 *   - patchApp(filename, updates): PATCH app metadata (name/description/access_code/parked)
 *   - deployAppAgent / undeployAppAgent / appAgentStatus: Agent-Bundled Apps — deploy the
 *     crew-defs an app declares (manifest.cortex.agents) onto YOUR OWN fleet + read liveness
 *
 * @version-history
 *   v1.1.0 — 2026-07-16 — Agent-Bundled Apps Slice 1: deploy/undeploy/status service calls
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
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

const appAgentUrl = (owner, filename, agentName, tail) =>
  '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename)
  + '/agents/' + encodeURIComponent(agentName) + '/' + tail;

/** Deploy an app's bundled agent onto YOUR OWN fleet (creates a deploy-app-agent task). */
export async function deployAppAgent(owner, filename, agentName, opts = {}) {
  return api(appAgentUrl(owner, filename, agentName, 'deploy'), {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

/** Signal your fleet to stop + deregister an app's deployed agent. */
export async function undeployAppAgent(owner, filename, agentName, opts = {}) {
  return api(appAgentUrl(owner, filename, agentName, 'undeploy'), {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

/** Liveness of an app's bundled agent on your fleet (registration + deploy memory key). */
export async function appAgentStatus(owner, filename, agentName) {
  return apiGet(appAgentUrl(owner, filename, agentName, 'status'));
}
