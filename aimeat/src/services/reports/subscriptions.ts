/**
 * @file src/services/reports/subscriptions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Report subscriptions: one report tool for four scopes (a person's own, a workspace, an
 *   organism, the node), each subscription a memory record the person or their AI writes under
 *   `reports.sub.<id>` in the person's own namespace (no new route or table: a record and the prompt
 *   that reads it). The core job report-subscriptions (every 15 minutes) reads every subscription,
 *   decides which are due, builds the report from the value, data and rhythm reports
 *   (services/value/) and sends it as a notification in each reader's language.
 *
 *   WHO MAY SEND WHAT, decided at every send and not at the write, because a role can end after the
 *   record was written: `own` goes to its writer only; `workspace` and `organism` need the writer to be
 *   the organism's creator or an admin, and go to the writer, the organism's owners or every active
 *   member; `node` needs the writer to be an operator, and goes to the writer or every operator. A
 *   subscription that no longer holds is skipped and says why in `lastSkip`, which the Reports page
 *   shows. A report with nothing in it is not sent: a report that says nothing teaches its reader to
 *   skip it.
 *
 *   HOW IT GOES STALE. A subscription not sent for 180 days because nothing happened, or skipped for
 *   lack of a right, is left as it is and shown as quiet on the page; the person removes it.
 * @structure SUBSCRIPTION_PREFIX · ReportSubscription · parseSubscription · isDue · windowOf ·
 *   recipientsOf · buildReport · runReportSubscriptions
 * @version-history
 *   v1.1.0 — 2026-11-20 — `lastSkip` is a code (SKIP) the Reports page words in the reader's language,
 *     kept on parse so an unchanged reason is not written again every run; a record that is not a
 *     subscription says why (`invalid`, `lastSkipDetail`); contents `measures` adds an organism's own
 *     measures (services/value/measures.ts) to an organism or workspace report.
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 4).
 */
import { Cron } from 'croner';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { organismOwners } from '../organism/ownership.js';
import { readValueReport } from '../value/report.js';
import { readDataReport } from '../value/data-report.js';
import { readUsageRhythm } from '../value/usage-rhythm.js';
import { readMeasures } from '../value/measures.js';

export const SUBSCRIPTION_PREFIX = 'reports.sub.';

export type ReportScope = 'own' | 'workspace' | 'organism' | 'node';
export type ReportCadence = 'daily' | 'every-other-day' | 'weekly' | 'monthly' | 'cron' | 'burst';
export type ReportRecipients = 'me' | 'owners' | 'members' | 'operators';
/** `measures`: an organism or workspace report's own measures (services/value/measures.ts). */
export type ReportContent = 'value' | 'data' | 'rhythm' | 'goals' | 'measures';

export interface ReportSubscription {
  id: string;
  name: string;
  scope: ReportScope;
  orgId?: string;
  wsId?: string;
  recipients: ReportRecipients;
  cadence: ReportCadence;
  /** UTC hour 0..23 for daily, every-other-day, weekly and monthly; default 7. */
  hour?: number;
  /** ISO weekday 1 (Monday) .. 7 for weekly; default 1. */
  weekday?: number;
  /** Day of the month 1..28 for monthly; default 1. */
  monthDay?: number;
  cron?: string;
  contents: ReportContent[];
  paused?: boolean;
  lastSentAt?: string;
  lastBurstDay?: string;
  /** Why the last due run sent nothing, as a code the Reports page words (SKIP). */
  lastSkip?: SkipCode;
  /** For `invalid`: what in the record is wrong, in the parser's words (for the person's AI). */
  lastSkipDetail?: string;
}

/** Why a due subscription sent nothing. Stored as a code so the page can say it in the reader's language. */
export const SKIP = {
  nothing: 'nothing',
  notOperator: 'not-operator',
  organismGone: 'organism-gone',
  notOrganismOwner: 'not-organism-owner',
  invalid: 'invalid',
} as const;
export type SkipCode = typeof SKIP[keyof typeof SKIP];

const CADENCES: readonly ReportCadence[] = ['daily', 'every-other-day', 'weekly', 'monthly', 'cron', 'burst'];
const SCOPES: readonly ReportScope[] = ['own', 'workspace', 'organism', 'node'];
const RECIPIENTS: readonly ReportRecipients[] = ['me', 'owners', 'members', 'operators'];
const CONTENTS: readonly ReportContent[] = ['value', 'data', 'rhythm', 'goals', 'measures'];

