/**
 * @file src/services/ai-transparency-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The documentation duty, answered from data instead of from a spreadsheet
 *   (TARGET-058 Phase 8). Section 2, Commitment 2 of the GPAI Code of Practice asks a provider to
 *   keep documentation of what it marks and how; this rolls that up out of the provenance records
 *   the node already holds, so the answer is what the node actually did rather than what somebody
 *   remembered to write down.
 *
 *   ONE ROLL-UP, THREE SURFACES. The operator report, the per-owner "what my agents published" view
 *   and the scheduled sweep all read from here, and all three ask the storage layer the SAME
 *   question — `aiProvenanceFacets` for the counts, `listAiProvenance` for the rows. If the sweep
 *   counted one population while the report displayed another, the disagreement would surface as a
 *   contradiction in front of a regulator, which is the worst possible place to find it.
 *
 *   THE NUMBER THAT MATTERS IS `unlabelled`. Publicly readable content, produced with nobody
 *   reading the substance, carrying no computed disclosure. That is the Article 50(4) failure case,
 *   and on the evidence of Phases 4, 5 and 6 it keeps arriving through a door nobody thought of.
 *
 *   ABSENCE IS NOT INNOCENCE, AND THE REPORT SAYS SO. Content with NO provenance record at all does
 *   not appear in these counts — it cannot, there is nothing to count. `scope` carries that
 *   sentence, because a total that reads as "everything on this node" would be the one misleading
 *   number in a compliance artefact.
 * @structure
 *   - AiTransparencyReport — the shape both surfaces serve
 *   - buildAiTransparencyReport(storage, opts) — the roll-up
 *   - listUnlabelledPublic(storage, opts) — the sweep's population, as rows
 * @usage
 *   const report = await buildAiTransparencyReport(storage, { sinceDays: 30 });
 *   res.json(success(config.nodeId, report));
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';

/** The window the trend is computed over when a caller does not choose one. */
export const DEFAULT_TREND_DAYS = 30;

export interface AiTransparencyReport {
  /** What population these numbers describe. Read this before reading the numbers. */
  scope: {
    owner_ghii: string | null;
    since: string | null;
    /** The sentence that stops a total being read as "everything published on this node". */
    note: string;
  };
  /** Every provenance record in scope. */
  total: number;
  /** Records whose content an anonymous visitor can read right now. */
  public_total: number;
  /** Public items by how much a person was involved. The Article 50(4) axis. */
  public_by_human_involvement: Record<string, number>;
  /** Public items by what the record says the content is. */
  public_by_level: Record<string, number>;
  /**
   * THE number: public, nobody read the substance, and no label was computed as required. Each one
   * is an item a visitor is reading without being told a model wrote it.
   */
  unlabelled: number;
  /** Public items where a label WAS computed as required — the working case, for contrast. */
  labelled: number;
  /** Daily counts over the window: `{ day, public, unlabelled }`, oldest first. */
  trend: Array<{ day: string; public: number; unlabelled: number }>;
  /** Apps that declare they generate content while the publish check recorded a disclosure gap. */
  apps_declaring_generation_with_gap: Array<{ owner: string; filename: string; gap: string }>;
}

