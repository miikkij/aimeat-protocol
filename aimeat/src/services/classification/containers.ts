/**
 * @file src/services/classification/containers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification of a CONTAINER: an organism, a workspace, a board or an app
 *   (plan doc-mvdipuyqraas, L1.1, L1.2 and L1.4). A container's label is the floor for everything
 *   in it: what it holds reads at least as sensitive as the container (effective.ts). The label row,
 *   its history, its source and its lock are the content label's (labels.ts setLabel); this file
 *   says where a container's label is stored, which containers a piece of content sits in, and who
 *   may read or change a container's label.
 *
 *   WHERE THE LABEL IS STORED (storage/types/content-labels.ts):
 *     organism  `organism:<id>` / the organism id
 *     workspace `organism:<id>` / the workspace id
 *     board     the board's owner identity / the board id
 *     app       the owner GHII / the app's slug (utils/gaii.ts appSlug)
 *   The organism's and the workspace's rows sit in the organism's scope, so the organism's policy
 *   applies and deleting the organism deletes them (deleteContentLabelsByScope). A board's and an
 *   app's rows sit in the owner's scope, under the owner's policy, and go with the owner's erasure.
 *
 *   WHO (L1.2). An organism's or a workspace's label: any active member reads it (a workspace's also
 *   needs the workspace read decision); its creator or an admin sets and reviews it, in person or
 *   through their agent or app. A member who is not one gets 403 NOT_ALLOWED, a non-member 404. An
 *   ecosystem app (GEAI) holds a data area, not a container, so it is no one here. A board's and an
 *   app's label: its owner, or the owner's agent or app, as for personal content. Another owner gets
 *   403 NOT_ALLOWED for a board everyone can read and 404 for any other board, so a private board's
 *   existence is not told.
 *
 *   AN APP'S DATA (L1.4), decided from the code on 2026-10-18. What an app's label covers is what
 *   can be told apart as the app's on every read without asking anything more:
 *   - INCLUDED: memory records and stored files held in the app's own namespace,
 *     `eco:<slug>#<owner>@<node>`. An ecosystem app writes there (its flat working keys,
 *     services/ecosystem-access.ts), and that identity is the one a hosted app of the same slug calls
 *     as (utils/gaii.ts callerPrincipal), so the namespace names the app on every record in it.
 *   - LEFT OUT: what a hosted app writes through its owner's app grant. That lands in the OWNER's
 *     namespace (resolveIdentity; "Storage keeps using resolveIdentity, so no app's data moves",
 *     utils/gaii.ts), under keys the app chooses freely: the manifest declares no key prefix and the
 *     SDK prefixes nothing (sdk-libs/data), so no rule tells those records from the owner's own.
 *   - LEFT OUT: a file an app uploaded into its owner's namespace. The file record does not name the
 *     uploader (storage/types/commerce.ts StorageFileRecord).
 *   - LEFT OUT: workspace rows. No row space names an app (storage/types/workspace-rows.ts), and a
 *     row's `createdBy` names who appended one row, not whose space it is; a row is under its
 *     workspace's and organism's labels already.
 *   The app's own listing (the exposure report's app item) reads the app's label too.
 * @structure CONTAINER_KINDS · isContainerKind() · organismTarget() · workspaceTarget() · boardTarget() ·
 *   boardPostTarget() · appTarget() · containersOf() · containerTargetOf() · resolveContainer() ·
 *   assertMayLabelContainer()
 * @usage
 *   const t = workspaceTarget(orgId, ws);                       // a workspace's label address
 *   for (const c of containersOf(memoryTarget(owner, key))) …   // the floors a record sits under
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L1.1, L1.2, L1.4).
 */
import type { Storage, ContentLabelTarget, ContentLabelKind, BoardRecord } from '../../storage/interface.js';
import { appSlug, isGEAI, isSameOwner, ownerGhiiOf, parseGaiiLoose } from '../../utils/gaii.js';
import type { AimeatConfig } from '../../config.js';
import { agentBarred } from '../organism-agent-access.js';
import { decideWorkspaceRead, isOrgManager } from '../workspace-access.js';
import { findWorkspaceRegistration } from '../workspace-meta-read.js';
import { ClassificationError, rolesOf, type ClassificationDeps, type LabelActor } from './label-core.js';
import { ownerOfScope, scopeOrganism } from './policy.js';

/** The containers a label can be set on, in the order the surfaces list them. */
export const CONTAINER_KINDS = ['organism', 'workspace', 'board', 'app'] as const;
export type ContainerKind = typeof CONTAINER_KINDS[number];

