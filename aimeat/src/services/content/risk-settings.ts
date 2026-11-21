/**
 * @file src/services/content/risk-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which content risk rules are in force for one item, laid from four layers (docs/internal/
 *   situated-ai/07 section 3 "Asetukset", and 08 section 5):
 *
 *   1. The operator: the node's default and its limits (config/content-class.ts content_risk.*): a floor
 *      for each point that nobody goes below, whether rules+ai may be chosen at all, and the switch that
 *      turns the whole function off. Off: every point is off and no floor holds.
 *   2. The organism, for its shared spaces: `organism.<org>.meta.contentclass` `risk`.
 *   3. A workspace, which may deviate from its organism: `organism.<org>.w.<ws>.meta.contentclass` `risk`.
 *   4. A person, for their own content and their own AIs: `contentclass.settings` `risk`.
 *
 *   THE CONTENT'S HOME DECIDES. A person's own item takes the node and that person; a workspace's item
 *   takes the node, the organism and the workspace. On a read, the reading AI's person comes last, for
 *   on_read alone ("a person tunes their own AIs").
 *
 *   A MISSING FIELD FOLLOWS THE LAYER ABOVE. A layer that sets `locked: true` makes its values a floor for
 *   the layers under it, which may then only tighten them: stricter wins (off < mark < mark+warn < hold,
 *   rules < rules+ai, a kind looked for over one left out). A person may turn the marks off for their
 *   own part unless the organism or the workspace locked them; the operator's floor holds for everyone.
 *
 *   WHO PAYS FOR rules+ai. The person who chose it at the layer the choice came from; on a person's own
 *   item with the node's default, that person. A workspace item whose rules+ai comes from the node's
 *   default has no payer, and its model part is skipped with that reason.
 * @structure riskLayerError · checkRiskLayer · lenientRiskLayer · nodeRiskLayer · resolveRisk ·
 *   strictestBehaviour
 * @usage const r = resolveRisk(config, [{ level: 'person', layer, by }], { homeOwner });
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import {
  BEHAVIOURS, READ_BEHAVIOURS, RISK_KINDS, behaviourRank,
  type RiskBehaviour, type RiskDetect, type RiskKind, type RiskLayer, type ResolvedRisk,
} from './risk-types.js';

type Level = 'organism' | 'workspace' | 'person';
type Field = 'enabled' | 'detect' | 'on_intake' | 'on_shared_write' | 'on_read' | 'kinds';
const POINT_FIELDS = ['on_intake', 'on_shared_write', 'on_read'] as const;
const LAYER_KEYS = ['enabled', 'detect', 'on_intake', 'on_shared_write', 'on_read', 'kinds', 'locked'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class RiskSettingsError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
const refuse = (message: string): RiskSettingsError => new RiskSettingsError('INVALID_INPUT', 400, message);

/**
 * A layer's patch, checked strictly: a key that is not a setting or a value of the wrong kind is refused
 * naming it. `null` for a field removes this layer's choice (it then follows the layer above).
 * `allowLock` is false for a person, whose choice is a floor for nobody.
 */
