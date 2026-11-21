/**
 * @file src/services/compliance/regulated-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which content belongs to a regulated data domain, and what an AI model outside this
 *   server gets of it (plan doc-mwnnp9xz9814, feature audit item 1.3). The content reader
 *   (classification/reader.ts) asks this in show(), useForAi() and leave(), beside the label.
 *
 *   WHERE THE DOMAIN COMES FROM. A register of processing names its domains and the containers its
 *   data sits in (an organism, a workspace, an app), as the classification floor reads them
 *   (domain-floor.ts containersOfRegister, and containerInScope for what the register may name).
 *   Content is in a domain when it, or a container it sits in (classification/containers.ts
 *   containersOf), is named by a register with that domain. The same reach as the floor: an app's
 *   data is its own namespace (`eco:<app>#<owner>@<node>`), not what a hosted app writes into its
 *   owner's namespace, which no rule tells apart from the owner's own.
 *
 *   THE MODE. The operator's mode of each of the content's domains (config regulatedAiModes, a
 *   domain not named is notify), tightened by the register's own `aiMode`: the strictest holds, so
 *   a register cannot open what the operator closed. data/compliance-domains.ts says what each mode does.
 *
 *   INDEPENDENT OF THE CLASSIFICATION SWITCH. The mode is the operator's and the register keeper's
 *   choice about the law, so it holds with classification off too.
 *
 *   COST. Nothing is stored for it: the index is built in this process from the stored registers
 *   (compliance/docs.ts listDocs, one read), kept, and dropped when a compliance document changes
 *   (the 'compliance' change event) and after INDEX_TTL_MS, which also covers a change of who manages
 *   an organism. With no register naming a domain the index is empty, and a reader asks nothing more.
 *
 *   THE MARKS. What happened is written to the classification audit (audit.ts): action `regulated`
 *   for content that went to an outside model under notify or protect (with what protect replaced, by
 *   kind and count) and for a use of an exception that opened protect or local; `refused` for what
 *   was held back; `exception` for an attempt on block content while an exception was in force,
 *   which marks the attempt as exceptional and opens nothing. The compliance report lists them.
 * @structure RegulatedFact · regulatedOf() · modeOfDomains() · recordRegulatedMark() ·
 *   regulatedMarkPurpose() · REGULATED_LABEL · resetRegulatedIndex()
 * @usage
 *   const facts = await regulatedOf(deps, targets);     // null for content outside every domain
 *   if (facts[i]?.mode === 'block') { … }
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (plan doc-mwnnp9xz9814, feature audit item 1.3).
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { localAccountName } from '../../utils/gaii.js';
import { onChangeEvent } from '../event-bus.js';
import { aiModesOf, stricterAiMode, type RegulatedAiMode } from '../../data/compliance-domains.js';
import { containersOf, isContainerKind } from '../classification/containers.js';
import { targetId } from '../classification/label-rows.js';
import { recordClassificationAudit } from '../classification/audit.js';
import type { ClassificationAuditReaderKind } from '../../storage/types/classification-audit.js';
import { listDocs } from './docs.js';
import { containerInScope, containersOfRegister } from './domain-floor.js';

export interface RegulatedDeps {
  storage: Storage;
  config: Pick<AimeatConfig, 'nodeId'> & { regulatedAiModes?: readonly string[] };
}

/** What makes one piece of content regulated, and the mode that holds for it. */
export interface RegulatedFact {
  domains: string[];
  mode: RegulatedAiMode;
  /** The registers that name its container. */
  registers: string[];
  /** The container a register named (its label address as targetId), the nearest first. */
  container: string;
}

interface IndexEntry { domains: string[]; aiMode?: RegulatedAiMode; register: string }

/** How long the index is kept when nothing changes: a change of who manages an organism is seen by then. */
const INDEX_TTL_MS = 5 * 60_000;

// process-local: derived from the stored registers, dropped on the 'compliance' change event (which
// reaches every process through the bus) and after INDEX_TTL_MS.
let index: { nodeId: string; at: number; map: Map<string, IndexEntry[]> } | null = null;
// process-local: the build in progress, so concurrent readers wait for one read of the registers.
let building: Promise<Map<string, IndexEntry[]>> | null = null;
// process-local: whether this process listens for the change event yet.
let listening = false;
// process-local: bumped by every drop, so a build that started before one does not keep its result.
let generation = 0;

function drop(): void {
  index = null;
  building = null;
  generation++;
}

