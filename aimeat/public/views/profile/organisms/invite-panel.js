/**
 * @file invite-panel.js
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
import { CopyButton } from '/components/CopyButton.js';

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
    <div class="pj-eminvite-wslabel">${t('organisms.inviteWorkspacesLabel') || 'Grant workspace access (optional)'}</div>
    <div class="pj-eminvite-wslist">
      ${wsOptions.map(w => html`
        <div class="pj-eminvite-wsrow" key=${w.id}>
          <label>
            <input type="checkbox" checked=${!!sel[w.id]} onChange=${(e) => toggle(w.id, e.target.checked)} />
            ${w.name}
          </label>
          ${sel[w.id] ? html`
            <select class="input-field input-sm" value=${sel[w.id]} onChange=${(e) => setRole(w.id, e.target.value)}>
              <option value="viewer">${t('organisms.roleViewer') || 'Viewer'}</option>
              <option value="contributor">${t('organisms.roleContributor') || 'Contributor'}</option>
            </select>` : null}
        </div>`)}
    </div>`;
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
    <div class="pj-eminvite">
      <div class="pj-eminvite-grid">
        <div class="pj-eminvite-field">
          <label>${t('organisms.whoLabel') || 'Owner name or email'}</label>
          <${ContactPicker} value=${who} onChange=${setWho} onSubmit=${submit} autofocus=${true}
            kinds=${['ghii']}
            placeholder=${t('organisms.whoPlaceholder') || 'owner name or name@example.com'} disabled=${busy} />
        </div>
        <div class="pj-eminvite-field">
          <label>${t('organisms.inviteRoleLabel') || 'Role'}</label>
          <select class="input-field input-sm" value=${role} onChange=${(e) => setRole(e.target.value)}>
            <option value="member">${t('organisms.roleMember') || 'Member'}</option>
            <option value="admin">${t('organisms.roleAdmin') || 'Admin'}</option>
          </select>
        </div>
        ${isEmail ? html`
          <div class="pj-eminvite-field">
            <label>${t('organisms.inviteExpiryLabel') || 'Expires in'}</label>
            <select class="input-field input-sm" value=${String(expiresInDays)} onChange=${(e) => setExpiresInDays(Number(e.target.value))}>
              <option value="1">${t('organisms.expiry1d') || '1 day'}</option>
              <option value="7">${t('organisms.expiry7d') || '7 days'}</option>
              <option value="30">${t('organisms.expiry30d') || '30 days'}</option>
            </select>
          </div>` : null}
      </div>

      <${WsGrantList} wsOptions=${wsOptions} sel=${wsSel} onChange=${setWsSel} />

      ${isEmail ? html`
        <div class="pj-eminvite-field">
          <label>${t('organisms.inviteMessageLabel') || 'Personal message (optional)'}</label>
          <textarea class="input-field input-sm" rows="2" value=${message} onInput=${(e) => setMessage(e.target.value)}></textarea>
        </div>
        <div class="section-desc">${t('organisms.emailInviteHint') || 'This looks like an email address — a registration invitation will be emailed.'}</div>
      ` : html`
        <label class="pj-invpanel-accept">
          <input type="checkbox" checked=${requireAccept} onChange=${(e) => setRequireAccept(e.target.checked)} />
          ${t('organisms.requireAcceptance') || 'Require acceptance — send an invitation instead of adding directly'}
        </label>
        ${!requireAccept ? html`<div class="section-desc">${t('organisms.directAddHint') || 'The member is added immediately with the selected rights. They are notified and can leave at any time.'}</div>` : null}
      `}

      <div class="pj-eminvite-actions">
        <button class="btn-primary btn-sm" disabled=${busy || !who.trim()} onClick=${submit}>${submitLabel}</button>
        <button class="btn-ghost btn-sm" onClick=${() => onClose?.()}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>

      ${emResult ? html`
        <div class="pj-eminvite-url">
          <div class="section-desc">${emResult.email_sent ? (t('organisms.inviteEmailSentHint') || 'Email sent. You can also share this link:') : (t('organisms.inviteLinkHint') || 'Share this link with the invitee:')}</div>
          ${emResult.accept_url}
          <div><${CopyButton} text=${emResult.accept_url} className="btn-outline btn-sm"
            label=${t('common.copyLink') || 'Copy link'}
            onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')} /></div>
        </div>` : null}
    </div>`;
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
    <div class="detail-label">${t('organisms.pendingInvites') || 'Pending invitations'}</div>
    ${rows.map(row => html`
      <div key=${`${row.kind}-${row.id}`}>
        <div class="pj-eminvite-pending-row">
          <span>${row.kind === 'email' ? '✉ ' : '👤 '}${row.label}</span>
          <span class="badge badge-info">${row.role === 'admin' ? (t('organisms.roleAdmin') || 'Admin') : (t('organisms.roleMember') || 'Member')}</span>
          <span class="pj-eminvite-pending-meta">
            ${row.grants.length ? `${row.grants.length} ${t('organisms.workspacesShort') || 'ws'}` : ''}${row.grants.length && row.meta ? ' · ' : ''}${row.meta}
          </span>
          <button class="btn-ghost btn-sm pj-eminvite-pending-cancel" disabled=${busy}
            onClick=${() => (editing && editing.id === row.id && editing.kind === row.kind) ? setEditing(null) : startEdit(row)}>
            ${t('organisms.editInvite') || 'Edit'}</button>
          <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => withdraw(row)}>${t('organisms.withdraw') || 'Withdraw'}</button>
        </div>
        ${editing && editing.id === row.id && editing.kind === row.kind ? html`
          <div class="pj-eminvite pj-pinv-editor">
            <div class="pj-eminvite-grid">
              <div class="pj-eminvite-field">
                <label>${t('organisms.inviteRoleLabel') || 'Role'}</label>
                <select class="input-field input-sm" value=${editing.role} onChange=${(e) => setEditing(ed => ({ ...ed, role: e.target.value }))}>
                  <option value="member">${t('organisms.roleMember') || 'Member'}</option>
                  <option value="admin">${t('organisms.roleAdmin') || 'Admin'}</option>
                </select>
              </div>
            </div>
            <${WsGrantList} wsOptions=${wsOptions} sel=${editing.wsSel} onChange=${(sel) => setEditing(ed => ({ ...ed, wsSel: sel }))} />
            <div class="pj-eminvite-actions">
              <button class="btn-primary btn-sm" disabled=${busy} onClick=${saveEdit}>${t('organisms.saveChanges') || 'Save'}</button>
              <button class="btn-ghost btn-sm" onClick=${() => setEditing(null)}>${t('organisms.cancel') || 'Cancel'}</button>
            </div>
          </div>` : null}
      </div>`)}
  `;
}
