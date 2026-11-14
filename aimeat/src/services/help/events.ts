/**
 * @file src/services/help/events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What Ask someone who knows tells the rest of the node when something changed: the
 *   live-update domain `help` for the people concerned (their open pages reload over the existing
 *   SSE stream; auth/sse-domain-scopes.ts fences it to help:answer), and the operator's hook moments
 *   post_help_question and post_help_solved (services/hooks.ts), for a company that wants its own
 *   handling on top. A hook carries the question's id, state, topics and when, never its text and
 *   never a name.
 * @structure emitHelpChange · runHelpHook
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { emitChange } from '../event-bus.js';
import { executeHooks } from '../hooks.js';
import { logger } from '../../utils/logger.js';
import type { HelpDeps } from './rules.js';

/** The people whose pages should reload: the asker, the helpers, or both. */
export function emitHelpChange(...ghiis: string[]): void {
  for (const g of new Set(ghiis.filter(Boolean))) emitChange('help', g);
}

/** Tell the operator's hook, after the fact. A failing address is recorded by the hook log and
 *  changes nothing here: these moments decide nothing. */
export function runHelpHook(deps: HelpDeps, moment: 'post_help_question' | 'post_help_solved',
  detail: { question_id: string; state: string; topics: string[] }): void {
  if (!(deps.config.extensionHooks?.[moment]?.length)) return;
  void executeHooks(deps.config, deps.storage, moment, { ...detail, at: new Date().toISOString() })
    .catch(err => logger.warn('help: hook did not run', { moment, error: String(err) }));
}
