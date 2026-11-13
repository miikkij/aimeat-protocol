/**
 * @file src/services/compliance/lia-need.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When an app's register needs a balancing test (the legitimate interests assessment of
 *   GDPR art. 6(1)(f)), and where a written test stands. Read from what the app already states: its
 *   register's legal basis, its data map (who can see the data, which regulated data it holds) and
 *   its trial mark. Nothing is asked of an app that does not need one.
 *
 *   THE RULE (developer's specification, 2026-11-13). A personal register that names legitimate
 *   interests as its basis needs a test when someone other than the app's user can see the data
 *   (reach shared or exposed, app-reach.ts) or the app holds regulated data: the same line that
 *   decides whether the app gets a register of its own. Three exceptions, each a named reason:
 *     only-its-user   reach none or self and no regulated data: a demo or the person's own tool.
 *     trial           the owner marked the app a trial, it is shared (not exposed) and it holds no
 *                     regulated data. An expired trial stays a trial until the owner decides
 *                     (trial-expired): the app does not come into use without a person saying so.
 *     reach-unknown   the node cannot read who sees the data and no regulated data is stated; the
 *                     unreadable data map is its own gap (scope-gaps.ts).
 *   Special category data (health, biometric and genetic, other special categories) is not carried
 *   by legitimate interests alone: art. 9 asks for one of its own grounds. For such a register the
 *   answer is `not-allowed`, no test is drafted, and the person is pointed to another basis and to
 *   the impact assessment.
 *
 *   OPEN AGAIN IS READ, NEVER WRITTEN. An approved test keeps who could see the data and the
 *   regulated data at approval (`approvedOn`). When the data map later shows a wider reach or a new
 *   regulated domain, the test reads as `reopened` until a person approves it again. No code path
 *   that changes a data map has to remember the test.
 *
 *   PURE except appLiaReading(), which reads the scope's documents and the app's map.
 * @structure TrialState · trialState() · LiaNeed · liaNeedOf() · LiaStanding · liaStanding() · AppLiaReading · appLiaReading() · SPECIAL_CATEGORY_DOMAINS
 * @usage const r = await appLiaReading(deps, scope); for (const n of r.needs) if (n.need === 'required') ...
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { readAppDataMap } from '../data-map/data-map-store.js';
import type { DataMap } from '../data-map/data-map-types.js';
import { appAiSignals, type AppAiSignals } from './app-signals.js';
import { appReach, REACH_ORDER, type AppReach, type AppReachReading } from './app-reach.js';
import { readDoc, type ComplianceScope } from './docs.js';
import type { ComplianceRegister } from './docs-schemas.js';
import type { ComplianceLia, ComplianceTrial } from './lia-schemas.js';

/** The domains GDPR art. 9 covers, by the ids of data/compliance-domains.ts. */
export const SPECIAL_CATEGORY_DOMAINS: ReadonlySet<string> = new Set(['health', 'special-category', 'biometric-genetic']);

export type TrialState = 'none' | 'active' | 'expired' | 'ended';

/** Where a trial mark stands at `now`. */
export function trialState(trial: ComplianceTrial | null | undefined, now: number): TrialState {
  if (!trial?.startedAt || !trial.expiresAt) return 'none';
  if (trial.endedAt) return 'ended';
  return Date.parse(trial.expiresAt) > now ? 'active' : 'expired';
}

export interface LiaNeed {
  register: { id: string; title: string };
  need: 'required' | 'not-allowed' | 'none';
  reason: 'legitimate-interests' | 'special-category' | 'only-its-user' | 'trial' | 'trial-expired' | 'reach-unknown';
  reach: AppReach;
  /** The regulated data of the register and of the app's data map together. */
  domains: string[];
}

const isPersonal = (r: ComplianceRegister): boolean => r.type === 'personal' || r.type === 'pseudonymised';

/** Does this register rest on legitimate interests? */
export function restsOnLegitimateInterests(r: ComplianceRegister): boolean {
  return isPersonal(r) && !!r.legalBasis?.includes('legitimate-interests');
}

/**
 * Whether one register needs a balancing test. Null for a register that does not rest on legitimate
 * interests: the question does not arise for it.
 */
