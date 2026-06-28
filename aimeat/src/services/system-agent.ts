/**
 * @file system-agent.ts
 * @description Shared provisioning primitive for server-side "system" agents — agents the owner does
 *   NOT connect via device auth (RFC 8628) but that the node provisions on the owner's behalf and that
 *   act server-side without holding a JWT: the personal Secretary, the company Secretary, and
 *   specialist agents (Secretary P5 / S-A). Factored out of ensureSecretary so all three share ONE
 *   keypair+create+race path instead of forking it. The generated private key is intentionally
 *   discarded (only `publicKey` is a required AgentRecord field); JWT/device wiring is a later phase.
 * @structure provisionSystemAgent() — idempotent create, returns { record, created } ·
 *   SYSTEM_AGENT_TAGS · isSystemAgentRecord() · systemAgentLiveness() — the shared "is this a node-run
 *   system agent, and is it usable right now?" predicate behind presence + the live DM responder.
 * @usage const { record, created } = await provisionSystemAgent(storage, config, spec)
 * @version-history
 *   v1.1.0 — 2026-06-28 — systemAgentLiveness(): node-run Secretary/specialist agents report their OWN
 *     usability (available when the owner has AI configured + not stop-spending; away when paused;
 *     offline when no AI key) so presence stops showing them perpetually "offline" and the live DM
 *     responder shares one availability rule.
 *   v1.0.0 — 2026-06-24 — Initial: extracted the ensureSecretary provisioning pattern (Secretary P5 S-A)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { emitChange } from './event-bus.js';
import { parseGaiiLoose } from '../utils/gaii.js';

/** The fields a caller supplies to provision a system agent; the helper fills keypair + timestamps. */
export interface SystemAgentSpec {
  name: string;
  owner: string;
  gaii: string;
  displayName: string;
  description: string;
  /** Scope bundle for the agent (from a scope profile). */
  defaultScopes: string[];
  /** Classification/role tags (e.g. system:secretary + unlisted, or system:specialist + role:sdr). */
  tags: string[];
  trustScore?: number;
  mode?: AgentRecord['mode'];
}

/**
 * Idempotently provision a server-side system agent. Returns the existing record (created:false) if the
 * GAII is already taken, otherwise creates it (created:true). Handles the provisioning race (two
 * concurrent calls) by reusing whichever create won. Emits an `agents` change on a fresh create.
 */
export async function provisionSystemAgent(
  storage: Storage,
  _config: AimeatConfig,
  spec: SystemAgentSpec,
): Promise<{ record: AgentRecord; created: boolean }> {
  const existing = await storage.getAgent(spec.gaii);
  if (existing) return { record: existing, created: false };

  const { publicKey } = await generateKeyPair();
  const now = new Date().toISOString();
  const record: AgentRecord = {
    name: spec.name,
    owner: spec.owner,
    gaii: spec.gaii,
    displayName: spec.displayName,
    description: spec.description,
    capabilities: [],
    publicKey,
    trustScore: spec.trustScore ?? 50,
    morselBalance: 0,
    createdAt: now,
    lastSeen: now,
    defaultScopes: spec.defaultScopes,
    mode: spec.mode ?? 'interactive',
    tags: spec.tags,
  };

  try {
    await storage.createAgent(record);
  } catch (err) {
    // Lost a provisioning race — the other create won; reuse it.
    const again = await storage.getAgent(spec.gaii);
    if (again) return { record: again, created: false };
    throw err;
  }

  emitChange('agents', spec.gaii);
  return { record, created: true };
}

// ── System-agent liveness (presence + live DM responder share this) ───────────────────────────────

/**
 * Tags that mark a node-run "system" agent — one the node executes in-process (no device-auth, no
 * connect tunnel). MIRRORS the constants in services/secretary.ts (SECRETARY_ROLE_TAG /
 * COMPANY_SECRETARY_TAG) + services/specialist.ts (SPECIALIST_ROLE_TAG); kept as literals here to avoid
 * an import cycle (those modules import provisionSystemAgent from this file).
 */
