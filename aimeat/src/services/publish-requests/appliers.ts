/**
 * @file src/services/publish-requests/appliers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an approved publish request does, per kind of content (plan doc-mvcn6c7e4e5q,
 *   V4.3). Each applier makes one target public AS THE OWNER, through the code path the owner's own
 *   change takes, after checking that the target is still what the owner was asked about: there,
 *   the owner's or one of their agents', and unchanged since the request. If it is not, it answers
 *   why, and the request is settled `outdated` (decide.ts).
 *
 *   A kind without an applier here cannot be approved; its door files no request either.
 *   Each applier lives in its own `apply-<kind>.ts` and takes the PublishApplier shape (store.ts).
 * @structure PUBLISH_APPLIERS
 * @usage const applied = await PUBLISH_APPLIERS[request.kind]?.(ctx, ownerGhii, request);
 * @version-history
 *   v1.17.0 — 2026-10-30 — A credit card payment only the seller's account attests, confirmed by the
 *     buyer in person, records them as an adult (apply-card-adult.ts; secaudit2026oct26 round 8c, commerce-07).
 *   v1.16.0 — 2026-10-29 — An older accountant grant the client allowed is confirmed, and one the client
 *     did not allow is removed (PUBLISH_DECLINERS) (apply-accountant-grant.ts; secaudit2026oct26 round 8c).
 *   v1.15.0 — 2026-10-29 — A cortex name's new holder, allowed by the owner of apps that loaded the
 *     earlier library (apply-cortex-holder.ts; secaudit2026oct26 round 8c).
 *   v1.14.0 — 2026-10-29 — Extension code a package brought into an account that may not install it,
 *     allowed by an operator (apply-extension-code.ts; secaudit2026oct26 round 8c).
 *   2026-10-29 — An app by another author publishing through a delegation that names its app by file
 *     name alone, allowed by the channel owner (apply-delegation-binding.ts; secaudit2026oct26 round 8c).
 *   v1.13.0 — 2026-10-29 — AIMEAT's model doing a goal's work on the AI allowance for an agent without
 *     ai:use, allowed by the owner (apply-goal-model-spend.ts; secaudit2026oct26 round 8c).
 *   v1.12.0 — 2026-10-27 — AIMEAT's model reading private records an agent named in a goal, allowed by
 *     the owner (apply-goal-model-read.ts; secaudit2026oct26).
 *   v1.11.0 — 2026-10-27 — A sibling agent's instruction to another agent's ai schedule, allowed by the
 *     owner (apply-schedule-instruction.ts; secaudit2026oct26).
 *   2026-10-27 — Where a mail refinery reads and files mail, asked by an app or an agent that may not
 *     run it and allowed by the owner (apply-refinery-definition.ts; secaudit2026oct26).
 *   v1.10.0 — 2026-10-25 — A subscription renewal at a raised price, allowed by the buyer
 *     (apply-subscription-price.ts; secaudit2026oct22).
 *   v1.9.0 — 2026-10-25 — The secret host question switched off at an agent's or app's request
 *     (apply-account-setting.ts; secaudit2026oct22).
 *   v1.8.0 — 2026-10-25 — A crew model choice with its own address an app set, approved by the owner
 *     (apply-crew-model.ts; secaudit2026oct22).
 *   v1.7.0 — 2026-10-25 — An extension's emailPolicy grant, approved by an operator
 *     (apply-extension-email-policy.ts; secaudit2026oct22).
 *   v1.6.0 — 2026-10-25 — An app opened to the internet on a closed node (apply-internet-opening.ts).
 *   v1.5.0 — 2026-10-20 — A consent to everyone (apply-consent.ts; secaudit 2026-10,
 *     grantConsent:wildcard-recipient-skips-publish-gate).
 *   v1.4.0 — 2026-10-18 — Apps, the personal welcome page and a company's front page (apply-app.ts,
 *     apply-portfolio.ts, apply-company.ts).
 *   v1.3.0 — 2026-10-18 — Organisms, boards, user skills, cortex libraries and workspace shares (V4).
 *   v1.2.0 — 2026-10-18 — Package groups, knowledge packages and data packages (plan doc-mvcn6c7e4e5q, V4).
 *   v1.1.0 — 2026-10-18 — Stored files (apply-file.ts; plan doc-mvcn6c7e4e5q, V4).
 *   v1.0.0 — 2026-10-18 — Initial: memory records (plan doc-mvcn6c7e4e5q, V4.3).
 */
