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
 *   v1.4.0 — 2026-10-18 — Apps, the personal welcome page and a company's front page (apply-app.ts,
 *     apply-portfolio.ts, apply-company.ts).
 *   v1.3.0 — 2026-10-18 — Organisms, boards, user skills, cortex libraries and workspace shares (V4).
 *   v1.2.0 — 2026-10-18 — Package groups, knowledge packages and data packages (plan doc-mvcn6c7e4e5q, V4).
 *   v1.1.0 — 2026-10-18 — Stored files (apply-file.ts; plan doc-mvcn6c7e4e5q, V4).
 *   v1.0.0 — 2026-10-18 — Initial: memory records (plan doc-mvcn6c7e4e5q, V4.3).
 */
import type { PublishApplier, PublishKind } from './store.js';
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
};
