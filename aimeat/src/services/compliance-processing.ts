/**
 * @file src/services/compliance-processing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of the operator's compliance report that plan doc-mvlftkh9zmc9 adds: the
 *   records of processing, the regulated data domains in use, the framework verdicts, the processors
 *   and transfers, the label packs, and what these leave open (compliance-scope-gaps.ts). The AI Act
 *   half stays in compliance-report.ts, which spreads this into the node-wide report.
 *
 *   THE LIMITS ARE PART OF THE MEASUREMENT, as the report's own not_covered list says. What this
 *   half cannot see is said in PROCESSING_LIMITS, one code and one sentence each, which the surfaces
 *   translate by code.
 * @structure ProcessingSummary · PROCESSING_LIMITS · buildProcessingSummary()
 * @usage const p = await buildProcessingSummary({ storage, config });   // { summary, gaps, limits }
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1.5, C3.6, C4, C5, C6, C7).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readNodePolicy } from './classification/policy.js';
import { packStatus, type PackStatus } from './classification/packs.js';
import { listDocs, readDoc } from './compliance-docs.js';
import { derivedProcessors, frameworkVerdicts, processorsView, transfersOf } from './compliance-derived.js';
import { nodeWideScopeGaps, type ScopeGap } from './compliance-scope-gaps.js';
import type { ComplianceRegister } from './compliance-docs-schemas.js';

export interface ProcessingSummary {
  registers: { total: number; personal: number; by_scope: { node: number; organism: number; app: number } };
  domains: Record<string, number>;
  requests: { open: number; total: number };
  breaches: { open: number; total: number };
  dpias: number;
  frameworks: ReturnType<typeof frameworkVerdicts>;
  processors: ReturnType<typeof processorsView>;
  transfers: ReturnType<typeof transfersOf>;
  packs: PackStatus[];
}

export const PROCESSING_LIMITS = [
  {
    code: 'registers-are-statements',
    text: 'The records of processing, the impact assessments and the framework answers are what the operator, an organism\'s admins and app owners wrote. The node checks them against its own records (data maps, labels, deadlines) and cannot check them against the world.',
  },
  {
    code: 'external-ai-claim-unverified',
    text: 'An agent that reports a local model reads content whose label refuses an outside model. The node records that claim and cannot check it. A model reference named local: is trusted to be on this machine.',
  },
  {
    code: 'not-accredited',
    text: 'The TL and NATO label packs mark, recognise and restrict classified content. They do not make this node an accredited system (Katakri, Traficom approval, NATO accreditation).',
  },
  {
    code: 'app-scan-listed-only',
    text: 'The apps whose data maps are read here are the ones the catalogue lists, and any app with a stored register. An app that is parked or hidden is read only when it has a register.',
  },
  {
    code: 'federation-peers-not-processors',
    text: 'Federation peers are not in the processor list. A copy that leaves for another node is stopped by its label (may not leave the organism), not recorded as a transfer.',
  },
] as const;

/** The summary, the gaps and the limits of the processing half of the node-wide report. */
export async function buildProcessingSummary(deps: { storage: Storage; config: AimeatConfig }): Promise<{
  summary: ProcessingSummary; gaps: ScopeGap[]; limits: typeof PROCESSING_LIMITS;
}> {
  const { storage, config } = deps;
  const [regDocs, reqDocs, breachDocs, dpiaDocs, storedProcessors, nodeFw, policy] = await Promise.all([
    listDocs(storage, config.nodeId, 'registers'), listDocs(storage, config.nodeId, 'requests'),
    listDocs(storage, config.nodeId, 'breaches'), listDocs(storage, config.nodeId, 'dpias'),
    readDoc(storage, config.nodeId, 'processors', { kind: 'node' }),
    readDoc(storage, config.nodeId, 'frameworks', { kind: 'node' }),
    readNodePolicy(storage, config.nodeId),
  ]);
  const byScope = { node: 0, organism: 0, app: 0 };
  const domains: Record<string, number> = {};
  let total = 0;
  let personal = 0;
  for (const { scope, doc } of regDocs) {
    for (const r of doc.items as ComplianceRegister[]) {
      total++; byScope[scope.kind]++;
      if (r.type === 'personal' || r.type === 'pseudonymised') personal++;
      for (const d of r.domains ?? []) domains[d] = (domains[d] ?? 0) + 1;
    }
  }
  const requests = reqDocs.flatMap(d => d.doc.items);
  const breaches = breachDocs.flatMap(d => d.doc.items);
  const processors = processorsView(derivedProcessors(config), storedProcessors.items);
  return {
    summary: {
      registers: { total, personal, by_scope: byScope }, domains,
      requests: { open: requests.filter(r => r.status === 'open').length, total: requests.length },
      breaches: { open: breaches.filter(b => b.status === 'open').length, total: breaches.length },
      dpias: dpiaDocs.reduce((n, d) => n + d.doc.items.length, 0),
      frameworks: frameworkVerdicts(nodeFw, 'node'),
      processors, transfers: transfersOf(processors), packs: packStatus(policy),
    },
    gaps: await nodeWideScopeGaps(deps),
    limits: PROCESSING_LIMITS,
  };
}