export const SYSTEM_AGENT_TAGS: ReadonlySet<string> = new Set([
  'system:secretary',
  'system:company-secretary',
  'system:specialist',
]);

/** True if an agent record is a node-run system agent (Secretary / company Secretary / specialist). */
export function isSystemAgentRecord(record: AgentRecord | null | undefined): boolean {
  return !!record && (record.tags ?? []).some((t) => SYSTEM_AGENT_TAGS.has(t));
}

/** available = configured + node will act on it now · away = AI configured but spending paused ·
 *  offline = no AI key (the agent literally cannot act). */
export type SystemAgentStatus = 'available' | 'away' | 'offline';

export interface SystemAgentLiveness {
  /** Whether the target is a node-run system agent hosted on THIS node. */
  isSystemAgent: boolean;
  /** Computed usability status (only meaningful when isSystemAgent). */
  status: SystemAgentStatus;
  /** The agent record (null when absent / not local). */
  record: AgentRecord | null;
}

/** Does the owner have an AI provider configured (an OpenRouter key, or a non-openrouter provider)? */
async function ownerAiConfigured(storage: Storage, ownerGhii: string): Promise<boolean> {
  try {
    const [keyRec, prefsRec] = await Promise.all([
      storage.getMemory(ownerGhii, 'openrouter.apikey'),
      storage.getMemory(ownerGhii, 'openrouter.settings'),
    ]);
    const provider = ((prefsRec?.value as { provider?: string } | undefined)?.provider) || 'openrouter';
    if (provider !== 'openrouter') return true; // lmstudio/custom may need no key
    return !!(keyRec?.value as { encrypted?: string } | undefined)?.encrypted;
  } catch {
    return false;
  }
}

/** Is paid work paused for this system agent? Secretary → its active context's stop-spending; a
 *  specialist → its own `specialist.<name>.config` policy.stopSpending. (Cheap: one memory read.) */
async function systemAgentPaused(storage: Storage, ownerGhii: string, agentName: string): Promise<boolean> {
  try {
    if (agentName === 'secretary' || agentName.startsWith('secretary-')) {
      const rec = await storage.getMemory(ownerGhii, 'secretary.config');
      const cfg = (rec?.value ?? {}) as { activeContextId?: string; contexts?: Array<{ id?: string; policy?: { stopSpending?: boolean } }> };
      const contexts = Array.isArray(cfg.contexts) ? cfg.contexts : [];
      const active = contexts.find((c) => c.id === cfg.activeContextId) || contexts[0];
      return active?.policy?.stopSpending === true;
    }
    // specialist: mirrors specialistConfigKey() — inlined to avoid an import cycle with specialist.ts.
    const rec = await storage.getMemory(ownerGhii, `specialist.${agentName}.config`);
    const cfg = (rec?.value ?? {}) as { policy?: { stopSpending?: boolean } };
    return cfg.policy?.stopSpending === true;
  } catch {
    return false;
  }
}

/**
 * Resolve a GAII's system-agent liveness: whether it is a node-run system agent on THIS node and, if so,
 * whether it is available / away / offline. Reads are always local — a remote GAII is never a local system
 * agent here. Uncached so a stop-spending / AI-key change reflects immediately (presence is already
 * throttled upstream: the client batches + 60s-caches, and the tracker caches presence config).
 */
export async function systemAgentLiveness(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
): Promise<SystemAgentLiveness> {
  const { agent, owner, node } = parseGaiiLoose(gaii);
  if (!owner || node !== config.nodeId) return { isSystemAgent: false, status: 'offline', record: null };

  const record = await storage.getAgent(gaii).catch(() => null);
  if (!isSystemAgentRecord(record)) return { isSystemAgent: false, status: 'offline', record };

  const ownerGhii = `${owner}@${node}`;
  if (!(await ownerAiConfigured(storage, ownerGhii))) {
    return { isSystemAgent: true, status: 'offline', record };
  }
  const paused = await systemAgentPaused(storage, ownerGhii, agent);
  return { isSystemAgent: true, status: paused ? 'away' : 'available', record };
}
