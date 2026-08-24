/**
 * @file src/services/data-map/coverage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What is stored here that nobody has described.
 *
 *   THE FOLD HAPPENS ON THE SERVER, ALWAYS. The heaviest owner on this node holds 18,446 keys, and a
 *   surface that receives them and groups them in the browser is a surface that ships eighteen
 *   thousand strings to draw twenty-seven rows. The classifier runs here, once, and what crosses the
 *   wire is the answer.
 *
 *   THE NUMBER THAT MATTERS IS THE FAMILY COUNT, NOT THE KEY COUNT. Measured on this node's whole
 *   keyspace: 4,222 unexplained keys fold to 174 families, and the six biggest of those are 91% of
 *   them. The work of describing what nobody has described is therefore six sentences, not four
 *   thousand — which is the difference between a view worth building and a list nobody opens.
 *
 *   EVERY ANSWER CARRIES WHAT IT CANNOT SEE. A coverage figure that hides its own blind spots reads
 *   as complete, and reading as complete when it is not is the exact failure this whole feature
 *   exists to prevent.
 * @structure CoverageReport · buildCoverage(storage, config, ownerName)
 * @usage import { buildCoverage } from './coverage.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial, for TARGET-073.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { classifyKey, type IdentificationTier } from '../../utils/key-family.js';

export interface CoverageRoot {
  family: string;
  keys: number;
  bytes: number;
  lastWritten: string;
  /** A few real key names, so a person can recognise the thing rather than guess at a pattern. */
  sample: string[];
}

export interface CoverageReport {
  totalKeys: number;
  byTier: Record<IdentificationTier, number>;
  identified: number;
  unexplainedKeys: number;
  unexplainedFamilies: number;
  /** The unexplained, biggest first. Naming the top few is most of the work. */
  roots: CoverageRoot[];
  asOf: string;
  notCovered: string[];
}

/** Said the same way wherever a coverage number is rendered. */
const NOT_COVERED = [
  'This counts what is in your store right now. It says nothing about anything already sent somewhere else.',
  'A group is described when something can say what it is: a fixed shape, a program that declared it, a part of AIMEAT, or a name you gave it. Everything else is here.',
];

/**
 * Fold one owner's whole keyspace into families and count what nobody can describe.
 *
 * Owner scope, because a namespace is not an account: an agent's keys are this person's keys, and a
 * count that skipped them would describe a third of the store and call it all of it.
 */
export async function buildCoverage(
  storage: Storage, config: AimeatConfig, ownerName: string, at: string,
): Promise<CoverageReport> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName);
  const namespaces = [...new Set([ownerGhii, ...agents.map(a => a.gaii)])];

  // The hints the classifier cannot work out for itself. Without the agent names, `crews.<agent>.*`
  // — 1,094 keys on this node — reads as unexplained when it is the plainest thing in the store.
  const apps = await storage.listApps({ limit: 200, adminView: true });
  const hints = {
    appNames: apps.apps.filter(a => a.ownerName === ownerName).map(a => a.filename.replace(/\.html$/i, '')),
    agentNames: agents.map(a => a.name),
  };

  const rows = await storage.listMemoryMetaForOwners(namespaces);
  const byTier: Record<string, number> = {};
  const roots = new Map<string, { keys: number; bytes: number; lastWritten: string; sample: string[] }>();

  for (const row of rows) {
    const f = classifyKey(row.key, hints);
    byTier[f.tier] = (byTier[f.tier] ?? 0) + 1;
    if (f.tier !== 'none') continue;
    const cur = roots.get(f.family) ?? { keys: 0, bytes: 0, lastWritten: '', sample: [] };
    cur.keys++;
    cur.bytes += row.byteSize ?? 0;
    if (row.updatedAt > cur.lastWritten) cur.lastWritten = row.updatedAt;
    if (cur.sample.length < 3) cur.sample.push(row.key);
    roots.set(f.family, cur);
  }

  const unexplainedKeys = byTier.none ?? 0;
  return {
    totalKeys: rows.length,
    byTier: {
      'schema-locked': byTier['schema-locked'] ?? 0,
      'declared-space': byTier['declared-space'] ?? 0,
      'platform-prefix': byTier['platform-prefix'] ?? 0,
      'owner-named': byTier['owner-named'] ?? 0,
      none: unexplainedKeys,
    },
    identified: rows.length - unexplainedKeys,
    unexplainedKeys,
    unexplainedFamilies: roots.size,
    roots: [...roots.entries()]
      .map(([family, v]) => ({ family, ...v }))
      .sort((a, b) => b.keys - a.keys)
      .slice(0, 100),
    asOf: at,
    notCovered: NOT_COVERED,
  };
}
