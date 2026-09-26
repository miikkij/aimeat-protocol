/**
 * @file invite-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unified "add people" panel for the organism Members tab + the pending-invitation
 *   rows. ONE form handles all three paths: an existing owner name → DIRECT ADD (active
 *   immediately, default) or a name invitation (when "require acceptance" is ticked), and an
 *   email address → email invitation (message + expiry appear). Role + per-workspace grants are
 *   chosen up front in every path. Pending invitations (name + email merged) render as proper
 *   rows with an inline rights editor (PATCH) and a withdraw/cancel action.
 * @structure InvitePanel (the form); PendingInvites (pending rows + inline editor);
 *   WsGrantList (shared workspace checkbox+role list).
 * @usage import { InvitePanel, PendingInvites } from '/views/profile/organisms/invite-panel.js';
 * @version-history
 *   v1.9.0 — 2026-09-26 — Every part is a kit component (page group G2a): the form is the Box with the Fields (who, role and expiry in a Row of fields, the workspace grants a Field group of Check lines each with its role Select, the message a TextArea, the acceptance a Check), FormActions at its foot, and the accept link in the Box's copy tone with a copy Action; the pending invitations are the List under a Group heading, Edit opening the row's panel. The page writes no class.
 *   v1.11.0 — 2026-09-26 — A workspace to invite to and "Require acceptance" are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.10.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.9.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 — 2026-09-26 — The pending invitations are the Listing (css/components/listing.css, name-desc-doors, columns kept on a phone); an invitation's editor is the row's open panel (.listing-open, framed), not a box of its own (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The labels over the invitation's fields and over its workspace list are the row label (.poster-label) (Jouni's decision "Row label", a unification).
 *   v1.6.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v1.0.0 — 2026-07-16 — Initial: unified direct-add/invite/email form + editable pending rows.
 *   v1.1.0 — 2026-08-08 — The accept-link copy is a shared <CopyButton> with an onCopied toast, replacing the
 *       copyAcceptUrl handler; label is the shared common.copyLink.
 *   v1.2.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Box } from '/components/Box.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { TextArea } from '/components/TextField.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { HeadDesc } from '/components/SubHeading.js';
import { Row, Stack } from '/components/Layout.js';
import { List, Row as ListRow, Name, Desc, Doors, Group } from '/components/List.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared workspace grant list: checkbox per workspace + viewer/contributor select when ticked.
 *  `sel` is { [wsId]: 'viewer'|'contributor' }; onChange receives the next sel object. */
export function WsGrantList({ wsOptions, sel, onChange }) {
  if (!wsOptions.length) return null;
  const toggle = (wsId, checked) => {
    const next = { ...sel };
    if (checked) next[wsId] = next[wsId] || 'viewer'; else delete next[wsId];
    onChange(next);
  };
  const setRole = (wsId, role) => onChange({ ...sel, [wsId]: role });
  return html`
    <${Field} label=${t('organisms.inviteWorkspacesLabel') || 'Grant workspace access (optional)'} group>
      <${Stack}>
        ${wsOptions.map(w => html`
          <${Row} key=${w.id} justify="between">
            <${Check} checked=${!!sel[w.id]} onChange=${(on) => toggle(w.id, on)}>${w.name}<//>
            ${sel[w.id] ? html`
              <${Select} fit value=${sel[w.id]} onChange=${(v) => setRole(w.id, v)} ariaLabel=${w.name} options=${[
                ['viewer', t('organisms.roleViewer') || 'Viewer'],
                ['contributor', t('organisms.roleContributor') || 'Contributor'],
              ]} />` : null}
          <//>`)}
      <//>
    <//>`;
}

const selToGrants = (sel) => Object.entries(sel).map(([ws, role]) => ({ ws, role }));
const grantsToSel = (grants) => Object.fromEntries((grants || []).map(g => [g.ws, g.role]));

/**
 * The unified add/invite form. Mode follows the "who" field: an email address flips the form to
 * the email-invitation shape (message + expiry); a name defaults to DIRECT ADD with an optional
 * "require acceptance" toggle that sends a classic invitation instead.
 */
