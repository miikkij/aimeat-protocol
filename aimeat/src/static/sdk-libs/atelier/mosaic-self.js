/**
 * @file atelier/mosaic-self.js
 * @description The mosaic's SELF-SOURCED blocks: the ones that bind no memory source because what
 *   they show comes from somewhere the props name (the app's own public legal surface, an organism
 *   row space, a Public Intake form) or from a library on the page (AIMEAT.iam for the members
 *   blocks). Moved out of mosaic.js on 2026-10-01 without a change to the four commercial cases
 *   (mosaic.js stood at 794 lines against the 800 cap), and the members blocks join them here.
 * @structure renderSelfSourced(block, into, handles) → whether the block was one of these
 * @usage if (renderSelfSourced(block, into, alive.handles)) return;   // inside mosaic.js buildBlock
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial: legalLinks, auditTrail, feedbackForm and reviewerLine moved from
 *     mosaic.js unchanged; members and joinRequest added (members.js), workspaceTeam
 *     (workspace-team.js), intakeForm and intakeAdmin (intake-form.js), and connections
 *     (connections.js).
 */
import { legalLinks, auditTrail, feedbackForm, reviewerLine } from './commercial.js';
import { members, joinRequest } from './members.js';
import { workspaceTeam } from './workspace-team.js';
import { intakeForm, intakeAdmin } from './intake-form.js';
import { connections } from './connections.js';

/**
 * Render one self-sourced block into `into`, pushing its handle onto `handles`.
 * @param {{ id: string, component: string, props?: Record<string, any> }} block
 * @param {HTMLElement} into
 * @param {Array<{ destroy?: () => void }>} handles
 * @returns {boolean} false when the block is not one of these
 */
export function renderSelfSourced(block, into, handles) {
  const p = block.props || {};
  switch (block.component) {
    // ── The commercial side: self-sourced blocks (the app's own public legal surface, the
    //    organism row space and the intake form the props name), no memory source to bind.
    case 'legalLinks': {
      handles.push(legalLinks({ target: into, title: p.title }));
      return true;
    }
    case 'auditTrail': {
      handles.push(auditTrail({
        target: into, org: p.org, ws: p.ws, space: p.space, title: p.title, hint: p.hint,
      }));
      return true;
    }
    case 'feedbackForm': {
      handles.push(feedbackForm({
        target: into, org: p.org, ws: p.ws, formId: p.formId, title: p.title, hint: p.hint,
      }));
      return true;
    }
    case 'reviewerLine': {
      handles.push(reviewerLine({ target: into }));
      return true;
    }
    // ── The app's own members, over AIMEAT.iam. `roles` is a comma list, least power first.
    case 'members': {
      handles.push(members({
        target: into, app: p.app, roles: rolesOf(p.roles), approveRole: p.approveRole, title: p.title, variant: p.variant,
      }));
      return true;
    }
    case 'joinRequest': {
      handles.push(joinRequest({ target: into, app: p.app, roles: rolesOf(p.roles), title: p.title }));
      return true;
    }
    // ── A workspace's people, over AIMEAT.organism.
    case 'workspaceTeam': {
      handles.push(workspaceTeam({ target: into, org: p.org, ws: p.ws, title: p.title, variant: p.variant }));
      return true;
    }
    // ── A Public Intake form and the owner's list of forms, over AIMEAT.intake.
    case 'intakeForm': {
      handles.push(intakeForm({
        target: into, org: p.org, ws: p.ws, formId: p.formId, title: p.title, hint: p.hint,
      }));
      return true;
    }
    case 'intakeAdmin': {
      handles.push(intakeAdmin({ target: into, org: p.org, ws: p.ws, namespace: p.namespace, title: p.title }));
      return true;
    }
    // ── The owner's outside accounts, over AIMEAT.connect.
    case 'connections': {
      handles.push(connections({ target: into, title: p.title, need: p.need }));
      return true;
    }
    default:
      return false;
  }
}

/** "member, admin" → ['member', 'admin']; nothing → undefined, so the library keeps its own. */
function rolesOf(v) {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
