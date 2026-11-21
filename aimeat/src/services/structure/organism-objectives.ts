/**
 * @file src/services/structure/organism-objectives.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's own objectives on the organism read: GET /v1/organisms/:id and
 *   aimeat_organism_get spread these fields into their answer, as they spread the directive fields.
 *
 *   WHY ON THE READ. The organism's direction lives in its manifest's `objectives`
 *   (decision-situatedai-p-tavoite-organismin-manifestin-objectives-kent-s), and the agent handbook
 *   tells every AI to put objectives on "the manifest (organism or workspace)". Until 2026-11-21 no
 *   surface read the organism's copy, so an AI that followed the handbook wrote direction nobody saw.
 *
 *   WHO SEES THEM. An active member, the rule directiveFields asks. A visitor reading a public
 *   organism gets the organism and not its objectives: they are the members' working direction. A
 *   KPI computed from a workspace's records is computed only when the viewer may read that
 *   workspace (collectOrganismObjectives); otherwise it keeps its declared value.
 * @structure objectiveFields(deps, ownerName, orgId, viewerGaii, reader) → { objectives? }
 * @usage ...await objectiveFields({ storage, config }, ownerName, id, viewerGaii, reader)
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-suunta-n-kyviin-organismin-manifestin-tavoitteet-ja-tasot-yl).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { ContentReader } from '../classification/reader.js';
import { collectOrganismObjectives, type ObjectiveSummary } from './overview.js';

export async function objectiveFields(
  deps: { storage: Storage; config: AimeatConfig },
  ownerName: string | undefined,
  orgId: string,
  viewerGaii: string | undefined,
  reader: ContentReader,
): Promise<{ objectives?: ObjectiveSummary[] }> {
  if (!ownerName || !viewerGaii) return {};
  const m = await deps.storage.getMembership(orgId, ownerName);
  if (!m || m.status !== 'active') return {};
  return { objectives: await collectOrganismObjectives(deps.storage, deps.config, { orgId, viewerGaii, reader }) };
}