export function liaNeedOf(
  reg: ComplianceRegister, ctx: { reach: AppReach; mapDomains: string[]; trial: TrialState },
): LiaNeed | null {
  if (!restsOnLegitimateInterests(reg)) return null;
  const domains = [...new Set([...(reg.domains ?? []), ...ctx.mapDomains])];
  const base = { register: { id: reg.id, title: reg.title }, reach: ctx.reach, domains };
  if (domains.some(d => SPECIAL_CATEGORY_DOMAINS.has(d))) return { ...base, need: 'not-allowed', reason: 'special-category' };
  if (domains.length === 0) {
    if (ctx.reach === 'none' || ctx.reach === 'self') return { ...base, need: 'none', reason: 'only-its-user' };
    if (ctx.reach === 'unknown') return { ...base, need: 'none', reason: 'reach-unknown' };
    if (ctx.reach === 'shared' && ctx.trial === 'active') return { ...base, need: 'none', reason: 'trial' };
    if (ctx.reach === 'shared' && ctx.trial === 'expired') return { ...base, need: 'none', reason: 'trial-expired' };
  }
  return { ...base, need: 'required', reason: 'legitimate-interests' };
}

export interface LiaStanding {
  /** `reopened`: approved, and the app changed since. `review-due`: approved, and its review date passed. */
  state: 'draft' | 'approved' | 'reopened' | 'review-due';
  /** For `reopened`: what changed, as data a page can say in its reader's language. */
  changed?: { reachFrom?: AppReach; reachTo?: AppReach; newDomains?: string[] };
}

/** Where a written test stands against the app as it is now. */
export function liaStanding(lia: ComplianceLia, now: number, current: { reach: AppReach; domains: string[] }): LiaStanding {
  if (lia.status !== 'approved') return { state: 'draft' };
  const on = lia.approvedOn;
  if (on) {
    const wider = REACH_ORDER.indexOf(current.reach) > REACH_ORDER.indexOf(on.reach);
    const newDomains = current.domains.filter(d => !on.domains.includes(d));
    if (wider || newDomains.length) {
      return { state: 'reopened', changed: { ...(wider ? { reachFrom: on.reach, reachTo: current.reach } : {}), ...(newDomains.length ? { newDomains } : {}) } };
    }
  }
  if (lia.reviewAt && Date.parse(lia.reviewAt) < now) return { state: 'review-due' };
  return { state: 'approved' };
}

export interface AppLiaReading {
  registers: ComplianceRegister[];
  lias: ComplianceLia[];
  trial: ComplianceTrial;
  trialState: TrialState;
  map: DataMap | null;
  reach: AppReachReading;
  signals: AppAiSignals;
  app: AppRecord | null;
  /** One entry per register that rests on legitimate interests. */
  needs: LiaNeed[];
  /** The regulated data the app's map states or its words point to. */
  mapDomains: string[];
}

type Deps = { storage: Storage; config: AimeatConfig };

/** Everything the balancing test of one app is decided from. `regs` saves a read when the caller holds them. */
export async function appLiaReading(
  deps: Deps, scope: Extract<ComplianceScope, { kind: 'app' }>, opts: { regs?: ComplianceRegister[]; now?: number } = {},
): Promise<AppLiaReading> {
  const { storage, config } = deps;
  const now = opts.now ?? Date.now();
  const ownerGhii = `${scope.ownerName}@${config.nodeId}`;
  const [regDoc, liaDoc, trial, map, app] = await Promise.all([
    opts.regs ? Promise.resolve({ items: opts.regs }) : readDoc(storage, config.nodeId, 'registers', scope),
    readDoc(storage, config.nodeId, 'lias', scope),
    readDoc(storage, config.nodeId, 'trial', scope),
    readAppDataMap(storage, ownerGhii, scope.app.replace(/\.html$/i, '')),
    storage.getAppByOwnerName(scope.ownerName, scope.app),
  ]);
  const reach = appReach(map);
  const signals = appAiSignals(map, app?.manifest?.aiPosture);
  const mapDomains = [...new Set(signals.domains.map(d => d.domain))];
  const state = trialState(trial, now);
  const needs = regDoc.items
    .map(r => liaNeedOf(r, { reach: reach.reach, mapDomains, trial: state }))
    .filter((n): n is LiaNeed => n !== null);
  return { registers: regDoc.items, lias: liaDoc.items, trial, trialState: state, map, reach, signals, app, needs, mapDomains };
}
