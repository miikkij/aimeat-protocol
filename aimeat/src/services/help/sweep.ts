/**
 * @file src/services/help/sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hourly round of Ask someone who knows (core job `help-sweep`), and the answer to
 *   "how does this go stale" for everything the feature keeps:
 *   - a helper who has not answered in `helpRerouteHours` is skipped and the next one asked; when
 *     nobody is left, the asker is told and offered the shared list;
 *   - a day before a question's deadline the asker is asked whether to continue;
 *   - an open question past its deadline expires; an answered one nobody closed expires 30 days later;
 *   - a kept answer its helper has not confirmed in `helpReviewMonths` is marked out of date, and the
 *     AI offers it last;
 *   - closed questions not kept for others are deleted 90 days after they closed;
 *   - on the first of the month, a helper whose topic nobody asked about in `helpTopicReviewDays` is
 *     asked whether to keep it.
 * @structure runHelpSweep
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';
import { sendStatusLine } from './delivery.js';
import { routeOnward } from './respond.js';
import { emitHelpChange, runHelpHook } from './events.js';
import { addDays, addHours, topicsMatch, ANSWERED_GRACE_DAYS, CLOSED_RETENTION_DAYS, type HelpDeps } from './rules.js';

export interface HelpSweepResult { rerouted: number; nobody: number; reminded: number; expired: number; staled: number; purged: number; topicNotices: number }

export async function runHelpSweep(deps: HelpDeps, nowDate: Date = new Date()): Promise<HelpSweepResult> {
  const out: HelpSweepResult = { rerouted: 0, nobody: 0, reminded: 0, expired: 0, staled: 0, purged: 0, topicNotices: 0 };
  if (!deps.config.helpEnabled) return out;
  const { storage, config } = deps;
  const now = nowDate.toISOString();

  // 1. Helpers who did not answer in time: the next one is asked.
  for (const r of await storage.listPendingHelpRoutes(addHours(now, -config.helpRerouteHours), { limit: 500 })) {
    const q = await storage.getHelpQuestion(r.questionId);
    if (!q || (q.state !== 'open' && q.state !== 'answered')) {
      await storage.updateHelpRoute({ ...r, outcome: 'closed', outcomeAt: now });
      continue;
    }
    await storage.updateHelpRoute({ ...r, outcome: 'timeout', outcomeAt: now });
    if (q.state === 'answered') continue;
    if (await routeOnward(deps, q)) { out.rerouted++; continue; }
    const pending = (await storage.listHelpRoutes(q.id)).some(x => x.outcome === 'pending');
    if (pending) continue;
    out.nobody++;
    await notify(storage, q.ownerGhii, {
      type: 'help_nobody', title: `Nobody has answered yet: ${q.subject}`,
      body: config.helpBoardEnabled ? 'You can put the question on the shared list, where any helper can take it.' : 'You can wait, change the question, or close it.',
      link: '/v1/profile?tab=help',
      i18n: { key: config.helpBoardEnabled ? 'help_nobody_board' : 'help_nobody', vars: { subject: q.subject } },
    });
    emitHelpChange(q.ownerGhii);
  }

  // 2. A day before the deadline: continue, move to the shared list, or close?
  for (const q of await storage.listHelpQuestionsDue(['open', 'answered'], addDays(now, 1), { limit: 500 })) {
    if (q.remindedAt || q.deadline <= now) continue;
    if (!(await storage.updateHelpQuestion({ ...q, remindedAt: now, updatedAt: now }, q.version))) continue;
    out.reminded++;
    await notify(storage, q.ownerGhii, {
      type: 'help_deadline', title: `Your question ends tomorrow: ${q.subject}`,
      body: q.state === 'answered' ? 'Was it solved? Mark it solved and thank your helper, or give it more time.' : 'Give it more time, put it on the shared list, or close it.',
      link: '/v1/profile?tab=help',
      i18n: { key: q.state === 'answered' ? 'help_deadline_answered' : 'help_deadline', vars: { subject: q.subject } },
    });
  }

  // 3. Expiry: open questions at their deadline; answered ones nobody closed, a grace period later.
  const expiring = [
    ...(await storage.listHelpQuestionsDue(['open'], now, { limit: 500 })),
    ...(await storage.listHelpQuestionsDue(['answered'], addDays(now, -ANSWERED_GRACE_DAYS), { limit: 500 })),
  ];
  for (const q of expiring) {
    if (!(await storage.updateHelpQuestion({ ...q, state: 'expired', closedAt: now, updatedAt: now }, q.version))) continue;
    out.expired++;
    const routes = await storage.listHelpRoutes(q.id);
    for (const r of routes.filter(x => x.outcome === 'pending')) {
      await storage.updateHelpRoute({ ...r, outcome: 'closed', outcomeAt: now });
      await sendStatusLine(deps, q, r, 'help.msg.expired').catch(err => logger.warn('help: expiry line not sent', { error: String(err) }));
    }
    await notify(storage, q.ownerGhii, {
      type: 'help_expired', title: `Your question ended without an answer: ${q.subject}`,
      body: 'Ask again with other words or topics, or ask someone you know directly.',
      link: '/v1/profile?tab=help', i18n: { key: 'help_expired', vars: { subject: q.subject } },
    });
    emitHelpChange(q.ownerGhii, ...routes.map(r => r.helperGhii));
    runHelpHook(deps, 'post_help_solved', { question_id: q.id, state: 'expired', topics: q.topics });
  }

  // 4. Kept answers nobody confirmed: marked out of date, their helper asked once.
  const reviewBefore = addDays(now, -30 * config.helpReviewMonths);
  for (const q of await storage.listHelpQuestions({ saved: true, states: ['solved'], limit: 1000 })) {
    if (q.stale || !q.answeredBy || (q.savedConfirmedAt ?? q.closedAt ?? now) > reviewBefore) continue;
    if (!(await storage.updateHelpQuestion({ ...q, stale: true, updatedAt: now }, q.version))) continue;
    out.staled++;
    await notify(storage, q.answeredBy, {
      type: 'help_review', title: `Does your kept answer still hold? ${q.subject}`,
      body: 'Confirm it, and the next person who asks gets it first. Unconfirmed, it is offered last.',
      link: '/v1/profile?tab=help', i18n: { key: 'help_review', vars: { subject: q.subject } },
    });
  }

  // 5. Closed questions not kept for others leave after the retention period.
  out.purged = await storage.purgeClosedHelpQuestions(addDays(now, -CLOSED_RETENTION_DAYS));

  // 6. Monthly, on the first at 06 UTC: topics nobody asked about.
  if (nowDate.getUTCDate() === 1 && nowDate.getUTCHours() === 6) {
    const since = addDays(now, -config.helpTopicReviewDays);
    for (const p of await storage.listHelpers({ limit: 1000 })) {
      if (p.topics.length === 0 || p.createdAt > since) continue;
      const routes = await storage.listHelpRoutesForHelper(p.ownerGhii, { since, limit: 500 });
      const asked = new Set<string>();
      for (const id of new Set(routes.map(r => r.questionId))) {
        const q = await storage.getHelpQuestion(id);
        for (const t of q?.topics ?? []) asked.add(t);
      }
      const quiet = p.topics.filter(t => ![...asked].some(a => topicsMatch(a, t)));
      if (quiet.length === 0) continue;
      out.topicNotices++;
      await notify(storage, p.ownerGhii, {
        type: 'help_topics', title: 'Nobody asked you about some of your topics',
        body: `${quiet.slice(0, 5).join(', ')}. Keep them, or take them off.`,
        link: '/v1/profile?tab=help', i18n: { key: 'help_topics', vars: { topics: quiet.slice(0, 5).join(', ') } },
      });
    }
  }
  return out;
}
