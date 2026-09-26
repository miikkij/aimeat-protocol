/**
 * @file src/services/app-frame-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which redirect of the visible app-grant flow is the node itself, and which of those is
 *   the page that holds an app in a frame (audit A7-1). routes/app-grants.ts asks it before it takes a
 *   redirect_uri. Moved out of that file unchanged when the route passed the 800-line ceiling.
 * @structure apexOrigin(config) · isNodeItself(config, url) · frameRedirect(config, storage, uri, app)
 * @usage const frame = await frameRedirect(config, storage, redirectUri, app);
 * @version-history
 *   v1.1.0 — 2026-09-26 — The app's own path is a bound redirect on every node, for the App Catalog's
 *     preview; a node that runs apps in the isolated frame still refuses every other address of its own.
 *   v1.0.0 — 2026-09-26 — Extracted from routes/app-grants.ts (max-file-lines), apexOrigin with it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appIsolationMode } from './app-isolation.js';

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
  const m = /^\/v1\/apps\/([^/]+)\/([^/]+)$/.exec(u.pathname);
  let named: string;
  // eslint-disable-next-line aimeat/no-silent-catch -- a path that does not decode names no app
  try { named = m ? `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}` : ''; } catch { named = ''; }
  const bound = !!named && named === app && !u.search && !u.hash;
  const isolated = (await appIsolationMode(config, storage)) === 'isolated-frame';
  return { onNode: bound || isolated, bound, origin: u.origin };
}
