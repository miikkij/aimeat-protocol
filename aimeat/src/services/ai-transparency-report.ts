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
 *   v1.1.0 — 2026-10-08 — `labelled` and `unlabelled` count the label each public record owes NOW
 *     (the serve-time decision), not the `required` flag stored at mint: content made public after
 *     its record was minted had counted as unlabelled while every surface labelled it. The options
 *     take the node's `labelPolicy`.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import { AI_PROVENANCE_SPEC_V1, type AiProvenance } from '../models/ai-provenance-schemas.js';
import { disclosureFor, type DisclosureLabelPolicy } from './ai-disclosure.js';
import { servedContext } from './ai-disclosure-served.js';

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
  /** The node's label posture, `config.aiLabelPublic`. Each label is decided under it. */
  labelPolicy?: DisclosureLabelPolicy;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Does a PUBLIC record with these facts owe a label now? The same decision a serving surface makes
 * (services/ai-provenance-marks.ts servedDisclosure), from the facts the facet query groups by: the
 * stored `required` flag was decided against the surface the content had at mint, and content made
 * public afterwards would otherwise count as unlabelled while every surface labels it.
 */
function owedWhenPublic(
  f: { level: string; humanInvolvement: string; mediaKind: string | null; reason: string | null },
  policy: DisclosureLabelPolicy,
): boolean {
  const record = {
    spec: AI_PROVENANCE_SPEC_V1, level: f.level, humanInvolvement: f.humanInvolvement,
    generatedAt: new Date(0).toISOString(),
    ...(f.mediaKind ? { mediaKind: f.mediaKind } : {}),
    ...(f.reason ? { disclosure: { required: false, reason: f.reason, short: { en: '-' } } } : {}),
  } as AiProvenance;
  // An unknown level or medium fails the schema in disclosureFor and reads as unstated: not owed.
  return disclosureFor(record, servedContext(record, { visibility: 'public' }), policy).required;
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
  const policy = opts.labelPolicy ?? 'light';

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
    // Unlabelled means all three at once: public, unreviewed, and no label owed as it is served now.
    // A reviewed item without a label is not a failure — Art. 50(4) exempts it — so counting it
    // here would inflate the one number an operator is meant to act on.
    const owed = owedWhenPublic(f, policy);
    const unlabelled = !reviewed && !owed ? f.count : 0;
    report.unlabelled += unlabelled;
    if (owed) report.labelled += f.count;

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
  const policy = opts.labelPolicy ?? 'light';
  const since = opts.sinceDays ? sinceIso(opts.sinceDays) : undefined;
  // The honest total comes from the facets, which cover the whole population in SQL. When it is
  // zero (the usual case, since every public surface decides its label when it serves) nothing is
  // scanned at all.
  const facets = await storage.aiProvenanceFacets({ ownerGhii: opts.ownerGhii, since });
  const total = facets
    .filter((f) => f.publiclyLinked && (f.humanInvolvement === 'none' || f.humanInvolvement === 'light-review')
      && !owedWhenPublic(f, policy))
    .reduce((n, f) => n + f.count, 0);
  const limit = opts.limit ?? 25;
  const items: AiProvenanceRecordRow[] = [];
  // The rows, newest first: the unreviewed public population, decided one by one with the same
  // rule. Paged, and capped at UNLABELLED_SCAN_PAGES so a large node cannot turn the sweep into a
  // full read; `total` above stays the whole count either way.
  for (let page = 0; total > 0 && items.length < limit && page < UNLABELLED_SCAN_PAGES; page++) {
    const { items: rows } = await storage.listAiProvenance({
      ownerGhii: opts.ownerGhii, ...(since ? { since } : {}),
      unreviewedPublicOnly: true, limit: UNLABELLED_SCAN_PAGE, offset: page * UNLABELLED_SCAN_PAGE,
    });
    for (const row of rows) {
      const r = row.record;
      const owed = owedWhenPublic({
        level: r.level, humanInvolvement: r.humanInvolvement,
        mediaKind: r.mediaKind ?? null, reason: r.disclosure?.reason ?? null,
      }, policy);
      if (!owed && items.length < limit) items.push(row);
    }
    if (rows.length < UNLABELLED_SCAN_PAGE) break;
  }
  return { items, total };
}

/** Rows read per page while collecting the unlabelled list, and the most pages read. */
const UNLABELLED_SCAN_PAGE = 500;
const UNLABELLED_SCAN_PAGES = 10;