export function checkRiskLayer(cur: RiskLayer | undefined, patch: unknown, opts: { allowLock: boolean }): RiskLayer {
  if (!isObj(patch)) throw refuse('risk must be an object, such as { "on_read": "mark+warn" }.');
  const next: RiskLayer = { ...(cur ?? {}), ...(cur?.kinds ? { kinds: { ...cur.kinds } } : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(LAYER_KEYS as readonly string[]).includes(k)) throw refuse(`risk.${k} is not a setting. The keys are: ${LAYER_KEYS.join(', ')}.`);
    if (v === null) { delete (next as Record<string, unknown>)[k]; continue; }
    switch (k as (typeof LAYER_KEYS)[number]) {
      case 'enabled':
        if (typeof v !== 'boolean') throw refuse('risk.enabled must be true or false.');
        next.enabled = v; break;
      case 'locked':
        if (!opts.allowLock) throw refuse('risk.locked is set by an organism or a workspace: it makes their values a floor for the layers under them. A person\'s choice is a floor for nobody.');
        if (typeof v !== 'boolean') throw refuse('risk.locked must be true or false.');
        next.locked = v; break;
      case 'detect':
        if (v !== 'rules' && v !== 'rules+ai') throw refuse('risk.detect must be "rules" (no AI model, no cost) or "rules+ai" (an AI model looks too, on your AI allowance).');
        next.detect = v; break;
      case 'on_intake': case 'on_shared_write': case 'on_read': {
        const ok = k === 'on_read' ? READ_BEHAVIOURS : BEHAVIOURS;
        if (!ok.includes(v as RiskBehaviour)) throw refuse(`risk.${k} must be one of ${ok.join(', ')}.${k === 'on_read' ? ' A read has no hold: a hold is decided when the content arrives.' : ''}`);
        next[k as (typeof POINT_FIELDS)[number]] = v as RiskBehaviour; break;
      }
      case 'kinds': {
        if (!isObj(v)) throw refuse(`risk.kinds must be an object of true or false values with the keys ${RISK_KINDS.join(', ')}.`);
        const kinds = { ...(next.kinds ?? {}) };
        for (const [name, on] of Object.entries(v)) {
          if (!(RISK_KINDS as readonly string[]).includes(name)) throw refuse(`risk.kinds.${name} is not a kind. The kinds are: ${RISK_KINDS.join(', ')}.`);
          if (on === null) { delete kinds[name as RiskKind]; continue; }
          if (typeof on !== 'boolean') throw refuse(`risk.kinds.${name} must be true or false.`);
          kinds[name as RiskKind] = on;
        }
        next.kinds = kinds;
        if (!Object.keys(kinds).length) delete next.kinds;
        break;
      }
    }
  }
  return next;
}

/** A stored layer read field by field; a field that is not valid is left out (it follows the layer above). */
export function lenientRiskLayer(v: unknown): RiskLayer | null {
  if (!isObj(v)) return null;
  const out: RiskLayer = {};
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  if (typeof v.locked === 'boolean') out.locked = v.locked;
  if (v.detect === 'rules' || v.detect === 'rules+ai') out.detect = v.detect;
  for (const f of POINT_FIELDS) {
    const ok = f === 'on_read' ? READ_BEHAVIOURS : BEHAVIOURS;
    if (ok.includes(v[f] as RiskBehaviour)) out[f] = v[f] as RiskBehaviour;
  }
  if (isObj(v.kinds)) {
    const kinds: Partial<Record<RiskKind, boolean>> = {};
    for (const k of RISK_KINDS) if (typeof v.kinds[k] === 'boolean') kinds[k] = v.kinds[k] as boolean;
    if (Object.keys(kinds).length) out.kinds = kinds;
  }
  if (typeof v.by === 'string') out.by = v.by;
  if (typeof v.at === 'string') out.at = v.at;
  if (typeof v.detectBy === 'string') out.detectBy = v.detectBy;
  return out;
}

type RiskConfig = Pick<AimeatConfig, 'contentRiskMode' | 'contentRiskDetect' | 'contentRiskAi' | 'contentRiskOnIntake' | 'contentRiskOnSharedWrite'
  | 'contentRiskOnRead' | 'contentRiskFloorIntake' | 'contentRiskFloorSharedWrite' | 'contentRiskFloorRead' | 'contentRiskKinds'>;

/** The operator's layer: the node's defaults and floors, as a reader of the settings sees them. */
export function nodeRiskLayer(config: RiskConfig): { mode: 'on' | 'off'; defaults: ResolvedRisk; floors: Record<(typeof POINT_FIELDS)[number], RiskBehaviour>; ai: 'allow' | 'deny' } {
  const kinds = config.contentRiskKinds.split(',').map((s) => s.trim()).filter((s): s is RiskKind => (RISK_KINDS as readonly string[]).includes(s));
  const from = { enabled: 'node', detect: 'node', on_intake: 'node', on_shared_write: 'node', on_read: 'node', kinds: 'node' } as const;
  return {
    mode: config.contentRiskMode,
    ai: config.contentRiskAi,
    defaults: {
      enabled: config.contentRiskMode === 'on', detect: config.contentRiskDetect,
      on_intake: config.contentRiskOnIntake, on_shared_write: config.contentRiskOnSharedWrite,
      on_read: config.contentRiskOnRead === 'hold' ? 'mark+warn' : config.contentRiskOnRead,
      kinds, aiPayer: null, from: { ...from },
    },
    floors: { on_intake: config.contentRiskFloorIntake, on_shared_write: config.contentRiskFloorSharedWrite, on_read: config.contentRiskFloorRead },
  };
}

