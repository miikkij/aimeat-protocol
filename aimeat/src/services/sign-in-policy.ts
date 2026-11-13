/**
 * @file src/services/sign-in-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's sign-in policy: whether two-step sign-in is required
 *   (auth.two_step_required: off, operators, everyone) and who may sign in with a password
 *   (auth.password_sign_in: on, operators, off). Both default to the node's behaviour before they
 *   existed. Every route that takes a password for sign-in or sets one asks this file, so the rule is
 *   written once (IT review of the node, 2026-11-02).
 *
 *   TWO-STEP REQUIRED. The policy covers a person's account when it is `everyone`, or `operators` and
 *   the account holds the operator role. Agents, ecosystem apps and visitors from another node are not
 *   persons here and are never covered. What satisfies it: a password with a code from an
 *   authenticator app (TOTP), a passkey, a sign-in through an identity provider (OIDC or SAML, whose
 *   MFA is the provider's), and an emailed link only with the TOTP step that route already asks. A
 *   covered account without TOTP gets no session from a password or a link: it gets a setup token
 *   (services/two-step-setup.ts) and enrols at POST /v1/ghii/login/two-step/{start,finish}. A refresh
 *   of a covered session whose account has no TOTP, no passkey and no identity provider link is
 *   refused, so the person signs in again and enrols (services/owner-session.ts).
 *
 *   PASSWORD SIGN-IN. `off` refuses every password sign-in before the password is read, and every
 *   route that would give an account a new password. `operators` keeps the password for an operator
 *   account, as the way in when the others fail: the password is checked first and the role after,
 *   and a non-operator gets PASSWORD_SIGN_IN_OFF only after a right password, so a guesser learns
 *   nothing about roles.
 *   The first operator of a node always gets a password (setup routes, and a registration that makes
 *   the first operator).
 *
 *   WHO CHANGES IT. A change that weakens either setting (two_step_required to a lower value,
 *   password_sign_in to a more open one) gives protection away, so an AI credential is refused it with
 *   PERSON_REQUIRED, the way the classification switch is (classification/switch.ts). A change that
 *   tightens applies from an AI too. Saving password_sign_in=off is refused while no operator account
 *   has a passkey or an identity provider link, because nobody could then sign in to run the node.
 *   Two-step sign-in required and totp.enabled false are refused together (TWO_STEP_NEEDS_TOTP),
 *   whichever of the two a save moves: the enrolment needs TOTP on. Set so from the environment, both
 *   guards are start-up warnings instead, and the node starts.
 * @structure TWO_STEP_REQUIRED_PATH · PASSWORD_SIGN_IN_PATH · PASSWORD_SIGN_IN_OFF · TWO_STEP_SETUP_REQUIRED ·
 *   signInPolicyLoosens() · signInPolicyChangeRefusal() · twoStepCovers() · hasIdentityProviderLink() ·
 *   hasStrongWayIn() · passwordSignInRefusal() · passwordWayInRefusal() · newPasswordRefusal() ·
 *   operatorsWithAnotherWayIn() · passwordOffLockoutRefusal() · passwordOffLockoutWarning() ·
 *   TOTP_ENABLED_PATH · twoStepWithoutTotpRefusal() · twoStepWithoutTotpWarning()
 * @usage
 *   const off = passwordSignInRefusal(config);           // before the password is read
 *   if (off) { res.status(off.status).json(error(config.nodeId, off.code, off.message)); return; }
 * @version-history
 *   v1.4.0 — 2026-11-04 — The three settings' order and the refusal's words moved onto their rows
 *     (config-schema-access.ts), judged by config-strictness.ts, which every config write and reset path
 *     asks; the answers are the same (codebase analysis 2026-11-03, item B4).
 *   v1.3.0 — 2026-11-02 — auth.sign_in_lockout is a setting an AI may turn on and not off (signInPolicyLoosens).
 *   v1.2.0 — 2026-11-02 — Under `operators` the refusal says the password is the operators' only, which
 *     agrees with the sign-in dialog's line; under `off` it says the server takes none (browser check).
 *   v1.1.0 — 2026-11-02 — twoStepWithoutTotpRefusal / twoStepWithoutTotpWarning: two-step sign-in
 *     required with totp.enabled false is refused on save and warned at start.
 *   v1.0.0 — 2026-11-02 — Initial: required two-step sign-in and password sign-in off (IT review).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord, OwnerRecord } from '../storage/interface.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { settingLoosens, looseningRefusal } from './config/strictness.js';
import { twoStepArmed } from './passkeys.js';

export const TWO_STEP_REQUIRED_PATH = 'auth.two_step_required';
export const PASSWORD_SIGN_IN_PATH = 'auth.password_sign_in';
export const SIGN_IN_LOCKOUT_PATH = 'auth.sign_in_lockout';

/** The error code a refused password sign-in or a refused new password carries. */
export const PASSWORD_SIGN_IN_OFF = 'PASSWORD_SIGN_IN_OFF';
/** The error code a covered account without a code app carries, with a setup token on a sign-in. */
export const TWO_STEP_SETUP_REQUIRED = 'TWO_STEP_SETUP_REQUIRED';

