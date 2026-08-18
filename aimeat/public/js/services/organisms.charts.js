/**
 * @file public/js/services/organisms.charts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deterministic Mermaid charts built from stable workspace/organism data (no AI) — the
 *   label sanitiser, the participants graph, and the edit→publish lifecycle flowchart. Extracted
 *   from organisms.js. (The organism-overview chart stays in organisms.js — it orchestrates the
 *   organism CRUD calls; it imports `mlbl` from here.)
 * @usage import { mlbl, buildParticipantsMermaid, buildEditFlowMermaid } from './organisms.charts.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from organisms.js (max-file-lines)
 */
import { isMemorySpace, isDocSpace } from './organisms.shared.js';

/** Sanitise a label for a Mermaid node (strip chars that break the syntax; keep it single-line). */
export function mlbl(s) {
  const t = String(s == null ? '' : s).replace(/["[\]{}|<>;`\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (t.length > 96 ? t.slice(0, 95).replace(/\s+\S*$/, '') + '…' : t) || '—';
}

/** Build the participants chart: which node each identity comes from, who is human, and whose agent
 *  each agent is. The caller's own agents are named; everyone else's are ghost "agent" boxes. */
export function buildParticipantsMermaid(data) {
  const nodes = (data && data.nodes) || [];
  if (!nodes.length) return '';
  const out = ['graph TD'];
  let oi = 0, ai = 0;
  nodes.forEach((n, ni) => {
    const nid = 'N' + ni;
    out.push(`  ${nid}["🖥 ${mlbl(n.id)}${n.isLocal ? '' : ' · 🌐'}"]`);
    (n.owners || []).forEach((o) => {
      const oid = 'O' + (oi++);
      const tag = o.isSelf ? ' · you' : (o.isCreator ? ' · creator' : (o.isMember ? '' : ' · guest'));
      out.push(`  ${oid}(["👤 ${mlbl(o.owner)}${tag}"])`);
      out.push(`  ${nid} --> ${oid}`);
      (o.agents || []).forEach((a) => {
        const aid = 'A' + (ai++);
        out.push(`  ${aid}["🤖 ${mlbl(a.name)} · ${a.contributions}"]`);
        // Own agents get a solid edge; everyone else's a dashed edge (greyed — trace only, no live status).
        out.push(a.isOwn ? `  ${oid} --> ${aid}` : `  ${oid} -.-> ${aid}`);
      });
    });
  });
  return out.join('\n');
}

/** Chart 2 — the edit→publish lifecycle this workspace's manifest defines (deterministic). Records
 *  are schema-validated; the publish gate + the manifest's policy.alwaysGate add a review step. */
export function buildEditFlowMermaid(manifest, gateOn) {
  const types = (manifest?.objectTypes || []).filter(isMemorySpace);
  const recTypes = types.filter(o => !isDocSpace(o)).map(o => o.name);
  const docTypes = types.filter(isDocSpace).map(o => o.name);
  const alwaysGate = (manifest?.policy && manifest.policy.alwaysGate) || [];

  const L = ['flowchart LR'];
  L.push('  START(["Pick what to edit"])');
  if (recTypes.length) L.push(`  REC["📋 Records: ${mlbl(recTypes.join(', '))} · schema form"]`);
  if (docTypes.length) L.push(`  DOC["📄 Documents: ${mlbl(docTypes.join(', '))} · free-form markdown"]`);
  L.push('  DRAFT["✏️ Save as DRAFT · working copy"]');
  if (gateOn) L.push('  GATE{"🔍 Owner review · publish gate on"}');
  L.push('  PUB["✅ Publish"]');
  L.push('  VER["📌 .version.N + .latest"]');

  if (recTypes.length) L.push('  START --> REC --> DRAFT');
  if (docTypes.length) L.push('  START --> DOC --> DRAFT');
  if (!recTypes.length && !docTypes.length) L.push('  START --> DRAFT');
  if (gateOn) { L.push('  DRAFT --> GATE'); L.push('  GATE -- approve --> PUB'); L.push('  GATE -- reject --> DRAFT'); }
  else L.push('  DRAFT --> PUB');
  L.push('  PUB --> VER');
  L.push('  VER -. edit again .-> DRAFT');
  if (alwaysGate.length) { L.push(`  NOTE["⚠️ Always needs approval: ${mlbl(alwaysGate.join(', '))}"]`); L.push(`  NOTE -.-> ${gateOn ? 'GATE' : 'PUB'}`); }
  return L.join('\n');
}
