/**
 * @file src/services/app-purchase-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's own gates, asked by POST /v1/app-store/purchase before any morsel moves. The
 *   purchase stored the app's bytes in the receipt and GET /v1/app-store/purchases/:txId gave them to
 *   the buyer, past every gate the apex read (routes/apps/read.ts) applies before the licence check: the
 *   operator's hiding, the access code, and who the app opens for (secaudit2026oct26,
 *   app-store:purchase-returns-content-past-app-gates).
 *
 *   - An app the operator hid answers as a missing one, as the read does.
 *   - An app that opens for chosen people only refuses a buyer who is not among them, with the read's
 *     sentence: they could not open what they bought.
 *   - An access code does not stop the purchase: a buyer who holds the code is told to buy by the read
 *     after they gave it, and buys as before. Without the right code the receipt carries no copy of the
 *     app, and the app opens on the apex with the code and the licence, as it always did.
 *   An operator passes all three, with the operator trail the read writes.
 * @structure PurchaseGate · appPurchaseGate(deps, auth, app, code)
 * @usage
 *   const gate = await appPurchaseGate({ storage, config }, req.auth, app, codeOf(req));
 *   if (gate.kind === 'refused') return res.status(gate.status).json(error(nodeId, gate.code, gate.message));
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { appNeedsSignIn, mayOpenApp } from './app-access.js';
import { operatorOverride } from './operator-override.js';

export type PurchaseGate =
  | { kind: 'ok'; withholdContent: boolean }
  | { kind: 'refused'; status: 403 | 404; code: 'NOT_FOUND' | 'ACCESS_DENIED'; message: string };

type GateAuth = Parameters<typeof operatorOverride>[2] & Parameters<typeof mayOpenApp>[3];

/** What the app's own gates say to this buyer. `code` is the access code the buyer sent, if any. */
export async function appPurchaseGate(
  deps: { storage: Storage; config: AimeatConfig }, auth: GateAuth, app: AppRecord, code: string | undefined,
): Promise<PurchaseGate> {
  const { storage, config } = deps;
  let operatorRead: boolean | undefined;
  const operatorReads = async (): Promise<boolean> => (operatorRead ??= await operatorOverride(
    storage, config, auth, { ownerOf: app.ownerName, area: 'app', action: 'read', subject: app.filename }));

  if (app.operatorHidden && !(await operatorReads())) {
    return { kind: 'refused', status: 404, code: 'NOT_FOUND', message: `App "${app.filename}" not found for owner "${app.ownerName}"` };
  }
  if (appNeedsSignIn(config, app) && !(await mayOpenApp(storage, config, app, auth)) && !(await operatorReads())) {
    return { kind: 'refused', status: 403, code: 'ACCESS_DENIED', message: 'This app opens for the people its owner chose, and you are not among them.' };
  }
  const withholdContent = !!app.accessCode && app.accessCode !== code && !(await operatorReads());
  return { kind: 'ok', withholdContent };
}
