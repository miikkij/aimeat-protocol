/**
 * @file src/services/extension-install-role.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The install role (AIMEAT_EXT_INSTALL_ROLE) as a rule on the ACCOUNT: with 'operator'
 *   only the operator's account writes extension code. Moved here from routes/extensions/permissions.ts,
 *   which re-exports it, so a service (the package component registrar) asks the same rule as the
 *   /v1/extensions doors (secaudit2026oct26 round 8c, extensions-08).
 * @structure installRoleRefusal
 * @usage const refused = await installRoleRefusal(storage, config, accountName);
 * @version-history
 *   v1.0.0 — 2026-10-29 — Moved unchanged from routes/extensions/permissions.ts (secaudit2026oct26 round 8c).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { listOperatorGhiis } from './operators.js';

/**
 * The install role as a rule on the ACCOUNT. With AIMEAT_EXT_INSTALL_ROLE=operator only the
 * operator's account writes extension code: the operator in person and the operator's agents. An
 * agent of any other account is refused an install, a redeploy and an action script change, as the
 * account holder in person already was (Jouni, 2026-10-25, secaudit2026oct22 lead 128). With the
 * default 'owner' nothing is asked here. Answers the refusal in plain words, naming the setting and
 * the operator, or null when the account may write code.
 */
export async function installRoleRefusal(storage: Storage, config: AimeatConfig, accountName: string): Promise<string | null> {
  if (config.extInstallRole !== 'operator') return null;
  if (isOperatorAccount(await storage.getOwner(accountName))) return null;
  const operators = (await listOperatorGhiis(storage, config)).map(g => localAccountName(g));
  const who = operators.length ? `the operator (${operators.join(', ')})` : 'the operator';
  return 'On this node only the operator\'s account installs or changes add-on code '
    + `(the setting AIMEAT_EXT_INSTALL_ROLE is "operator"). Ask ${who} to install it for you, `
    + 'or to change the setting. You can write to support@operators.';
}
