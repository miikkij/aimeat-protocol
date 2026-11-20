/**
 * @file src/services/ai-standing/view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What GET /v1/ai-standing and the MCP tool aimeat_ai_standing_get answer: every
 *   permission the "Allow always" setting can name, whether it is on, who set it and when, and whether
 *   the node lets it stand now. One function, so the two doors cannot disagree.
 * @structure StandingView · standingView(config, rec, locale) · readStandingView(deps, caller, lang)
 * @usage res.json(success(nodeId, await readStandingView({ storage, config }, caller, req.query.lang)));
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { toLocale, type Locale } from '../../i18n.js';
import { plainPermission } from '../permission-ask.js';
import { standingCandidates, standingClassOf, standingRefusal, type StandingClass } from './words.js';
import { readStanding, type StandingRecord } from './settings.js';
import { standingPageUrl } from './page.js';

export interface StandingViewWord {
  scope: string;
  /** The permission in plain words, in the asked language. */
  plain: string;
  class: StandingClass;
  on: boolean;
  set_at: string | null;
  set_by: string | null;
  /** The node lets this word stand now. A word set before the node turned its class off stays named, and is given to no agent. */
  allowed: boolean;
  refusal_code: string | null;
}

export interface StandingView {
  enabled: boolean;
  money_allowed: boolean;
  delete_allowed: boolean;
  words: StandingViewWord[];
  /** The Agents page section where the account holder changes it. */
  page: string;
}

export function standingView(config: AimeatConfig, rec: StandingRecord, locale: Locale): StandingView {
  return {
    enabled: config.standingEnabled !== false,
    money_allowed: config.standingMoney === true,
    delete_allowed: config.standingDelete === true,
    words: standingCandidates().map((w) => {
      const refusal = standingRefusal(config, w);
      const set = rec.words[w];
      return {
        scope: w, plain: plainPermission(w, locale) ?? w, class: standingClassOf(w), on: !!set,
        set_at: set?.at ?? null, set_by: set?.by ?? null, allowed: refusal === null, refusal_code: refusal?.code ?? null,
      };
    }),
    page: standingPageUrl(config.baseUrl),
  };
}

/**
 * The setting of the caller's account, for the account holder in person and for each of their agents;
 * `{ ok: false }` for anyone else (an app, a visitor, the anonymous identity).
 */
export async function readStandingView(
  deps: { storage: Storage; config: AimeatConfig },
  caller: Pick<CallerContext, 'inPerson' | 'kind' | 'visitor' | 'ownerGhii'>,
  lang: unknown,
): Promise<{ ok: true; view: StandingView } | { ok: false; code: 'ACCESS_DENIED'; message: string }> {
  if (caller.visitor || !(caller.inPerson || caller.kind === 'agent')) {
    return { ok: false, code: 'ACCESS_DENIED', message: 'The account holder and their own agents read this setting.' };
  }
  const rec = await readStanding(deps.storage, caller.ownerGhii);
  return { ok: true, view: standingView(deps.config, rec, toLocale(String(lang ?? 'en'))) };
}