/** A stored value as a subscription, or the reason it is not one. */
export function parseSubscription(id: string, value: unknown): { ok: true; sub: ReportSubscription } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not an object' };
  const v = value as Record<string, unknown>;
  const scope = v.scope as ReportScope;
  if (!SCOPES.includes(scope)) return { ok: false, reason: `scope is one of ${SCOPES.join(', ')}` };
  const cadence = v.cadence as ReportCadence;
  if (!CADENCES.includes(cadence)) return { ok: false, reason: `cadence is one of ${CADENCES.join(', ')}` };
  const recipients = (v.recipients ?? 'me') as ReportRecipients;
  if (!RECIPIENTS.includes(recipients)) return { ok: false, reason: `recipients is one of ${RECIPIENTS.join(', ')}` };
  if (scope === 'own' && recipients !== 'me') return { ok: false, reason: 'an own report goes to its writer only' };
  if ((scope === 'workspace' || scope === 'organism') && (typeof v.orgId !== 'string' || !v.orgId)) return { ok: false, reason: 'orgId is required' };
  if (scope === 'workspace' && (typeof v.wsId !== 'string' || !v.wsId)) return { ok: false, reason: 'wsId is required' };
  if (scope === 'node' && recipients !== 'me' && recipients !== 'operators') return { ok: false, reason: 'a node report goes to its writer or the operators' };
  if (scope !== 'node' && recipients === 'operators') return { ok: false, reason: 'only a node report goes to the operators' };
  if (cadence === 'cron') {
    try { new Cron(String(v.cron ?? ''), { paused: true }); } catch { return { ok: false, reason: 'cron is not a valid cron expression' }; }
  }
  const contents = (Array.isArray(v.contents) ? v.contents : ['value']).filter((c): c is ReportContent => CONTENTS.includes(c as ReportContent));
  if (contents.length === 0) return { ok: false, reason: `contents names at least one of ${CONTENTS.join(', ')}` };
  const int = (x: unknown, lo: number, hi: number): number | undefined => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? x as number : undefined);
  return {
    ok: true,
    sub: {
      id, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 120) : id,
      scope, ...(typeof v.orgId === 'string' ? { orgId: v.orgId } : {}), ...(typeof v.wsId === 'string' ? { wsId: v.wsId } : {}),
      recipients, cadence, hour: int(v.hour, 0, 23), weekday: int(v.weekday, 1, 7), monthDay: int(v.monthDay, 1, 28),
      ...(cadence === 'cron' ? { cron: String(v.cron) } : {}),
      contents, paused: v.paused === true,
      ...(typeof v.lastSentAt === 'string' ? { lastSentAt: v.lastSentAt } : {}),
      ...(typeof v.lastBurstDay === 'string' ? { lastBurstDay: v.lastBurstDay } : {}),
      ...(typeof v.lastSkip === 'string' ? { lastSkip: v.lastSkip as SkipCode } : {}),
    },
  };
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Whether a subscription is due at `now` (the burst cadence is decided by buildReport). */
export function isDue(sub: ReportSubscription, now: Date): boolean {
  if (sub.paused) return false;
  if (sub.cadence === 'burst') return true;
  const sentToday = !!sub.lastSentAt && sub.lastSentAt.slice(0, 10) === day(now);
  if (sub.cadence === 'cron') {
    const from = sub.lastSentAt ? new Date(sub.lastSentAt) : new Date(now.getTime() - 86_400_000);
    const next = new Cron(sub.cron ?? '', { paused: true }).nextRun(from);
    return !!next && next.getTime() <= now.getTime();
  }
  if (sentToday || now.getUTCHours() < (sub.hour ?? 7)) return false;
  if (sub.cadence === 'daily') return true;
  if (sub.cadence === 'every-other-day') return now.getUTCDate() % 2 === 0;
  if (sub.cadence === 'weekly') return ((now.getUTCDay() + 6) % 7) + 1 === (sub.weekday ?? 1);
  return now.getUTCDate() === (sub.monthDay ?? 1);
}

/** The days a report covers: since the last send, or the cadence's own span. */
export function windowOf(sub: ReportSubscription, now: Date): { from: string; to: string } {
  const span = { daily: 1, 'every-other-day': 2, weekly: 7, monthly: 30, cron: 7, burst: 1 }[sub.cadence];
  const from = sub.lastSentAt && sub.cadence !== 'burst' ? sub.lastSentAt.slice(0, 10) : day(new Date(now.getTime() - span * 86_400_000));
  return { from, to: day(now) };
}

