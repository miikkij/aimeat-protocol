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
 *   v1.2.1 -- 2026-09-22 -- Withdraw carries the danger tone.
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared set (Surface, Field, ListRow, Chip, CopyAction):
 *     no class of its own; the envelope and person emoji before a pending row are gone.
 *   v1.0.0 — 2026-07-16 — Initial: unified direct-add/invite/email form + editable pending rows.
 *   v1.1.0 — 2026-08-08 — The accept-link copy is a shared <CopyButton> with an onCopied toast, replacing the
 *       copyAcceptUrl handler; label is the shared common.copyLink.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Stack, Columns, Surface, Field, ListRow, Chip, Action, CopyAction, Text } from '/components/poster-parts.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_OPTIONS = () => [
  { value: 'member', label: t('organisms.roleMember') || 'Member' },
  { value: 'admin', label: t('organisms.roleAdmin') || 'Admin' },
];

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
  return html`<${Stack} density="compact">
    <${Text} kind="label">${t('organisms.inviteWorkspacesLabel') || 'Grant workspace access (optional)'}<//>
    ${wsOptions.map(w => html`
      <${Columns} key=${w.id} density="compact" collapse="560">
        <${Field} type="checkbox" label=${w.name} value=${!!sel[w.id]} onChange=${(e) => toggle(w.id, e.target.checked)} />
        ${sel[w.id] ? html`
          <${Field} type="select" value=${sel[w.id]} onChange=${(e) => setRole(w.id, e.target.value)} options=${[
            { value: 'viewer', label: t('organisms.roleViewer') || 'Viewer' },
            { value: 'contributor', label: t('organisms.roleContributor') || 'Contributor' },
          ]} />` : null}
      <//>`)}
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
    <${Surface} kind="box">
      <${Stack}>
        <${Columns} layout=${isEmail ? 'thirds' : 'leading'} density="compact" collapse="640">
          <${Stack} density="compact">
            <${Text} kind="label">${t('organisms.whoLabel') || 'Owner name or email'}<//>
            <${ContactPicker} value=${who} onChange=${setWho} onSubmit=${submit} autofocus=${true}
              kinds=${['ghii']}
              placeholder=${t('organisms.whoPlaceholder') || 'owner name or name@example.com'} disabled=${busy} />
          <//>
          <${Field} type="select" label=${t('organisms.inviteRoleLabel') || 'Role'} value=${role} onChange=${(e) => setRole(e.target.value)} options=${ROLE_OPTIONS()} />
          ${isEmail ? html`
            <${Field} type="select" label=${t('organisms.inviteExpiryLabel') || 'Expires in'} value=${String(expiresInDays)} onChange=${(e) => setExpiresInDays(Number(e.target.value))} options=${[
              { value: '1', label: t('organisms.expiry1d') || '1 day' },
              { value: '7', label: t('organisms.expiry7d') || '7 days' },
              { value: '30', label: t('organisms.expiry30d') || '30 days' },
            ]} />` : null}
        <//>

        <${WsGrantList} wsOptions=${wsOptions} sel=${wsSel} onChange=${setWsSel} />

        ${isEmail ? html`
          <${Field} type="textarea" rows=${2} label=${t('organisms.inviteMessageLabel') || 'Personal message (optional)'} value=${message} onInput=${(e) => setMessage(e.target.value)} />
          <${Text} kind="caption" tone="muted">${t('organisms.emailInviteHint') || 'This looks like an email address — a registration invitation will be emailed.'}<//>
        ` : html`
          <${Field} type="checkbox" label=${t('organisms.requireAcceptance') || 'Require acceptance — send an invitation instead of adding directly'}
            value=${requireAccept} onChange=${(e) => setRequireAccept(e.target.checked)} />
          ${!requireAccept ? html`<${Text} kind="caption" tone="muted">${t('organisms.directAddHint') || 'The member is added immediately with the selected rights. They are notified and can leave at any time.'}<//>` : null}
        `}

        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${busy || !who.trim()} onClick=${submit}>${submitLabel}<//>
          <${Action} onClick=${() => onClose?.()}>${t('organisms.cancel') || 'Cancel'}<//>
        <//>

        ${emResult ? html`
          <${Stack} density="compact" align="start">
            <${Text} kind="caption" tone="muted">${emResult.email_sent ? (t('organisms.inviteEmailSentHint') || 'Email sent. You can also share this link:') : (t('organisms.inviteLinkHint') || 'Share this link with the invitee:')}<//>
            <${Text} kind="mono">${emResult.accept_url}<//>
            <${CopyAction} text=${emResult.accept_url} label=${t('common.copyLink') || 'Copy link'}
              onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')} />
          <//>` : null}
      <//>
    <//>`;
}

/**
 * Pending invitations — name invites + email invites merged into uniform manageable rows:
 * identity, role chip, workspace-grant count, inviter/expiry meta, an inline rights editor
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

  return html`<${Stack} density="compact">
    <${Text} kind="label">${t('organisms.pendingInvites') || 'Pending invitations'}<//>
    ${rows.map(row => {
      const open = editing && editing.id === row.id && editing.kind === row.kind;
      return html`
      <${ListRow} key=${`${row.kind}-${row.id}`} density="compact" name=${row.label}
        detail=${`${row.grants.length ? `${row.grants.length} ${t('organisms.workspacesShort') || 'ws'}` : ''}${row.grants.length && row.meta ? ' · ' : ''}${row.meta}` || undefined}
        actions=${html`<${Chip}>${row.role === 'admin' ? (t('organisms.roleAdmin') || 'Admin') : (t('organisms.roleMember') || 'Member')}<//>
          <${Action} kind="tab" selected=${!!open} disabled=${busy} onClick=${() => (open ? setEditing(null) : startEdit(row))}>${t('organisms.editInvite') || 'Edit'}<//>
          <${Action} tone="danger" disabled=${busy} onClick=${() => withdraw(row)}>${t('organisms.withdraw') || 'Withdraw'}<//>`}>
        ${open ? html`
          <${Surface} kind="box" density="compact">
            <${Stack}>
              <${Field} type="select" label=${t('organisms.inviteRoleLabel') || 'Role'} value=${editing.role} onChange=${(e) => setEditing(ed => ({ ...ed, role: e.target.value }))} options=${ROLE_OPTIONS()} />
              <${WsGrantList} wsOptions=${wsOptions} sel=${editing.wsSel} onChange=${(sel) => setEditing(ed => ({ ...ed, wsSel: sel }))} />
              <${Stack} direction="wrap" align="center">
                <${Action} kind="primary" disabled=${busy} onClick=${saveEdit}>${t('organisms.saveChanges') || 'Save'}<//>
                <${Action} onClick=${() => setEditing(null)}>${t('organisms.cancel') || 'Cancel'}<//>
              <//>
            <//>
          <//>` : null}
      <//>`; })}
  <//>`;
}
