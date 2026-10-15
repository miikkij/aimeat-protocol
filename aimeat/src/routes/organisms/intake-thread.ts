/**
 * @file src/routes/organisms/intake-thread.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public routes of a conversation through an intake form: a visitor who is not
 *   signed in writes, reads the answers and can have the conversation deleted. The form owner's
 *   side (an agent, or a person in an app) answers by writing an ordinary workspace record, so
 *   these routes are the visitor's only. The records, the secret and the settings are in
 *   services/intake-thread.ts.
 *
 *   WHAT THE NODE DECIDES, so that no agent has to: how many conversations a form starts in a day
 *   (the form's `max_per_day`), how many turns one conversation takes, how long one turn is, how
 *   soon the next turn may come, and how many turns a day wake an agent. Every one of them is
 *   refused or decided before the write.
 *
 *   A TURN THAT WAKES NO AGENT IS STILL STORED. When a person has taken the conversation over, or
 *   the form's agent turns for the day are spent, the visitor's message is kept and no signal is
 *   written; the answer then says a person answers. The thread record carries `signalled_turn`,
 *   the last turn an agent was woken for, so the owner's app can list the conversations that wait
 *   for a person.
 *
 *   THE TOKEN IS IN THE BODY of every call, never in the address: addresses are logged, and a
 *   custom header would need its own cross-origin allowance. Reading is therefore a POST.
 * @structure
 *   POST /v1/intake/:org/:ws/:formId/thread         (PUBLIC) start, or with `token` add a turn
 *   POST /v1/intake/:org/:ws/:formId/thread/read    (PUBLIC) the conversation the token opens
 *   POST /v1/intake/:org/:ws/:formId/thread/forget  (PUBLIC) delete it: all three records, every version
 * @version-history
 *   2026-10-15 — The expiry sweep on a new conversation is gone: the scheduled job
 *     core:intake-thread-retention deletes by date, whatever state the form is in, and the
 *     forget route deletes through the same service (feature-list audit #64).
 *   v1.1.0 — 2026-10-13 — A turn asks the fenced-space rule (services/fenced-space.ts) for the
 *     identity the form stores, before anything is written: a form stored under an agent's identity
 *     writes nothing into a record space that names extensions (ruled by the developer on 2026-10-13).
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, P4:
 *     wish-el-v-keskustelu-kirjautumattoman-vierailijan-kanssa-p4-p-t-k).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { readPublishSpace } from '../../services/workspace-write-items.js';
import { readWorkspaceMetaRecord } from '../../services/workspace-meta.js';
import { fencedFormRefusal, FENCED_FORM_PUBLIC_MESSAGE } from '../../services/fenced-space.js';
import { takeDailySlot } from '../../services/intake-daily-count.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';
import {
  THREAD_DEFAULTS, MIN_TURN_INTERVAL_MS, newThreadToken, threadIdOf, cleanTurnText, turnsOfThread, replyState, composeTurns,
  type IntakeThreadConfig,
} from '../../services/intake-thread.js';
import { forgetThreadRecords } from '../../services/intake-thread-retention.js';
import type { OrganismHelpers } from './shared.js';

/** The part of a form's stored config these routes read (routes/organisms/intake.ts writes it). */
interface ThreadFormConfig {
  formId: string; namespace: string; ownerGhii: string; enabled: boolean;
  honeypotField: string | null; maxPerDay: number | null; thread?: IntakeThreadConfig | null;
}

export function registerOrganismIntakeThreadRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const { publishDraftsBatch } = H;
  const refuse = (res: Response, status: number, code: string, message: string) => { res.status(status).json(error(config.nodeId, code, message, status)); };

  /** A form that takes a conversation, or null: unknown, switched off, or an ordinary form. */
  async function readThreadForm(org: string, ws: string, formId: string): Promise<(ThreadFormConfig & { thread: IntakeThreadConfig }) | null> {
    const cfg = (await readWorkspaceMetaRecord(storage, org, ws, `meta.intake.${formId}`, config.nodeId))?.value as ThreadFormConfig | undefined;
    return cfg && cfg.enabled && cfg.thread ? cfg as ThreadFormConfig & { thread: IntakeThreadConfig } : null;
  }

  const baseKey = (org: string, ws: string, namespace: string, id: string) => `organism.${org}.w.${ws}.${namespace}.${id}`;

  /** The live value of one record, the freshest copy when more than one owner holds it. */
  async function latestOf(org: string, ws: string, namespace: string, id: string): Promise<MemoryRecord | null> {
    const key = `${baseKey(org, ws, namespace, id)}.latest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
    return items.filter((r) => r.key === key).reduce<MemoryRecord | null>((best, r) => (!best || r.updatedAt > best.updatedAt ? r : best), null);
  }

  /** Delete a conversation: the thread, the reply and the signal, with every version of each
   *  (services/intake-thread-retention.ts, which the scheduled retention job uses too). */
  function forgetThread(org: string, ws: string, cfg: ThreadFormConfig & { thread: IntakeThreadConfig }, id: string): Promise<number> {
    return forgetThreadRecords(storage, { org, ws, namespace: cfg.namespace, replyNamespace: cfg.thread.replyNamespace, signalNamespace: cfg.thread.signalNamespace }, id);
  }

  // One chain per form: a conversation's read, its checks and its write run before the next
  // request for the same form is read, so two turns that arrive together cannot both pass a cap
  // or write over each other.
  const chains = new Map<string, Promise<unknown>>();
  function inOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
    const ended = (): void => { if (chains.get(key) === tail) chains.delete(key); };
    const tail: Promise<void> = next.then(ended, ended);
    chains.set(key, tail);
    return next;
  }

  // Conversations past the form's keeping time are deleted by the scheduled job
  // core:intake-thread-retention (services/intake-thread-retention.ts), whatever state the form is
  // in. Until 2026-10-15 the deletion ran here, when a new conversation started, so a form nobody
  // wrote to, or one switched off or deleted, kept everything (feature-list audit #64).

  const params = (req: Request) => ({ org: req.params.org as string, ws: req.params.ws as string, formId: req.params.formId as string });

  /* ── POST …/thread — PUBLIC. Start a conversation, or with `token` add the visitor's next turn. ── */
  router.post('/v1/intake/:org/:ws/:formId/thread',
    rateLimit({ windowMs: 15 * 60_000, max: 60, keyBy: 'ip' }),
    async (req, res) => {
      const { org, ws, formId } = params(req);
      const cfg = await readThreadForm(org, ws, formId);
      if (!cfg) { refuse(res, 404, 'NOT_FOUND', 'Form not found'); return; }
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Honeypot: a filled hidden field is a bot. It is answered as a start and nothing is written.
      if (cfg.honeypotField && String(body[cfg.honeypotField] ?? '').trim() !== '') {
        res.json(success(config.nodeId, { ok: true, thread_token: null, turn: 0, turns_left: 0, handler: 'agent' })); return;
      }
      const cleaned = cleanTurnText(body.text, cfg.thread.maxChars);
      if (!cleaned.ok) { refuse(res, 400, 'INVALID_INPUT', cleaned.message); return; }
      const given = body.token;
      const id = given === undefined || given === null || given === '' ? null : threadIdOf(given);
      if (given && !id) { refuse(res, 404, 'THREAD_NOT_FOUND', 'No conversation opens with this token.'); return; }
      // A form whose spaces the workspace no longer declares writes nothing; the visitor is told
      // neither the namespace nor the workspace's spaces.
      for (const namespace of [cfg.namespace, cfg.thread.signalNamespace]) {
        const undeclared = (await readPublishSpace(storage, org, ws, namespace, { audience: 'public' })).refusal;
        if (undeclared) { res.status(undeclared.status).json(error(config.nodeId, undeclared.code, undeclared.message, undeclared.status, undeclared.details)); return; }
        // The turn and its signal are written as the identity the form stores, so the fenced-space
        // rule is asked for that identity (services/fenced-space.ts), as the ordinary submit asks it.
        const fenced = await fencedFormRefusal({ storage, config }, cfg.ownerGhii, undefined, org, ws, namespace);
        // In words that name neither the space nor the extension, as the ordinary submit answers.
        if (fenced) { refuse(res, fenced.status, fenced.code, FENCED_FORM_PUBLIC_MESSAGE); return; }
      }

      await inOrder(`${org}/${ws}/${formId}`, async () => {
        const now = new Date();
        const at = now.toISOString();
        let threadId: string;
        let token: string | null = null;
        let turns: Array<{ text: string; at: string }>;
        let startedAt = at;
        let expectedVersion = 0;
        let handler: 'agent' | 'person' = 'agent';
        let signalledTurn = 0;

        if (!id) {
          // START. The form's daily cap counts conversations; nothing is written past it.
          if (!(await takeDailySlot(storage, config.nodeId, { org, ws, formId }, cfg.maxPerDay ?? THREAD_DEFAULTS.maxThreadsPerDay))) {
            refuse(res, 429, 'INTAKE_DAILY_LIMIT', 'This form has started all the conversations it starts in one day. Try again tomorrow.'); return;
          }
          token = newThreadToken();
          threadId = threadIdOf(token) as string;
          turns = [{ text: cleaned.text, at }];
        } else {
          // NEXT TURN of the conversation the token opens.
          threadId = id;
          const existing = await latestOf(org, ws, cfg.namespace, threadId);
          if (!existing || (existing.value as { form_id?: unknown } | null)?.form_id !== formId) {
            refuse(res, 404, 'THREAD_NOT_FOUND', 'No conversation opens with this token.'); return;
          }
          const state = replyState((await latestOf(org, ws, cfg.thread.replyNamespace, threadId))?.value);
          if (state.closed) { refuse(res, 409, 'THREAD_CLOSED', 'This conversation is closed. Start a new one to write again.'); return; }
          const before = turnsOfThread(existing.value);
          if (before.length >= cfg.thread.maxTurns) {
            refuse(res, 429, 'THREAD_FULL', `This conversation has taken all ${cfg.thread.maxTurns} of its messages. Start a new one to write again.`); return;
          }
          const last = before.length ? Date.parse(before[before.length - 1].at) : 0;
          if (now.getTime() - last < MIN_TURN_INTERVAL_MS) { refuse(res, 429, 'THREAD_TOO_FAST', 'Wait a moment before the next message.'); return; }
          const held = existing.value as { started_at?: unknown; signalled_turn?: unknown };
          startedAt = typeof held.started_at === 'string' ? held.started_at : at;
          signalledTurn = typeof held.signalled_turn === 'number' ? held.signalled_turn : 0;
          expectedVersion = existing.version;
          handler = state.handler;
          turns = [...before.map((t) => ({ text: t.text, at: t.at })), { text: cleaned.text, at }];
        }

        // Whether this turn wakes an agent: only while an agent answers, and only while the form
        // has agent turns left today. Decided before the write, so the record says what happened.
        const turn = turns.length;
        const wakes = handler === 'agent'
          && await takeDailySlot(storage, config.nodeId, { org, ws, formId: `${formId}.turns` }, cfg.thread.maxAgentTurnsPerDay);
        const record = { id: threadId, form_id: formId, started_at: startedAt, updated_at: at, turns, signalled_turn: wakes ? turn : signalledTurn };
        const out = await publishDraftsBatch(org, ws, cfg.namespace, [threadId], cfg.ownerGhii, { [threadId]: expectedVersion },
          { [threadId]: { value: record, visibility: 'owner' } });
        const result = out.results[0];
        if (out.refusal || !result?.ok) {
          const conflict = result?.code === 'VERSION_CONFLICT' || result?.code === 'EXISTS';
          logger.warn('Intake thread: the turn was not stored', { event: 'intake.thread_refused', org, ws, form: formId, code: out.refusal?.code ?? result?.code });
          refuse(res, conflict ? 409 : 422, conflict ? 'THREAD_BUSY' : 'THREAD_NOT_STORED',
            conflict ? 'The conversation changed while this message arrived. Send it again.' : 'This form cannot store the message. Its owner has to correct the form.');
          return;
        }
        if (wakes) {
          const signal = await publishDraftsBatch(org, ws, cfg.thread.signalNamespace, [threadId], cfg.ownerGhii, undefined,
            { [threadId]: { value: { id: threadId, thread: threadId, turn, at }, visibility: 'owner' } });
          if (signal.refusal || !signal.results[0]?.ok) {
            // The message is stored and no agent was woken: the owner's list shows it as waiting.
            logger.warn('Intake thread: the signal was not stored, so no agent is woken for this turn', {
              event: 'intake.thread_signal_refused', org, ws, form: formId, code: signal.refusal?.code ?? signal.results[0]?.code,
            });
          }
        }
        emitChange('organisms');
        res.json(success(config.nodeId, {
          ok: true,
          // Given once, at the start. It opens the conversation for reading, writing and deleting.
          ...(token ? { thread_token: token } : {}),
          turn,
          turns_left: Math.max(0, cfg.thread.maxTurns - turn),
          // Who answers this turn: an agent, or a person when one took the conversation over or the
          // form's agent turns for today are spent.
          handler: wakes ? 'agent' : 'person',
        }));
      });
    });

  /* ── POST …/thread/read — PUBLIC. The conversation the token opens: both sides' turns, and its state. ── */
  router.post('/v1/intake/:org/:ws/:formId/thread/read',
    rateLimit({ windowMs: 15 * 60_000, max: 1200, keyBy: 'ip' }),
    async (req, res) => {
      const { org, ws, formId } = params(req);
      const cfg = await readThreadForm(org, ws, formId);
      const id = threadIdOf((req.body ?? {}).token);
      const thread = cfg && id ? await latestOf(org, ws, cfg.namespace, id) : null;
      // One answer for an unknown form, an unknown token and another form's conversation.
      if (!cfg || !id || !thread || (thread.value as { form_id?: unknown } | null)?.form_id !== formId) {
        refuse(res, 404, 'THREAD_NOT_FOUND', 'No conversation opens with this token.'); return;
      }
      const state = replyState((await latestOf(org, ws, cfg.thread.replyNamespace, id))?.value);
      const visitorTurns = turnsOfThread(thread.value);
      res.json(success(config.nodeId, {
        turns: composeTurns(visitorTurns, state.replies),
        handler: state.handler,
        closed: state.closed,
        turns_left: Math.max(0, cfg.thread.maxTurns - visitorTurns.length),
      }));
    });

  /* ── POST …/thread/forget — PUBLIC. Delete the conversation the token opens, on both sides. ── */
  router.post('/v1/intake/:org/:ws/:formId/thread/forget',
    rateLimit({ windowMs: 15 * 60_000, max: 30, keyBy: 'ip' }),
    async (req, res) => {
      const { org, ws, formId } = params(req);
      const cfg = await readThreadForm(org, ws, formId);
      const id = threadIdOf((req.body ?? {}).token);
      const thread = cfg && id ? await latestOf(org, ws, cfg.namespace, id) : null;
      if (!cfg || !id || !thread || (thread.value as { form_id?: unknown } | null)?.form_id !== formId) {
        refuse(res, 404, 'THREAD_NOT_FOUND', 'No conversation opens with this token.'); return;
      }
      await inOrder(`${org}/${ws}/${formId}`, async () => { await forgetThread(org, ws, cfg, id); });
      emitChange('organisms');
      res.json(success(config.nodeId, { forgotten: true }));
    });
}