export function InvitePanel({ orgId, wsOptions, showToast, onChanged, onClose }) {
  const [who, setWho] = useState('');
  const [role, setRole] = useState('member');
  const [wsSel, setWsSel] = useState({});
  const [requireAccept, setRequireAccept] = useState(false);
  const [message, setMessage] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [emResult, setEmResult] = useState(null);

  const isEmail = EMAIL_RE.test(who.trim());

  const submit = async () => {
    const target = who.trim();
    if (!target) return;
    const workspaces = selToGrants(wsSel);
    setBusy(true);
    try {
      let r;
      if (isEmail) {
        r = await orgService.inviteByEmail(orgId, {
          email: target, orgRole: role, workspaces,
          message: message.trim() || undefined, expiresInDays: Number(expiresInDays) || 7,
        });
      } else if (requireAccept) {
        r = await orgService.inviteMember(orgId, target, { role, workspaces });
      } else {
        r = await orgService.addMemberDirect(orgId, target, { role, workspaces });
      }
      if (r?.ok === false) { showToast(r?.error?.message || (t('organisms.inviteFailed') || 'Failed'), true); }
      else {
        if (isEmail) {
          setEmResult({ accept_url: r?.data?.accept_url, email_sent: r?.data?.email_sent });
          showToast(r?.data?.email_sent ? (t('organisms.inviteEmailSent') || 'Invitation email sent') : (t('organisms.inviteCreated') || 'Invitation created — share the link'));
        } else {
          showToast(requireAccept ? (t('organisms.invitationSent') || 'Invitation sent') : (t('organisms.memberAdded') || 'Member added'));
        }
        setWho(''); setRole('member'); setWsSel({}); setMessage('');
        if (!isEmail) onClose?.();
      }
      onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.inviteFailed') || 'Failed'), true); }
    finally { setBusy(false); }
  };

  const submitLabel = isEmail
    ? (t('organisms.sendInvite') || 'Send invitation')
    : requireAccept ? (t('organisms.sendInvite') || 'Send invitation') : (t('organisms.addMember') || 'Add member');

  return html`
    <${Box}>
      <${Fields}>
        <${Row} wrap align="end">
          <${Field} label=${t('organisms.whoLabel') || 'Owner name or email'}>
            <${ContactPicker} value=${who} onChange=${setWho} onSubmit=${submit} autofocus=${true}
              kinds=${['ghii']}
              placeholder=${t('organisms.whoPlaceholder') || 'owner name or name@example.com'} disabled=${busy} />
          <//>
          <${Select} label=${t('organisms.inviteRoleLabel') || 'Role'} value=${role} onChange=${setRole} options=${[
            ['member', t('organisms.roleMember') || 'Member'],
            ['admin', t('organisms.roleAdmin') || 'Admin'],
          ]} />
          ${isEmail ? html`
            <${Select} label=${t('organisms.inviteExpiryLabel') || 'Expires in'} value=${String(expiresInDays)} onChange=${(v) => setExpiresInDays(Number(v))} options=${[
              ['1', t('organisms.expiry1d') || '1 day'],
              ['7', t('organisms.expiry7d') || '7 days'],
              ['30', t('organisms.expiry30d') || '30 days'],
            ]} />` : null}
        <//>

        <${WsGrantList} wsOptions=${wsOptions} sel=${wsSel} onChange=${setWsSel} />

        ${isEmail ? html`
          <${TextArea} label=${t('organisms.inviteMessageLabel') || 'Personal message (optional)'} rows=${2} value=${message} onInput=${setMessage} />
          <${HeadDesc}>${t('organisms.emailInviteHint') || 'This looks like an email address — a registration invitation will be emailed.'}<//>
        ` : html`
          <${Check} checked=${requireAccept} onChange=${setRequireAccept}>
            ${t('organisms.requireAcceptance') || 'Require acceptance — send an invitation instead of adding directly'}
          <//>
          ${!requireAccept ? html`<${HeadDesc}>${t('organisms.directAddHint') || 'The member is added immediately with the selected rights. They are notified and can leave at any time.'}<//>` : null}
        `}

        <${FormActions}>
          <${Loud} control disabled=${busy || !who.trim()} onClick=${submit}>${submitLabel}<//>
          <${Action} small onClick=${() => onClose?.()}>${t('organisms.cancel') || 'Cancel'}<//>
        <//>
      <//>

      ${emResult ? html`
        <${Box} tone="copy">
          <${HeadDesc}>${emResult.email_sent ? (t('organisms.inviteEmailSentHint') || 'Email sent. You can also share this link:') : (t('organisms.inviteLinkHint') || 'Share this link with the invitee:')}<//>
          <${Code}>${emResult.accept_url}<//>
          <${Actions}>
            <${Action} small copy=${emResult.accept_url} onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')}>${t('common.copyLink') || 'Copy link'}<//>
          <//>
        <//>` : null}
    <//>`;
}

/**
 * Pending invitations — name invites + email invites merged into uniform manageable rows:
 * identity, role badge, workspace-grant count, inviter/expiry meta, an inline rights editor
 * (role + workspace grants → PATCH), and withdraw/cancel.
 */
export function PendingInvites({ orgId, invitations, emailInvites, wsOptions, showToast, onChanged }) {
  const [editing, setEditing] = useState(null);   // { kind:'name'|'email', id, role, wsSel }
  const [busy, setBusy] = useState(false);

  const rows = [
    ...(invitations || []).map(m => ({
      kind: 'name', id: m.ghii, label: m.ghii, role: m.role || 'member',
      grants: m.invitedWorkspaces || [], meta: m.invitedBy ? `${t('organisms.invitedBy') || 'invited by'} ${m.invitedBy}` : '',
    })),
    ...(emailInvites || []).map(inv => ({
      kind: 'email', id: inv.id, label: inv.email, role: inv.org_role || 'member',
      grants: inv.workspaces || [], meta: inv.expires_at ? `${t('organisms.expiresLabel') || 'expires'} ${fmtDate(inv.expires_at)}` : '',
    })),
  ];
  if (!rows.length) return null;

  const startEdit = (row) => setEditing({ kind: row.kind, id: row.id, role: row.role, wsSel: grantsToSel(row.grants) });
  const saveEdit = async () => {
    setBusy(true);
    try {
      const workspaces = selToGrants(editing.wsSel);
      const r = editing.kind === 'name'
        ? await orgService.updateInvitation(orgId, editing.id, { role: editing.role, workspaces })
        : await orgService.updateEmailInvitation(orgId, editing.id, { orgRole: editing.role, workspaces });
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.inviteFailed') || 'Failed'), true);
      else { showToast(t('organisms.inviteUpdated') || 'Invitation updated'); setEditing(null); }
      onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.inviteFailed') || 'Failed'), true); }
    finally { setBusy(false); }
  };
  const withdraw = async (row) => {
    setBusy(true);
    try {
      const r = row.kind === 'name'
        ? await orgService.cancelInvitation(orgId, row.id)
        : await orgService.cancelEmailInvitation(orgId, row.id);
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.inviteFailed') || 'Failed'), true);
      else showToast(t('organisms.inviteCancelled') || 'Invitation cancelled');
      onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.inviteFailed') || 'Failed'), true); }
    finally { setBusy(false); }
  };

  return html`
    <${Group} title=${t('organisms.pendingInvites') || 'Pending invitations'}>
      <${List} cols="name-desc-doors" keepCols>
        ${rows.map(row => {
          const isOpen = !!(editing && editing.id === row.id && editing.kind === row.kind);
          return html`
            <${ListRow} key=${`${row.kind}-${row.id}`} open=${isOpen} panel=${isOpen ? html`
              <${Fields}>
                <${Select} label=${t('organisms.inviteRoleLabel') || 'Role'} value=${editing.role} onChange=${(v) => setEditing(ed => ({ ...ed, role: v }))} options=${[
                  ['member', t('organisms.roleMember') || 'Member'],
                  ['admin', t('organisms.roleAdmin') || 'Admin'],
                ]} />
                <${WsGrantList} wsOptions=${wsOptions} sel=${editing.wsSel} onChange=${(sel) => setEditing(ed => ({ ...ed, wsSel: sel }))} />
                <${FormActions}>
                  <${Loud} control disabled=${busy} onClick=${saveEdit}>${t('organisms.saveChanges') || 'Save'}<//>
                  <${Action} small onClick=${() => setEditing(null)}>${t('organisms.cancel') || 'Cancel'}<//>
                <//>
              <//>` : null}>
              <${Name} tag=${html`<${Mark}>${row.role === 'admin' ? (t('organisms.roleAdmin') || 'Admin') : (t('organisms.roleMember') || 'Member')}<//>`}>${row.kind === 'email' ? '✉ ' : '👤 '}${row.label}<//>
              <${Desc}>
                ${row.grants.length ? `${row.grants.length} ${t('organisms.workspacesShort') || 'ws'}` : ''}${row.grants.length && row.meta ? ' · ' : ''}${row.meta}
              <//>
              <${Doors}>
                <${Action} small row disabled=${busy} expanded=${isOpen}
                  onClick=${() => isOpen ? setEditing(null) : startEdit(row)}>
                  ${t('organisms.editInvite') || 'Edit'}<//>
                <${Action} small row disabled=${busy} onClick=${() => withdraw(row)}>${t('organisms.withdraw') || 'Withdraw'}<//>
              <//>
            <//>`;
        })}
      <//>
    <//>
  `;
}
