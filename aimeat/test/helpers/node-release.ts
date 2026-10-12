/**
 * @file node-release.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which release the node under test runs, read from GET /v1/build, so a suite whose
 *   subject is a deprecated form can assert the exact answer of each release: the 3.x acceptance on
 *   a node before the removal, the refusal on a node at or after it.
 *
 *   WHY. A sweep runs the same suites on a node at the package version and on a loopback test node
 *   that runs as 4.0.0 (AIMEAT_TEST_SOFTWARE_VERSION, src/utils/version.ts testVersionOverride). A
 *   suite that accepted "either answer" would pass a node that refuses on 3.x or accepts on 4.0.0;
 *   asking the node which release it runs keeps each half exact.
 * @structure nodeVersion(base) · removedOn(base, removedIn) · versionAtLeast
 * @usage
 *   import { removedOn } from './helpers/node-release.js';
 *   import { MORSEL_PRICE_FIELDS_REMOVED_IN } from '../src/config-pacing.js';
 *   if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) { ...expect 400 MORSEL_PRICE_REMOVED } else { ...expect 3.x }
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial: the 4.0.0 sweep (AIMEAT_TEST_SOFTWARE_VERSION=4.0.0).
 */
import { versionAtLeast } from '../../src/utils/version.js';

export { versionAtLeast };

const cache = new Map<string, string>();

/** The release the node at `base` reports on GET /v1/build. Read once per base. */
export async function nodeVersion(base: string): Promise<string> {
    const hit = cache.get(base);
    if (hit) return hit;
    const res = await fetch(`${base}/v1/build`);
    const body = await res.json() as { version?: string };
    if (!res.ok || typeof body.version !== 'string') throw new Error(`GET ${base}/v1/build answered ${res.status} without a version`);
    cache.set(base, body.version);
    return body.version;
}

/** Whether the node at `base` runs `removedIn` or later, so the form removed in it is refused there. */
export async function removedOn(base: string, removedIn: string): Promise<boolean> {
    return versionAtLeast(await nodeVersion(base), removedIn);
}
