/**
 * @file src/services/classification/packs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Switching a classification label pack on and off in the node policy (plan
 *   doc-mvlftkh9zmc9, C3.2): the TL and NATO packs of data/classification-packs.ts. REST and MCP call
 *   these functions, and both write through policy-admin.ts writePolicy, so who may change the node
 *   policy, what an AI's change waits for and the policy history are decided where they always were.
 *
 *   UP TO A LEVEL. The operator switches a pack on up to one of its classes, the highest
 *   non-top one by default. A marking of a class above that level is not left unprotected: its rule
 *   raises the content to the highest class that is on, and the status says so. Up to a top class
 *   (TL II, TL I, NATO SECRET, COSMIC TOP SECRET) takes `acknowledgeNotAccredited` (decision 10.8).
 *
 *   OFF RETIRES THE LABELS. Switching a pack off retires its labels and takes its rules out (a rule
 *   may name only an active label). Content that already carries one of its labels keeps it, and a
 *   retired label keeps every field, so nothing that was protected becomes less so. Switching it on
 *   again reactivates the same ids and writes the rules back.
 * @structure PackStatus · packStatus() · activatePack() · deactivatePack()
 * @usage
 *   await activatePack(deps, actor, 'tl', { upTo: 'tl-iii' });
 *   const s = packStatus(policy);   // [{ id: 'tl', on: true, upTo: 'tl-iii', top: false, ... }]
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C3.2, decision 10.8).
 */
import { CLASSIFICATION_PACKS, packById, type ClassificationPack } from '../../data/classification-packs.js';
import type { ClassificationLabel, ClassificationPolicy, ClassificationRule } from './defaults.js';
import { ClassificationError, type ClassificationDeps, type LabelActor } from './label-core.js';
import { readNodePolicy } from './policy.js';
import { writePolicy, type PolicyWriteResult } from './policy-admin.js';

export interface PackStatus {
  id: ClassificationPack['id'];
  name: ClassificationPack['name'];
  on: boolean;
  /** The highest class switched on, or null when the pack is off. */
  upTo: string | null;
  /** Whether a top class is on (the report warns while it is). */
  top: boolean;
  labels: Array<{ id: string; name: ClassificationLabel['name']; rank: number; top: boolean; active: boolean }>;
  laws: string[];
}

/** Each pack as the node policy has it now. Pure. */
export function packStatus(policy: ClassificationPolicy): PackStatus[] {
  return CLASSIFICATION_PACKS.map(p => {
    const active = p.labels.filter(l => policy.labels.some(x => x.id === l.id && x.status === 'active'));
    const highest = active[active.length - 1];
    return {
      id: p.id, name: p.name, on: active.length > 0, upTo: highest?.id ?? null, top: active.some(l => l.top),
      labels: p.labels.map(l => ({ id: l.id, name: l.name, rank: l.rank, top: l.top, active: active.includes(l) })),
      laws: p.laws,
    };
  });
}

function packOf(id: unknown): ClassificationPack {
  const pack = typeof id === 'string' ? packById(id) : undefined;
  if (!pack) throw new ClassificationError('INVALID_INPUT', 400, `pack is one of ${CLASSIFICATION_PACKS.map(p => `"${p.id}"`).join(', ')}.`);
  return pack;
}

/** `policy` with `labels` put in by id (replacing one of the same id) and `rules` likewise. */
function withPut(policy: ClassificationPolicy, labels: ClassificationLabel[], rules: ClassificationRule[]): ClassificationPolicy {
  const labelIds = new Set(labels.map(l => l.id));
  const ruleIds = new Set(rules.map(r => r.id));
  return {
    ...policy,
    labels: [...policy.labels.filter(l => !labelIds.has(l.id)), ...labels].sort((a, b) => a.rank - b.rank),
    rules: [...policy.rules.filter(r => !ruleIds.has(r.id)), ...rules],
  };
}