import type { PublishApplier, PublishKind, PublishRequest, PublishStoreCtx } from './store.js';
import { applyAccountantGrant } from './apply-accountant-grant.js';
import { applyCardAdultConfirm } from './apply-card-adult.js';
import { declineAccountantGrant } from '../finance/accountant-grant-ask.js';
import { applyMemoryPublish } from './apply-memory.js';
import { applyFilePublish } from './apply-file.js';
import { applyPackagePublish } from './apply-package.js';
import { applyKnowledgePublish } from './apply-knowledge.js';
import { applyDatapackagePublish } from './apply-datapackage.js';
import { applyOrganismPublish } from './apply-organism.js';
import { applyBoardPublish } from './apply-board.js';
import { applySkillPublish } from './apply-skill.js';
import { applyCortexPublish } from './apply-cortex.js';
import { applyWorkspaceSharePublish } from './apply-workspace-share.js';
import { applyAppPublish } from './apply-app.js';
import { applyPortfolioPublish } from './apply-portfolio.js';
import { applyCompanyPublish } from './apply-company.js';
import { applyConsentPublish } from './apply-consent.js';
import { applyInternetOpening } from './apply-internet-opening.js';
import { applyExtensionEmailPolicy } from './apply-extension-email-policy.js';
import { applyCrewModel } from './apply-crew-model.js';
import { applyAccountSetting } from './apply-account-setting.js';
import { applySubscriptionPrice } from './apply-subscription-price.js';
import { applyScheduleInstruction } from './apply-schedule-instruction.js';
import { applyGoalModelRead } from './apply-goal-model-read.js';
import { applyGoalModelSpend } from './apply-goal-model-spend.js';
import { applyRefineryDefinition } from './apply-refinery-definition.js';
import { applyDelegationBinding } from './apply-delegation-binding.js';
import { applyExtensionCode } from './apply-extension-code.js';
import { applyCortexHolder } from './apply-cortex-holder.js';

/** One applier per kind of content a request can make public. */
export const PUBLISH_APPLIERS: Partial<Record<PublishKind, PublishApplier>> = {
  memory: applyMemoryPublish,
  file: applyFilePublish,
  package: applyPackagePublish,
  knowledge: applyKnowledgePublish,
  datapackage: applyDatapackagePublish,
  organism: applyOrganismPublish,
  board: applyBoardPublish,
  skill: applySkillPublish,
  cortex: applyCortexPublish,
  'workspace-share': applyWorkspaceSharePublish,
  app: applyAppPublish,
  portfolio: applyPortfolioPublish,
  company: applyCompanyPublish,
  consent: applyConsentPublish,
  'internet-opening': applyInternetOpening,
  'extension-email-policy': applyExtensionEmailPolicy,
  'crew-model': applyCrewModel,
  'account-setting': applyAccountSetting,
  'subscription-price': applySubscriptionPrice,
  'schedule-instruction': applyScheduleInstruction,
  'goal-model-read': applyGoalModelRead,
  'refinery-definition': applyRefineryDefinition,
  'delegation-binding': applyDelegationBinding,
  'goal-model-spend': applyGoalModelSpend,
  'extension-code': applyExtensionCode,
  'cortex-holder': applyCortexHolder,
  'accountant-grant': applyAccountantGrant,
  'card-adult-confirm': applyCardAdultConfirm,
};

/**
 * What a declined request does, for the kinds where "Don't allow" changes something rather than
 * leaving it as it was: an older accountant grant the client did not allow is removed
 * (finance/accountant-grant-ask.ts). decide.ts runs it after the request is settled declined.
 */
export const PUBLISH_DECLINERS: Partial<Record<PublishKind, (ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest) => Promise<void>>> = {
  'accountant-grant': declineAccountantGrant,
};
