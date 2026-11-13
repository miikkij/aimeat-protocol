/**
 * @file src/services/datapackage/announce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Telling the search engines that a public data package changed: its public page goes to
 *   IndexNow when a public version is published, or when a package is raised to public.
 *
 *   The notice is the one services/indexnow.ts sends for an app, with the same four silences: no
 *   IndexNow key, the automatic switch (seo.indexnow_auto) off, node-wide discovery (seo.indexing) off,
 *   or nothing to send. A node that shows its content to signed-in accounts only sends nothing either,
 *   because it has no public page to point at. A notice never fails the publish: it is sent after the
 *   version is stored and its outcome is only logged (submitToIndexNow never throws).
 * @structure announcePublicDataset · datasetLandingOf
 * @usage announcePublicDataset({ storage, config }, descriptor.aimeat.packageId);
 * @version-history
 *   v1.1.0 — 2026-11-01 — The public page is /v1/dataset/{owner}/{name}, read from the package id (WP9b).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { submitToIndexNow } from '../indexnow.js';
import { signedInOnly } from '../../config/visibility.js';
import { datasetLandingUrl } from './catalogue-facts.js';
import { logger } from '../../utils/logger.js';

/** The public page of a package, from its package id `pkg:<owner>/<name>`. */
export function datasetLandingOf(baseUrl: string, packageId: string): string {
  const m = /^pkg:([^/]+)\/([^/@]+)/.exec(packageId);
  return datasetLandingUrl(baseUrl, m?.[1] ?? '', m?.[2] ?? '');
}

/** Send the package's public page to IndexNow, in the background. Returns at once. */
export function announcePublicDataset(deps: { storage: Storage; config: AimeatConfig }, packageId: string): void {
  if (signedInOnly(deps.config)) return;
  const url = datasetLandingOf(deps.config.baseUrl, packageId);
  void submitToIndexNow(deps.config, deps.storage, [url], { scope: 'dataset' }).catch((err: unknown) => {
    logger.warn('datapackage: the IndexNow notice did not go out', { package: packageId, error: String(err) });
  });
}
