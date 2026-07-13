/**
 * @file network-policy.ts
 * @description Federation network-policy document (Phase B governance). A declarative,
 *   versioned, genesis-signed doc with a FIXED set of measurable criteria (no DSL):
 *   auto-admit conditions for visiting peers, hard permission caps for the visiting tier,
 *   and the criteria a visiting peer must MEET to become eligible for promotion to member.
 *   The genesis/anchor operator authors it; peers fetch + signature-verify + version-gate +
 *   cache it, then measure joining/visiting peers against it. Promotion itself stays a
 *   deliberate LOCAL operator action (vouch) — this only decides eligibility.
 * @structure
 *   - NetworkPolicyDoc + DEFAULT_NETWORK_POLICY + coercePolicy()
 *   - policySignString() — canonical string signed/verified for a doc
 *   - getActivePolicy(storage) / setActivePolicy() — cached resolution (stored doc else default)
 *   - evaluateAutoAdmit(introduce, policy) — domain + protocol gate for open-join
 *   - evaluatePromotion(metrics, policy) — { eligible, failing[] } for visiting→member
 * @usage import { getActivePolicy, evaluatePromotion } from './network-policy.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial network-policy doc + evaluators (genesis-defined criteria).
 */
import type { Storage } from '../storage/interface.js';

/** System identity + key the active network policy is stored under. */
export const NETWORK_POLICY_GAII = '__network_policy__';
export const NETWORK_POLICY_KEY = 'network-policy.active';

export interface NetworkPolicyDoc {
  policy_version: number;
  issued_by: string;
  issued_at: string;
  signature?: string;
  auto_admit: {
    enabled: boolean;
    require_signed_introduce: boolean;
    min_protocol_version: string;
    domain_allow: string[];
    domain_block: string[];
  };
  visiting_permission_caps: {
    share_catalogue: boolean;
    replicate_memory: boolean;
    allow_routing: boolean;
    allow_federated_auth: boolean;
  };
  promotion_criteria: {
    require_signed_introduce: boolean;
    min_protocol_version: string;
    min_availability_pct: number;
    min_days_active: number;
    min_successful_work: number;
    max_active_flags: number;
    domain_allow: string[];
    domain_block: string[];
  };
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicyDoc = {
  policy_version: 0,
  issued_by: '',
  issued_at: '1970-01-01T00:00:00.000Z',
  auto_admit: {
    enabled: true,
    require_signed_introduce: true,
    min_protocol_version: 'v1',
    domain_allow: [],
    domain_block: [],
  },
  visiting_permission_caps: {
    share_catalogue: true,
    replicate_memory: false,
    allow_routing: false,
    allow_federated_auth: false,
  },
  promotion_criteria: {
    require_signed_introduce: true,
    min_protocol_version: 'v1',
    min_availability_pct: 90,
    min_days_active: 7,
    min_successful_work: 3,
    max_active_flags: 0,
    domain_allow: [],
    domain_block: [],
  },
};

const asBool = (v: unknown, d: boolean) => typeof v === 'boolean' ? v : d;
const asNum = (v: unknown, d: number) => typeof v === 'number' && Number.isFinite(v) ? v : d;
const asStr = (v: unknown, d: string) => typeof v === 'string' ? v : d;
const asArr = (v: unknown) => Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : [];

/** Coerce an arbitrary stored/received value into a valid policy doc (per-field fallback to defaults). */
export function coercePolicy(value: unknown): NetworkPolicyDoc {
  const v = (value && typeof value === 'object') ? value as Record<string, any> : {};
  const aa = v.auto_admit ?? {}, caps = v.visiting_permission_caps ?? {}, pc = v.promotion_criteria ?? {};
  const D = DEFAULT_NETWORK_POLICY;
  return {
    policy_version: asNum(v.policy_version, D.policy_version),
    issued_by: asStr(v.issued_by, D.issued_by),
    issued_at: asStr(v.issued_at, D.issued_at),
    signature: typeof v.signature === 'string' ? v.signature : undefined,
    auto_admit: {
      enabled: asBool(aa.enabled, D.auto_admit.enabled),
      require_signed_introduce: asBool(aa.require_signed_introduce, D.auto_admit.require_signed_introduce),
      min_protocol_version: asStr(aa.min_protocol_version, D.auto_admit.min_protocol_version),
      domain_allow: asArr(aa.domain_allow),
      domain_block: asArr(aa.domain_block),
    },
    visiting_permission_caps: {
      share_catalogue: asBool(caps.share_catalogue, D.visiting_permission_caps.share_catalogue),
      replicate_memory: asBool(caps.replicate_memory, D.visiting_permission_caps.replicate_memory),
      allow_routing: asBool(caps.allow_routing, D.visiting_permission_caps.allow_routing),
      allow_federated_auth: asBool(caps.allow_federated_auth, D.visiting_permission_caps.allow_federated_auth),
    },
    promotion_criteria: {
      require_signed_introduce: asBool(pc.require_signed_introduce, D.promotion_criteria.require_signed_introduce),
      min_protocol_version: asStr(pc.min_protocol_version, D.promotion_criteria.min_protocol_version),
      min_availability_pct: asNum(pc.min_availability_pct, D.promotion_criteria.min_availability_pct),
      min_days_active: asNum(pc.min_days_active, D.promotion_criteria.min_days_active),
      min_successful_work: asNum(pc.min_successful_work, D.promotion_criteria.min_successful_work),
      max_active_flags: asNum(pc.max_active_flags, D.promotion_criteria.max_active_flags),
      domain_allow: asArr(pc.domain_allow),
      domain_block: asArr(pc.domain_block),
    },
  };
}

/** Canonical string a genesis node signs (and a peer verifies) for a policy doc — excludes `signature`. */
export function policySignString(doc: NetworkPolicyDoc): string {
  const rest = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'signature'));
  return JSON.stringify(rest);
}

