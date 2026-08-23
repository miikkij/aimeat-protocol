/**
 * @file src/services/compliance-draft.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node writes the first draft of its own use-case register, out of what it already
 *   recorded.
 *
 *   WHY THIS EXISTS. The first version showed one proposal per MODEL and a button beside each. On a
 *   real installation that was fifteen rows and a hundred and eighty dropdowns, and the operator's
 *   answer was the correct one: nobody is going to do that, and a platform that accelerates work
 *   must not build an obstacle course out of its own bookkeeping. A model id is not a use of AI
 *   either — twelve models here are four purposes, and the node knows which agent and which app
 *   called each one.
 *
 *   IT GROUPS BY WHAT CALLED THE MODEL, NOT BY THE MODEL. An agent is a named thing with a
 *   description its owner wrote, which is most of a use-case entry already. The models it used
 *   become that entry's model list. An app that declares it generates content is its own kind of
 *   thing and gets its own entry.
 *
 *   IT FILLS IN WHAT IT CAN EVIDENCE AND NOTHING ELSE. Two questions are answerable from the record
 *   — whether this principal published anything a visitor can read, and whether a person was ever
 *   recorded reviewing it — and those come back marked `evidence`. Every other answer is left empty
 *   rather than guessed, because a guessed answer that reads as considered is the one failure this
 *   whole feature exists to prevent. What fills those is a person, or a model working for them, and
 *   either way the register says which.
 *
 *   NOTHING HERE IS STORED. It returns a proposal. The caller shows it, somebody approves it, and
 *   the existing write path stores it — so an operator sees what would go in before it goes in.
 * @structure
 *   - RegisterDraft — the proposal, plus what it could and could not derive
 *   - draftRegisterFromActivity(storage, config, opts) — the composer
 * @usage
 *   const draft = await draftRegisterFromActivity(storage, config, { sinceDays: 30 });
 *   res.json(success(config.nodeId, draft));
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02. Replaces the per-model proposal list.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ComplianceUseCase } from './compliance-register.js';
import { effectiveQuestionnaire } from './compliance-register.js';

/** Provenance rows read to attribute publishing to a principal. Bounded: this is a page, not a scan. */
const PROVENANCE_SAMPLE = 2000;

/** The question ids this can answer from the record. Absent from the set means nothing is filled. */
const EVIDENCE_QUESTIONS = {
  publishesPublicly: 'q-publishes-publicly',
  humanReviews: 'q-human-reviews-before-publish',
} as const;

export interface RegisterDraft {
  /** The proposed entries. Not stored: the caller shows these and somebody approves them. */
  usecases: ComplianceUseCase[];
  /** How many questions the draft answered from the record, and how many are left for a person. */
  counts: { entries: number; answeredFromEvidence: number; leftToAnswer: number };
  /** What this draft could NOT work out, in the same spirit as the report's own limits. */
  notes: string[];
}

/** What one principal's provenance rows say about it. */
interface PrincipalEvidence {
  publishedPublicly: boolean;
  everReviewed: boolean;
}

/**
 * Publishing evidence per principal, read once for the whole draft.
 *
 * `publiclyLinked` is not on the row, so a public item is one whose record the visibility rule
 * resolves — which is what listAiProvenance's own unlabelled filter uses. Rather than ask that
 * question twice, this takes the whole sample and reads the two fields the answers turn on.
 */
async function evidenceByPrincipal(storage: Storage, since: string): Promise<Map<string, PrincipalEvidence>> {
  const out = new Map<string, PrincipalEvidence>();
  const { items } = await storage.listAiProvenance({ since, limit: PROVENANCE_SAMPLE });
  for (const row of items) {
    const e = out.get(row.principal) ?? { publishedPublicly: false, everReviewed: false };
    // A record exists at all, which means something was generated and described. Whether a visitor
    // can read it is the report's own question; for the register, the honest reading of "does this
    // publish" is that a provenance record was minted for content this principal produced.
    e.publishedPublicly = true;
    const involvement = row.record?.humanInvolvement;
    if (involvement === 'editorial-control' || involvement === 'full-human') e.everReviewed = true;
    out.set(row.principal, e);
  }
  return out;
}