async function build(deps: RegulatedDeps): Promise<Map<string, IndexEntry[]>> {
  const map = new Map<string, IndexEntry[]>();
  for (const { scope, doc } of await listDocs(deps.storage, deps.config.nodeId, 'registers')) {
    for (const reg of doc.items) {
      if (!reg.domains?.length) continue;
      const keeper = reg.updatedBy ? localAccountName(reg.updatedBy) ?? undefined : undefined;
      for (const { target, named } of containersOfRegister(scope, reg, deps.config.nodeId)) {
        // What the register may not move, it does not make regulated either (domain-floor.ts).
        if (!(await containerInScope(deps.storage, scope, named, keeper))) continue;
        const id = targetId(target);
        map.set(id, [...(map.get(id) ?? []), { domains: [...reg.domains], ...(reg.aiMode ? { aiMode: reg.aiMode } : {}), register: reg.id }]);
      }
    }
  }
  return map;
}

/** The index of this node, built on first use and kept (see COST). A failed build is an empty index, logged. */
async function indexOf(deps: RegulatedDeps): Promise<Map<string, IndexEntry[]>> {
  if (!listening) {
    listening = true;
    onChangeEvent(evt => { if (evt.domain === 'compliance') drop(); });
  }
  if (index && index.nodeId === deps.config.nodeId && Date.now() - index.at < INDEX_TTL_MS) return index.map;
  if (!building) {
    const gen = generation;
    building = build(deps).then(map => {
      if (gen === generation) { index = { nodeId: deps.config.nodeId, at: Date.now(), map }; building = null; }
      return map;
    }, err => {
      // An index that cannot be built leaves content as it is today (notify without marks), and says so.
      logger.warn('compliance: the regulated data domains could not be read; content is treated as outside every domain', { error: String(err) });
      if (gen === generation) building = null;
      return new Map<string, IndexEntry[]>();
    });
  }
  return building;
}

/** The mode of content in these domains: the operator's strictest, then the registers' own. */
export function modeOfDomains(domains: readonly string[], registerModes: ReadonlyArray<RegulatedAiMode | undefined>, operator: readonly string[] | undefined): RegulatedAiMode {
  const modes = aiModesOf(operator);
  let mode: RegulatedAiMode = 'notify';
  for (const d of domains) mode = stricterAiMode(mode, modes[d] ?? 'notify');
  for (const m of registerModes) if (m) mode = stricterAiMode(mode, m);
  return mode;
}

/**
 * For each target, what makes it regulated and its mode, or null. Reads the index once (usually from
 * this process's copy); an empty index answers nulls without looking further.
 */
export async function regulatedOf(deps: RegulatedDeps, targets: ReadonlyArray<ContentLabelTarget | null>): Promise<Array<RegulatedFact | null>> {
  if (!targets.some(Boolean)) return targets.map(() => null);
  const map = await indexOf(deps);
  if (!map.size) return targets.map(() => null);
  return targets.map(t => {
    if (!t) return null;
    const ids = [...(isContainerKind(t.kind) ? [targetId(t)] : []), ...containersOf(t).map(c => targetId(c.target))];
    let container: string | null = null;
    const entries: IndexEntry[] = [];
    for (const id of ids) {
      const hit = map.get(id);
      if (!hit) continue;
      container ??= id;
      entries.push(...hit);
    }
    if (!container) return null;
    const domains = [...new Set(entries.flatMap(e => e.domains))];
    return {
      domains, container,
      registers: [...new Set(entries.map(e => e.register))],
      mode: modeOfDomains(domains, entries.map(e => e.aiMode), deps.config.regulatedAiModes),
    };
  });
}

/** The label column of a mark: the domains, so the audit groups them apart from any label. */
export const REGULATED_LABEL = (f: Pick<RegulatedFact, 'domains'>): string => `domain:${f.domains.join('+')}`.slice(0, 120);

/** What a mark says: the domains and mode, then what happened. */
export function regulatedMarkPurpose(f: Pick<RegulatedFact, 'domains' | 'mode'>, what: string): string {
  return `regulated ${f.domains.join(', ')} (${f.mode}): ${what}`.slice(0, 500);
}

/**
 * Write one mark. `count` stands for that many items of one scope and mode (a long list is one row).
 * Buffered off the request path by audit.ts, as every classification audit row is.
 */
export function recordRegulatedMark(
  target: ContentLabelTarget, fact: Pick<RegulatedFact, 'domains' | 'mode'>, reader: { principal: string; kind: ClassificationAuditReaderKind },
  action: 'regulated' | 'refused' | 'exception', what: string, ownerGaii: string | null, count = 1,
): void {
  recordClassificationAudit({
    scope: target.scope, ownerGaii, kind: target.kind, key: target.key, label: REGULATED_LABEL(fact),
    reader: reader.principal || 'anonymous', readerKind: reader.kind, action, purpose: regulatedMarkPurpose(fact, what), count,
  });
}

/** Test seam: forget the index. */
export function resetRegulatedIndex(): void {
  drop();
}
