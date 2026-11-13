/**
 * @file src/services/app-build/legal-readiness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which legal pages an app ought to have, and which of them it does not have yet.
 *   A pure move out of services/app/legal.ts (which re-exports both names), so the publish answer
 *   (app-publish-next-steps.ts) can say which pages are open without importing app-legal, whose
 *   imports lead back to the publish path and close an import cycle.
 * @structure LegalReadiness · legalReadiness(app, opts)
 * @usage
 *   const { missing } = legalReadiness(app);
 * @version-history
 *   v1.0.0 — 2026-11-08 — Moved from services/app-legal.ts unchanged.
 */
import type { AppLegalKind, AppSummaryRecord } from '../../storage/types/apps.js';

export interface LegalReadiness {
  /** The kinds this app should have, given what it is. */
  recommended: AppLegalKind[];
  /** Of those, the ones it does not have yet. */
  missing: AppLegalKind[];
  /** Why the recommendation is what it is, one line. */
  reason: string;
}

/**
 * Which pages an app ought to have. Every published app: terms and privacy. An app that takes
 * money (appSellsForMoney): also who is selling, how to withdraw, the accessibility statement the
 * EAA asks of e-commerce, and a support contact. Recommended, never blocked: the owner decides,
 * the details view shows what is missing, and a chip on the app's masthead says so.
 */
export function legalReadiness(app: Pick<AppSummaryRecord, 'manifest'>, opts?: { sellsForMoney?: boolean }): LegalReadiness {
  const m = app.manifest;
  const sells = opts?.sellsForMoney === true;
  const recommended: AppLegalKind[] = sells
    ? ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'support']
    : ['terms', 'privacy'];
  const have = new Set(Object.keys(m?.legal ?? {}));
  return {
    recommended,
    missing: recommended.filter(k => !have.has(k)),
    reason: sells
      ? 'This app sells something, so it answers for the sale: who is selling, on what terms, how to withdraw, how the data is handled, and how the shop can be used by everyone.'
      : 'A published app answers for its own terms and for the personal data it handles.',
  };
}
