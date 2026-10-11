/**
 * @file src/services/contract-docs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public record contracts this node serves at /v1/specs/{name}, so the `spec` field
 *   of a self-describing record names an address that opens. The documents live in the repository's
 *   docs/specs/ folder, and a packaged install carries a copy in dist/docs/specs
 *   (scripts/copy-dist-assets.mjs).
 *
 * @structure
 *   - PUBLIC_CONTRACTS: the file names served; nothing else in docs/specs is reachable
 *   - findContractDoc(name): the file on disk, or null
 *   A record names one as `/v1/specs/<file name>`, a node-relative path that resolves on whichever
 *   node holds the record (models/signal-schemas.ts, models/visibility-schemas.ts).
 *
 * @version-history
 *   v1.2.0 — 2026-10-11 — datamap.md, the public spec of aimeat.datamap/2, the record an app's data
 *     map is (services/data-map/data-map-types.ts).
 *   v1.1.0 — 2026-10-11 — package-sale.md, the node-to-node contract of a package sale. The design it
 *     came from is in the development organism (docs audit, phase 3).
 *   v1.0.0 — 2026-10-11 — signals.* and visibility records named /docs/specs/…, which no route served
 *     (wish-signals-ja-visibility-tietueiden-spec-kentt-osoittaa-osoitte).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The contracts a record's `spec` field may point at. Adding one here is what publishes it. */
export const PUBLIC_CONTRACTS = ['signals-contract.md', 'visibility-contract.md', 'tracked-response-contract.md', 'package-sale.md', 'datamap.md'] as const;

/** Where the document is on disk: the repository's docs/specs when run from source, dist/docs/specs in a package. */
export function findContractDoc(name: string): string | null {
  if (!(PUBLIC_CONTRACTS as readonly string[]).includes(name)) return null;
  for (const dir of [
    join(__dirname, '..', '..', '..', 'docs', 'specs'), // source: src/services → the repo root
    join(__dirname, '..', '..', 'docs', 'specs'),       // built + npm: dist/src/services → dist/docs
  ]) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}
