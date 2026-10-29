/**
 * @file src/services/compliance-ask-makers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node asks the maker of an app that uses AI to answer the EU AI Act questions for
 *   it, when nobody has: one message a day at most, per maker, naming their unanswered apps.
 *
 *   WHY THE MAKER. The node finds every app that uses AI by itself (compliance-app-signals.ts), but
 *   whether TalentGrid decides about people, or CV Parser only reformats, is something only the
 *   person who built it knows. On innokas.aimeat.io (2026-10-28) twelve such apps sat in the draft
 *   with 130 questions open and one administrator to answer them. Jouni: the maker answers for their
 *   own app, through their own AI or on the app's page, and the administrator approves; when the
 *   answers are missing, the node sends a notification and an internal message so that answering is
 *   easy.
 *
 *   WHAT IS ASKED. An app counts as unanswered when it uses AI, its data map's `aiAct` leaves a
 *   question of the node's set open, and the stored register has not answered that question for it
 *   either. One direct message per maker lists their apps with a link to each app's page and a
 *   ready prompt for their own AI; the message raises the bell like any other. It is written in the
 *   maker's own language (their account's `locale`) and comes from the administrator's account,
 *   because the administrator is who asks and who reads the reply.
 *
 *   HOW OFTEN. The same app is asked again after REASK_DAYS, never sooner; the dates live in one
 *   record beside the register (`compliance.makerAsks`), written on its version. A maker who answers
 *   stops being asked.
 * @structure REASK_DAYS · unansweredApps() · askMakersForAiAct()
 * @usage scheduler core handler 'compliance-ask-makers' (core-jobs.ts), daily
 *   THE DATA MAP TOO (2026-10-29). Who can see an app's data is read from its data map
 *   (compliance-app-reach.ts), so an app with no map, a map in words the node does not know, or
 *   unsaid personal data that others can read is asked about in the same message, AI or not.
 * @version-history
 *   v1.1.0 — 2026-10-29 — Only the questions the node asks of an app count as open (askedWhen); an
 *     app whose data map cannot say who sees its data is asked to fix it in the same message.
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appAiSignals } from './compliance-app-signals.js';
import { appReach } from './compliance-app-reach.js';
import { askedQuestions, effectiveQuestionnaire, readUseCases, systemGhiiFor } from './compliance-register.js';
import { readAppDataMap } from './data-map/data-map-store.js';
import { findOperatorGhii } from './operators.js';
import { sendDirectMessage } from './message-send.js';
import { updateRecord } from './record-cas.js';
import { createT, toLocale } from '../i18n.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Days before the same app is asked again. */
export const REASK_DAYS = 14;
const ASKS_KEY = 'compliance.makerAsks';
const APP_SCAN = 1000;

export interface UnansweredApp {
  /** `owner/filename.html`. */
  ref: string;
  owner: string;
  title: string;
  /** How many of the questions the node asks of it are still open; 0 for an app that uses no AI. */
  open: number;
  /** It has no data map, so nobody can say who sees its data. */
  noMap: boolean;
  /** Key families whose location or readers are words the node does not know. */
  unreadable: string[];
  /** Key families others can read whose map does not say whether they hold personal data. */
  unstated: string[];
}

/**
 * Every app with something only its maker can fill in: an AI Act question the node asks of it that
 * neither its maker nor the stored register has answered, or a data map that cannot say who sees the
 * app's data (none, words the node does not know, or unsaid personal data that others can read).
 */
export async function unansweredApps(storage: Storage, config: AimeatConfig): Promise<UnansweredApp[]> {
  const [apps, questionnaire, stored] = await Promise.all([
    storage.listApps({ adminView: true, limit: APP_SCAN }),
    effectiveQuestionnaire(storage, config.nodeId),
    readUseCases(storage, config.nodeId),
  ]);
  const savedFor = new Map<string, Record<string, unknown>>();
  for (const u of stored) for (const ref of u.apps ?? []) savedFor.set(ref.toLowerCase(), u.answers ?? {});
  const out: UnansweredApp[] = [];
  for (const app of apps.apps) {
    const owner = localAccountName(app.ownerName ?? app.ownerGaii ?? '');
    if (!owner) continue;
    const map = await readAppDataMap(storage, `${owner}@${config.nodeId}`, app.filename.replace(/\.html$/i, ''));
    const ref = `${owner}/${app.filename}`;
    let open = 0;
    if (appAiSignals(map, app.manifest?.aiPosture).usesAi) {
      // The saved answers win, the maker's fill the rest; only the questions those make the node ask
      // (askedWhen) count: outside an Annex III area that is three, not twelve.
      const answers = { ...(map?.aiAct?.answers ?? {}), ...savedFor.get(ref.toLowerCase()) };
      const asked = askedQuestions(questionnaire, answers);
      open = questionnaire.questions.filter(q => asked.get(q.id) === 'asked' && answers[q.id] === undefined).length;
    }
    const reach = appReach(map);
    const row: UnansweredApp = {
      ref, owner, title: app.manifest?.name || app.filename.replace(/\.html$/i, ''), open,
      noMap: !reach.hasMap, unreadable: reach.unreadable.map(r => r.what), unstated: reach.personalUnstated,
    };
    if (row.open > 0 || row.noMap || row.unreadable.length || row.unstated.length) out.push(row);
  }
  return out;
}

