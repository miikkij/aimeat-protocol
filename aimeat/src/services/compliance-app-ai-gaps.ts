/**
 * @file src/services/compliance-app-ai-gaps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI Act gaps an app's own statements reveal: an app that uses AI and is in no
 *   use case of the register, and with it, when its data map holds employment or biometric data,
 *   that the use is a candidate for the high-risk class.
 *
 *   WHY APART FROM THE MODEL GAP. The report's first gap is a model nobody registered. On a node
 *   where every app calls models through its owner's account, that gap names models and never the
 *   app: innokas.aimeat.io showed three model ids, and nothing on the page said that TalentGrid
 *   proposes who works on what from colleagues' competence ratings. This names the app, what says it
 *   uses AI, and what its map says about the people in its data.
 * @structure appAiGaps()
 * @usage const gaps = await appAiGaps(storage, config, usecases, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { appAiSignals } from './compliance-app-signals.js';
import type { ComplianceUseCase } from './compliance-register.js';
import { readAppDataMap } from './data-map/data-map-store.js';

/** How many apps are read, as the records-of-processing gaps read them. */
const APP_SCAN = 1000;

/** The gap this file produces; compliance-report.ts carries it in its union. */
export interface AppAiGap {
  kind: 'app-uses-ai-not-in-register';
  detail: string;
  evidence: {
    app: string;
    uses_ai: string[];
    personal: boolean;
    domains: Array<{ domain: string; source: 'evidence' | 'proposed'; rows: string[] }>;
    /** The Annex III area the map points to, or null. */
    annex3: string | null;
    annex3_reason: string | null;
    /** The facts behind `annex3`, as data: the domain, stated or proposed, its rows and words. */
    annex3_basis: { domain: string; source: 'evidence' | 'proposed'; rows: string[]; words: string[] } | null;
  };
}

const keyOf = (ref: string): string => ref.replace(/\.html$/i, '').toLowerCase();

/**
 * Every app that uses AI and that no use case names, owner's apps only when `ownerGhii` is given.
 * Matched by exact `owner/filename`, as the report matches models: a near-miss must not satisfy it.
 */
export async function appAiGaps(
  storage: Storage, config: AimeatConfig, usecases: ComplianceUseCase[], ownerGhii?: string,
): Promise<AppAiGap[]> {
  const registered = new Set(usecases.flatMap(u => u.apps ?? []).map(keyOf));
  const { apps } = await storage.listApps({ adminView: true, limit: APP_SCAN });
  const out: AppAiGap[] = [];
  for (const app of apps) {
    const owner = localAccountName(app.ownerName ?? app.ownerGaii ?? '');
    if (!owner || (ownerGhii && `${owner}@${config.nodeId}` !== ownerGhii)) continue;
    const ref = `${owner}/${app.filename}`;
    if (registered.has(keyOf(ref))) continue;
    const map = await readAppDataMap(storage, `${owner}@${config.nodeId}`, app.filename.replace(/\.html$/i, ''));
    const s = appAiSignals(map, app.manifest?.aiPosture);
    if (!s.usesAi) continue;
    const highRisk = s.annex3
      ? ` Its data map holds ${s.annex3.domain} data, which with AI is a candidate for the high-risk class (EU AI Act Annex III, ${s.annex3.area}).`
      : '';
    out.push({
      kind: 'app-uses-ai-not-in-register',
      detail: `The app "${ref}" uses AI (${s.aiEvidence[0]}), and no use case in the register names it.${highRisk}`,
      evidence: {
        app: ref,
        uses_ai: s.aiEvidence,
        personal: s.personal,
        domains: s.domains.map(d => ({ domain: d.domain, source: d.source, rows: d.rows })),
        annex3: s.annex3?.area ?? null,
        annex3_reason: s.annex3?.reason ?? null,
        annex3_basis: s.annex3?.basis ?? null,
      },
    });
  }
  // The candidates for the high-risk class first: they are the ones an auditor asks about.
  return out.sort((a, b) => Number(!!b.evidence.annex3) - Number(!!a.evidence.annex3) || a.evidence.app.localeCompare(b.evidence.app));
}
