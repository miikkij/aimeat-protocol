/**
 * @file src/services/app/acceptance-criteria.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The acceptance criteria of an app: what "correct" means for it, one line each, kept in
 *   its design spec record (services/app/design-spec.ts, field `criteria`) and checked at publish.
 *
 *   WHY. A builder of any vendor (Claude Code, Codex, a chat AI) could say what an app should do only
 *   in prose, and nothing tied a stated requirement to a check, so "done means all of what was
 *   agreed" depended on the model reading it. Google's paper "The New SDLC With Vibe Coding" (May
 *   2026) puts success criteria and the checks for them at the centre of agentic engineering; Kiro's
 *   requirements file does the same with one line per behaviour.
 *
 *   ONE LINE IS one behaviour in one sentence, a check kind (how it is proven: the publish lint, a
 *   playtest scenario, a screenshot, an eval, or a person looking) and a status: `open`, `evidenced`
 *   (with the evidence: the scenario that passed, the screenshot address, the command and its output)
 *   or `waived` (with the reason). The node stamps who evidenced or waived a line, when, and at which
 *   app version.
 *
 *   WHO. Everybody inside the build writes the list (the owner, the owner's agents, a development
 *   right), as they write the spec. A waiver says "we ship without this", which is the owner's call,
 *   so a builder of another account is refused when a line it writes is newly waived.
 *
 *   THE GATE. At the finest level (`<meta name="aimeat-level" content="fine">`, or no level, which is
 *   held to fine) an update with an open line is refused with the other owed items (APP_OWES_ITEMS,
 *   item `criteria`, services/app/owed-gate.ts). At `proto` and `plain` the publish answer only
 *   counts them. The gate reads the lines; it does not judge the evidence, which stays readable to
 *   the owner in the spec.
 * @structure AppCriterion · checkCriteria(input, live) · criteriaCounts(list) · openCriteriaIds(spec)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-acceptance-criteria-in-the-design-spec-checked-at-publish).
 */

export const CRITERION_CHECKS = ['lint', 'scenario', 'screenshot', 'eval', 'person'] as const;
export const CRITERION_STATUSES = ['open', 'evidenced', 'waived'] as const;
export type CriterionCheck = typeof CRITERION_CHECKS[number];
export type CriterionStatus = typeof CRITERION_STATUSES[number];

/** At most this many lines: a list longer than that is a test plan, which belongs in a workspace. */
export const CRITERIA_MAX = 50;
const TEXT_MAX = 400;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface AppCriterion {
  /** Short and stable: `empty-state`, `phone-layout`. Evidence and scenarios name it. */
  id: string;
  /** One behaviour, one sentence (Given/When/Then is fine). */
  text: string;
  check: CriterionCheck;
  status: CriterionStatus;
  /** Required when `evidenced`: what proved it. */
  evidence?: string;
  evidencedBy?: string;
  evidencedAt?: string;
  /** The app version that was live when the line was evidenced. */
  evidencedVersion?: number;
  /** Required when `waived`: why the app ships without it. */
  waivedReason?: string;
  waivedBy?: string;
  waivedAt?: string;
}

type Checked = { ok: true; criteria: AppCriterion[]; newlyWaived: string[] } | { ok: false; message: string };

/**
 * Read a written list against the stored one: shapes and bounds, unique ids, evidence for every
 * evidenced line and a reason for every waived one. A line whose status and its words did not change
 * keeps its stamps; a line that became evidenced or waived is stamped with `by`, now and `appVersion`.
 */
export function checkCriteria(
  input: unknown, live: readonly AppCriterion[], stamp: { by: string; appVersion: number; now?: string },
): Checked {
  if (!Array.isArray(input)) return { ok: false, message: 'criteria is the whole list: an array of { id, text, check, status, evidence?, waived_reason? }.' };
  if (input.length > CRITERIA_MAX) return { ok: false, message: `At most ${CRITERIA_MAX} criteria; a longer list belongs in a workspace test plan.` };
  const now = stamp.now ?? new Date().toISOString();
  const before = new Map(live.map(c => [c.id, c]));
  const seen = new Set<string>();
  const out: AppCriterion[] = [];
  const newlyWaived: string[] = [];
  for (const [i, raw] of input.entries()) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const at = `criteria[${i}]`;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!ID_RE.test(id)) return { ok: false, message: `${at}.id is a short lowercase name (letters, digits, hyphens, at most 40), such as "empty-state".` };
    if (seen.has(id)) return { ok: false, message: `${at}.id "${id}" is used twice.` };
    seen.add(id);
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text || text.length > TEXT_MAX) return { ok: false, message: `${at}.text is one behaviour in one sentence, at most ${TEXT_MAX} characters.` };
    const check = r.check as CriterionCheck;
    if (!CRITERION_CHECKS.includes(check)) return { ok: false, message: `${at}.check is one of ${CRITERION_CHECKS.join(', ')}: how the line is proven.` };
    const status = (r.status ?? 'open') as CriterionStatus;
    if (!CRITERION_STATUSES.includes(status)) return { ok: false, message: `${at}.status is one of ${CRITERION_STATUSES.join(', ')}.` };
    const line: AppCriterion = { id, text, check, status };
    const prev = before.get(id);
    if (status === 'evidenced') {
      const evidence = typeof r.evidence === 'string' ? r.evidence.trim() : '';
      if (!evidence || evidence.length > TEXT_MAX) return { ok: false, message: `${at} is evidenced, so evidence says what proved it (the scenario that passed, the screenshot address, the command and its output), at most ${TEXT_MAX} characters.` };
      const kept = prev?.status === 'evidenced' && prev.evidence === evidence && prev.text === text;
      Object.assign(line, { evidence }, kept
        ? { evidencedBy: prev.evidencedBy, evidencedAt: prev.evidencedAt, evidencedVersion: prev.evidencedVersion }
        : { evidencedBy: stamp.by, evidencedAt: now, evidencedVersion: stamp.appVersion });
    }
    if (status === 'waived') {
      const reason = typeof r.waived_reason === 'string' ? r.waived_reason.trim() : '';
      if (!reason || reason.length > TEXT_MAX) return { ok: false, message: `${at} is waived, so waived_reason says why the app ships without it, at most ${TEXT_MAX} characters.` };
      const kept = prev?.status === 'waived' && prev.waivedReason === reason && prev.text === text;
      if (!kept) newlyWaived.push(id);
      Object.assign(line, { waivedReason: reason }, kept
        ? { waivedBy: prev.waivedBy, waivedAt: prev.waivedAt }
        : { waivedBy: stamp.by, waivedAt: now });
    }
    out.push(line);
  }
  return { ok: true, criteria: out, newlyWaived };
}

/** How many lines are in each status. */
export function criteriaCounts(list: readonly AppCriterion[] | undefined): Record<CriterionStatus, number> & { total: number } {
  const counts = { open: 0, evidenced: 0, waived: 0, total: list?.length ?? 0 };
  for (const c of list ?? []) counts[c.status]++;
  return counts;
}

/** The ids of the open lines, in list order. */
export function openCriteriaIds(spec: { criteria?: readonly AppCriterion[] } | null | undefined): string[] {
  return (spec?.criteria ?? []).filter(c => c.status === 'open').map(c => c.id);
}
