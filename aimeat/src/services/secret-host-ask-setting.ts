/**
 * @file src/services/secret-host-ask-setting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One account's "Ask me before my secret is sent to a new address for the first time":
 *   where it is kept, what it is when the owner never chose, and how it is changed.
 *
 *   WHY (secaudit2026oct22, leads 68 and 386; Jouni, 2026-10-25). Code an owner's agent writes runs
 *   with the owner's rights, and the record still names who wrote it. The one exception is this
 *   setting. While it is on, the first send of an owner's vault secret that has no address yet, to an
 *   address chosen by code one of the owner's agents wrote or by a host field such an agent set, asks
 *   the owner first under the approval standard (services/secret-approvals.ts files the question; an
 *   agent holding secrets:manage is not asked about). While it is off, that send goes through and
 *   the address is kept, as before the audit (services/extension-secret-authority.ts decideFirstUse).
 *
 *   WHERE IT IS KEPT. The profile settings record pattern (routes/ghii/profile.ts
 *   `profile.<username>.directory_listed`): one memory record, `profile.<username>.secret_host_ask`,
 *   in the owner's namespace under the reserved `profile.` prefix (utils/reserved-keys.ts), so a
 *   granted app cannot write it through the memory routes. Absent means the node's default, the
 *   operator's setting security.secret_host_ask_default (AIMEAT_SECRET_HOST_ASK_DEFAULT), which is on.
 *
 *   WHO CHANGES IT. Switching it on narrows, so any principal of the account may do it at once. Off
 *   loosens: the owner in person and a principal holding secrets:manage (which may choose a secret's
 *   address anyway) switch it off at once; anyone else asks the owner with one press (kind
 *   account-setting), and it stays on until the owner allows it.
 * @structure SECRET_HOST_ASK_FIELD · secretHostAskKey · SecretHostAsk · readSecretHostAsk ·
 *   secretHostAskOn · writeSecretHostAsk · changeSecretHostAsk
 * @usage
 *   if (await secretHostAskOn(storage, config, ownerGhii)) { ...ask... }
 *   const out = await changeSecretHostAsk({ storage, config }, caller, false, req.auth?.app);
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 68 and 386 reworked; the approval standard).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from './caller-context.js';
import { emitChange } from './event-bus.js';
import { fileAsk, publishRequestedBody, requesterOf } from './publish-requests/ask.js';
import { localAccountName } from '../utils/gaii.js';
import { SECRETS_MANAGE_SCOPE } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

export const SECRET_HOST_ASK_FIELD = 'secret_host_ask';

/** The record of one account's choice. */
export function secretHostAskKey(account: string): string {
  return `profile.${account}.${SECRET_HOST_ASK_FIELD}`;
}

/** What is in force for an account, and why. */
export interface SecretHostAsk {
  /** Whether the first send to a new address asks the owner now. */
  on: boolean;
  /** True while the owner never chose, so the node's default applies. */
  defaulted: boolean;
  /** The node's default, the operator's setting. */
  node_default: boolean;
  set_by: string | null;
  set_at: string | null;
}

const asRecord = (v: unknown) => (v && typeof v === 'object' ? v as { on?: unknown; set_by?: unknown; set_at?: unknown } : null);

/** The setting for this account. A read that fails answers the node's default. */
export async function readSecretHostAsk(storage: Storage, config: Pick<AimeatConfig, 'secretHostAskDefault'>, ownerGhii: string): Promise<SecretHostAsk> {
  const nodeDefault = config.secretHostAskDefault !== false;
  const row = await storage.getMemory(ownerGhii, secretHostAskKey(localAccountName(ownerGhii))).catch((err: unknown) => {
    logger.warn('secret host ask: the setting could not be read; the node default applies', { owner: ownerGhii, error: String(err) });
    return null;
  });
  const v = asRecord(row?.value);
  if (!v || typeof v.on !== 'boolean') return { on: nodeDefault, defaulted: true, node_default: nodeDefault, set_by: null, set_at: null };
  return {
    on: v.on, defaulted: false, node_default: nodeDefault,
    set_by: typeof v.set_by === 'string' ? v.set_by : null, set_at: typeof v.set_at === 'string' ? v.set_at : null,
  };
}