export interface ReportOptions {
  /** Restrict to one account — the per-owner view. */
  ownerGhii?: string;
  /** Trend + filter window in days. */
  sinceDays?: number;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Roll the provenance records up into the report.
 *
 * `sinceDays` narrows the whole report, not only the trend: an operator asking "what did we publish
 * this month" should get a month's numbers, not a month's chart under a lifetime total.
 */
export async function buildAiTransparencyReport(
  storage: Storage, opts: ReportOptions = {},
): Promise<AiTransparencyReport> {
  const days = Math.min(Math.max(opts.sinceDays ?? DEFAULT_TREND_DAYS, 1), 3650);
  const since = sinceIso(days);
  const facets = await storage.aiProvenanceFacets({ ownerGhii: opts.ownerGhii, since });

  const report: AiTransparencyReport = {
    scope: {
      owner_ghii: opts.ownerGhii ?? null,
      since,
      note: 'Counts describe content this node holds a provenance record for. Content with NO record '
        + 'is UNSTATED and does not appear here — absence of a record is not evidence that a person '
        + 'wrote something.',
    },
    total: 0,
    public_total: 0,
    public_by_human_involvement: {},
    public_by_level: {},
    unlabelled: 0,
    labelled: 0,
    trend: [],
    apps_declaring_generation_with_gap: [],
  };

  const byDay = new Map<string, { day: string; public: number; unlabelled: number }>();
  for (const f of facets) {
    report.total += f.count;
    if (!f.publiclyLinked) continue;
    report.public_total += f.count;
    report.public_by_human_involvement[f.humanInvolvement] =
      (report.public_by_human_involvement[f.humanInvolvement] ?? 0) + f.count;
    report.public_by_level[f.level] = (report.public_by_level[f.level] ?? 0) + f.count;

    const reviewed = f.humanInvolvement === 'editorial-control' || f.humanInvolvement === 'full-human';
    // Unlabelled means all three at once: public, unreviewed, and no label computed. A reviewed item
    // without a label is not a failure — Art. 50(4) exempts it — so counting it here would inflate
    // the one number an operator is meant to act on.
    const unlabelled = !reviewed && !f.disclosureRequired ? f.count : 0;
    report.unlabelled += unlabelled;
    if (f.disclosureRequired) report.labelled += f.count;

    const bucket = byDay.get(f.day) ?? { day: f.day, public: 0, unlabelled: 0 };
    bucket.public += f.count;
    bucket.unlabelled += unlabelled;
    byDay.set(f.day, bucket);
  }
  report.trend = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  report.apps_declaring_generation_with_gap = await appsWithDisclosureGap(storage, opts.ownerGhii);
  return report;
}

/**
 * Apps whose own `<meta name="aimeat-ai">` says they generate content while the publish check
 * recorded a gap — the app-side half of the same question, which no provenance record can answer
 * because the gap is about what the app does at RUNTIME rather than about how its bytes were made.
 *
 * The gap is owner-only information (publicPosture() strips it from the catalogue), so this is only
 * ever reached from an operator route or from an owner's own view.
 */
async function appsWithDisclosureGap(
  storage: Storage, ownerGhii?: string,
): Promise<Array<{ owner: string; filename: string; gap: string }>> {
  // The owner's own view sees their parked and operator-hidden apps (viewerGhii); the operator's
  // view sees every app on the node (adminView). Neither may quietly omit a hidden app: a gap on
  // something currently hidden is exactly what has to be fixed BEFORE it goes back up.
  const { apps } = await storage.listApps(ownerGhii
    ? { ownerGaii: ownerGhii, viewerGhii: ownerGhii, limit: 1000 }
    : { adminView: true, limit: 1000 });
  const out: Array<{ owner: string; filename: string; gap: string }> = [];
  for (const app of apps) {
    const posture = app.manifest?.aiPosture;
    if (!posture?.gap) continue;
    // Only the ones that actually say they generate something: an app with a gap and no declared
    // modality is the node's guess, and listing guesses beside measurements devalues both.
    if (!posture.generates?.length && !posture.usesAi) continue;
    out.push({ owner: app.ownerName, filename: app.filename, gap: posture.gap.code });
  }
  return out;
}

/**
 * The sweep's population as rows: public items nobody reviewed, carrying no computed label.
 *
 * Newest first, and capped — this feeds a notification and a detail list, both of which a person
 * reads. `total` beside it is the honest count, so a truncated list never reads as the whole story.
 */
export async function listUnlabelledPublic(
  storage: Storage, opts: ReportOptions & { limit?: number } = {},
): Promise<{ items: AiProvenanceRecordRow[]; total: number }> {
  return storage.listAiProvenance({
    ownerGhii: opts.ownerGhii,
    ...(opts.sinceDays ? { since: sinceIso(opts.sinceDays) } : {}),
    unlabelledPublicOnly: true,
    limit: opts.limit ?? 25,
  });
}
