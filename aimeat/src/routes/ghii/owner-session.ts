/**
 * @file src/routes/ghii/owner-session.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What happens after a human credential checks out, whichever credential it was.
 *   The password door and the passkey door both end here, so a session minted one way and a
 *   session minted the other are the same session: same deactivation refusal, same login count,
 *   same owner key handling, same first-login credentials, same response shape.
 *
 *   THE DEACTIVATION CHECK BELONGS INSIDE, not at each door. It is the last thing between a
 *   correct credential and a working session, and a door that forgot it would hand a deactivated
 *   account a token. Keeping it here means a new sign-in method cannot forget it.
 *
 *   PURE EXTRACTION from register-login.ts on 2026-09-04, moved when passkeys arrived. The bytes
 *   are the same; only the indent and the surrounding signature changed.
 *
 * @structure completeOwnerLogin(config, storage, req, res, args) -> writes the response itself
 * @usage await completeOwnerLogin(config, storage, req, res, { ghiiRecord, loginName, wantsOwnerKey });
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted verbatim from routes/ghii/register-login.ts.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, GHIIRecord } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { establishOwnerSession } from '../../services/owner-session.js';
import { issueFirstLoginKeyCredentials } from '../../services/key-credentials.js';

/**
 * Turn a checked credential into an owner session, or refuse a deactivated account.
 *
 * @param args.ghiiRecord   the account, already read
 * @param args.loginName    its bare owner name
 * @param args.wantsOwnerKey the client holds no signing key and is asking for a fresh one
 */
export async function completeOwnerLogin(
  config: AimeatConfig,
  storage: Storage,
  req: Request,
  res: Response,
  args: { ghiiRecord: GHIIRecord; loginName: string; wantsOwnerKey: boolean },
): Promise<void> {
  const { ghiiRecord, loginName, wantsOwnerKey } = args;
  // Deactivated account (BR-04): refused AFTER the password check on purpose — answering
  // before it would tell anyone who types a username whether the account is disabled.
  // Refused BEFORE the login-count write and the session, so nothing records a "login".
  const preSessionOwner = await storage.getOwner(loginName);
  if (preSessionOwner?.disabledAt) {
      res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated'));
      return;
  }

  // Password (+ TOTP if enabled) verified — track login
  const isFirstLogin = (ghiiRecord.loginCount ?? 0) === 0;
  const loginNow = new Date().toISOString();
  await storage.updateGHII(ghiiRecord.ghii, {
      lastLoginAt: loginNow,
      loginCount: (ghiiRecord.loginCount ?? 0) + 1,
  });

  // Provisioned-code ("key") account, first sign-in: rotate its dash-carrying bootstrap code to
  // a durable, validator-clean password and hand the owner their real login (username + password),
  // both in this response and by email. Runs exactly once (gated by the invite flipping accepted).
  const keyCredentials = isFirstLogin
      ? await issueFirstLoginKeyCredentials(storage, config, ghiiRecord)
      : null;

  // Issue OWNER JWT (human users authenticate as owners, not agents)
  const ownerRecord = await storage.getOwner(loginName);

  // Owner signing-key handling — mint a fresh keypair ONLY when necessary.
  // Rotating the key on every login (the previous behaviour) rewrote the
  // stored public key, which silently invalidated the private key held by
  // every OTHER device/tab in IndexedDB. Those sessions could then no longer
  // sign a refresh and were force-logged-out at JWT expiry. The server only
  // persists the public key (the private key lives solely in the browser),
  // so we re-mint only when the owner has no key yet, or the client asks for
  // one because it holds none locally (a brand-new device). Otherwise we keep
  // the existing key and return no private key, leaving every already-signed-in
  // device's refresh capability intact.
  const needsNewOwnerKey = wantsOwnerKey || !ownerRecord?.publicKey;
  let ownerKeyPair: { publicKey: string; privateKey: string } | null = null;
  if (needsNewOwnerKey) {
      ownerKeyPair = await generateKeyPair();
      await storage.updateOwner(loginName, { publicKey: ownerKeyPair.publicKey });
  }

  const roles: string[] = [];
  if (ownerRecord?.roles.includes('owner')) roles.push('owner');
  if (ownerRecord?.roles.includes('operator')) roles.push('operator');

  // Self-heal: if no operator exists anywhere, promote this user
  if (ownerRecord && !roles.includes('operator')) {
    const allOwners = await storage.listOwners();
    const hasOperator = allOwners.some(o => o.roles.includes('operator'));
    if (!hasOperator) {
      roles.push('operator');
      await storage.updateOwner(loginName, { roles: [...ownerRecord.roles, 'operator'] });
    }
  }

  // Establish an owner session: short-lived access JWT (bound to the session via
  // jti) + a rotating refresh token delivered as an httpOnly cookie. Refresh no
  // longer depends on the owner keypair, so other devices are never invalidated.
  const { token, sessionId, expiresIn } = await establishOwnerSession(
      storage, config, req, res, { owner: loginName, roles },
  );

  // SECURITY: Prevent caching of response containing private keys
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.json(success(config.nodeId, {
      ghii: {
          ghii: ghiiRecord.ghii,
          username: ghiiRecord.username,
          display_name: ghiiRecord.displayName,
      },
      owner: { name: loginName },
      token,
      session_id: sessionId,
      expires_in: expiresIn,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      // Only hand back the private key when a new one was minted — otherwise
      // the client keeps the key it already holds in IndexedDB (see above).
      ...(ownerKeyPair ? { owner_private_key: ownerKeyPair.privateKey } : {}),
      owner_public_key: ownerKeyPair?.publicKey ?? ownerRecord?.publicKey ?? '',
      // First-login durable credentials for a provisioned-code account (also emailed). Lets the
      // entry surface show the exact username + password the login form accepts. Absent otherwise.
      ...(keyCredentials ? { key_credentials: keyCredentials } : {}),
  }, [
      { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
      { description: 'Upload an app', method: 'POST', url: '/v1/apps' },
  ]));
  emitChange('ghii');
}