export function isContainerKind(kind: unknown): kind is ContainerKind {
  return typeof kind === 'string' && (CONTAINER_KINDS as readonly string[]).includes(kind);
}

/** Where a content target's effective label came from, when not from itself. */
export type ContainerFrom = 'workspace' | 'organism' | 'board' | 'app';

export function organismTarget(organismId: string): ContentLabelTarget {
  return { kind: 'organism', scope: `organism:${organismId}`, key: organismId };
}

export function workspaceTarget(organismId: string, ws: string): ContentLabelTarget {
  return { kind: 'workspace', scope: `organism:${organismId}`, key: ws };
}

export function boardTarget(board: Pick<BoardRecord, 'id' | 'ownerGaii'>): ContentLabelTarget {
  return { kind: 'board', scope: board.ownerGaii, key: board.id };
}

/**
 * A post of a board, as the reader decides it: under its board's address, with the post id after a
 * slash. A post has no label of its own (none is ever stored there: containerTargetOf refuses a
 * board id with a slash), so it reads as the default raised to its board's label.
 */
export function boardPostTarget(board: Pick<BoardRecord, 'id' | 'ownerGaii'>, postId: string): ContentLabelTarget {
  return { kind: 'board', scope: board.ownerGaii, key: `${board.id}/${postId}` };
}

/** An app's label address: its owner and its slug, the name its GEAI and its namespace carry. */
export function appTarget(owner: string, name: string): ContentLabelTarget {
  return { kind: 'app', scope: ownerGhiiOf(owner), key: appSlug(name) };
}

/** The workspace a content target of an organism sits in, or null outside one. */
function workspaceOfContent(t: ContentLabelTarget): string | null {
  if (t.kind === 'row') return t.key.split('/')[0] || null;
  const m = /^organism\.[^.]+\.w\.([^.]+)\./.exec(t.key);
  return m ? m[1]! : null;
}

/**
 * The containers whose label is a floor for this target, nearest first. Pure: it reads nothing, so a
 * list of a thousand items asks storage once per container kind and scope (effective.ts).
 */
export function containersOf(t: ContentLabelTarget): Array<{ target: ContentLabelTarget; from: ContainerFrom }> {
  const org = scopeOrganism(t.scope);
  switch (t.kind) {
    case 'organism':
    case 'app':
      return [];
    case 'workspace':
      return org ? [{ target: organismTarget(org), from: 'organism' }] : [];
    case 'board': {
      const slash = t.key.indexOf('/');
      return slash > 0 ? [{ target: { kind: 'board', scope: t.scope, key: t.key.slice(0, slash) }, from: 'board' }] : [];
    }
    default:
      break;
  }
  if (org) {
    const ws = workspaceOfContent(t);
    return [
      ...(ws ? [{ target: workspaceTarget(org, ws), from: 'workspace' as const }] : []),
      { target: organismTarget(org), from: 'organism' },
    ];
  }
  // An app's own namespace (see the file header, AN APP'S DATA).
  if (isGEAI(t.scope)) {
    const owner = ownerOfScope(t.scope);
    const name = parseGaiiLoose(t.scope).agent;
    if (owner && name) return [{ target: appTarget(owner, name), from: 'app' }];
  }
  return [];
}

/** What a caller names as a container. */
export interface ContainerInput {
  organism_id?: unknown;
  ws?: unknown;
  board_id?: unknown;
  app?: unknown;
}

/** An id a caller names: text without a slash or a dot, so it cannot reach another address. */
function idOf(v: unknown, field: string, max = 200): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > max || /[/.\s]/.test(s)) {
    throw new ClassificationError('INVALID_INPUT', 400, `${field} is required, and names one ${field === 'ws' ? 'workspace' : field.replace('_id', '')} by its id.`);
  }
  return s;
}

/**
 * The label address of the container a caller named. A board's owner is not known until the board
 * is read, so its scope is empty here and resolveContainer fills it in. An app is always the
 * caller's owner's: `app` is a hosted app's filename or an ecosystem app's name.
 */
export function containerTargetOf(actor: LabelActor, kind: ContainerKind, input: ContainerInput): ContentLabelTarget {
  switch (kind) {
    case 'organism': return organismTarget(idOf(input.organism_id, 'organism_id'));
    case 'workspace': return workspaceTarget(idOf(input.organism_id, 'organism_id'), idOf(input.ws, 'ws'));
    case 'board': return { kind: 'board', scope: '', key: idOf(input.board_id, 'board_id') };
    case 'app': {
      const name = typeof input.app === 'string' ? input.app.trim() : '';
      if (!name || name.length > 200 || /[/\s]/.test(name)) throw new ClassificationError('INVALID_INPUT', 400, 'app is required: the filename of your hosted app or the name of your ecosystem app.');
      return appTarget(actor.ownerGhii, name);
    }
  }
}

