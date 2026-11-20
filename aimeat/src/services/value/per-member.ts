/**
 * @file src/services/value/per-member.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism's value report per member: how much of what each member's AI made in the
 *   organism was kept, corrected by someone else, deleted within 14 days or opened by someone else. Off
 *   by default, because a number about one person's work is workplace monitoring: an organism's creator
 *   turns it on with the meta record `organism.<id>.meta.valuereport` { perMember: true }, and only a
 *   copy written by a current creator counts (an admin may write meta.* but does not decide this).
 *
 *   WHO SEES WHAT, while it is on. The organism's creators and admins get `by_member` in the organism's
 *   value report (GET /v1/organisms/:id/value, organism-wide only). Every active member is told it is on
 *   and sees their own numbers, with the organism (`value_per_member` on aimeat_organism_get and
 *   GET /v1/organisms/:id), so nobody is counted without knowing it. Only active members are listed; a
 *   person who left is not.
 * @structure PER_MEMBER_REL · perMemberSetting · byMember · perMemberFields
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-j-senkohtaiset-korjausluvut-tiimin-vet-j-lle-kun-luoja-kytke).
 */
import type { Storage, ValueSignal } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { VALUE_SIGNALS } from '../../storage/types/value.js';
import { organismOwners } from '../organism/ownership.js';
import { localAccountName } from '../../utils/gaii.js';
import { dayNDaysAgo } from '../usage/usage-read.js';
import { flushValueSignals } from './signal-buffer.js';

export const PER_MEMBER_REL = 'meta.valuereport';

type Signals = Record<ValueSignal, number>;
const zero = (): Signals => Object.fromEntries(VALUE_SIGNALS.map(s => [s, 0])) as Signals;

/** Whether the organism's creators turned the per-member report on, and when; off without a creator's record. */
export async function perMemberSetting(storage: Storage, orgId: string): Promise<{ on: boolean; set_at: string | null }> {
  const organism = await storage.getOrganism(orgId);
  if (!organism) return { on: false, set_at: null };
  const key = `organism.${orgId}.${PER_MEMBER_REL}`;
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  const creators = new Set(organismOwners(organism));
  const rec = items
    .filter(r => r.key === key && !r.ownerGaii.includes('#') && creators.has(localAccountName(r.ownerGaii)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const on = (rec?.value as { perMember?: unknown } | undefined)?.perMember === true;
  return { on, set_at: rec ? rec.updatedAt : null };
}

/**
 * The organism's numbers per member over a window, each row the member whose AI made the work. Only
 * the organism's active members; `only` narrows it to one person.
 */
export async function byMember(
  storage: Storage, nodeId: string, orgId: string, window: { from: string; to: string }, only?: string,
): Promise<Array<{ member: string } & Signals>> {
  await flushValueSignals();
  const members = await storage.listMembers(orgId, { status: 'active' });
  const ghiiOf = (who: string): string => (who.includes('@') ? who : `${who}@${nodeId}`);
  const active = new Set(members.map(m => ghiiOf(m.ghii)));
  const rows = await storage.sumValueDaily({ orgId, from: window.from, to: window.to }, ['ownerGhii', 'signal']);
  const out = new Map<string, Signals>();
  for (const r of rows) {
    if (!r.ownerGhii || !r.signal || !active.has(r.ownerGhii) || (only && r.ownerGhii !== only)) continue;
    const s = out.get(r.ownerGhii) ?? zero();
    s[r.signal] += r.count;
    out.set(r.ownerGhii, s);
  }
  return [...out.entries()].map(([member, s]) => ({ member, ...s })).sort((a, b) => a.member.localeCompare(b.member));
}

/**
 * What a member is told with the organism while the per-member report is on: that it is on, since
 * when, and their own numbers for the last 30 days. Nothing while it is off, and nothing for someone
 * who is not an active member.
 */
export async function perMemberFields(
  deps: { storage: Storage; config: AimeatConfig }, ownerName: string | undefined, orgId: string,
): Promise<Record<string, unknown>> {
  if (!ownerName) return {};
  const m = await deps.storage.getMembership(orgId, ownerName);
  if (!m || m.status !== 'active') return {};
  const setting = await perMemberSetting(deps.storage, orgId);
  if (!setting.on) return {};
  const ghii = ownerName.includes('@') ? ownerName : `${ownerName}@${deps.config.nodeId}`;
  const window = { from: dayNDaysAgo(30), to: dayNDaysAgo(0) };
  const [yours] = await byMember(deps.storage, deps.config.nodeId, orgId, window, ghii);
  const signals = yours ? Object.fromEntries(VALUE_SIGNALS.map(s => [s, yours[s]])) as Signals : zero();
  return { value_per_member: { on: true, set_at: setting.set_at, from: window.from, to: window.to, yours: signals } };
}
