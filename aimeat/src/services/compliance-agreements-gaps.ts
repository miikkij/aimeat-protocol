/**
 * @file src/services/compliance-agreements-gaps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node's data processing agreements leave open, and the hourly sweep that keeps
 *   their clocks (plan doc-mvmr4i2wdk0p, D4.1, D4.2, D4.3).
 *
 *   GAPS. An agreement that waits for its counterparty over a week, a copy that waits for the operator,
 *   a sub-processor taken into use and not announced to the agreements whose Annex IV it changes, an
 *   objection nobody answered, a deletion past its day, measures signed more than a year ago, an open
 *   breach the agreed hours have passed without a notice, and an Annex III area nothing describes.
 *
 *   THE SWEEP. Once an hour: the counterparty's reminders on the 2nd and the 7th day, the reminder a
 *   week before an announced change takes effect, a lapsed notice turned into the version in force,
 *   and the AIMEAT signing requests read, so a version signed in the signing app comes into force and
 *   is told without anyone opening the page.
 * @structure AgreementGap · agreementGaps() · sweepAgreements() · scheduleAgreementSweep()
 * @usage const gaps = await agreementGaps(deps);
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { UNCHANGED } from './record-cas.js';
import { readDoc } from './compliance-docs.js';
import { derivedProcessors, processorsView } from './compliance-derived.js';
import { MEASURE_AREAS, type Agreement } from './compliance-agreements-schemas.js';
import { finalizeNotices, historyEntry, inForce, listAgreements, newest, statusOf, updateAgreement } from './compliance-agreements.js';
import { subprocessorsFor } from './compliance-agreements-generate.js';
import { tellAgreement } from './compliance-agreements-notify.js';
import { syncDocsign } from './compliance-agreements-sign.js';

type Deps = { storage: Storage; config: AimeatConfig };
const DAY = 86_400_000;

export interface AgreementGap { kind: string; agreement?: string; counterparty?: string; detail: string }

export async function agreementGaps(deps: Deps, now = Date.now()): Promise<AgreementGap[]> {
  const all = await listAgreements(deps.storage, deps.config.nodeId);
  const stored = (await readDoc(deps.storage, deps.config.nodeId, 'processors', { kind: 'node' })).items;
  const processors = processorsView(derivedProcessors(deps.config), stored);
  const out: AgreementGap[] = [];
  for (const a0 of all) {
    const a = finalizeNotices(a0, now);
    const v = newest(a);
    const f = inForce(a);
    const who = { agreement: a.id, counterparty: a.counterparty.name };
    if (a.endedAt) {
      if (a.deletion && !a.deletion.doneAt && Date.parse(a.deletion.dueAt) < now) out.push({ kind: 'agreement-deletion-overdue', ...who, detail: `The data was to be ${a.deletion.choice === 'return' ? 'returned' : 'deleted'} by ${a.deletion.dueAt}.` });
      continue;
    }
    if (v.status === 'sent' && !v.notice && v.sentAt && now - Date.parse(v.sentAt) > 7 * DAY) out.push({ kind: 'agreement-awaiting-counterparty', ...who, detail: `Version ${v.n} was sent on ${v.sentAt} and is not signed.` });
    if (v.status === 'review') out.push({ kind: 'agreement-review-waiting', ...who, detail: `A ${v.review?.kind === 'pdf' ? 'signed PDF' : 'scanned copy'} waits for your decision (check: ${v.review?.verdict}).` });
    if (v.notice?.objectedAt) out.push({ kind: 'agreement-objection-open', ...who, detail: `The counterparty objected on ${v.notice.objectedAt}: ${v.notice.objection ?? ''}`.slice(0, 600) });
    if (f && f.signedAt && now - Date.parse(f.signedAt) > 365 * DAY) out.push({ kind: 'agreement-measures-stale', ...who, detail: `Annex III was signed on ${f.signedAt}, over a year ago. Make a new version.` });
    const empty = MEASURE_AREAS.filter(area => !v.annexes.III.measures.some(m => m.area === area && m.text.trim()));
    if (empty.length && v.status === 'draft') out.push({ kind: 'agreement-measures-incomplete', ...who, detail: `Annex III says nothing about: ${empty.join(', ')}.` });
    if (f && a.ourRole === 'processor' && f.n === v.n) {
      const now4 = new Set(subprocessorsFor(a.product, processors, a.language).map(s => s.processorId));
      const signed4 = new Set(f.annexes.IV.subprocessors.filter(s => s.processorId).map(s => s.processorId));
      const added = [...now4].filter(x => !signed4.has(x));
      const removed = [...signed4].filter(x => !now4.has(x));
      if (added.length || removed.length) out.push({ kind: 'subprocessor-change-unannounced', ...who, detail: `The processor list ${added.length ? `adds ${added.join(', ')}` : ''}${added.length && removed.length ? ' and ' : ''}${removed.length ? `drops ${removed.join(', ')}` : ''} against Annex IV in force. Make a new version and announce it.` });
    }
  }
  // An open breach whose agreed hours have passed without a notice on any agreement in force.
  const breaches = (await readDoc(deps.storage, deps.config.nodeId, 'breaches', { kind: 'node' })).items.filter(b => b.status === 'open');
  const live = all.filter(a => !a.endedAt && inForce(a));
  if (live.length) {
    const hours = Math.min(...live.map(a => inForce(a)!.options.breachNoticeHours));
    for (const b of breaches) {
      const due = Date.parse(b.discoveredAt) + hours * 3_600_000;
      const told = live.some(a => a.history.some(h => h.event === 'breach-notice' && Date.parse(h.at) >= Date.parse(b.discoveredAt)));
      if (!told && due < now && b.riskToPeople !== 'none') out.push({ kind: 'breach-notice-overdue', detail: `Breach "${b.title}" (discovered ${b.discoveredAt}): no agreement's counterparty has been told, and the agreed ${hours} hours have passed.` });
    }
  }
  return out;
}

/** One pass of the clocks. Never throws: one agreement failing does not stop the others. */
export async function sweepAgreements(deps: Deps, now = Date.now()): Promise<{ reminded: number; finalized: number; synced: number }> {
  const res = { reminded: 0, finalized: 0, synced: 0 };
  let all: Agreement[];
  try { all = await listAgreements(deps.storage, deps.config.nodeId); } catch (err) { logger.warn('agreements sweep: list failed', { error: String(err) }); return res; }
  for (const a of all) {
    try {
      if (a.endedAt) continue;
      const v = newest(a);
      // A lapsed notice: write the version in force and tell it.
      if (v.status === 'sent' && v.notice && !v.notice.objectedAt && Date.parse(v.notice.objectionUntil) <= now) {
        const saved = await updateAgreement(deps.storage, deps.config.nodeId, a.id, cur => cur);
        if (saved && statusOf(saved) === 'signed') { res.finalized++; await tellAgreement(deps, saved, 'in-force'); }
        continue;
      }
      if (v.status === 'sent' && v.docsignId) { const s = await syncDocsign(deps, a); if (s !== a) res.synced++; }
      // Reminders: day 2 and day 7 for a signature, a week before an announced change takes effect.
      const due: Array<{ at: number; mark: string; ev: 'reminder' | 'notice-reminder'; days?: number }> = [];
      if (v.status === 'sent' && !v.notice && v.sentAt) {
        due.push({ at: Date.parse(v.sentAt) + 2 * DAY, mark: 'd2', ev: 'reminder', days: 2 }, { at: Date.parse(v.sentAt) + 7 * DAY, mark: 'd7', ev: 'reminder', days: 7 });
      }
      if (v.status === 'sent' && v.notice && !v.notice.objectedAt) due.push({ at: Date.parse(v.notice.objectionUntil) - 7 * DAY, mark: 'n7', ev: 'notice-reminder' });
      for (const d of due) {
        const stamp = `${new Date(d.at).toISOString().slice(0, 10)}T00:00:00.000Z`;
        if (d.at > now || v.remindersSent.includes(stamp)) continue;
        const saved = await updateAgreement(deps.storage, deps.config.nodeId, a.id, cur => {
          const n = newest(cur);
          if (n.n !== v.n || n.remindersSent.includes(stamp)) return UNCHANGED;
          return { ...cur, versions: [...cur.versions.slice(0, -1), { ...n, remindersSent: [...n.remindersSent, stamp].slice(-10) }], history: [...cur.history, historyEntry('system', d.ev, `Reminder ${d.mark}.`)].slice(-500) };
        });
        if (saved) { res.reminded++; await tellAgreement(deps, saved, d.ev, d.days ? { days: d.days } : {}); }
      }
    } catch (err) {
      logger.warn('agreements sweep: one agreement failed', { agreement: a.id, error: String(err) });
    }
  }
  return res;
}

/**
 * Run sweepAgreements hourly, the first time 150 s after boot (server-bootstrap/service-init.ts
 * calls this once). Hourly because the shortest clock is a day.
 */
export function scheduleAgreementSweep(deps: Deps): void {
  const run = () => {
    sweepAgreements(deps).catch(err => logger.warn('agreements sweep failed', { error: String(err) }));
  };
  setTimeout(run, 150_000);
  setInterval(run, 3_600_000);
}