/** A board target named before its board was read gets its owner's scope; 404 for no such board. */
export async function resolveContainer(storage: Pick<Storage, 'getBoard'>, t: ContentLabelTarget): Promise<ContentLabelTarget> {
  if (t.kind !== 'board' || t.scope) return t;
  const board = await storage.getBoard(t.key);
  if (!board) throw new ClassificationError('NOT_FOUND', 404, 'No such board.');
  return boardTarget(board);
}

const NOT_A_MEMBER = 'No such organism or workspace, or you are not a member who may read it.';
const NOT_A_MANAGER = "Only the organism's creator or an admin sets the classification of the organism and of its workspaces, in person or through their agent or app.";

/** Organism and workspace: members read, the creator and the admins write (see the file header). */
async function assertOrganismContainer(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget, mode: 'read' | 'write'): Promise<void> {
  const orgId = scopeOrganism(target.scope) as string;
  const organism = await deps.storage.getOrganism(orgId);
  const roles = rolesOf(actor);
  const ecosystem = roles.includes('ecosystem') || (actor.kind === 'ai' && isGEAI(actor.principal));
  if (!organism || !actor.ownerName || ecosystem || agentBarred(organism, actor.principal)) {
    throw new ClassificationError('NOT_FOUND', 404, NOT_A_MEMBER);
  }
  if (target.kind === 'workspace') {
    // A hosted app's grant reads in its owner's name (resolveIdentity), as labels.ts assertMayLabel.
    const accessId = roles.includes('app') ? actor.ownerGhii : actor.principal;
    const read = await decideWorkspaceRead(deps.storage, deps.config as AimeatConfig, organism, accessId, actor.ownerName, accessId, target.key);
    if ((!read.canRead && !read.manager) || !(await findWorkspaceRegistration(deps.storage, orgId, target.key))) {
      throw new ClassificationError('NOT_FOUND', 404, NOT_A_MEMBER);
    }
  } else {
    const m = await deps.storage.getMembership(orgId, actor.ownerName);
    if (!m || m.status !== 'active') throw new ClassificationError('NOT_FOUND', 404, NOT_A_MEMBER);
  }
  if (mode === 'write' && !(await isOrgManager(deps.storage, orgId, actor.ownerName))) {
    throw new ClassificationError('NOT_ALLOWED', 403, NOT_A_MANAGER);
  }
}

/** Board: its owner and the owner's agents and apps; anyone else is told only what they could see. */
async function assertBoardContainer(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget): Promise<void> {
  const board = await deps.storage.getBoard(target.key);
  if (board && isSameOwner(board.ownerGaii, actor.ownerGhii)) return;
  if (board && (board.visibility === 'public' || board.visibility === 'system')) {
    throw new ClassificationError('NOT_ALLOWED', 403, "Only the board's owner sets or reads its classification, in person or through their agent or app.");
  }
  throw new ClassificationError('NOT_FOUND', 404, 'No such board, or it is not yours.');
}

/**
 * App: always the caller's owner's (containerTargetOf). A write names an app the owner has: a hosted
 * app whose filename has this slug, or an ecosystem app of this name.
 */
async function assertAppContainer(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget, mode: 'read' | 'write'): Promise<void> {
  if (!isSameOwner(target.scope, actor.ownerGhii)) throw new ClassificationError('NOT_FOUND', 404, 'No such app, or it is not yours.');
  if (mode === 'read' || !actor.ownerName) return;
  if (await deps.storage.getEcosystemAppByOwnerAndApp(actor.ownerName, target.key)) return;
  const { apps } = await deps.storage.listApps({ ownerGaii: actor.ownerGhii, viewerGhii: actor.ownerGhii, limit: 1000 });
  if (apps.some(a => appSlug(a.filename) === target.key)) return;
  throw new ClassificationError('NOT_FOUND', 404, 'No such app of yours: name a hosted app by its filename, or an ecosystem app by its name.');
}

/** May this actor read (`read`) or set and review (`write`) this container's label? */
export async function assertMayLabelContainer(
  deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget, mode: 'read' | 'write',
): Promise<void> {
  const kind = target.kind as ContentLabelKind;
  if (kind === 'organism' || kind === 'workspace') return assertOrganismContainer(deps, actor, target, mode);
  if (kind === 'board') return assertBoardContainer(deps, actor, target);
  return assertAppContainer(deps, actor, target, mode);
}
