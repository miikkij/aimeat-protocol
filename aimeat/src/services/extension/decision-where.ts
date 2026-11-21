/**
 * @file src/services/extension/decision-where.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the person makes a decision an extension action marks `decision: person`
 *   (decision-mark.ts) themselves: the app the extension gates, else the account's Extensions page.
 *   Its own file so the unattended run (system-run.ts) names the address without importing the
 *   approval request store that person-decision.ts files into.
 * @structure wherePersonDecides
 * @usage const where = await wherePersonDecides(config, storage, ext);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionRecord } from '../../storage/interface.js';
import { resolveGatedAppRef } from '../members-only.js';
import { resolveAppUrls } from '../app/urls.js';

/**
 * Where the person makes this decision themselves: the app the extension gates (`config.app`), or
 * the account's Extensions page when it gates none. Read only; it assigns nothing.
 */
export async function wherePersonDecides(
  config: AimeatConfig, storage: Storage, ext: Pick<ExtensionRecord, 'config' | 'installedBy'>,
): Promise<string> {
  const gated = await resolveGatedAppRef(storage, ext);
  const slash = gated ? gated.indexOf('/') : -1;
  if (gated && slash > 0) {
    const owner = gated.slice(0, slash);
    const filename = gated.slice(slash + 1);
    // resolveAppUrls falls back to the path form itself when the subdomain table cannot be read.
    const urls = await resolveAppUrls(config, storage, [{ owner, filename }]);
    const url = urls[`${owner}/${filename}`];
    if (url) return url;
  }
  return `${config.baseUrl.replace(/\/+$/, '')}/v1/profile?tab=extensions`;
}