/**
 * Resolve the active policy from storage (the stored doc, else the default). Read straight from
 * storage on each call — NOT a module cache — so multiple node instances in one process (tests)
 * never share state; reads are infrequent (introduce / promote / peer-list), so this is cheap.
 */
export async function getActivePolicy(storage: Storage): Promise<NetworkPolicyDoc> {
  try {
    const rec = await storage.getMemory(NETWORK_POLICY_GAII, NETWORK_POLICY_KEY);
    if (rec) return coercePolicy(rec.value);
  } catch { /* fall through to default */ }
  return DEFAULT_NETWORK_POLICY;
}

/** Persist the policy doc under the system identity. */
export async function storeActivePolicy(storage: Storage, doc: NetworkPolicyDoc): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(NETWORK_POLICY_GAII, NETWORK_POLICY_KEY).catch(() => null);
  await storage.setMemory({
    key: NETWORK_POLICY_KEY,
    ownerGaii: NETWORK_POLICY_GAII,
    value: doc as unknown as Record<string, unknown>,
    visibility: 'public',
    tags: ['federation', 'network-policy'],
    ttlHours: null,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

function domainOk(host: string, allow: string[], block: string[]): boolean {
  if (block.some(b => host === b.toLowerCase() || host.endsWith('.' + b.toLowerCase()))) return false;
  if (allow.length === 0) return true;
  return allow.some(a => host === a.toLowerCase() || host.endsWith('.' + a.toLowerCase()));
}

/** Gate an open-join introduction against the policy's auto_admit rules (domain + protocol). */
export function evaluateAutoAdmit(introduce: { node_url: string; protocol_version?: string }, policy: NetworkPolicyDoc): { allowed: boolean; reason?: string } {
  const aa = policy.auto_admit;
  if (!aa.enabled) return { allowed: false, reason: 'Auto-admit is disabled by network policy' };
  const host = hostOf(introduce.node_url);
  if (!domainOk(host, aa.domain_allow, aa.domain_block)) return { allowed: false, reason: `Domain ${host} is not permitted to auto-join` };
  const pv = introduce.protocol_version ?? 'v1';
  if (aa.min_protocol_version && pv < aa.min_protocol_version) return { allowed: false, reason: `Protocol ${pv} below required ${aa.min_protocol_version}` };
  return { allowed: true };
}

export interface PromotionMetrics {
  availabilityPct: number | null;
  daysActive: number;
  successfulWork: number;
  activeFlags: number;
  signedIntroduce: boolean;
  protocolVersion: string;
  nodeUrl: string;
}

/** Measure a visiting peer against the promotion criteria. Returns eligibility + failing criteria. */
export function evaluatePromotion(metrics: PromotionMetrics, policy: NetworkPolicyDoc): { eligible: boolean; failing: string[] } {
  const c = policy.promotion_criteria;
  const failing: string[] = [];
  if (c.require_signed_introduce && !metrics.signedIntroduce) failing.push('signed_introduce');
  if ((metrics.availabilityPct ?? 0) < c.min_availability_pct) failing.push('availability');
  if (metrics.daysActive < c.min_days_active) failing.push('days_active');
  if (metrics.successfulWork < c.min_successful_work) failing.push('successful_work');
  if (metrics.activeFlags > c.max_active_flags) failing.push('active_flags');
  if (c.min_protocol_version && metrics.protocolVersion < c.min_protocol_version) failing.push('protocol_version');
  if (!domainOk(hostOf(metrics.nodeUrl), c.domain_allow, c.domain_block)) failing.push('domain');
  return { eligible: failing.length === 0, failing };
}