/** Whether the first send of this owner's unbound secret to an address an agent chose asks the owner now. */
export async function secretHostAskOn(storage: Storage, config: Pick<AimeatConfig, 'secretHostAskDefault'>, ownerGhii: string): Promise<boolean> {
  return (await readSecretHostAsk(storage, config, ownerGhii)).on;
}

/** Store the account's choice, server-side (the reserved prefix keeps the memory routes out). */
export async function writeSecretHostAsk(
  deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string, on: boolean, by: string,
): Promise<SecretHostAsk> {
  const key = secretHostAskKey(localAccountName(ownerGhii));
  const now = new Date().toISOString();
  const row = await deps.storage.getMemory(ownerGhii, key);
  await deps.storage.setMemory({
    key, ownerGaii: ownerGhii,
    value: { on, set_by: by, set_at: now },
    visibility: 'owner', tags: ['profile', 'security'], ttlHours: null,
    version: (row?.version ?? 0) + 1, createdAt: row?.createdAt ?? now, updatedAt: now,
  });
  emitChange('ghii', ownerGhii);
  logger.info('Secret host ask set', { event: 'secret_host_ask.set', owner: ownerGhii, on, by });
  return readSecretHostAsk(deps.storage, deps.config, ownerGhii);
}

export type SecretHostAskChange =
  | { ok: true; setting: SecretHostAsk; approval_request?: ReturnType<typeof publishRequestedBody> }
  | { ok: false; status: number; code: string; message: string };

/**
 * Change the setting for the caller's account. On: at once. Off: at once for the owner in person or a
 * principal holding secrets:manage; anyone else files the owner's question and the setting stays on.
 */
export async function changeSecretHostAsk(
  deps: { storage: Storage; config: AimeatConfig }, caller: CallerContext, on: unknown, app?: string,
): Promise<SecretHostAskChange> {
  if (typeof on !== 'boolean') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Say whether the owner is asked first: send on as true or false.' };
  }
  if (caller.visitor || caller.kind === 'anonymous') {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only someone acting in this account changes its settings.' };
  }
  const current = await readSecretHostAsk(deps.storage, deps.config, caller.ownerGhii);
  if (on === current.on && !current.defaulted) return { ok: true, setting: current };
  if (on || caller.has(SECRETS_MANAGE_SCOPE)) {
    return { ok: true, setting: await writeSecretHostAsk(deps, caller.ownerGhii, on, caller.inPerson ? caller.ownerGhii : caller.principal) };
  }
  const filed = await fileAsk(deps, caller.owner, requesterOf(deps, caller, app), {
    kind: 'account-setting',
    target: { setting: SECRET_HOST_ASK_FIELD, on: 'false' },
    title: 'the question before a secret goes to a new address switched off',
    name: 'secret_host_ask',
    change: { field: SECRET_HOST_ASK_FIELD, from: current.on, to: false },
    approval: {
      approver: 'owner',
      asks: 'stop asking you before your secrets are sent to a new address for the first time',
      why: 'While the question is on, code your agents write and addresses they set cannot send your stored secrets anywhere new without your press. Switching it off lets them do that without asking. Until you allow it, the question stays on.',
      // An agent that may choose a secret's address anyway may switch the question off.
      approve_scope: SECRETS_MANAGE_SCOPE,
      i18n: { key: 'approval_secret_host_ask_off', vars: {} },
    },
  });
  if (!filed.ok) return { ok: false, status: filed.status, code: filed.code, message: filed.message };
  return { ok: true, setting: current, approval_request: publishRequestedBody(deps, filed) };
}
