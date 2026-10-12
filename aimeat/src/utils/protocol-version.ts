/**
 * @file src/utils/protocol-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Parse and order the AIMEAT protocol versions a federation peer can state, so a
 *   minimum-version gate compares versions rather than strings.
 *
 * @structure
 *   - parseProtocolVersion(value): the version as an ordered tuple, or null for a format it cannot read
 *   - compareProtocolVersions(a, b): -1 | 0 | 1, or null when either side cannot be read
 *   - isBelowProtocolVersion(value, min): true only when both are read and value is lower
 *
 * Three formats are read, in the order the project has named its protocol:
 *   - `v1`, `v2`: the API generation every node states today (the default when nothing is stated)
 *   - `4.0`, `5.0`, `5.1`: an RFC number
 *   - `2026-11`, `2026-11-15`: a dated protocol name (ruling D1, "AIMEAT Core 2026-11")
 * Within one format the numbers compare as numbers; across formats a later format is the newer one.
 *
 * @version-history
 *   v1.1.0 — 2026-10-12 — CORE_PROTOCOL_VERSION, the edition this node states in discovery from node
 *     4.0.0 (services/core-discovery.ts, Core 2026-11 DISC-01). security/protocol-versions.json row
 *     `aimeat-core` holds it to the openapi.yaml `x-aimeat-protocol`. Parsing is unchanged.
 *   v1.0.0 — 2026-10-11 — Federation compared protocol versions as strings, so "5.0" and "2026-11"
 *     sorted below "v1" and an auto-admit or promotion gate would refuse a newer node (docs audit
 *     2026-10-11, wish wish-federaation-protokollaversio-vertaillaan-numerona-ei-merkkij).
 */

/** What a peer that states no protocol version speaks: every node before the field existed. */
export const DEFAULT_PROTOCOL_VERSION = 'v1';

/** The AIMEAT Core edition this implementation is written to (docs/AIMEAT-Core-2026-11.md). */
export const CORE_PROTOCOL_VERSION = '2026-11';

const API_TAG = /^v(\d{1,4})$/i;
const RFC_NUMBER = /^(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?$/;
const DATED = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

/** The version as [format rank, ...numbers], or null for a value in no format this node reads. */
export function parseProtocolVersion(value: string | undefined | null): number[] | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  let m = API_TAG.exec(v);
  if (m) return [0, Number(m[1])];
  m = RFC_NUMBER.exec(v);
  if (m) return [1, Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  m = DATED.exec(v);
  if (m) {
    const month = Number(m[2]);
    const day = Number(m[3] ?? 0);
    if (month < 1 || month > 12 || day > 31) return null;
    return [2, Number(m[1]), month, day];
  }
  return null;
}

/** -1 when a is lower, 0 when equal, 1 when higher; null when either side cannot be read. */
export function compareProtocolVersions(a: string | undefined | null, b: string | undefined | null): -1 | 0 | 1 | null {
  const pa = parseProtocolVersion(a);
  const pb = parseProtocolVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Is the stated version below the minimum? A missing value reads as DEFAULT_PROTOCOL_VERSION. A
 * value or a minimum in a format this node cannot read is never ranked lower, so a newer node that
 * names its protocol in a way this build does not know is not refused for it.
 */
export function isBelowProtocolVersion(value: string | undefined | null, min: string | undefined | null): boolean {
  if (!min) return false;
  return compareProtocolVersions(value ?? DEFAULT_PROTOCOL_VERSION, min) === -1;
}
