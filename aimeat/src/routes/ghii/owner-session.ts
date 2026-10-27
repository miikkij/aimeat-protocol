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
 *   2026-10-27 — The self-heal claim reads fromNodeMachine(req): a sign-in the node replays onto loopback for a remote agent (the connector tunnel) is not this machine's own (secaudit2026oct26).
 *   2026-10-27 — The self-heal claim reads requestFromThisMachine (no forwarding header, a loopback Host) (secaudit2026oct26).
 *   2026-10-23 — The self-heal claim reads the request's socket address: a loopback base URL waives the
 *     setup code only for a request from loopback (secaudit2026oct22).
 *   2026-10-16 — On a node whose base URL is not loopback, the no-operator self-heal promotes the account
 *     only with the one-time setup code (`setupCode` in the sign-in body, claimOperatorSetupCode); without
 *     it the sign-in goes on as a plain owner. The promotion is decided again in one transaction with
 *     the claim read (rolesAtWrite), so two sign-ins at once do not both become the operator (Jouni, 2026-10-16).
 *   2026-10-16 — The no-operator self-heal asks storage.operatorAccountState instead of loading every owner
 *     on each sign-in of an account that is not an operator (QA audit P7-10).
 *   v1.0.1 — 2026-10-05 — The account's operator role is read with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-09-04 — Extracted verbatim from routes/ghii/register-login.ts.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, GHIIRecord } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { fromNodeMachine } from '../../auth/loopback-pass.js';
import { isOperatorAccount } from '../../utils/operator-account.js';
import { claimOperatorSetupCode, rolesAtWrite, SetupCodeRefusedError, type OperatorClaim } from '../../services/owner-provisioning.js';
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
  if (isOperatorAccount(ownerRecord)) roles.push('operator');

  // Self-heal: if no operator exists anywhere, promote this user
  if (ownerRecord && !isOperatorAccount(ownerRecord)) {
    // One EXISTS query, not the whole owner table: every sign-in of an account that is not an
    // operator asks this (QA audit P7-10).
    const { anyOperator: hasOperator } = await storage.operatorAccountState();
    if (!hasOperator) {
      // On a node others can reach, the promotion needs the one-time setup code from the start log
      // (`setupCode` in the sign-in body). Without a valid one the person signs in as the owner they
      // are, and nothing is refused: a sign-in is not the place to fail a correct password (Jouni,
      // 2026-10-16). On a loopback node the claim asks nothing.
      let claim: OperatorClaim | null = null;
      try {
        claim = await claimOperatorSetupCode(storage, config, ['operator'], (req.body as { setupCode?: unknown } | undefined)?.setupCode,
          fromNodeMachine(req));
      } catch (err) {
        if (!(err instanceof SetupCodeRefusedError)) throw err;
      }
      if (claim) {
        const held = claim;
        let promoted: boolean;
        try {
          // Decided again inside one transaction with the claim read (services/owner-provisioning.ts
          // rolesAtWrite), so two sign-ins at once do not both become the operator.
          promoted = await storage.transaction(async () => {
            const granted = await rolesAtWrite(storage, [...ownerRecord.roles, 'operator'], held);
            if (granted.indexOf('operator') < 0) return false;
            await storage.updateOwner(loginName, { roles: granted });
            return true;
          });
        } catch (err) {
          held.release();
          throw err;
        }
        if (promoted) {
          held.commit();
          roles.push('operator');
        } else {
          held.release();
        }
      }
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