export interface PolicyRefusal { status: number; code: string; message: string }

type PolicyConfig = Pick<AimeatConfig, 'twoStepRequired' | 'passwordSignIn'>;

/** The other ways in, named in every refusal of a password. */
const OTHER_WAYS = 'Sign in with a passkey, with your organisation\'s sign-in, or with a sign-in link sent to your email.';

/** The three settings of the policy; each row carries its open-to-strict order (config-schema-access.ts). */
const POLICY_PATHS: readonly string[] = [TWO_STEP_REQUIRED_PATH, PASSWORD_SIGN_IN_PATH, SIGN_IN_LOCKOUT_PATH];

/** Whether moving one of these settings from `from` to `to` gives protection away. False for any other setting. */
export function signInPolicyLoosens(path: string, from: unknown, to: unknown): boolean {
  return POLICY_PATHS.includes(path) && settingLoosens(path, from, to);
}

/** The credential asking for the change, as the config route and the MCP tool carry it. */
export interface PolicyCaller { roles?: string[]; via?: string; anonymous?: boolean }

/**
 * The refusal an AI credential gets for a weakening change of either setting, or null. A person's own
 * session is never refused here; a value the setting does not take is left to the validator.
 */
export function signInPolicyChangeRefusal(caller: PolicyCaller, path: string, from: unknown, to: unknown): PolicyRefusal | null {
  if (!POLICY_PATHS.includes(path)) return null;
  // Worded by the row and judged by config-strictness.ts, as every config write path does.
  const r = looseningRefusal(caller, path, from, to);
  return r ? { status: r.status, code: r.code, message: r.message } : null;
}

/** Whether the two-step policy covers this account. `owner` is the stored account record. */
export function twoStepCovers(config: PolicyConfig, owner: Pick<OwnerRecord, 'roles'> | null | undefined): boolean {
  if (config.twoStepRequired === 'everyone') return !!owner;
  if (config.twoStepRequired === 'operators') return isOperatorAccount(owner);
  return false;
}

/**
 * Whether the account signs in through an identity provider: an OIDC provider (google, entra, casdoor)
 * or a SAML connection (`saml:<id>`). The SCIM bookkeeping keys (`scim:`, `scimuser:`, `scimadopted:`)
 * provision an account and sign nobody in, so they do not count.
 */
export function hasIdentityProviderLink(ghii: Pick<GHIIRecord, 'externalIdentities' | 'googleSub'> | null | undefined): boolean {
  if (!ghii) return false;
  if (ghii.googleSub) return true;
  return Object.entries(ghii.externalIdentities ?? {})
    .some(([k, v]) => !!v && !k.startsWith('scim:') && !k.startsWith('scimuser:') && !k.startsWith('scimadopted:'));
}

/** Whether the account has a way in that satisfies the two-step policy: TOTP, a passkey or an identity provider link. */
export async function hasStrongWayIn(storage: Storage, ghii: GHIIRecord): Promise<boolean> {
  if (twoStepArmed(ghii) || hasIdentityProviderLink(ghii)) return true;
  return (await storage.listPasskeysByOwner(ghii.ownerName)).length > 0;
}

const offRefusal = (): PolicyRefusal => ({ status: 403, code: PASSWORD_SIGN_IN_OFF,
  message: `This server does not take password sign-in. ${OTHER_WAYS}` });
/** Under `operators`: the same code, and a sentence that agrees with the sign-in dialog's line. */
const operatorsOnlyRefusal = (): PolicyRefusal => ({ status: 403, code: PASSWORD_SIGN_IN_OFF,
  message: `Password sign-in on this server is only for its operators. ${OTHER_WAYS}` });

/**
 * Asked BEFORE the password is read: the refusal when the policy is `off`, null otherwise. Under
 * `operators` the password is checked first and passwordWayInRefusal() decides after it.
 */
export function passwordSignInRefusal(config: PolicyConfig): PolicyRefusal | null {
  return config.passwordSignIn === 'off' ? offRefusal() : null;
}

/**
 * Asked AFTER the password checked out: the refusal for an account that may not use a password, or
 * null. Under `operators` a non-operator gets PASSWORD_SIGN_IN_OFF saying the password is the operators'
 * only. It is given only after the right password, so only the account's holder learns the role.
 */
export function passwordWayInRefusal(config: PolicyConfig, owner: Pick<OwnerRecord, 'roles'> | null | undefined): PolicyRefusal | null {
  if (config.passwordSignIn === 'off') return offRefusal();
  if (config.passwordSignIn === 'operators' && !isOperatorAccount(owner)) return operatorsOnlyRefusal();
  return null;
}

