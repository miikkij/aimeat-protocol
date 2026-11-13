/**
 * @file src/services/publish-requests/kinds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The kinds of publish request, one per applier in appliers.ts. Moved out of store.ts at the
 *   800-line limit; store.ts re-exports the type, so its importers are unchanged.
 * @structure PublishKind
 * @usage import type { PublishKind } from './store.js';
 * @version-history
 *   v1.1.0 — 2026-11-13 — The kind `lia-approval`.
 *   v1.0.0 — 2026-11-02 — Moved verbatim from store.ts (800-line limit), with the kind `mcp-capability-use`
 *     (secaudit2026nov02d round 13).
 */

/** What kind of content a request makes public. Each has an applier in appliers.ts. */
export type PublishKind =
  | 'memory' | 'file' | 'workspace-share' | 'app' | 'organism' | 'board' | 'skill'
  | 'package' | 'knowledge' | 'datapackage' | 'portfolio' | 'company' | 'cortex' | 'consent'
  // An app opened to the internet on a closed node, asked by an agent or an app (services/internet-opening/).
  | 'internet-opening'
  // Approvals that make nothing public (`approval` on the request; services/approval-standard.ts):
  // an extension's emailPolicy grant (the operators answer), a crew model choice with its own
  // address set by an app, and switching off the owner's secret host question.
  | 'extension-email-policy' | 'crew-model' | 'account-setting'
  // A subscription renewal whose plan price went up since the buyer agreed (commerce/subscription-price-ask.ts).
  | 'subscription-price'
  // A sibling agent's new instruction to another agent's ai schedule (services/schedule-instruction-hold.ts).
  | 'schedule-instruction'
  // AIMEAT's model reading private records an agent named in a goal (services/goals/goals-model-reach.ts).
  | 'goal-model-read'
  // Where a mail refinery reads and files mail, changed by a writer that may not run it (refinery/definition-ask.ts).
  | 'refinery-definition'
  // An app by another author publishing through a delegation that names its app by file name alone
  // (services/connections/delegation-caller.ts).
  | 'delegation-binding'
  // AIMEAT's model doing a goal's work on the AI allowance for an agent without ai:use (services/goals/goals-model-spend.ts).
  | 'goal-model-spend'
  // Extension code a package brought into an account that may not install extension code (services/extension/code-hold.ts).
  | 'extension-code'
  // A cortex name's new holder, allowed by the owner of an app that loaded the earlier library (services/cortex-holder-change.ts).
  | 'cortex-holder'
  // An older accountant grant whose holder the node cannot place, asked of the client (finance/accountant-grant-ask.ts).
  | 'accountant-grant'
  // A credit card payment only the seller's own Stripe account attests, confirmed by the buyer in person (commerce/card-adult-ask.ts).
  | 'card-adult-confirm'
  // The owner's welcome page reading their memory, when a writer without memory:read wrote it (services/portfolio-read-hold.ts).
  | 'portfolio-memory-read'
  // A program a computer holds for an agent, allowed by the owner (services/connector-programs.ts).
  | 'connector-program'
  // A living document refreshing itself with the owner's AI, set up by a writer without ai:use (services/living-pulse-spend.ts).
  | 'living-ai-spend'
  // A writer without company:write changing a company's page through the file routes (services/company/company-page-key.ts).
  | 'company-page-write'
  // Another account's capability running a remote MCP tool with the caller's own sign-in (services/mcp-client/capability-consent.ts).
  | 'mcp-capability-use'
  // The balancing test of an app (legitimate interests), approved by its owner in person when an agent asked (services/compliance/lia-ops.ts).
  | 'lia-approval';
