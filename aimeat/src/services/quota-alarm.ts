/**
 * @file quota-alarm.ts
 * @description Warns an owner while there is still room to act, instead of letting a memory quota
 *   arrive as a wall. A principal that fills its key budget through one-key-per-small-fact gets no
 *   signal at all today: every write succeeds, and then one write fails with a 413 and a keyspace
 *   that needs reshaping, not a quick delete. This raises a bell notification when a principal
 *   crosses 80% (and again at 95%) of either the key ceiling or the byte quota.
 * @structure
 *   - checkMemoryQuotaAlarm(config, storage, gaii, { keyCount?, usedBytes? }) — fire-and-forget from
 *     a write path; computes the bands, throttles, and notifies the owner GHII.
 *   - QUOTA_ALARM_BANDS / QUOTA_ALARM_WINDOW_MS — the thresholds and the per-band repeat window.
 *   - __resetQuotaAlarmThrottle() — test seam.
 * @usage import { checkMemoryQuotaAlarm } from '../services/quota-alarm.js';
 *   void checkMemoryQuotaAlarm(config, storage, gaii, { keyCount, usedBytes });
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. Born from the memory-key-shape audit: aimeat.io runs the key
 *     ceiling at 100 000 against a shipped default of 1 000, so the two principals that would have
 *     failed loudest never failed at all and nobody learned anything. Monitoring is what makes a
 *     raised ceiling safe.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Percentages at which the owner is told. 80 leaves room to reshape; 95 says it is nearly over. */
export const QUOTA_ALARM_BANDS = [80, 95] as const;

/** How long before the SAME principal can raise the SAME band again. */
export const QUOTA_ALARM_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * principal|dimension|band -> last notified (ms). In-process on purpose: this is spam control, not
 * state anyone depends on. A restart may repeat one notification a day early, which costs nothing,
 * whereas persisting it would spend a memory key to warn about spending memory keys.
 */
const lastNotified = new Map<string, number>();

/** Test seam — clears the throttle so a test can assert two consecutive alarms. */
export function __resetQuotaAlarmThrottle(): void {
  lastNotified.clear();
}

/** Highest band the value has crossed, or null when it is below the lowest. */
function bandFor(percent: number): number | null {
  let hit: number | null = null;
  for (const b of QUOTA_ALARM_BANDS) if (percent >= b) hit = b;
  return hit;
}

/**
 * Who hears about it. An agent's or an app's pressure is the OWNER's problem, so the alarm always
 * lands on the owner GHII. An `ext:{name}` namespace has no owner in its identity, so the extension
 * record is read to find who installed it — done only once a band is actually crossed, so the normal
 * write path never pays for this lookup.
 */
async function resolveRecipient(storage: Storage, gaii: string, nodeId: string): Promise<string | null> {
  if (gaii.startsWith('ext:')) {
    const name = gaii.slice(4).split('.')[0];
    if (!name) return null;
    const ext = await storage.getExtension(name);
    return ext?.installedBy ? `${ext.installedBy}@${nodeId}` : null;
  }
  const { owner } = parseGaiiLoose(gaii);
  return owner ? `${owner}@${nodeId}` : null;
}

/** Human label for the principal in the notification body ("agent news-fetcher", "extension luotain"). */
function describePrincipal(gaii: string): string {
  if (gaii.startsWith('ext:')) return `Extension "${gaii.slice(4).split('.')[0]}"`;
  if (gaii.includes('#')) return `Agent "${gaii.split('#')[0]}"`;
  return 'Your account';
}

/**
 * Raise a bell notification when `gaii` crosses a quota band. Both inputs are optional because the
 * caller only has the ones it already computed: the write path counts keys just for new keys, and
 * knows the byte total from the quota check. Never throws — a warning that breaks a write would be
 * worse than the condition it warns about.
 */
export async function checkMemoryQuotaAlarm(
  config: AimeatConfig,
  storage: Storage,
  gaii: string,
  usage: { keyCount?: number; usedBytes?: number },
): Promise<void> {
  try {
    const maxKeys = config.memoryMaxKeysPerAgent;
    const maxBytes = config.memoryQuotaMb * 1024 * 1024;

    const dims: Array<{ dim: 'keys' | 'bytes'; percent: number; detail: string }> = [];
    if (typeof usage.keyCount === 'number' && maxKeys > 0) {
      dims.push({
        dim: 'keys',
        percent: (usage.keyCount / maxKeys) * 100,
        detail: `${usage.keyCount} of ${maxKeys} memory keys`,
      });
    }
    if (typeof usage.usedBytes === 'number' && maxBytes > 0) {
      dims.push({
        dim: 'bytes',
        percent: (usage.usedBytes / maxBytes) * 100,
        detail: `${(usage.usedBytes / (1024 * 1024)).toFixed(1)} MB of ${config.memoryQuotaMb} MB`,
      });
    }

    const crossed = dims
      .map(d => ({ ...d, band: bandFor(d.percent) }))
      .filter((d): d is typeof d & { band: number } => d.band !== null);
    if (!crossed.length) return;

    const now = Date.now();
    const fresh = crossed.filter(d => {
      const slot = `${gaii}|${d.dim}|${d.band}`;
      const seen = lastNotified.get(slot);
      if (seen !== undefined && now - seen < QUOTA_ALARM_WINDOW_MS) return false;
      lastNotified.set(slot, now);
      return true;
    });
    if (!fresh.length) return;

    const recipient = await resolveRecipient(storage, gaii, config.nodeId);
    if (!recipient) return;

    for (const d of fresh) {
      // The body names FOLDING, matching the 413 the caller would eventually hit. A warning that
      // said only "you are at 80%" would send the reader to delete data, which is the wrong fix for
      // the shape that got them here.
      const remedy = d.dim === 'keys'
        ? `One value may hold ${config.memoryMaxValueSizeKb} kB, so a set of small keys usually belongs in one record holding an array or an object keyed by id. Check which key prefix is growing before deleting anything.`
        : 'Check which key prefix is growing. Data that has stopped mattering can be archived or aged out; a prefix that grows one key per event usually wants one record per period instead.';
      await notify(storage, recipient, {
        type: 'quota_warning',
        title: `${describePrincipal(gaii)} is at ${Math.floor(d.percent)}% of its memory ${d.dim === 'keys' ? 'key limit' : 'quota'}`,
        body: `${d.detail}. ${remedy}`,
        link: '/v1/profile#memory',
      });
    }
  } catch (err) {
    logger.warn('memory quota alarm is best-effort', { gaii, error: String(err) });
  }
}
