/**
 * @file src/services/visibility/behaviour-fixer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fixing agent (AI visibility, layer D): it reads an app's behaviour findings (dead
 *   clicks, rage clicks, a page nobody scrolls), asks the owner's own AI for a corrected app, and
 *   writes the answer as the app's DRAFT. It never publishes: the live app is unchanged until the
 *   owner publishes the draft (`aimeat_app_draft_publish`, or the app page).
 *
 *   OFF UNTIL THE OWNER SWITCHES IT ON (behaviour-settings.ts `fixer`), because every run spends the
 *   owner's AI credit through their own AI settings (completeForOwner). Once on, the weekly job
 *   runs it for the apps with findings; the owner, or their AI, can also ask for one app now.
 *
 *   IT NEVER OVERWRITES THE OWNER'S OWN DRAFT. An app with a draft the fixing agent did not write is
 *   left alone, and the run says so. Every run, with its findings, is kept in
 *   `signals.behaviour.runs` (newest first, MAX_RUNS), so the owner sees what was found and done
 *   even when no draft was written.
 * @structure runBehaviourFix · runWeeklyBehaviourFixer · listBehaviourRuns · behaviourSettingsView · extractHtml ·
 *   BehaviourFixError
 * @usage const run = await runBehaviourFix(storage, config, ownerGhii, 'shop.html', 'owner');
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  BEHAVIOUR_RUNS_KEY, BEHAVIOUR_SETTINGS_KEY, MAX_RUNS,
  type BehaviourRun, type BehaviourFinding,
} from '../../models/behaviour-schemas.js';
import { readBehaviour } from './behaviour-report.js';
import { getBehaviourSettings, nodeWatchesBehaviour } from './behaviour-settings.js';
import { completeForOwner } from '../ai/completion.js';
import { AiCompletionError } from '../ai/errors.js';
import { stageAppDraft } from '../app-lifecycle.js';
import { recordAccountEvent } from '../account-events.js';
import { withKeyLock } from '../signals/signal-service.js';
import { localAccountOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

/** The longest app the agent is given; a larger one is reported, not cut. */
const MAX_APP_CHARS = 120_000;
/** Apps one owner's weekly run fixes at most. */
const MAX_APPS_PER_WEEK = 5;

export class BehaviourFixError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = 'BehaviourFixError';
  }
}

const SYSTEM_PROMPT = [
  'You fix single-file web apps. You receive one complete HTML file and a list of findings measured from real visitors.',
  'Change only what the findings point to: make a button that does nothing do what its label says, or show that it is working; make an element people click again and again respond at once; bring what is below the first screen up when nobody scrolls to it.',
  'Keep everything else as it is: the text, the look, the data calls and the scripts that work.',
  'Answer with the complete corrected HTML file and nothing else, starting with <!doctype html>.',
].join(' ');

/** The HTML file in an AI answer: the whole answer, or the first fenced block. Null when there is none. */
export function extractHtml(answer: string): string | null {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(answer);
  const text = (fenced ? fenced[1]! : answer).trim();
  return /^(<!doctype html|<html)/i.test(text) && /<\/html>\s*$/i.test(text) ? text : null;
}

async function readRuns(storage: Storage, ownerGhii: string): Promise<{ runs: BehaviourRun[]; row: MemoryRecord | null }> {
  const row = await storage.getMemory(ownerGhii, BEHAVIOUR_RUNS_KEY);
  const runs = (row?.value as { runs?: BehaviourRun[] } | undefined)?.runs;
  return { runs: Array.isArray(runs) ? runs : [], row };
}

/** The owner's view of the settings, as REST and MCP answer it: the switches, the node's switch and the last runs. */
export async function behaviourSettingsView(storage: Storage, config: AimeatConfig, ownerGhii: string): Promise<Record<string, unknown>> {
  const s = await getBehaviourSettings(storage, ownerGhii);
  return {
    node_enabled: nodeWatchesBehaviour(config),
    off_apps: s.offApps,
    fixer: s.fixer,
    updated_at: s.updatedAt || null,
    runs: (await listBehaviourRuns(storage, ownerGhii)).slice(0, 10),
  };
}

/** The owner's runs, newest first. */
export async function listBehaviourRuns(storage: Storage, ownerGhii: string, app?: string): Promise<BehaviourRun[]> {
  const { runs } = await readRuns(storage, ownerGhii);
  return app ? runs.filter((r) => r.app === app) : runs;
}

async function keepRun(storage: Storage, ownerGhii: string, run: BehaviourRun): Promise<void> {
  await withKeyLock(`${ownerGhii}|${BEHAVIOUR_RUNS_KEY}`, async () => {
    const { runs, row } = await readRuns(storage, ownerGhii);
    const now = new Date().toISOString();
    await storage.setMemory({
      key: BEHAVIOUR_RUNS_KEY, ownerGaii: ownerGhii,
      value: { type: 'aimeat.behaviour.runs', spec: '/docs/specs/visibility-contract.md', runs: [run, ...runs].slice(0, MAX_RUNS) },
      visibility: 'owner', tags: ['signal-visibility'], ttlHours: null,
      version: (row?.version ?? 0) + 1, createdAt: row?.createdAt ?? now, updatedAt: now,
    } as MemoryRecord);
  });
}