/** Who receives it, decided now from the writer's current rights; or why it may not be sent. */
export async function recipientsOf(storage: Storage, config: AimeatConfig, writerGhii: string, sub: ReportSubscription): Promise<{ ok: true; to: string[] } | { ok: false; reason: SkipCode }> {
  if (sub.scope === 'own') return { ok: true, to: [writerGhii] };
  const name = localAccountName(writerGhii);
  if (sub.scope === 'node') {
    const operators = await storage.listOperatorNames({ limit: 50 });
    if (!operators.includes(name)) return { ok: false, reason: SKIP.notOperator };
    return { ok: true, to: sub.recipients === 'operators' ? operators.map(o => `${o}@${config.nodeId}`) : [writerGhii] };
  }
  const org = await storage.getOrganism(sub.orgId!);
  if (!org) return { ok: false, reason: SKIP.organismGone };
  const owners = organismOwners(org);
  if (!owners.includes(name)) return { ok: false, reason: SKIP.notOrganismOwner };
  if (sub.recipients === 'me') return { ok: true, to: [writerGhii] };
  if (sub.recipients === 'owners') return { ok: true, to: owners.map(o => `${o}@${config.nodeId}`) };
  const members = await storage.listMembers(sub.orgId!, { status: 'active' });
  const asGhii = (who: string): string => (who.includes('@') ? who : `${who}@${config.nodeId}`);
  return { ok: true, to: [...new Set([...owners.map(asGhii), ...members.map(m => asGhii(m.ghii))])] };
}

/** The report's figures and its words, or `empty` when nothing happened. */
export async function buildReport(
  deps: { storage: Storage; config: AimeatConfig }, writerGhii: string, sub: ReportSubscription, now: Date,
): Promise<{ empty: boolean; vars: Record<string, string | number>; text: string; burstDay?: string }> {
  const { from, to } = windowOf(sub, now);
  const parts: string[] = [];
  const vars: Record<string, string | number> = { name: sub.name, from, to, made: 0, corrected: 0, rejected: 0, used: 0, writes: 0, burst: '-', measures: '' };
  let burstDay: string | undefined;
  if (sub.contents.includes('value') || sub.contents.includes('goals') || sub.cadence === 'burst') {
    const scope = sub.scope === 'own' ? { kind: 'own' as const, ownerGhii: writerGhii }
      : sub.scope === 'node' ? { kind: 'node' as const }
        : { kind: 'organism' as const, orgId: sub.orgId!, ...(sub.wsId ? { wsId: sub.wsId } : {}) };
    const v = await readValueReport(deps, scope, sub.cadence === 'burst' ? { from: day(new Date(now.getTime() - 60 * 86_400_000)), to } : { from, to });
    if (sub.cadence === 'burst') {
      const b = v.rhythm.bursts[0];
      const yesterday = day(new Date(now.getTime() - 86_400_000));
      if (!b || b.day < yesterday || b.day === sub.lastBurstDay) return { empty: true, vars, text: '' };
      burstDay = b.day;
      vars.burst = `${b.day} (${b.times} ×)`;
      parts.push(`Burst on ${b.day}: ${b.count}, usually ${b.usual}.`);
    }
    vars.made = v.signals.produced + v.signals.refined;
    vars.corrected = v.signals.corrected;
    vars.rejected = v.signals.rejected;
    vars.used = v.signals.used;
    if (vars.made || vars.corrected || vars.rejected || vars.used) {
      parts.push(`AI made ${vars.made}: ${vars.corrected} corrected, ${vars.rejected} deleted, ${vars.used} opened by someone else.`);
    }
    if (sub.contents.includes('goals') && v.goals?.length) {
      const saving = v.goals.reduce((s, g) => s + (g.saving_minutes ?? 0), 0);
      if (saving) { vars.saving = Math.round(saving); parts.push(`Saving counted from the goals' baselines: ${Math.round(saving)} min.`); }
    }
  }
  if (sub.contents.includes('data') && (sub.scope === 'own' || sub.scope === 'node')) {
    const d = await readDataReport(deps.storage, deps.config.nodeId, sub.scope === 'own' ? { kind: 'own', ownerGhii: writerGhii } : { kind: 'node' }, { from, to });
    vars.writes = d.total.count;
    if (d.total.count) parts.push(`Data written: ${d.total.count}.`);
  }
  if (sub.contents.includes('rhythm') && sub.scope === 'node') {
    const r = await readUsageRhythm(deps.storage, { from, to });
    const top = r.features.slice(0, 3).map(f => `${f.feature} ${f.calls}`).join(', ');
    if (top) parts.push(`Most used: ${top}.`);
  }
  if (sub.contents.includes('measures') && (sub.scope === 'organism' || sub.scope === 'workspace')) {
    // The writer's own measures of the organism, each counted only where the writer may read.
    const counted = (await readMeasures(deps, writerGhii, sub.orgId!, { from, to, ...(sub.wsId ? { wsId: sub.wsId } : {}) }))
      .filter(m => !m.problem && m.value !== null);
    if (counted.length) {
      vars.measures = counted.map(m => `${m.name}: ${Math.round(m.value! * 100) / 100}${m.unit ? ` ${m.unit}` : ''}`).join(' · ');
      parts.push(`${vars.measures}.`);
    }
  }
  return { empty: parts.length === 0, vars, text: parts.join(' '), ...(burstDay ? { burstDay } : {}) };
}