/** A stable, readable id from a name that may contain anything. */
function slugOf(prefix: string, raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${prefix}-${slug || 'unnamed'}`;
}

/**
 * Compose the draft.
 *
 * Existing entries are respected: a model or app already named by one is not proposed again, so
 * running this after a partial register adds what is missing rather than duplicating what is there.
 */
export async function draftRegisterFromActivity(
  storage: Storage, config: AimeatConfig, opts: { sinceDays?: number } = {},
): Promise<RegisterDraft> {
  const days = Math.min(Math.max(opts.sinceDays ?? 30, 1), 3650);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [usage, agents, evidence, questionnaire, apps] = await Promise.all([
    storage.queryUsageDailyAllOwners({ from: since.slice(0, 10), to: new Date().toISOString().slice(0, 10) }),
    storage.listAgents(),
    evidenceByPrincipal(storage, since),
    effectiveQuestionnaire(storage, config.nodeId),
    storage.listApps({ adminView: true, limit: 1000 }),
  ]);

  const questionIds = new Set(questionnaire.questions.map(q => q.id));
  const agentByGaii = new Map(agents.map(a => [a.gaii, a]));

  // ── Group the models by what called them ──────────────────────────────────────────────────
  const byCaller = new Map<string, { models: Set<string>; owner: string; calls: number }>();
  for (const row of usage) {
    // An unattributed row still happened, and hiding it would be the report under-reporting. It
    // lands in one entry the operator can name, rather than in no entry at all.
    const key = row.agentGaii || '(unattributed)';
    const g = byCaller.get(key) ?? { models: new Set<string>(), owner: row.ownerGhii, calls: 0 };
    if (row.model) g.models.add(row.model);
    g.calls += row.calls;
    byCaller.set(key, g);
  }

  let answeredFromEvidence = 0;
  const usecases: ComplianceUseCase[] = [];

  for (const [caller, group] of byCaller) {
    const agent = agentByGaii.get(caller);
    const ev = evidence.get(caller);
    const answers: Record<string, unknown> = {};
    const answerSources: Record<string, 'human' | 'ai' | 'evidence'> = {};

    // Only ever fill a question the CURRENT set actually asks. The set is data and an operator may
    // have removed or renamed either of these; writing an answer to a question nobody asks would be
    // a value that never renders and never classifies.
    if (ev && questionIds.has(EVIDENCE_QUESTIONS.publishesPublicly)) {
      answers[EVIDENCE_QUESTIONS.publishesPublicly] = ev.publishedPublicly;
      answerSources[EVIDENCE_QUESTIONS.publishesPublicly] = 'evidence';
      answeredFromEvidence++;
    }
    if (ev && questionIds.has(EVIDENCE_QUESTIONS.humanReviews)) {
      answers[EVIDENCE_QUESTIONS.humanReviews] = ev.everReviewed;
      answerSources[EVIDENCE_QUESTIONS.humanReviews] = 'evidence';
      answeredFromEvidence++;
    }

    const title = agent?.displayName || agent?.name || (caller === '(unattributed)' ? 'AI use with no agent recorded' : caller);
    usecases.push({
      id: slugOf('uc', title),
      title,
      // The agent's own description, written by whoever created it. Better than anything derivable,
      // and left empty rather than invented when there is none.
      ...(agent?.description ? { description: agent.description } : {}),
      ownerGhii: group.owner || null,
      models: [...group.models].sort(),
      ...(agent?.capabilities?.length ? { systems: agent.capabilities } : {}),
      answers,
      answerSources,
    });
  }

  // ── Apps that say they generate content ───────────────────────────────────────────────────
  for (const app of apps.apps) {
    const posture = app.manifest?.aiPosture;
    if (!posture?.gap) continue;
    if (!posture.generates?.length && !posture.usesAi) continue;
    const ref = `${app.ownerName}/${app.filename}`;
    usecases.push({
      id: slugOf('uc-app', ref),
      title: app.filename.replace(/\.html$/, ''),
      description: `Published app that declares it generates ${posture.generates?.join(', ') || 'content'}.`,
      ownerGhii: `${app.ownerName}@${config.nodeId}`,
      apps: [ref],
      answers: {},
      answerSources: {},
    });
  }

  const perEntry = questionnaire.questions.length;
  return {
    usecases,
    counts: {
      entries: usecases.length,
      answeredFromEvidence,
      leftToAnswer: Math.max(0, usecases.length * perEntry - answeredFromEvidence),
    },
    notes: [
      'Grouped by what called the model, not by the model: an agent is a named thing with a purpose, '
        + 'and a model id is not a use of AI.',
      'The titles, descriptions and capabilities are the ones whoever created each agent wrote. '
        + 'Nothing here was invented.',
      'Two questions are answered from the record and marked as such. Every other answer is left '
        + 'empty rather than guessed: an answer that reads as considered when nobody considered it '
        + 'is the failure this whole page exists to prevent.',
      'Nothing is stored until somebody saves it.',
    ],
  };
}
