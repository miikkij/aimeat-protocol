/**
 * @file src/services/internet-opening/opening-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who opens an app to the internet on this node without an operator's approval. The
 *   node's `visibility.app_internet_opening` decides: 'self' lets every owner; 'operator' lets an
 *   operator and the owners the operators trust (opening-types.ts TrustedOpener); 'off' lets nobody.
 *   A node that shows its content to anyone needs no opening at all ('not-needed').
 * @structure openingMode · directOpening
 * @usage const under = await directOpening(ctx, 'alice', false);   // 'self-mode' | 'operator' | 'trusted-opener' | null
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { signedInOnly } from '../../config-visibility.js';
import { readOpeners, activeOpeners, type OpeningCtx } from './opening-store.js';
import type { OpenedUnder } from './opening-types.js';

/** How this node opens apps: its setting, or 'not-needed' on a node that is open to everyone already. */
export function openingMode(config: OpeningCtx['config']): 'off' | 'operator' | 'self' | 'not-needed' {
  if (!signedInOnly(config)) return 'not-needed';
  return config.appInternetOpening ?? 'operator';
}

/** Why this owner may open without an operator, or null when an operator must approve. */
export async function directOpening(ctx: OpeningCtx, owner: string, isOperator: boolean): Promise<OpenedUnder | null> {
  const mode = openingMode(ctx.config);
  if (mode === 'self') return 'self-mode';
  if (mode !== 'operator') return null;
  if (isOperator) return 'operator';
  const trusted = activeOpeners(await readOpeners(ctx));
  return trusted.some(t => t.owner === owner) ? 'trusted-opener' : null;
}