/** Write back what the run learned about one subscription, on the version it read. */
async function stamp(storage: Storage, rec: MemoryRecord, patch: Partial<ReportSubscription>): Promise<void> {
  const value = { ...(rec.value as Record<string, unknown>), ...patch };
  const ok = await storage.setMemoryIfVersion({ ...rec, value, version: rec.version + 1, updatedAt: new Date().toISOString() }, rec.version);
  if (!ok) logger.info('report-subscriptions: a subscription changed during the run; its stamp waits for the next run', { key: rec.key });
}

/** One run: every due subscription is built and sent. Answers how many reports were sent. */
export async function runReportSubscriptions(storage: Storage, config: AimeatConfig, now = new Date()): Promise<number> {
  let sent = 0;
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const { items } = await storage.listAllMemory({ prefix: SUBSCRIPTION_PREFIX, limit: PAGE, offset });
    for (const rec of items) {
      const writerGhii = ownerGhiiOf(rec.ownerGaii);
      // Only a person's own record counts: a subscription in an agent's namespace is the agent's note.
      if (writerGhii !== rec.ownerGaii) continue;
      const parsed = parseSubscription(rec.key.slice(SUBSCRIPTION_PREFIX.length), rec.value);
      if (!parsed.ok) {
        // A record the person can open says why it sends nothing; one that is not an object stays as it is.
        const v = rec.value as Record<string, unknown> | null;
        if (v && typeof v === 'object' && !Array.isArray(v) && (v.lastSkip !== SKIP.invalid || v.lastSkipDetail !== parsed.reason)) {
          await stamp(storage, rec, { lastSkip: SKIP.invalid, lastSkipDetail: parsed.reason });
        }
        continue;
      }
      const sub = parsed.sub;
      try {
        if (!isDue(sub, now)) continue;
        const to = await recipientsOf(storage, config, writerGhii, sub);
        if (!to.ok) { if (sub.lastSkip !== to.reason) await stamp(storage, rec, { lastSkip: to.reason, lastSkipDetail: undefined }); continue; }
        const report = await buildReport({ storage, config }, writerGhii, sub, now);
        if (report.empty) {
          if (sub.cadence !== 'burst') await stamp(storage, rec, { lastSentAt: now.toISOString(), lastSkip: SKIP.nothing, lastSkipDetail: undefined });
          continue;
        }
        for (const ghii of to.to) {
          await notify(storage, ghii, {
            type: 'report',
            title: `${sub.name}: ${report.vars.made} made by AI`,
            body: report.text,
            link: '/v1/profile?tab=reports',
            i18n: { key: 'report_subscription', vars: report.vars },
          });
        }
        sent++;
        await stamp(storage, rec, { lastSentAt: now.toISOString(), lastSkip: undefined, lastSkipDetail: undefined, ...(report.burstDay ? { lastBurstDay: report.burstDay } : {}) });
      } catch (err) {
        logger.warn('report-subscriptions: one subscription failed', { key: rec.key, error: String(err) });
      }
    }
    if (items.length < PAGE) break;
  }
  return sent;
}
