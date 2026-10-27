/**
 * @file src/services/app-published-by-app.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A version of an owner's app published through an APP's grant (a role-'app' token that
 *   holds app:write). The token acts for the owner, so `manifest.publishedBy` is the owner's own GHII,
 *   and the owner's own app signed in silently with every word the new version declares: an app of
 *   another author could widen what the owner's app gets without the owner seeing it
 *   (secaudit2026oct26, own-app-consent:app-grant-publisher-reads-as-owner).
 *
 *   The developer's decision (2026-10-27): the version names the granting app as its publisher beside
 *   the owner (`manifest.publishedByApp`), the owner gets a notice that this app made or changed an app
 *   for them, and on the owner's next silent sign-in to that app the words the version adds are asked
 *   once with one press (services/own-app-consent.ts). A version the owner or the owner's own agent
 *   published, and one the owner's own app published through its own grant, sign in as before.
 * @structure publishingAppOf(auth) · publishingAppOfVerifiedToken(token) · byAnotherAuthorsApp(app, ownerName) ·
 *   tellOwnerAppPublishedByApp(...)
 * @usage
 *   const publishingApp = publishingAppOf(req.auth);   // a door; passed to publishApp
 *   if (byAnotherAuthorsApp(manifest.publishedByApp, owner)) { ...ask the owner... }
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import { accountOf } from './app-members.js';
import { authorAccountOf } from './app-grant-author.js';
import { logger } from '../utils/logger.js';

/** The app (`<author>/<filename>`) a role-'app' token was minted for, or undefined for any other caller. */
export function publishingAppOf(auth: { roles?: string[]; app?: string } | undefined | null): string | undefined {
  return auth && Array.isArray(auth.roles) && auth.roles.includes('app') && typeof auth.app === 'string' && auth.app
    ? auth.app : undefined;
}

/**
 * publishingAppOf for a bearer the MCP endpoint has already verified for this request (mcp/index.ts
 * authenticate): its claims are read, not checked again. Undefined for any token that is not a
 * role-'app' token or does not parse.
 */
export function publishingAppOfVerifiedToken(token: string | undefined): string | undefined {
  const payload = token?.split('.')[1];
  if (!payload) return undefined;
  try {
    return publishingAppOf(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { roles?: string[]; app?: string });
  } catch (err) {
    // A bearer that does not parse names no app; the endpoint verified it, so this is only logged.
    logger.debug('app-published-by-app: the bearer payload does not parse', { error: String(err) });
    return undefined;
  }
}

/** True when `app` names an app whose author is another account than `ownerName`. */
export function byAnotherAuthorsApp(app: unknown, ownerName: string): app is string {
  if (typeof app !== 'string' || !app) return false;
  const author = authorAccountOf(app);
  return !author || author.toLowerCase() !== accountOf(ownerName);
}

/** The owner hears that another author's app published a version of their app. Never throws. */
export async function tellOwnerAppPublishedByApp(
  storage: Storage, config: AimeatConfig,
  input: { ownerName: string; filename: string; version: number; publisher: string },
): Promise<void> {
  const app = `${input.ownerName}/${input.filename}`;
  const vars = { app, publisher: input.publisher, version: input.version };
  await notify(storage, `${input.ownerName}@${config.nodeId}`, {
    type: 'app_published_by_app',
    title: `The app ${input.publisher} published your app ${app}`,
    body: `It published version ${input.version} with the permission you gave it to publish apps. `
      + `The next time you open ${app}, you are asked once whether to allow the new permissions this version asks for.`,
    link: `/v1/apps/${app}`,
    i18n: { key: 'app_published_by_app', vars },
  });
}
