/**
 * @file public/views/profile/organisms/workspace/panels.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fixed panels of the organism workspace view: the add-document-space form, the
 *   Settings panel (manifest form, spaces, process/restructure, danger zone), the public Share
 *   panel, the Review (publish-gate + approvals) panel, and the Activity panel. Pure render
 *   functions driven by a ctx bag assembled by the parent Workspace; cover.js frames each one as
 *   a page. Extracted from workspace.js to satisfy max-file-lines with no behaviour change.
 * @structure renderSpacesAdd, renderSettingsPanel, renderShareTab, renderReviewTab, renderActivityTab
 * @usage import { renderSettingsPanel } from '/views/profile/organisms/workspace/panels.js';
 * @version-history
 *   2026-09-22 -- The danger zone is the set's solid danger aside; Remove, Remove password and Reject
 *     carry the danger tone, Approve the success tone. The template and last-saved chips moved to the
 *     settings page's identity line (cover.js), where the template chip already stood twice.
 *   2026-09-22 -- Composed from the shared set (Section, Field, ListRow, Action, CopyAction): no class of
 *     its own. The share-access radios are tab-style radio actions (a click on the password choice
 *     without a password still points at the field instead of switching); emoji fallbacks removed.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v2.0.0 — 2026-08-29 — renderTabsNav removed: the cover (cover.js) replaced the 21-tab block with
 *     tables and a rail, and a panel is a page of its own.
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — The public-viewer share link is a shared <CopyButton> (common.copyLink + onCopied toast)
 *       instead of the ctx.copyShareLink handler.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Stack, Surface, ListRow, Chip, Action, CopyAction, Field, Text } from '/components/poster-parts.js';
import { Mermaid } from '/components/Mermaid.js';
import * as orgService from '/js/services/organisms.js';
import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
import { WorkspaceGenerator } from './generator.js';

export function renderSpacesAdd(ctx) {
  const { newSpaceName, setNewSpaceName, addSpaceHandler, busy, setShowSpaces } = ctx;
  return html`
    <${Surface} kind="box" density="compact">
      <${Stack}>
        <${Text} kind="heading">${t('organisms.addDocSpaceTitle') || 'Add a document space'}<//>
        <${Text} kind="caption" tone="muted">${t('organisms.addDocSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). Record types need a schema, so they are designed with AI in Settings → Process (restructure).'}<//>
        <${Stack} direction="wrap" align="end">
          <${Field} placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addSpaceHandler(); }} />
          <${Action} onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}<//>
          <${Action} kind="text" onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}<//>
        <//>
      <//>
    <//>`;
}

export function renderSettingsPanel(ctx) {
  const {
    ws, sName, setSName, sSummary, setSSummary, sAutonomy, setSAutonomy, saveSettings, busy, wsDirty,
    resetSettingsForm, setShowSettings, isDocSpace, removeSpaceHandler, newSpaceName, setNewSpaceName,
    addSpaceHandler, gateOn, showFlow, setShowFlow, showRegenerate, setShowRegenerate, delConfirm,
    setDelConfirm, delWorkspace, orgId, wsId, showToast, load, genBusy, setGenBusy,
  } = ctx;
  return html`<${Stack}>
    <${Section} title=${t('organisms.formIdentity') || 'Identity'} size="small" density="compact">
      <${Stack}>
        <${Field} label=${t('organisms.wsName') || 'Name'} value=${sName} onInput=${e => setSName(e.target.value)} />
        <${Field} type="textarea" rows=${2} label=${t('organisms.wsSummary') || 'Summary'} value=${sSummary} onInput=${e => setSSummary(e.target.value)} />
      <//>
    <//>

    <${Section} title=${t('organisms.formAgentPolicy') || 'Agent policy'} size="small" density="compact">
      <${Stack}>
        <${Field} type="select" label=${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'} value=${sAutonomy} onChange=${e => setSAutonomy(e.target.value)}
          options=${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => ({ value: l, label: `${l} — ${t(`organisms.autonomyLevels.${l}`) || ''}` }))} />
        <${Text} kind="caption" tone="muted">${t('organisms.autonomyHint') || 'Guidance for agents working here — L1 asks before nearly everything, L5 acts freely. The publish gate (Review tab) still applies regardless.'}<//>
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" onClick=${saveSettings} disabled=${busy || !wsDirty}>${t('organisms.saveChanges') || 'Save changes'}<//>
          <${Action} onClick=${() => { resetSettingsForm(); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}<//>
        <//>
      <//>
    <//>

    <${Section} title=${t('organisms.spaces') || 'Spaces'} size="small" density="compact">
      <${Stack}>
        <${Text} kind="caption" tone="muted">${t('organisms.spacesRemoveHint') || 'These actions apply immediately. Removing a space hides its section — the data stays in memory and comes back if a space with the same name is added again.'}<//>
        <${Stack} density="compact">
          ${(ws.manifest?.objectTypes || []).map(ot => html`
            <${ListRow} key=${'sp' + ot.name} density="compact" name=${ot.name}
              actions=${html`<${Chip} tone="muted">${isDocSpace(ot) ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}<//>
                <${Action} tone="danger" onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}<//>`} />`)}
        <//>
        <${Stack} direction="wrap" align="end">
          <${Field} placeholder=${t('organisms.docSpaceNamePlaceholder') || 'New document space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} />
          <${Action} onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}<//>
        <//>
      <//>
    <//>

    <${Section} title=${t('organisms.formProcess') || 'Process'} size="small" density="compact">
      <${Stack} align="start">
        ${ws.manifest ? html`
          <${Stack} direction="wrap" align="center">
            <${Text} kind="label">${t('organisms.editFlow') || 'How editing works here'}<//>
            <${Action} kind="tab" selected=${showFlow} onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}<//>
          <//>
          ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}` : null}
        <${Action} kind="tab" selected=${showRegenerate} onClick=${() => setShowRegenerate(s => !s)}>
          ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || 'Restructure / add types with AI')}
        <//>
        ${showRegenerate ? html`<${WorkspaceGenerator} orgId=${orgId} wsId=${wsId} showToast=${showToast}
          onApplied=${load} onOpenSettings=${() => setShowSettings(true)} showRegenerate=${showRegenerate}
          manifest=${ws?.manifest} genBusy=${genBusy} setGenBusy=${setGenBusy} />` : null}
      <//>
    <//>

    <${Section} title=${t('organisms.dangerZone') || 'Danger zone'} size="small" density="compact">
      <${Surface} kind="aside" tone="danger">
        <${Stack}>
          <${Text}>${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}<//>
          <${Stack} direction="wrap" align="end">
            <${Field} label=${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}
              value=${delConfirm} onInput=${e => setDelConfirm(e.target.value)} placeholder=${ws.manifest?.name || ''} />
            <${Action} kind="primary" tone="danger" onClick=${delWorkspace}
              disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}<//>
          <//>
        <//>
      <//>
    <//>
  <//>`;
}

export function renderShareTab(ctx) {
  const { share, docTypes, shareBusy, patchShare, objectsFor, wsT, isDocPublic, sharePw, setSharePw, showToast, anythingPublic, orgId, wsId } = ctx;
  const pickPassword = () => {
    if (share.has_password) { patchShare({ access: 'password' }); return; }
    if (sharePw.trim().length >= 4) { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); return; }
    // No password yet: don't error out — keep the current mode, point at the field instead.
    showToast(t('organisms.sharePasswordMissing') || 'Type a password (at least 4 characters) below — setting it turns password protection on');
    const inp = document.getElementById('pj-share-pw-input'); if (inp) inp.focus();
  };
  const accessChoice = (on, onClick, label) => html`<${Action} kind="tab" semantics="radio" selected=${on} disabled=${shareBusy} onClick=${onClick}>${label}<//>`;
  return html`<${Stack}>
    <${Text} tone="muted">${t('organisms.sharePublicDesc') || 'Make published document-space pages readable by anyone with the link — no login required. Drafts are never shared. Anything you make public is also announced on the public activity feed on the front page.'}<//>
    ${share && docTypes.length > 0 ? html`
      <${Stack} direction="wrap" align="center">
        ${share.public
          ? html`<${Text}>${t('organisms.feedPublishedAll') || 'This whole workspace is published to the public feed.'}<//>
              <${Action} disabled=${shareBusy} onClick=${() => patchShare({ public: false })}>${t('organisms.feedUnpublish') || 'Unpublish'}<//>`
          : html`<${Action} kind="primary" disabled=${shareBusy}
              onClick=${() => { if (window.confirm(t('organisms.feedPublishConfirm') || 'Publish every published document in this workspace to the public activity feed on the front page?')) patchShare({ public: true }); }}>
              ${t('organisms.feedPublishBtn') || 'Publish to public feed'}
            <//>`}
      <//>` : null}
    ${docTypes.length === 0 ? html`<${Text} tone="muted">${t('organisms.noDocSpaces') || 'This workspace has no document spaces to share.'}<//>` : html`
      ${!share && shareBusy ? html`<${Text} tone="muted">${t('organisms.loading') || 'Loading…'}<//>` : null}
      ${share ? docTypes.map(ot => {
        const docs = objectsFor(ot.name);
        const spaceOn = !!(share.spaces && share.spaces[ot.name]);
        return html`
          <${Stack} key=${'sh' + ot.name} density="compact">
            <${Field} type="checkbox" label=${`${wsT('type.' + ot.name) || ot.name} · ${docs.length} ${t('organisms.docs') || 'docs'}`} value=${spaceOn} disabled=${shareBusy}
              onChange=${e => patchShare({ spaces: { [ot.name]: e.target.checked } })} />
            ${docs.length === 0
              ? html`<${Text} kind="caption" tone="muted">${t('organisms.noPublishedDocs') || 'No published documents yet — publish a page to share it.'}<//>`
              : html`<${Stack} density="compact">
                  ${docs.map(d => {
                    const on = isDocPublic(ot.name, d.id);
                    return html`
                      <${Stack} key=${'shd' + d.id} direction="horizontal" align="center">
                        <${Field} type="checkbox" label=${d.title || d.id} value=${on} disabled=${shareBusy} onChange=${e => patchShare({ docs: { [`${ot.name}/${d.id}`]: e.target.checked } })} />
                        ${on ? html`<${Action} kind="text" href=${orgService.publicViewerUrl(orgId, wsId, { type: ot.name, id: d.id })} target="_blank">${t('organisms.openLink') || 'open ↗'}<//>` : null}
                      <//>`;
                  })}
                <//>`}
          <//>`;
      }) : null}
      ${share ? html`
        <${Section} title=${t('organisms.shareAccessTitle') || 'Who can open the shared pages'} size="small" density="compact">
          <${Stack} role="radiogroup" label=${t('organisms.shareAccessTitle') || 'Who can open the shared pages'} align="start">
            ${accessChoice(share.access === 'open', () => patchShare({ access: 'open' }), t('organisms.shareAccessOpen') || 'Anyone with the link (default)')}
            ${accessChoice(share.access === 'password', pickPassword, t('organisms.shareAccessPassword') || 'Anyone with the link and the password')}
            <${Surface} kind="box" density="compact">
              <${Stack} direction="wrap" align="end">
                <${Text} kind="caption">${share.has_password
                  ? (t('organisms.sharePasswordSet') || 'A password is set')
                  : (t('organisms.sharePasswordUnset') || 'No password set')}<//>
                <${Field} type="password" id="pj-share-pw-input" autoComplete="new-password"
                  placeholder=${t('organisms.sharePasswordPlaceholder') || 'Share password (4–128 chars)'}
                  value=${sharePw} disabled=${shareBusy}
                  onInput=${e => setSharePw(e.target.value)} />
                <${Action} disabled=${shareBusy || sharePw.trim().length < 4}
                  onClick=${() => { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); }}>
                  ${share.has_password ? (t('organisms.sharePasswordChange') || 'Change password') : (t('organisms.sharePasswordSave') || 'Set password')}
                <//>
                ${share.has_password ? html`
                  <${Action} kind="text" tone="danger" disabled=${shareBusy}
                    onClick=${() => { if (window.confirm(t('organisms.sharePasswordClearConfirm') || 'Remove the share password? The shared pages become link-only.')) patchShare({ access: 'open', password: null }); }}>
                    ${t('organisms.sharePasswordClear') || 'Remove password'}
                  <//>` : null}
              <//>
            <//>
            ${accessChoice(share.access === 'account', () => patchShare({ access: 'account' }), t('organisms.shareAccessAccount') || 'Signed-in users only — any account on this node, not just members')}
            <${Text} kind="caption" tone="muted">${t('organisms.shareAccessNote') || "Default: anyone with the link. Workspace members always see these pages through their membership regardless of this choice — it only gates the public link. If you don't want outsiders at all, simply don't share."}<//>
          <//>
        <//>` : null}
      ${anythingPublic() ? html`
        <${Stack} direction="wrap" align="center">
          <${Action} href=${orgService.publicViewerUrl(orgId, wsId)} target="_blank">${t('organisms.openPublicViewer') || 'Open public viewer'}<//>
          <${CopyAction} text=${window.location.origin + orgService.publicViewerUrl(orgId, wsId)} kind="text"
            label=${t('common.copyLink') || 'Copy link'}
            onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')} />
        <//>` : null}
    `}
  <//>`;
}

export function renderReviewTab(ctx) {
  const { gateOn, toggleGate, busy, approvals, resolve } = ctx;
  return html`<${Stack}>
    <${Field} type="checkbox" label=${t('organisms.publishGate') || 'Require review before publishing'} hint=${t('organisms.publishGateHint') || 'When on, an agent’s publish is held for your review instead of going live'}
      value=${gateOn} onChange=${toggleGate} disabled=${busy} />
    ${approvals.length === 0
      ? html`<${Text} tone="muted">${t('organisms.reviewEmpty') || 'Nothing waiting for review.'}<//>`
      : html`
        <${Text} kind="label">${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})<//>
        <${Stack} density="compact">
          ${approvals.map(a => html`
            <${ListRow} key=${a.id} density="compact" name=${a.prompt || a.action}
              actions=${html`<${Action} tone="success" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}<//>
                <${Action} kind="text" tone="danger" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}<//>`} />`)}
        <//>`}
  <//>`;
}

export function renderActivityTab(ctx) {
  const { orgId, wsId, ws } = ctx;
  return html`
    <${ActivityPanel} orgId=${orgId} wsId=${wsId} />
    ${(ws.decisions || []).length > 0 ? html`
      <${Section} title=${t('organisms.decisions') || 'Recent decisions'} size="small" density="compact">
        <${Stack} density="compact">
          ${ws.decisions.slice(-8).reverse().map((d, i) => html`<${ListRow} key=${'dec' + i} density="compact" name=${String(d.summary || '')} />`)}
        <//>
      <//>` : null}`;
}
