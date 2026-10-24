/**
 * @file src/services/app-frame-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which redirect of the visible app-grant flow is the node itself, and which of those is
 *   the page that holds an app in a frame (audit A7-1). routes/app-grants.ts asks it before it takes a
 *   redirect_uri. Moved out of that file unchanged when the route passed the 800-line ceiling.
 *   It also answers which redirect on the bare app host is accepted (bareAppHostRedirectOk).
 * @structure apexOrigin(config) · isNodeItself(config, url) · frameRedirect(config, storage, uri, app) ·
 *   bareAppHostRedirectOk(uri, app, responseMode)
 * @usage const frame = await frameRedirect(config, storage, redirectUri, app);
 * @version-history
 *   v1.2.0 — 2026-10-25 — bareAppHostRedirectOk: a redirect on the bare app host is the app's own
 *     path-form address, or the host's root in web_message mode (secaudit2026oct22; Jouni, 2026-10-25).
 *     The path decode frameRedirect had is decodedPair, shared by both.
 *   v1.1.0 — 2026-09-26 — The app's own path is a bound redirect on every node, for the App Catalog's
 *     preview; a node that runs apps in the isolated frame still refuses every other address of its own.
 *   v1.0.0 — 2026-09-26 — Extracted from routes/app-grants.ts (max-file-lines), apexOrigin with it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appIsolationMode } from './app-isolation.js';
import { localAccountName } from '../utils/gaii.js';

/** The node's own origin (scheme + host + port), lowercased — what a same-origin caller's `Origin`
 *  header says when it is present. '' when baseUrl is unparseable, which then matches nothing. */
export function apexOrigin(config: AimeatConfig): string {
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: an unparseable baseUrl has no origin
  try { return new URL(config.baseUrl).origin.toLowerCase(); } catch { return ''; }
}

/** The node itself: its own origin, or a loopback name on the port it listens on. */
export function isNodeItself(config: AimeatConfig, u: URL): boolean {
  if (u.origin.toLowerCase() === apexOrigin(config)) return true;
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return loopback && port === String(config.port);
}

/**
 * A PAGE OF THE NODE THAT HOLDS THE APP, AS A REDIRECT (audit A7-1). Two pages hold app code in an
 * opaque-origin frame and run the visible flow for it: the isolated frame's page
 * (src/static/app-frame.js), and the App Catalog's preview. Both name the app's own path on the node
 * as the redirect, and the consent page posts the code to its opener on that origin, never into the
 * frame. `bound` says the redirect is exactly that path of exactly the requested app, and is accepted
 * on every node. `onNode` says the node must refuse any OTHER address of its own: a node that runs
 * apps in the isolated frame does, whatever the loopback rule in validRedirect allows, because a code
 * sent to one of its pages is a code any page there could be sent. Elsewhere validRedirect decides as
 * before.
 */
export async function frameRedirect(
  config: AimeatConfig, storage: Storage, uri: string, app: string,
): Promise<{ onNode: boolean; bound: boolean; origin: string }> {
  // A redirect that does not parse is no address of the node; validRedirect refuses it on its own.
  if (!URL.canParse(uri)) return { onNode: false, bound: false, origin: '' };
  const u = new URL(uri);
  if (!isNodeItself(config, u)) return { onNode: false, bound: false, origin: '' };
  const parts = decodedPair(/^\/v1\/apps\/([^/]+)\/([^/]+)$/.exec(u.pathname));
  const named = parts ? `${parts[0]}/${parts[1]}` : '';
  const bound = !!named && named === app && !u.search && !u.hash;
  const isolated = (await appIsolationMode(config, storage)) === 'isolated-frame';
  return { onNode: bound || isolated, bound, origin: u.origin };
}

/**
 * A REDIRECT ON THE BARE APP HOST (`apps.<apex>`), which serves every app by path and forwards
 * `/<owner>/<file>` to that app's own origin with the query (routes/subdomains.ts). A code sent there
 * in the URL reaches whichever app the path names, so in query mode only the requesting app's own
 * path-form address is accepted. web_message mode never navigates (the consent page posts the code to
 * its opener), and the SDK popup names the host's root (sdk-libs/auth/app-origin.js), which is accepted
 * there. The caller has already checked that the host is the bare app host. Not bound either way: every
 * app on this host shares one origin (secaudit2026oct22; Jouni, 2026-10-25).
 */
export function bareAppHostRedirectOk(uri: string, app: string, responseMode: 'query' | 'web_message'): boolean {
  if (!URL.canParse(uri)) return false;
  const u = new URL(uri);
  if (u.hash) return false;
  if (responseMode === 'web_message' && u.pathname === '/') return true;
  const parts = decodedPair(/^\/([^/]+)\/([^/]+)$/.exec(u.pathname));
  return !!parts && `${localAccountName(parts[0])}/${parts[1]}` === app;
}

/** The two captured path segments, percent-decoded, or null when there is no match or one does not decode. */
function decodedPair(m: RegExpExecArray | null): [string, string] | null {
  if (!m) return null;
  // eslint-disable-next-line aimeat/no-silent-catch -- a path that does not decode names no app
  try { return [decodeURIComponent(m[1]), decodeURIComponent(m[2])]; } catch { return null; }
}