function prompt(filename: string, html: string, findings: BehaviourFinding[]): string {
  return [
    `The app is ${filename}. These findings were measured from its visitors in the last seven days:`,
    ...findings.map((f) => `- ${f.text}`),
    '',
    'The app file:',
    html,
  ].join('\n');
}

/**
 * Run the fixing agent on one app now. Throws BehaviourFixError for a request that cannot run (no
 * such app, the operator switched layer D off); every other outcome is a kept run with a note.
 */
export async function runBehaviourFix(
  storage: Storage, config: AimeatConfig, ownerGhii: string, filename: string, by: BehaviourRun['by'],
): Promise<BehaviourRun> {
  if (!nodeWatchesBehaviour(config)) {
    throw new BehaviourFixError('FEATURE_DISABLED', 403, 'On-page behaviour is switched off on this node.');
  }
  const ownerName = localAccountOf(ownerGhii);
  const app = ownerName ? await storage.getApp(ownerGhii, filename) : null;
  if (!ownerName || !app) throw new BehaviourFixError('NOT_FOUND', 404, `You have no app named ${filename}.`);

  const findings = (await readBehaviour(storage, config, ownerGhii, { app: filename, days: 7 })).apps[0]?.findings ?? [];
  const run: BehaviourRun = { app: filename, at: new Date().toISOString(), by, findings, draft: false, model: null, note: null };
  const done = async (note: string | null): Promise<BehaviourRun> => {
    run.note = note;
    await keepRun(storage, ownerGhii, run);
    return run;
  };

  if (findings.length === 0) return done('No finding in the last seven days, so there is nothing to fix.');
  if (!/html/i.test(app.mimeType)) return done('The app is not an HTML file, so the fixing agent cannot change it.');
  const html = app.data.toString('utf-8');
  if (html.length > MAX_APP_CHARS) return done(`The app is ${html.length} characters long; the fixing agent works on apps up to ${MAX_APP_CHARS}.`);

  // The owner's own unpublished draft is theirs. Only a draft this agent wrote may be replaced.
  const draft = await storage.getAppDraft(ownerGhii, filename);
  if (draft) {
    const ours = (await listBehaviourRuns(storage, ownerGhii, filename)).find((r) => r.draft);
    // Ours only while it is exactly the draft the agent wrote; an owner's edit to it makes it theirs.
    if (!ours || draft.updatedAt !== ours.at) {
      return done('You have an unpublished draft of this app, so the fixing agent left it alone. Publish or discard your draft, and the next run can write one.');
    }
  }

  let answer: string;
  try {
    const r = await completeForOwner(storage, config, ownerGhii, {
      prompt: prompt(filename, html, findings), systemPrompt: SYSTEM_PROMPT,
      appId: 'behaviour-fixer', caller: 'owner', modelRole: 'execution', uncapped: true,
    });
    run.model = r.model;
    if (r.truncated) return done('The AI\'s answer was cut off before the end of the file, so no draft was written.');
    answer = r.content;
  } catch (e) {
    if (e instanceof AiCompletionError) return done(`Your AI could not run: ${e.message}`);
    throw e;
  }

  const fixed = extractHtml(answer);
  if (!fixed) return done('The AI did not answer with a complete HTML file, so no draft was written.');
  if (fixed === html.trim()) return done('The AI found nothing to change, so no draft was written.');
  const staged = await stageAppDraft(storage, config, {
    ownerName, ownerGhii, filename, data: Buffer.from(fixed, 'utf-8'), requested: {},
  });
  if ('refusal' in staged) return done(`The draft was refused: ${staged.refusal.message}`);
  run.draft = true;
  run.at = staged.updatedAt;
  await done(null);
  void recordAccountEvent(storage, {
    ownerGhii, kind: 'app_fix_drafted',
    data: { app: app.manifest?.name || filename, findings: String(findings.length) },
    link: `/v1/apps/${ownerName}/${encodeURIComponent(filename)}`,
  }, config);
  return run;
}

/**
 * The weekly run: every owner who switched the fixing agent on, for their apps with findings, at
 * most MAX_APPS_PER_WEEK each. A failure on one app is logged and the next one runs.
 */
export async function runWeeklyBehaviourFixer(storage: Storage, config: AimeatConfig): Promise<{ owners: number; runs: number; drafts: number }> {
  const result = { owners: 0, runs: 0, drafts: 0 };
  if (!nodeWatchesBehaviour(config) || !storage.listMemoryKeysByPrefix) return result;
  for (const { ownerGaii, key } of await storage.listMemoryKeysByPrefix(BEHAVIOUR_SETTINGS_KEY)) {
    if (key !== BEHAVIOUR_SETTINGS_KEY || !localAccountOf(ownerGaii)) continue;
    const settings = await getBehaviourSettings(storage, ownerGaii);
    if (!settings.fixer) continue;
    result.owners++;
    const report = await readBehaviour(storage, config, ownerGaii, { days: 7 });
    const apps = report.apps.filter((a) => a.counting && a.findings.length > 0).slice(0, MAX_APPS_PER_WEEK);
    for (const a of apps) {
      try {
        const run = await runBehaviourFix(storage, config, ownerGaii, a.app, 'weekly');
        result.runs++;
        if (run.draft) result.drafts++;
      } catch (e) {
        logger.warn('behaviour-fixer: a weekly run failed', { ownerGaii, app: a.app, error: String(e) });
      }
    }
  }
  return result;
}
