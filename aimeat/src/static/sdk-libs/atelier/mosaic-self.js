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
 *   v0.63.0 — 2026-10-02 — aiChat joins (ai-chat.js); doc passes `variant`, decision `decisionId`,
 *     workspaceTeam `inviteInto`, workspacePicker `allowPrivate` and `multiple`, connections and
 *     decision `via`.
 *   v0.62.0 — 2026-10-01 — workspacePicker joins (workspace-picker.js), and workspaceTeam, intakeForm
 *     and intakeAdmin pass `app`, so they follow the picker's choice when org and ws are left empty.
 *   v0.61.0 — 2026-10-01 — Initial: legalLinks, auditTrail, feedbackForm and reviewerLine moved from
 *     mosaic.js unchanged; members and joinRequest added (members.js), workspaceTeam
 *     (workspace-team.js), intakeForm and intakeAdmin (intake-form.js), and connections
 *     (connections.js).
 *   v0.62.0 — 2026-10-01 — workflowInput (workflow-input.js), aiTask (ai-task.js), doc (doc.js) and
 *     decision (decision.js).
 */
import { legalLinks, auditTrail, feedbackForm, reviewerLine } from './commercial.js';
import { members, joinRequest } from './members.js';
import { workspaceTeam } from './workspace-team.js';
import { workspacePicker } from './workspace-picker.js';
import { intakeForm, intakeAdmin } from './intake-form.js';
import { connections } from './connections.js';
import { workflowInput } from './workflow-input.js';
import { aiTask } from './ai-task.js';
import { aiChat } from './ai-chat.js';
import { doc } from './doc.js';
import { decision } from './decision.js';

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
    // ── A workspace's people, over AIMEAT.organism. With `app` and no org or ws, it opens on the
    //    workspace the picker above it chose (workspace-choice.js).
    case 'workspaceTeam': {
      handles.push(workspaceTeam({ target: into, org: p.org, ws: p.ws, app: p.app, title: p.title, variant: p.variant, inviteInto: p.inviteInto }));
      return true;
    }
    // ── Where the app keeps its records: the first-run choice, announced to the blocks below.
    case 'workspacePicker': {
      handles.push(workspacePicker({
        target: into, app: p.app, name: p.name, kind: p.kind, purpose: p.purpose, title: p.title, variant: p.variant,
        allowPrivate: p.allowPrivate, multiple: p.multiple,
      }));
      return true;
    }
    // ── A Public Intake form and the owner's list of forms, over AIMEAT.intake.
    case 'intakeForm': {
      handles.push(intakeForm({
        target: into, org: p.org, ws: p.ws, app: p.app, formId: p.formId, title: p.title, hint: p.hint,
      }));
      return true;
    }
    case 'intakeAdmin': {
      handles.push(intakeAdmin({ target: into, org: p.org, ws: p.ws, app: p.app, namespace: p.namespace, title: p.title }));
      return true;
    }
    // ── The owner's outside accounts, over AIMEAT.connect.
    // ── A workflow step waiting for a person, over AIMEAT.workflows.
    case 'workflowInput': {
      handles.push(workflowInput({ target: into, run: p.run, title: p.title, variant: p.variant }));
      return true;
    }
    // ── Ask the person's own AI once, over AIMEAT.ai. `prompt` is a template: {input} is what the
    //    person wrote; input "none" draws a run button with no box.
    case 'aiTask': {
      const tpl = String(p.prompt || '{input}');
      const min = parseInt(p.minChars, 10);
      handles.push(aiTask({
        target: into, appId: p.appId, title: p.title, hint: p.hint,
        input: p.input === 'none' ? null : { placeholder: p.placeholder, minChars: isNaN(min) ? undefined : min },
        prompt: function (text) { return tpl.split('{input}').join(text); },
        systemPrompt: p.systemPrompt, runLabel: p.runLabel, render: p.render === 'text' ? 'text' : 'markdown',
        copyPrompt: p.copyPrompt === 'true', variant: p.variant,
      }));
      return true;
    }
    // ── A markdown document, over AIMEAT.md, and one decision rule, over AIMEAT.decide.
    case 'doc': {
      handles.push(doc({ target: into, markdown: p.markdown, title: p.title, rich: p.rich === 'true', variant: p.variant }));
      return true;
    }
    case 'decision': {
      handles.push(decision({ target: into, appId: p.appId, rule: p.rule, state: p.state, title: p.title, decisionId: p.decisionId, via: p.via }));
      return true;
    }
    // ── A follow-up conversation about one document, over AIMEAT.ai.
    case 'aiChat': {
      const keep = parseInt(p.keep, 10);
      handles.push(aiChat({ target: into, appId: p.appId, context: p.context, title: p.title, hint: p.hint,
        placeholder: p.placeholder, systemPrompt: p.systemPrompt, keep: isNaN(keep) ? undefined : keep, variant: p.variant }));
      return true;
    }
    case 'connections': {
      handles.push(connections({ target: into, title: p.title, need: p.need, via: p.via }));
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