/** The prompt a maker pastes into their own AI. English, like every prompt here; the AI answers in the person's language. */
function makerPrompt(nodeUrl: string, refs: string[], withMaps: boolean): string {
  return [
    `On my AIMEAT node ${nodeUrl}, answer the EU AI Act questions for my app${refs.length > 1 ? 's' : ''} ${refs.join(', ')}.`,
    'For each app: call aimeat_datamap_get with the app; its `ai_act` lists the questions and which are unanswered.',
    'Read the app and its data map, then propose an answer to every question with one or two sentences saying why.',
    'Show me the answers and wait for my yes. Then write them into the app\'s data map as',
    '`aiAct`: { "answers": { "<question id>": true | false | "<option value>" }, "notes": { "<question id>": "why" } }',
    'with aimeat_datamap_set, sending the whole map back with `aiAct` added.',
    ...(withMaps ? [
      'Some of these apps have no data map, or a map that does not say who can see their data. For each of those, read the app,',
      'write the map with aimeat_datamap_set, with `where`, `readers` and `personalData` in the words',
      'aimeat_handbook_get { tier: "build-app/data-map" } lists, and show me the map before you write it.',
    ] : []),
  ].join('\n');
}

/** One app's line in the message: what is open for it, in the maker's language. */
function appLineOf(t: ReturnType<typeof createT>, a: UnansweredApp, url: string): string {
  const parts = [
    ...(a.open ? [t('admin.compliance.ask.partOpen', { open: a.open })] : []),
    ...(a.noMap ? [t('admin.compliance.ask.partNoMap')] : []),
    ...(a.unreadable.length ? [t('admin.compliance.ask.partWords', { rows: a.unreadable.slice(0, 5).join(', ') })] : []),
    ...(a.unstated.length ? [t('admin.compliance.ask.partPersonal', { rows: a.unstated.slice(0, 5).join(', ') })] : []),
  ];
  return t('admin.compliance.ask.line', { title: a.title, parts: parts.join('; '), url });
}

/**
 * Ask the makers whose apps are unanswered, at most once per app per REASK_DAYS. Never throws: a
 * reminder that cannot be sent is logged and tried again on the next run.
 */
export async function askMakersForAiAct(
  storage: Storage, config: AimeatConfig, opts: { now?: Date } = {},
): Promise<{ asked: number; makers: number }> {
  const now = opts.now ?? new Date();
  const operator = await findOperatorGhii(storage, config);
  if (!operator) return { asked: 0, makers: 0 };
  const open = await unansweredApps(storage, config);
  if (open.length === 0) return { asked: 0, makers: 0 };

  const parse = (v: unknown): Record<string, string> =>
    (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, string>) } : {});
  const record = await storage.getMemory(systemGhiiFor(config.nodeId), ASKS_KEY);
  const asked = parse(record?.value);
  const due = open.filter(a => !asked[a.ref] || now.getTime() - Date.parse(asked[a.ref]) >= REASK_DAYS * 86_400_000);
  if (due.length === 0) return { asked: 0, makers: 0 };

  const byOwner = new Map<string, UnansweredApp[]>();
  for (const a of due) byOwner.set(a.owner, [...(byOwner.get(a.owner) ?? []), a]);
  const nodeUrl = (config.baseUrl || '').replace(/\/$/, '');
  const sent: string[] = [];
  for (const [owner, list] of byOwner) {
    const recipient = `${owner}@${config.nodeId}`;
    try {
      const t = createT(toLocale((await storage.getGHII(recipient))?.locale));
      const lines = list.map(a => appLineOf(t, a, `${nodeUrl}/v1/appcat?app=${a.ref}`));
      // A message about the AI questions alone reads as before; one that also asks for data maps says so.
      const maps = list.some(a => a.noMap || a.unreadable.length || a.unstated.length);
      const body = [
        maps ? t('admin.compliance.ask.introMaps', { n: list.length }) : t('admin.compliance.ask.intro', { n: list.length }),
        '',
        ...lines,
        '',
        t('admin.compliance.ask.how'),
        '',
        '```',
        makerPrompt(nodeUrl, list.map(a => a.ref), maps),
        '```',
        '',
        maps ? t('admin.compliance.ask.afterMaps') : t('admin.compliance.ask.after'),
      ].join('\n');
      const r = await sendDirectMessage({ storage, config, peers: new Map() }, {
        senderGhii: operator,
        recipientGhii: recipient,
        subject: maps ? t('admin.compliance.ask.subjectMaps', { n: list.length }) : t('admin.compliance.ask.subject', { n: list.length }),
        body,
        skipContactGate: true,
        // The node writes this on the administrator's behalf: a day's reminders must not use up,
        // or be refused by, the administrator's own message limit.
        sendLimit: 'exempt',
      });
      if (r.ok) sent.push(...list.map(a => a.ref));
    } catch (err) {
      logger.warn('compliance-ask-makers: a reminder could not be sent', { owner, error: String(err) });
    }
  }
  if (sent.length) {
    const at = now.toISOString();
    await updateRecord(storage, systemGhiiFor(config.nodeId), ASKS_KEY, parse, (cur) => {
      for (const ref of sent) cur[ref] = at;
      return cur;
    }, { tag: 'compliance' });
  }
  return { asked: sent.length, makers: new Set(sent.map(r => r.split('/')[0])).size };
}
