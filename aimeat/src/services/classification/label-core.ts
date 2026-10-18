/**
 * @file src/services/classification/label-core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes every label decision shares: the error a refusal throws, the dependencies
 *   a label function takes, and who is labelling (LabelActor) with the three questions asked of it.
 *   Moved unchanged out of labels.ts so the container rules (containers.ts) and the effective label
 *   (effective.ts) use them without importing labels.ts, which imports both of them; labels.ts
 *   re-exports every name, so no caller changed its import.
 * @structure ClassificationError · ClassificationDeps · LabelActor · rolesOf() · isOwnerPerson() ·
 *   isAppActor() · appNameOf()
 * @usage import { ClassificationError, type LabelActor } from './label-core.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Extracted unchanged from labels.ts (plan doc-mvdipuyqraas, L1).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isOwnerInPerson } from '../../utils/gaii.js';

export class ClassificationError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = 'ClassificationError';
  }
}

export interface ClassificationDeps {
  storage: Storage;
  config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;
  /** ISO time; injectable for tests. */
  now?: () => string;
}

/** Who is labelling. `rule` is the node's own detection, never a caller. */
export interface LabelActor {
  principal: string;
  ownerGhii: string;
  ownerName: string | null;
  kind: 'human' | 'ai' | 'rule';
  /** The node's own classifier (classifier.ts): it labels any scope, as a rule does, but an AI's
   *  label still follows the AI rules. No request can set it. */
  nodeOwn?: boolean;
  /** The credential's roles, for the organism namespace rule. Absent: read from `kind`. */
  roles?: string[];
  /** An app credential's app id (`owner/file.html`), named in the exceptions it records. */
  app?: string;
  /** The credential's granted words, for the node level: something acting for the operator passes
   *  only on "operator:admin" (askOperator in services/operator-principal.ts). */
  scopes?: string[];
}

/** The credential's roles, or the ones its kind implies when the actor was built without them. */
export function rolesOf(actor: LabelActor): string[] {
  return actor.roles ?? (actor.kind === 'human' ? ['owner'] : ['agent']);
}

/** Is this the account holder in their own session (not an agent, an app or an ecosystem app)? */
export function isOwnerPerson(actor: LabelActor): boolean {
  // labelActorOf refuses a visitor from another node, so the roles are the whole question here.
  return actor.kind === 'human' && isOwnerInPerson({ roles: rolesOf(actor) });
}

/**
 * Is this an app credential (a hosted app's grant, read as the person's screen)? An app does what it
 * is built for, and an act against a label is recorded as an exception rather than refused (decided
 * 2026-09-30). An AI credential (agent, ecosystem app, PAT, unattended run) never is one.
 */
export function isAppActor(actor: LabelActor): boolean {
  return actor.kind === 'human' && rolesOf(actor).includes('app');
}

/** How an app is named in the exceptions it records. */
export const appNameOf = (actor: LabelActor): string => actor.app ?? actor.principal;
