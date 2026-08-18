/**
 * @file src/services/ai-disclosure-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sweep that catches the case nobody thought of (TARGET-058 Phase 8).
 *
 *   Every gate in this programme protects a path somebody has already thought about. This one
 *   protects the paths nobody has: it asks the database, on a timer, whether any publicly readable
 *   item exists whose provenance says a model wrote it, nobody read the substance, and no label was
 *   computed as required — and tells the account who published it. Phases 4, 5 and 6 each found a
 *   door that had been missed, so a mechanism that looks for the *outcome* rather than for a known
 *   *route* is the only one that keeps working when the next door appears.
 *
 *   IT TELLS THE OWNER, NOT ONLY THE OPERATOR. The account that published the item is the one who
 *   can fix it, and on this node most publishing is done by accounts rather than by the operator.
 *   The operator's view of the same population is GET /v1/admin/ai-transparency-report.
 *
 *   IT DOES NOT NAG. One notification per owner per sweep, carrying the count and the newest few,
 *   and only for items first seen since the previous sweep — a notification that arrives every hour
 *   about the same twelve items is one a person turns off, and then the mechanism is gone.
 *
 *   IT NEVER LABELS ANYTHING ITSELF. Deciding, silently and after the fact, that some content
 *   needed a label would be the node asserting something it did not observe. It reports; a person
 *   acts.
 * @structure
 *   - sweepUndisclosedPublicContent(storage, config) → { scanned, owners, notified }
 * @usage started from server-bootstrap/service-init.ts on a low-frequency timer
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import { listUnlabelledPublic } from './ai-transparency-report.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

export interface DisclosureSweepResult {
  /** Unlabelled public records found in this window. */
  scanned: number;
  /** Distinct accounts they belong to. */
  owners: number;
  /** Notifications actually sent. */
  notified: number;
}

/** How far back a sweep looks. Comfortably wider than the interval, so a restart cannot skip a gap. */
const SWEEP_WINDOW_DAYS = 2;

/** Rows pulled per sweep. The notification carries a count and a few examples, never a full list. */
const SWEEP_LIMIT = 200;

/** Examples named in one notification. Enough to recognise the pattern, few enough to read. */
const EXAMPLES_PER_OWNER = 3;

/**
 * Find publicly readable content published without a label and tell the account that published it.
 *
 * `enabled === false` (AIMEAT_AI_PROVENANCE=off) makes this a no-op: with minting switched off there
 * are no records to sweep, and a sweep that reported zero would read as a clean bill of health.
 */
export async function sweepUndisclosedPublicContent(
  storage: Storage, config: AimeatConfig,
): Promise<DisclosureSweepResult> {
  const out: DisclosureSweepResult = { scanned: 0, owners: 0, notified: 0 };
  if (!config.aiProvenance) return out;

  let found: { items: AiProvenanceRecordRow[]; total: number };
  try {
    found = await listUnlabelledPublic(storage, { sinceDays: SWEEP_WINDOW_DAYS, limit: SWEEP_LIMIT });
  } catch (err) {
    // A sweep that cannot read is a sweep that reports nothing; saying so beats an empty result that
    // reads as "nothing to report".
    logger.warn('ai-disclosure sweep: could not read provenance records, reporting nothing this round',
      { error: String(err) });
    return out;
  }
  out.scanned = found.items.length;
  if (found.items.length === 0) return out;

  const byOwner = new Map<string, AiProvenanceRecordRow[]>();
  for (const row of found.items) {
    const list = byOwner.get(row.ownerGhii) ?? [];
    list.push(row);
    byOwner.set(row.ownerGhii, list);
  }
  out.owners = byOwner.size;

  for (const [ownerGhii, rows] of byOwner) {
    const examples = rows.slice(0, EXAMPLES_PER_OWNER)
      .map(r => `${r.record.generator?.pipeline ?? 'unknown source'} · ${r.generatedAt.slice(0, 16).replace('T', ' ')}`)
      .join('\n');
    try {
      await notify(storage, ownerGhii, {
        type: 'ai_disclosure_gap',
        title: rows.length === 1
          ? 'Something you published is public and unlabelled'
          : `${rows.length} things you published are public and unlabelled`,
        // Says what was found and what it means, not what to feel about it. The account may have a
        // perfectly good answer — an item a person did review, recorded as `none` because nothing
        // upgraded the field — and the fix in that case is to say so, not to hide the item.
        body: 'A model produced this content, nobody recorded reviewing it, and it is readable by '
          + 'anyone. Under Article 50(4) that combination owes a label.\n\n' + examples
          + '\n\nIf a person did read and approve it, record that — the label stops being owed.',
        link: '/v1/profile#ai',
        // `navigate` only: this notification asks a person to LOOK, and an action that carried the
        // clicker's authority would be a way to change a compliance statement by tapping a bell.
        actions: [
          { id: 'view', label: 'See what you published', kind: 'navigate', link: '/v1/profile#ai' },
        ],
      });
      out.notified += 1;
    } catch (err) {
      // The gap is real whether or not a bell rang; the operator report still shows it.
      logger.warn('ai-disclosure sweep: could not notify an owner', { ownerGhii, error: String(err) });
    }
  }

  logger.info('ai-disclosure sweep: unlabelled public content found', {
    scanned: out.scanned, owners: out.owners, notified: out.notified, windowDays: SWEEP_WINDOW_DAYS,
  });
  return out;
}
