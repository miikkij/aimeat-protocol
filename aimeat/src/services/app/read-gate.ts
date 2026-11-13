/**
 * @file src/services/app/read-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may see a published app at all: the operator-hidden gate and the sign-in gate of
 *   GET /v1/apps/:owner/:filename, written once, so the version list (REST and the MCP action) answers
 *   what the app's own read answers for the same caller (codebase analysis 2026-11-03, item A1).
 *
 *   The two gates are the read route's own decisions, moved here unchanged: routes/apps/read.ts asks
 *   hiddenFromReader() where it asked the operator-hidden question inline, and routes/apps/open.ts
 *   signInGateRefused() asks signInGateOf(). The access code and the pacing licence stay in the read
 *   route: they guard the app's content, and a version list carries none.
 * @structure AppReader · hiddenFromReader() · signInGateOf() · callerAppReader() · appReadRefusal() · SIGN_IN_REFUSAL
 * @usage
 *   const refusal = await appReadRefusal(storage, config, app, current, reader, notFoundMessage);
 *   if (refusal) return refuse(refusal.status, refusal.code, refusal.message);
 * @version-history
 *   2026-11-04 — Initial: the operator-hidden and sign-in gates of the app read, extracted for the
 *     version list (codebase analysis 2026-11-03, item A1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { isSameAccount } from '../../utils/same-account.js';
import { appNeedsSignIn, mayOpenApp } from './access.js';
import { isNodeAccount, type AudienceAuth } from '../audience.js';
import { operatorOverride } from '../operator-override.js';
import type { CallerContext } from '../caller-context.js';

/** The caller of an app read, in the form both the REST routes and the MCP tool can give. */
export interface AppReader {
  /** The caller's credential: `req.auth` on REST, the session's caller on MCP; undefined signed out. */
  auth: AudienceAuth | undefined;
  /**
   * The caller's own account name (canonicalOwner on REST, the session's owner on MCP). Asked only
   * when `auth` is present, and at most where the read route asked it.
   */
  viewerOwner: () => Promise<string>;
  /** The operator's pass to another person's app (operatorOverride: writes the operator trail). */
  operatorReads: () => Promise<boolean>;
  /** A grant from POST /v1/apps/:owner/:filename/open for this app (REST `?access=`). */
  accessGranted?: () => Promise<boolean>;
}

/**
 * The operator-hidden gate: true when `current` (the row whose settings decide) is hidden from this
 * caller. Only the app's owner and an operator see a hidden app; anybody else gets the answer a
 * missing app gets, so moderation is not revealed.
 */
export async function hiddenFromReader(current: Pick<AppRecord, 'operatorHidden'>, appOwnerName: string, reader: AppReader): Promise<boolean> {
  if (!current.operatorHidden) return false;
  const isOwner = reader.auth ? isSameAccount(await reader.viewerOwner(), appOwnerName) : false;
  return !isOwner && !(await reader.operatorReads());
}

/**
 * The sign-in gate: null when the caller may open the app (it needs no sign-in, the caller holds an
 * opening grant, is the owner, is an account the app's setting admits, or an operator), else whether
 * the caller is an account of this node (403) or not (401).
 */
export async function signInGateOf(
  storage: Storage, config: AimeatConfig, app: Pick<AppRecord, 'ownerName'>, current: AppRecord, reader: AppReader,
): Promise<{ account: boolean } | null> {
  if (!appNeedsSignIn(config, current)) return null;
  if (reader.accessGranted && await reader.accessGranted()) return null;
  const account = isNodeAccount(reader.auth);
  if (account) {
    if (isSameAccount(await reader.viewerOwner(), app.ownerName) || await mayOpenApp(storage, config, current, reader.auth) || await reader.operatorReads()) return null;
  }
  return { account };
}

/**
 * The caller of an MCP session as an AppReader for one app: its account is the session's owner, and
 * an operator's pass writes the operator trail as the REST read's does. A session holds no opening
 * grant.
 */
export function callerAppReader(
  storage: Storage, config: AimeatConfig, caller: CallerContext, filename: string,
): (appOwnerName: string) => AppReader {
  const auth = { ...caller.auth, ...(caller.kind === 'anonymous' ? { anonymous: true } : {}) };
  return (appOwnerName) => {
    let operatorRead: boolean | undefined;
    return {
      auth,
      viewerOwner: async () => caller.owner,
      operatorReads: async () => (operatorRead ??= await operatorOverride(
        storage, config, auth, { ownerOf: appOwnerName, area: 'app', action: 'read', subject: filename })),
    };
  };
}

/** The two refusals of the sign-in gate, as the app read sends them to an API caller. */
export const SIGN_IN_REFUSAL = {
  account: { status: 403, code: 'ACCESS_DENIED', message: 'This app opens for the people its owner chose, and you are not among them.' },
  none: { status: 401, code: 'SIGN_IN_REQUIRED', message: 'This app opens for signed-in people only. Sign in and open it again.' },
} as const;

/**
 * Both gates in the read route's order: the 404 a missing app gets (with `notFoundMessage`) for a
 * hidden app, then the sign-in gate's 401 or 403. Null when the caller may see the app.
 */
export async function appReadRefusal(
  storage: Storage, config: AimeatConfig, app: AppRecord, current: AppRecord, reader: AppReader, notFoundMessage: string,
): Promise<{ status: number; code: string; message: string } | null> {
  if (await hiddenFromReader(current, app.ownerName, reader)) return { status: 404, code: 'NOT_FOUND', message: notFoundMessage };
  const gate = await signInGateOf(storage, config, app, current, reader);
  if (gate) return gate.account ? SIGN_IN_REFUSAL.account : SIGN_IN_REFUSAL.none;
  return null;
}