/**
 * Asked by a route that would give an account a new password (registration with a password, an
 * invitation with a password, a code key, a password reset or change). `operator` says the account
 * holds, or is about to hold, the operator role: under `operators` it keeps its password.
 */
export function newPasswordRefusal(config: PolicyConfig, operator: boolean): PolicyRefusal | null {
  if (config.passwordSignIn === 'off') return offRefusal();
  if (config.passwordSignIn === 'operators' && !operator) return operatorsOnlyRefusal();
  return null;
}

/** The operator accounts that can sign in without a password: a passkey or an identity provider link. */
export async function operatorsWithAnotherWayIn(storage: Storage, nodeId: string): Promise<string[]> {
  const out: string[] = [];
  // The active operator accounts, one filtered read; a node has a handful.
  for (const name of await storage.listOperatorNames({ limit: OPERATOR_SCAN_LIMIT })) {
    const ghii = await storage.getGHII(`${name}@${nodeId}`);
    if (hasIdentityProviderLink(ghii) || (await storage.listPasskeysByOwner(name)).length > 0) out.push(name);
  }
  return out;
}

/** The most operator accounts the lockout guard reads. More than any node runs with. */
const OPERATOR_SCAN_LIMIT = 500;

/** Saving password_sign_in=off with no operator who can sign in another way: the refusal, or null. */
export async function passwordOffLockoutRefusal(storage: Storage, nodeId: string): Promise<PolicyRefusal | null> {
  if ((await operatorsWithAnotherWayIn(storage, nodeId)).length > 0) return null;
  return { status: 409, code: 'OPERATOR_LOCKOUT',
    message: 'No operator account has a passkey or an identity provider link, so with password sign-in off nobody could sign in to run this server. Choose "operators" to keep the password for operators only, or register a passkey on an operator account first.' };
}

/** The config path of the switch that offers two-step sign-in (TOTP) at all. */
export const TOTP_ENABLED_PATH = 'totp.enabled';

/**
 * A save that would leave two-step sign-in required while TOTP is switched off: the refusal, or null.
 * Required two-step sign-in sends a covered password sign-in to the TOTP enrolment, which refuses
 * while TOTP is off, so those people could not sign in. `changed` names the setting the request moves,
 * so the message names the other one.
 */
export function twoStepWithoutTotpRefusal(
  twoStepRequired: unknown, totpEnabled: unknown, changed: typeof TWO_STEP_REQUIRED_PATH | typeof TOTP_ENABLED_PATH,
): PolicyRefusal | null {
  if (twoStepRequired === 'off' || totpEnabled !== false) return null;
  return { status: 409, code: 'TWO_STEP_NEEDS_TOTP',
    message: changed === TOTP_ENABLED_PATH
      ? `Two-step sign-in is required (${TWO_STEP_REQUIRED_PATH} is ${String(twoStepRequired)}), so ${TOTP_ENABLED_PATH} cannot be switched off: people it covers could not set up their app and sign in. Set ${TWO_STEP_REQUIRED_PATH} to off first.`
      : `Two-step sign-in is switched off on this server (${TOTP_ENABLED_PATH} is false), so ${TWO_STEP_REQUIRED_PATH} cannot require it: people it covers could not set up their app and sign in. Switch ${TOTP_ENABLED_PATH} on first, or in the same request.` };
}

/** At start: the posture warning for two-step sign-in required while TOTP is off, or null. Warn-only. */
export function twoStepWithoutTotpWarning(config: Pick<AimeatConfig, 'twoStepRequired' | 'totpEnabled'>): string | null {
  if (config.twoStepRequired === 'off' || config.totpEnabled) return null;
  return `AIMEAT_TWO_STEP_REQUIRED=${config.twoStepRequired} while AIMEAT_TOTP_ENABLED=false: a password or sign-in link of a covered account asks for the two-step setup, which is off, so those people cannot sign in. Set AIMEAT_TOTP_ENABLED=true, or AIMEAT_TWO_STEP_REQUIRED=off.`;
}

/**
 * At start: the posture warning for a node configured `off` with no operator who can sign in another
 * way, or null. Warn-only: the node starts, and the operator adds a passkey or sets `operators`.
 */
export async function passwordOffLockoutWarning(storage: Storage, config: Pick<AimeatConfig, 'passwordSignIn' | 'nodeId'>): Promise<string | null> {
  if (config.passwordSignIn !== 'off') return null;
  if ((await operatorsWithAnotherWayIn(storage, config.nodeId)).length > 0) return null;
  return 'AIMEAT_PASSWORD_SIGN_IN=off and no operator account has a passkey or an identity provider link: no operator can sign in. Set AIMEAT_PASSWORD_SIGN_IN=operators, or sign in once that way and register a passkey.';
}