/** The stricter of two behaviours. */
export function strictestBehaviour(a: RiskBehaviour, b: RiskBehaviour): RiskBehaviour {
  return behaviourRank(a) >= behaviourRank(b) ? a : b;
}

export interface LayerIn {
  level: Level;
  layer: RiskLayer | null;
  /** For the reading person's layer: only on_read is taken from it. */
  readOnly?: boolean;
}

/**
 * What is in force, from the node's layer and the given layers in order (organism, workspace, person;
 * or person alone). `homeOwner` is the person whose own item this is, who pays for rules+ai when it
 * comes from the node's default; null for a workspace's item.
 */
export function resolveRisk(config: RiskConfig, layers: readonly LayerIn[], opts: { homeOwner: string | null }): ResolvedRisk {
  const node = nodeRiskLayer(config);
  const off: ResolvedRisk = {
    enabled: false, detect: 'rules', on_intake: 'off', on_shared_write: 'off', on_read: 'off', kinds: [], aiPayer: null,
    from: { enabled: 'node', detect: 'node', on_intake: 'node', on_shared_write: 'node', on_read: 'node', kinds: 'node' },
  };
  if (node.mode === 'off') return off;

  const cur = { ...node.defaults, kinds: [...node.defaults.kinds], from: { ...node.defaults.from } };
  const kindSet = new Set<RiskKind>(cur.kinds);
  let detectBy: string | null = null;
  // The floor: the operator's, raised by every locked layer's own values.
  const floor = { enabled: false, detect: 'rules' as RiskDetect, ...node.floors, kinds: new Set<RiskKind>() };
  let floorDetectBy: string | null = null;

  for (const { level, layer, readOnly } of layers) {
    if (!layer) continue;
    const fields: Field[] = readOnly ? ['on_read'] : ['enabled', 'detect', 'on_intake', 'on_shared_write', 'on_read', 'kinds'];
    for (const f of fields) {
      if (f === 'kinds') {
        if (!layer.kinds) continue;
        for (const [k, on] of Object.entries(layer.kinds) as Array<[RiskKind, boolean]>) { if (on) kindSet.add(k); else kindSet.delete(k); }
        cur.from.kinds = level;
        continue;
      }
      const v = layer[f];
      if (v === undefined) continue;
      if (f === 'detect') detectBy = layer.detectBy ?? layer.by ?? null;
      (cur as Record<string, unknown>)[f] = v;
      cur.from[f] = level;
    }
    if (layer.locked && !readOnly) {
      floor.enabled = floor.enabled || cur.enabled;
      if (cur.detect === 'rules+ai' && floor.detect !== 'rules+ai') { floor.detect = 'rules+ai'; floorDetectBy = detectBy; }
      for (const p of POINT_FIELDS) floor[p] = strictestBehaviour(floor[p], cur.enabled ? cur[p] : 'off');
      for (const k of kindSet) floor.kinds.add(k);
    }
  }

  const out: ResolvedRisk = { ...cur, kinds: [], from: { ...cur.from } };
  for (const p of POINT_FIELDS) {
    const own = cur.enabled ? cur[p] : 'off';
    const v = strictestBehaviour(own, floor[p]);
    out[p] = p === 'on_read' && v === 'hold' ? 'mark+warn' : v;
    if (v !== own) out.from[p] = 'floor';
  }
  out.enabled = POINT_FIELDS.some((p) => out[p] !== 'off');
  for (const k of floor.kinds) kindSet.add(k);
  out.kinds = RISK_KINDS.filter((k) => kindSet.has(k));
  let payer = detectBy;
  if (floor.detect === 'rules+ai' && cur.detect !== 'rules+ai') { out.detect = 'rules+ai'; out.from.detect = 'floor'; payer = floorDetectBy; }
  if (node.ai === 'deny') out.detect = 'rules';
  out.aiPayer = out.detect === 'rules+ai'
    ? (payer ? ownerGhiiOf(payer) : (out.from.detect === 'node' || out.from.detect === 'person') ? opts.homeOwner : null)
    : null;
  return out;
}
