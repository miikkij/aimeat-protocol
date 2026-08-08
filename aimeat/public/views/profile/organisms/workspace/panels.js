/**
 * @file public/views/profile/organisms/workspace/panels.js
 * @description The fixed panels + chrome of the organism workspace view: the grouped tab nav, the
 *   add-document-space form, the Settings panel (manifest form, spaces, process/restructure, danger
 *   zone), the public Share tab, the Review (publish-gate + approvals) tab, and the Activity tab.
 *   Pure render functions driven by a ctx bag assembled by the parent Workspace. Extracted from
 *   workspace.js to satisfy max-file-lines with no behaviour change.
 * @structure renderTabsNav, renderSpacesAdd, renderSettingsPanel, renderShareTab, renderReviewTab,
 *   renderActivityTab
 * @usage import { renderSettingsPanel } from '/views/profile/organisms/workspace/panels.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — The public-viewer share link is a shared <CopyButton> (common.copyLink + onCopied toast)
 *       instead of the ctx.copyShareLink handler.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { EmptyState } from '/components/EmptyState.js';
import { Mermaid } from '/components/Mermaid.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
import { WorkspaceGenerator } from './generator.js';

export function renderTabsNav(ctx) {
  const { groups, activeTab, wsSearchCounts, unseenOf, openGroup, pickTab, scrollToSpace, guardWsDirty, setShowSettings, setShowSpaces } = ctx;
  return html`
    <div class="pj-org-groups" role="tablist">
      ${groups.map(g => {
        const stacked = g.kind === 'stacked';
        const groupActive = activeTab === g.id;
        // While searching, a stacked (content) group shows only the spaces that have matches.
        const members = (wsSearchCounts && stacked) ? g.members.filter(tb => wsSearchCounts[tb.ot.name]) : g.members;
        if (wsSearchCounts && stacked && !members.length) return null;
        return html`
          <div class="pj-org-group ${groupActive ? 'active' : ''}" key=${g.id}>
            ${stacked
              ? html`<button class="pj-org-group-cap ${groupActive ? 'active' : ''}" title=${g.desc || ''} onClick=${() => openGroup(g.id)}>
                  ${g.label}${g.count !== null && g.count !== undefined ? html`<span class="pj-org-tab-count">${g.count}</span>` : null}
                </button>`
              : html`<span class="pj-org-group-cap pj-org-group-cap-static">${g.label}</span>`}
            <div class="pj-org-group-tabs">
              ${members.map(tb => {
                // Related members are independent panels; a stacked member scrolls within its group.
                const isActive = activeTab === tb.id;
                const u = isActive ? 0 : unseenOf(tb.id);
                const matchCount = (wsSearchCounts && stacked) ? wsSearchCounts[tb.ot.name] : null;
                const onClick = stacked ? () => scrollToSpace(g.id, tb.ot.name) : () => pickTab(tb.id);
                return html`
                  <button class="pj-org-tab ${isActive ? 'active' : ''}" role="tab" aria-selected=${isActive} key=${tb.id} onClick=${onClick}>
                    ${(tb.label)}${matchCount != null ? html`<span class="pj-org-tab-count pj-org-tab-match">${matchCount}</span>`
                      : (tb.count !== null && tb.count !== undefined ? html`<span class="pj-org-tab-count">${tb.count}</span>` : null)}
                    ${u > 0 ? html`<span class="pj-org-tab-unseen" title=${t('organisms.unseenHint') || 'Changed since your last visit'}>${u}</span>` : null}
                  </button>`;
              })}
            </div>
          </div>`;
      })}
      <button class="pj-org-tab pj-ws-tab-add" title=${t('organisms.addDocSpaceTitle') || 'Add a document space'} onClick=${() => guardWsDirty(() => { setShowSettings(false); setShowSpaces(s => !s); })}>+</button>
    </div>`;
}

export function renderSpacesAdd(ctx) {
  const { newSpaceName, setNewSpaceName, addSpaceHandler, busy, setShowSpaces } = ctx;
  return html`
    <div class="pj-inbox pj-spaces-add">
      <div class="card-h3">${t('organisms.addDocSpaceTitle') || 'Add a document space'}</div>
      <div class="section-desc">${t('organisms.addDocSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). Record types need a schema, so they are designed with AI in Settings → Process (restructure).'}</div>
      <div class="pj-space-row">
        <input type="text" class="input-field input-sm" placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addSpaceHandler(); }} />
        <button class="btn-primary btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
        <button class="btn-ghost btn-sm" onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>
    </div>`;
}

export function renderSettingsPanel(ctx) {
  const {
    ws, sName, setSName, sSummary, setSSummary, sAutonomy, setSAutonomy, saveSettings, busy, wsDirty,
    resetSettingsForm, setShowSettings, isDocSpace, removeSpaceHandler, newSpaceName, setNewSpaceName,
    addSpaceHandler, gateOn, showFlow, setShowFlow, showRegenerate, setShowRegenerate, delConfirm,
    setDelConfirm, delWorkspace, orgId, wsId, showToast, load, genBusy, setGenBusy,
  } = ctx;
  return html`
    <div class="pj-inbox">
      <div class="pj-meta-line">
        <span>${t('organisms.template') || 'Template'} ${(ws.manifest?.kind || '-')}</span>
        ${ws.manifest?.updatedAt ? html`<span>${t('organisms.lastSaved') || 'Last saved'} ${fmtDate(ws.manifest.updatedAt)}</span>` : null}
      </div>

      <div class="pj-form-card">
        <div class="pj-form-group">${t('organisms.formIdentity') || 'Identity'}</div>
        <label class="pj-field"><span>${t('organisms.wsName') || 'Name'}</span>
          <input type="text" class="input-field input-sm" value=${sName} onInput=${e => setSName(e.target.value)} /></label>
        <label class="pj-field"><span>${t('organisms.wsSummary') || 'Summary'}</span>
          <textarea class="input-field input-sm" rows="2" value=${sSummary} onInput=${e => setSSummary(e.target.value)}></textarea></label>

        <div class="pj-form-group">${t('organisms.formAgentPolicy') || 'Agent policy'}</div>
        <label class="pj-field"><span>${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'}</span>
          <select class="input-field input-sm" value=${sAutonomy} onChange=${e => setSAutonomy(e.target.value)}>
            ${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => html`<option value=${l} key=${l}>${l} — ${t(`organisms.autonomyLevels.${l}`) || ''}</option>`)}
          </select></label>
        <div class="pj-form-hint">${t('organisms.autonomyHint') || 'Guidance for agents working here — L1 asks before nearly everything, L5 acts freely. The publish gate (Review tab) still applies regardless.'}</div>

        <div class="form-actions">
          <button class="btn-primary btn-sm" onClick=${saveSettings} disabled=${busy || !wsDirty}>${t('organisms.saveChanges') || 'Save changes'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => { resetSettingsForm(); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      </div>

      <div class="pj-divider"></div>
      <div class="pj-form-group">${t('organisms.spaces') || 'Spaces'}</div>
      <div class="pj-form-hint">${t('organisms.spacesRemoveHint') || 'These actions apply immediately. Removing a space hides its section — the data stays in memory and comes back if a space with the same name is added again.'}</div>
      ${(ws.manifest?.objectTypes || []).map(ot => html`
        <div class="pj-doc-row" key=${'sp' + ot.name}>
          <span class="pj-space-name">${(ot.name)}<span class="pj-doc-tag">${isDocSpace(ot) ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}</span></span>
          <button class="btn-ghost btn-sm" onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}</button>
        </div>
      `)}
      <div class="form-actions">
        <input type="text" class="input-field input-sm" placeholder=${t('organisms.docSpaceNamePlaceholder') || 'New document space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} />
        <button class="btn-outline btn-sm" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
      </div>

      <div class="pj-divider"></div>
      <div class="pj-form-group">${t('organisms.formProcess') || 'Process'}</div>
      ${ws.manifest ? html`
        <div class="pj-chart">
          <div class="pj-chart-head">
            <span class="pj-chart-title">${'🔄 '}${t('organisms.editFlow') || 'How editing works here'}</span>
            <button class="btn-ghost btn-sm" onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
          </div>
          ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}
        </div>` : null}
      <button class="btn-outline btn-sm" onClick=${() => setShowRegenerate(s => !s)}>
        ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || '✨ Restructure / add types with AI')}
      </button>
      ${showRegenerate ? html`<${WorkspaceGenerator} orgId=${orgId} wsId=${wsId} showToast=${showToast}
        onApplied=${load} onOpenSettings=${() => setShowSettings(true)} showRegenerate=${showRegenerate}
        manifest=${ws?.manifest} genBusy=${genBusy} setGenBusy=${setGenBusy} />` : null}

      <div class="pj-divider"></div>
      <div class="pj-danger">
        <div class="pj-danger-title">${t('organisms.dangerZone') || 'Danger zone'}</div>
        <div class="section-desc">${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}</div>
        <label class="pj-field"><span>${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}</span>
          <input type="text" class="input-field input-sm" value=${delConfirm} onInput=${e => setDelConfirm(e.target.value)} placeholder=${ws.manifest?.name || ''} /></label>
        <button class="btn-danger btn-sm" onClick=${delWorkspace}
          disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}</button>
      </div>
    </div>`;
}

export function renderShareTab(ctx) {
  const { share, docTypes, shareBusy, patchShare, objectsFor, wsT, isDocPublic, sharePw, setSharePw, showToast, anythingPublic, orgId, wsId } = ctx;
  return html`
    <div class="pj-section">
      <div class="section-desc">${t('organisms.sharePublicDesc') || 'Make published document-space pages readable by anyone with the link — no login required. Drafts are never shared. Anything you make public is also announced on the public activity feed on the front page.'}</div>
      ${share && docTypes.length > 0 ? html`
        <div class="pj-share-feed">
          ${share.public
            ? html`<div class="pj-share-feed-on">
                <span>${t('organisms.feedPublishedAll') || '📣 This whole workspace is published to the public feed.'}</span>
                <button class="btn-ghost btn-sm" disabled=${shareBusy} onClick=${() => patchShare({ public: false })}>${t('organisms.feedUnpublish') || 'Unpublish'}</button>
              </div>`
            : html`<button class="btn-primary btn-sm" disabled=${shareBusy}
                onClick=${() => { if (window.confirm(t('organisms.feedPublishConfirm') || 'Publish every published document in this workspace to the public activity feed on the front page?')) patchShare({ public: true }); }}>
                ${t('organisms.feedPublishBtn') || '📣 Publish to public feed'}
              </button>`}
        </div>` : null}
      ${docTypes.length === 0 ? html`<${EmptyState} icon="🌐" text=${t('organisms.noDocSpaces') || 'This workspace has no document spaces to share.'} />` : html`
        ${!share && shareBusy ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading…'}</div>` : null}
        ${share ? docTypes.map(ot => {
          const docs = objectsFor(ot.name);
          const spaceOn = !!(share.spaces && share.spaces[ot.name]);
          return html`
            <div class="pj-share-space" key=${'sh' + ot.name}>
              <label class="pj-share-row">
                <input type="checkbox" checked=${spaceOn} disabled=${shareBusy} onChange=${e => patchShare({ spaces: { [ot.name]: e.target.checked } })} />
                <span class="pj-space-name">${wsT('type.' + ot.name) || ot.name}</span>
                <span class="pj-doc-tag">${docs.length} ${t('organisms.docs') || 'docs'}</span>
              </label>
              ${docs.length === 0
                ? html`<div class="pj-empty pj-share-empty">${t('organisms.noPublishedDocs') || 'No published documents yet — publish a page to share it.'}</div>`
                : html`<div class="pj-share-docs">
                    ${docs.map(d => {
                      const on = isDocPublic(ot.name, d.id);
                      return html`
                        <label class="pj-share-doc" key=${'shd' + d.id}>
                          <input type="checkbox" checked=${on} disabled=${shareBusy} onChange=${e => patchShare({ docs: { [`${ot.name}/${d.id}`]: e.target.checked } })} />
                          <span class="pj-share-doc-title">${d.title || d.id}</span>
                          ${on ? html`<a class="pj-share-link" href=${orgService.publicViewerUrl(orgId, wsId, { type: ot.name, id: d.id })} target="_blank" rel="noopener">${t('organisms.openLink') || 'open ↗'}</a>` : null}
                        </label>`;
                    })}
                  </div>`}
            </div>`;
        }) : null}
        ${share ? html`
          <div class="pj-share-access">
            <div class="card-h3">${t('organisms.shareAccessTitle') || 'Who can open the shared pages'}</div>
            <label class="pj-share-row">
              <input type="radio" name="pj-share-access" checked=${share.access === 'open'} disabled=${shareBusy}
                onChange=${() => patchShare({ access: 'open' })} />
              <span>${t('organisms.shareAccessOpen') || 'Anyone with the link (default)'}</span>
            </label>
            <label class="pj-share-row">
              <input type="radio" name="pj-share-access" checked=${share.access === 'password'} disabled=${shareBusy}
                onChange=${(e) => {
                  if (share.has_password) { patchShare({ access: 'password' }); return; }
                  if (sharePw.trim().length >= 4) { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); return; }
                  // No password yet: don't error out — keep the current mode, point at the field instead.
                  e.target.checked = share.access === 'password';
                  showToast(t('organisms.sharePasswordMissing') || 'Type a password (at least 4 characters) below — setting it turns password protection on');
                  const inp = document.getElementById('pj-share-pw-input'); if (inp) inp.focus();
                }} />
              <span>${t('organisms.shareAccessPassword') || 'Anyone with the link and the password'}</span>
            </label>
            <div class="pj-share-pw">
              <span class="pj-share-pw-state">${share.has_password
                ? (t('organisms.sharePasswordSet') || '🔑 A password is set')
                : (t('organisms.sharePasswordUnset') || 'No password set')}</span>
              <input type="password" id="pj-share-pw-input" class="pj-share-pw-input" autocomplete="new-password"
                placeholder=${t('organisms.sharePasswordPlaceholder') || 'Share password (4–128 chars)'}
                value=${sharePw} disabled=${shareBusy}
                onInput=${e => setSharePw(e.target.value)} />
              <button class="btn-outline btn-sm" disabled=${shareBusy || sharePw.trim().length < 4}
                onClick=${() => { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); }}>
                ${share.has_password ? (t('organisms.sharePasswordChange') || 'Change password') : (t('organisms.sharePasswordSave') || 'Set password')}
              </button>
              ${share.has_password ? html`
                <button class="btn-ghost btn-sm" disabled=${shareBusy}
                  onClick=${() => { if (window.confirm(t('organisms.sharePasswordClearConfirm') || 'Remove the share password? The shared pages become link-only.')) patchShare({ access: 'open', password: null }); }}>
                  ${t('organisms.sharePasswordClear') || 'Remove password'}
                </button>` : null}
            </div>
            <label class="pj-share-row">
              <input type="radio" name="pj-share-access" checked=${share.access === 'account'} disabled=${shareBusy}
                onChange=${() => patchShare({ access: 'account' })} />
              <span>${t('organisms.shareAccessAccount') || 'Signed-in users only — any account on this node, not just members'}</span>
            </label>
            <div class="pj-share-access-note">${t('organisms.shareAccessNote') || "Default: anyone with the link. Workspace members always see these pages through their membership regardless of this choice — it only gates the public link. If you don't want outsiders at all, simply don't share."}</div>
          </div>` : null}
        ${anythingPublic() ? html`
          <div class="pj-share-actions">
            <a class="btn-outline btn-sm" href=${orgService.publicViewerUrl(orgId, wsId)} target="_blank" rel="noopener">${'🔗 '}${t('organisms.openPublicViewer') || 'Open public viewer'}</a>
            <${CopyButton} text=${window.location.origin + orgService.publicViewerUrl(orgId, wsId)} className="btn-ghost btn-sm"
              label=${t('common.copyLink') || 'Copy link'}
              onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')} />
          </div>` : null}
      `}
    </div>`;
}

export function renderReviewTab(ctx) {
  const { gateOn, toggleGate, busy, approvals, resolve } = ctx;
  return html`
    <div class="pj-section">
      <label class="pj-gate-label" title=${t('organisms.publishGateHint') || 'When on, an agent’s publish is held for your review instead of going live'}>
        <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
        ${'🔒 '}${t('organisms.publishGate') || 'Require review before publishing'}
      </label>
      ${approvals.length === 0
        ? html`<${EmptyState} icon="📭" text=${t('organisms.reviewEmpty') || 'Nothing waiting for review.'} />`
        : html`
          <div class="card-h3">${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})</div>
          ${approvals.map(a => html`
            <div class="pj-approval" key=${a.id}>
              <div class="pj-approval-text">${(a.prompt || a.action)}</div>
              <div class="card-actions">
                <button class="btn-success btn-sm" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}</button>
                <button class="btn-danger btn-sm" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}</button>
              </div>
            </div>
          `)}`}
    </div>`;
}

export function renderActivityTab(ctx) {
  const { orgId, wsId, ws } = ctx;
  return html`
    <${ActivityPanel} orgId=${orgId} wsId=${wsId} />
    ${(ws.decisions || []).length > 0 ? html`
      <div class="pj-section">
        <div class="pj-section-title">${t('organisms.decisions') || 'Recent decisions'}</div>
        ${ws.decisions.slice(-8).reverse().map((d, i) => html`
          <div class="pj-item pj-decision" key=${'dec' + i}><span class="pj-item-text">${(String(d.summary || ''))}</span></div>
        `)}
      </div>` : null}`;
}