/**
 * Switch `packId` on up to `opts.upTo` (a class id of the pack; default its highest class that is
 * not a top class). The classes above it are retired if they were on, and their markings raise
 * content to `upTo`.
 */
export async function activatePack(
  deps: ClassificationDeps, actor: LabelActor, packId: unknown,
  opts: { upTo?: unknown; acknowledgeNotAccredited?: unknown; humanSaid?: unknown } = {},
): Promise<PolicyWriteResult & { pack: PackStatus }> {
  const pack = packOf(packId);
  const upTo = opts.upTo === undefined || opts.upTo === null
    ? [...pack.labels].reverse().find(l => !l.top)!.id
    : String(opts.upTo);
  const idx = pack.labels.findIndex(l => l.id === upTo);
  if (idx < 0) throw new ClassificationError('INVALID_INPUT', 400, `upTo is one of ${pack.labels.map(l => `"${l.id}"`).join(', ')}.`);
  if (pack.labels.slice(0, idx + 1).some(l => l.top) && opts.acknowledgeNotAccredited !== true) {
    throw new ClassificationError('ACKNOWLEDGEMENT_REQUIRED', 400,
      `${pack.labels[idx]!.name.en} is one of the two highest classes of this pack. This node is not an accredited system `
      + '(Katakri, Traficom, NATO accreditation), so switching it on takes acknowledgeNotAccredited: true, and the compliance report warns for as long as it is on.');
  }
  const node = await readNodePolicy(deps.storage, deps.config.nodeId);
  const on = pack.labels.slice(0, idx + 1);
  const highest = on[on.length - 1]!.id;
  const onIds = new Set(on.map(l => l.id));
  const labels: ClassificationLabel[] = pack.labels.map(({ top: _top, ...l }) => (
    onIds.has(l.id) ? { ...l, name: { ...l.name } }
      // A class above upTo stays retired, or becomes retired, keeping every field it had.
      : { ...(node.labels.find(x => x.id === l.id) ?? { ...l, name: { ...l.name } }), status: 'retired' as const }
  )).filter(l => l.status === 'active' || node.labels.some(x => x.id === l.id));
  const packIds = new Set(pack.labels.map(l => l.id));
  const rules = pack.rules.map(r => ({
    ...r, enabled: true,
    // A marking above what is on raises the content to the highest class that is on.
    minLabel: packIds.has(r.minLabel) && !onIds.has(r.minLabel) ? highest : r.minLabel,
  }));
  const result = await writePolicy(deps, actor, 'node', null, withPut(node, labels, rules), { humanSaid: opts.humanSaid });
  return { ...result, pack: packStatus(result.view.effective).find(p => p.id === pack.id)! };
}

/** Switch `packId` off: its labels retire with every field kept, its rules go. */
export async function deactivatePack(
  deps: ClassificationDeps, actor: LabelActor, packId: unknown, opts: { humanSaid?: unknown } = {},
): Promise<PolicyWriteResult & { pack: PackStatus }> {
  const pack = packOf(packId);
  const node = await readNodePolicy(deps.storage, deps.config.nodeId);
  const ids = new Set(pack.labels.map(l => l.id));
  const ruleIds = new Set(pack.rules.map(r => r.id));
  const labels = node.labels.filter(l => ids.has(l.id)).map(l => ({ ...l, status: 'retired' as const }));
  if (node.defaultLabel && ids.has(node.defaultLabel)) {
    throw new ClassificationError('INVALID_INPUT', 400, `${node.defaultLabel} is the node's default label. Pick another default before switching this pack off.`);
  }
  // A rule may name only an active label (levels.ts validateNodePolicy), so the pack's rules go;
  // switching it on again writes them back.
  const next = withPut(node, labels, []);
  const result = await writePolicy(deps, actor, 'node', null, { ...next, rules: next.rules.filter(r => !ruleIds.has(r.id)) }, { humanSaid: opts.humanSaid });
  return { ...result, pack: packStatus(result.view.effective).find(p => p.id === pack.id)! };
}
