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
 *   2026-09-25 -- Settings: "Members' changes", the workspace's rule for a change from a member who is
 *     neither its creator nor an admin (made at once, or waits for approval).
 *   v2.21.0 -- 2026-09-26 -- What to share, who can open it and the review gate are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v2.20.0 -- 2026-09-26 -- The workspace's recent decisions are the home's Timeline (components/Timeline.js): when each was made, the made dot, the decision as its line (a unification: Jouni's decision "Activity log").
 *   v2.19.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v2.18.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v2.17.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.16.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v2.15.0 -- 2026-09-25 -- Whether a share password is set is the Status (.poster-status: fine when set, off when not), a unification: Jouni's decision "Status".
 *   v2.14.0 -- 2026-09-25 -- A shared document's "open ↗" is the action link (.poster-action) (a unification: Jouni's decision "Action link").
 *   v2.13.0 -- 2026-09-25 -- The settings' list of spaces and the publishes waiting for review are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v2.12.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v2.12.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v2.12.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.11.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v2.11.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.10.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.9.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v2.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.7.0 -- 2026-09-25 -- A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v2.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.5.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v2.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v2.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { CopyButton } from '/components/CopyButton.js';
import { QuietNote } from '/components/QuietNote.js';
import { Mermaid } from '/components/Mermaid.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { WorkspaceGenerator } from './generator.js';

export function renderSpacesAdd(ctx) {
  const { newSpaceName, setNewSpaceName, addSpaceHandler, busy, setShowSpaces } = ctx;
  return html`
    <div class="pj-inbox poster-box pj-spaces-add">
      <div class="card-h3 sub-heading">${t('organisms.addDocSpaceTitle') || 'Add a document space'}</div>
      <div class="section-desc">${t('organisms.addDocSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). Record types need a schema, so they are designed with AI in Settings → Process (restructure).'}</div>
      <div class="pj-space-row">
        <input type="text" class="og-input" placeholder=${t('organisms.spaceName') || 'New space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addSpaceHandler(); }} />
        <button class="poster-slab poster-slab--control" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
        <button class="poster-action poster-action--small" onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}</button>
      </div>
    </div>`;
}

export function renderSettingsPanel(ctx) {
  const {
    ws, sName, setSName, sSummary, setSSummary, sAutonomy, setSAutonomy, saveSettings, busy, wsDirty,
    resetSettingsForm, setShowSettings, isDocSpace, removeSpaceHandler, newSpaceName, setNewSpaceName,
    addSpaceHandler, gateOn, showFlow, setShowFlow, showRegenerate, setShowRegenerate, delConfirm,
    setDelConfirm, delWorkspace, orgId, wsId, showToast, load, genBusy, setGenBusy, setMemberChanges,
  } = ctx;
  return html`
    <div class="pj-inbox poster-box">
      <div class="pj-meta-line">
        <span>${t('organisms.template') || 'Template'} ${(ws.manifest?.kind || '-')}</span>
        ${ws.manifest?.updatedAt ? html`<span>${t('organisms.lastSaved') || 'Last saved'} ${fmtDate(ws.manifest.updatedAt)}</span>` : null}
      </div>

      <div class="pj-form-card poster-box">
        <div class="pj-form-group poster-label">${t('organisms.formIdentity') || 'Identity'}</div>
        <label class="pj-field"><span class="poster-label">${t('organisms.wsName') || 'Name'}</span>
          <input type="text" class="og-input" value=${sName} onInput=${e => setSName(e.target.value)} /></label>
        <label class="pj-field"><span class="poster-label">${t('organisms.wsSummary') || 'Summary'}</span>
          <textarea class="og-textarea" rows="2" value=${sSummary} onInput=${e => setSSummary(e.target.value)}></textarea></label>

        <div class="pj-form-group poster-label">${t('organisms.formAgentPolicy') || 'Agent policy'}</div>
        <label class="pj-field"><span class="poster-label">${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'}</span>
          <select class="select-field" value=${sAutonomy} onChange=${e => setSAutonomy(e.target.value)}>
            ${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => html`<option value=${l} key=${l}>${l} — ${t(`organisms.autonomyLevels.${l}`) || ''}</option>`)}
          </select></label>
        <div class="poster-hint">${t('organisms.autonomyHint') || 'Guidance for agents working here — L1 asks before nearly everything, L5 acts freely. The publish gate (Review tab) still applies regardless.'}</div>

        <div class="form-actions">
          <button class="poster-slab poster-slab--control" onClick=${saveSettings} disabled=${busy || !wsDirty}>${t('organisms.saveChanges') || 'Save changes'}</button>
          <button class="poster-action poster-action--small" onClick=${() => { resetSettingsForm(); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      </div>

      <div class="pj-divider"></div>
      <div class="pj-form-group poster-label">${t('organisms.spaces') || 'Spaces'}</div>
      <div class="poster-hint">${t('organisms.spacesRemoveHint') || 'These actions apply immediately. Removing a space hides its section — the data stays in memory and comes back if a space with the same name is added again.'}</div>
      <div class="listing listing--name-state listing--cols">
        ${(ws.manifest?.objectTypes || []).map(ot => html`
          <div class="listing-row" key=${'sp' + ot.name}>
            <div class="listing-name">${(ot.name)}<span class="poster-chip">${isDocSpace(ot) ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}</span></div>
            <div class="listing-doors"><button class="poster-action poster-action--small poster-action--row" onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}</button></div>
          </div>
        `)}
      </div>
      <div class="form-actions">
        <input type="text" class="og-input" placeholder=${t('organisms.docSpaceNamePlaceholder') || 'New document space name'} value=${newSpaceName} onInput=${e => setNewSpaceName(e.target.value)} />
        <button class="poster-action poster-action--small" onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}</button>
      </div>

      <div class="pj-divider"></div>
      <div class="pj-form-group poster-label">${t('organisms.memberChanges.title') || "Members' changes"}</div>
      <div class="poster-hint">${t('organisms.memberChanges.hint') || 'When a member who is neither the creator nor an admin adds a space or changes sections:'}</div>
      <label class="pj-field"><span class="poster-label">${t('organisms.memberChanges.label') || 'Their change'}</span>
        <select class="select-field" value=${ws.rules?.member_changes || 'suggest'} disabled=${busy}
          onChange=${e => setMemberChanges(e.target.value)}>
          <option value="suggest">${t('organisms.memberChanges.suggest') || 'waits until the creator or an admin approves it'}</option>
          <option value="direct">${t('organisms.memberChanges.direct') || 'is made at once, with their name on it'}</option>
        </select></label>

      <div class="pj-divider"></div>
      <div class="pj-form-group poster-label">${t('organisms.formProcess') || 'Process'}</div>
      ${ws.manifest ? html`
        <div class="pj-chart poster-box">
          <div class="pj-chart-head">
            <span class="pj-chart-title">${'🔄 '}${t('organisms.editFlow') || 'How editing works here'}</span>
            <button class="poster-action poster-action--small" onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
          </div>
          ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}
        </div>` : null}
      <button class="poster-action poster-action--small" onClick=${() => setShowRegenerate(s => !s)}>
        ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || '✨ Restructure / add types with AI')}
      </button>
      ${showRegenerate ? html`<${WorkspaceGenerator} orgId=${orgId} wsId=${wsId} showToast=${showToast}
        onApplied=${load} onOpenSettings=${() => setShowSettings(true)} showRegenerate=${showRegenerate}
        manifest=${ws?.manifest} genBusy=${genBusy} setGenBusy=${setGenBusy} />` : null}

      <div class="pj-divider"></div>
      <div class="pj-danger poster-aside poster-aside--small poster-aside--irreversible">
        <div class="pj-danger-title">${t('organisms.dangerZone') || 'Danger zone'}</div>
        <div class="section-desc">${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}</div>
        <label class="pj-field"><span class="poster-label">${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}</span>
          <input type="text" class="og-input" value=${delConfirm} onInput=${e => setDelConfirm(e.target.value)} placeholder=${ws.manifest?.name || ''} /></label>
        <button class="poster-action poster-action--small poster-action--danger" onClick=${delWorkspace}
          disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}</button>
      </div>
    </div>`;
}

export function renderShareTab(ctx) {
  const { share, docTypes, shareBusy, patchShare, objectsFor, wsT, isDocPublic, sharePw, setSharePw, showToast, anythingPublic, orgId, wsId } = ctx;
  return html`
    <div class="pj-section poster-row--thing">
      <div class="section-desc">${t('organisms.sharePublicDesc') || 'Make published document-space pages readable by anyone with the link — no login required. Drafts are never shared. Anything you make public is also announced on the public activity feed on the front page.'}</div>
      ${share && docTypes.length > 0 ? html`
        <div class="pj-share-feed">
          ${share.public
            ? html`<div class="pj-share-feed-on poster-box">
                <span>${t('organisms.feedPublishedAll') || '📣 This whole workspace is published to the public feed.'}</span>
                <button class="poster-action poster-action--small" disabled=${shareBusy} onClick=${() => patchShare({ public: false })}>${t('organisms.feedUnpublish') || 'Unpublish'}</button>
              </div>`
            : html`<button class="poster-slab poster-slab--control" disabled=${shareBusy}
                onClick=${() => { if (window.confirm(t('organisms.feedPublishConfirm') || 'Publish every published document in this workspace to the public activity feed on the front page?')) patchShare({ public: true }); }}>
                ${t('organisms.feedPublishBtn') || '📣 Publish to public feed'}
              </button>`}
        </div>` : null}
      ${docTypes.length === 0 ? html`<${QuietNote}>${t('organisms.noDocSpaces') || 'This workspace has no document spaces to share.'}<//>` : html`
        ${!share && shareBusy ? html`<div class="poster-quiet pj-empty loading-mark">${t('organisms.loading') || 'Loading…'}</div>` : null}
        ${share ? docTypes.map(ot => {
          const docs = objectsFor(ot.name);
          const spaceOn = !!(share.spaces && share.spaces[ot.name]);
          return html`
            <div class="pj-share-space" key=${'sh' + ot.name}>
              <label class="pj-share-row check-line">
                <input type="checkbox" checked=${spaceOn} disabled=${shareBusy} onChange=${e => patchShare({ spaces: { [ot.name]: e.target.checked } })} />
                <span class="pj-space-name">${wsT('type.' + ot.name) || ot.name}</span>
                <span class="poster-chip">${docs.length} ${t('organisms.docs') || 'docs'}</span>
              </label>
              ${docs.length === 0
                ? html`<div class="poster-quiet pj-empty pj-share-empty">${t('organisms.noPublishedDocs') || 'No published documents yet — publish a page to share it.'}</div>`
                : html`<div class="pj-share-docs">
                    ${docs.map(d => {
                      const on = isDocPublic(ot.name, d.id);
                      return html`
                        <label class="pj-share-doc check-line" key=${'shd' + d.id}>
                          <input type="checkbox" checked=${on} disabled=${shareBusy} onChange=${e => patchShare({ docs: { [`${ot.name}/${d.id}`]: e.target.checked } })} />
                          <span class="pj-share-doc-title">${d.title || d.id}</span>
                          ${on ? html`<a class="poster-action poster-action--small" href=${orgService.publicViewerUrl(orgId, wsId, { type: ot.name, id: d.id })} target="_blank" rel="noopener">${t('organisms.openLink') || 'open ↗'}</a>` : null}
                        </label>`;
                    })}
                  </div>`}
            </div>`;
        }) : null}
        ${share ? html`
          <div class="pj-share-access poster-box">
            <div class="card-h3 sub-heading">${t('organisms.shareAccessTitle') || 'Who can open the shared pages'}</div>
            <label class="pj-share-row check-line">
              <input type="radio" name="pj-share-access" checked=${share.access === 'open'} disabled=${shareBusy}
                onChange=${() => patchShare({ access: 'open' })} />
              <span>${t('organisms.shareAccessOpen') || 'Anyone with the link (default)'}</span>
            </label>
            <label class="pj-share-row check-line">
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
              <span class=${`poster-status ${share.has_password ? 'poster-status--fine' : 'poster-status--off'}`}>${share.has_password
                ? (t('organisms.sharePasswordSet') || '🔑 A password is set')
                : (t('organisms.sharePasswordUnset') || 'No password set')}</span>
              <input type="password" id="pj-share-pw-input" class="og-input pj-share-pw-input" autocomplete="new-password"
                placeholder=${t('organisms.sharePasswordPlaceholder') || 'Share password (4–128 chars)'}
                value=${sharePw} disabled=${shareBusy}
                onInput=${e => setSharePw(e.target.value)} />
              <button class="poster-action poster-action--small" disabled=${shareBusy || sharePw.trim().length < 4}
                onClick=${() => { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); }}>
                ${share.has_password ? (t('organisms.sharePasswordChange') || 'Change password') : (t('organisms.sharePasswordSave') || 'Set password')}
              </button>
              ${share.has_password ? html`
                <button class="poster-action poster-action--small" disabled=${shareBusy}
                  onClick=${() => { if (window.confirm(t('organisms.sharePasswordClearConfirm') || 'Remove the share password? The shared pages become link-only.')) patchShare({ access: 'open', password: null }); }}>
                  ${t('organisms.sharePasswordClear') || 'Remove password'}
                </button>` : null}
            </div>
            <label class="pj-share-row check-line">
              <input type="radio" name="pj-share-access" checked=${share.access === 'account'} disabled=${shareBusy}
                onChange=${() => patchShare({ access: 'account' })} />
              <span>${t('organisms.shareAccessAccount') || 'Signed-in users only — any account on this node, not just members'}</span>
            </label>
            <div class="poster-hint">${t('organisms.shareAccessNote') || "Default: anyone with the link. Workspace members always see these pages through their membership regardless of this choice — it only gates the public link. If you don't want outsiders at all, simply don't share."}</div>
          </div>` : null}
        ${anythingPublic() ? html`
          <div class="pj-share-actions">
            <a class="poster-action poster-action--small" href=${orgService.publicViewerUrl(orgId, wsId)} target="_blank" rel="noopener">${'🔗 '}${t('organisms.openPublicViewer') || 'Open public viewer'}</a>
            <${CopyButton} text=${window.location.origin + orgService.publicViewerUrl(orgId, wsId)} className="poster-action poster-action--small"
              label=${t('common.copyLink') || 'Copy link'}
              onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')} />
          </div>` : null}
      `}
    </div>`;
}

export function renderReviewTab(ctx) {
  const { gateOn, toggleGate, busy, approvals, resolve } = ctx;
  return html`
    <div class="pj-section poster-row--thing">
      <label class="pj-gate-label check-line" title=${t('organisms.publishGateHint') || 'When on, an agent’s publish is held for your review instead of going live'}>
        <input type="checkbox" checked=${gateOn} onChange=${toggleGate} disabled=${busy} />
        ${'🔒 '}${t('organisms.publishGate') || 'Require review before publishing'}
      </label>
      ${approvals.length === 0
        ? html`<${QuietNote}>${t('organisms.reviewEmpty') || 'Nothing waiting for review.'}<//>`
        : html`
          <div class="card-h3 sub-heading">${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})</div>
          <div class="listing listing--name-state listing--cols">
            ${approvals.map(a => html`
              <div class="listing-row" key=${a.id}>
                <div class="listing-name">${(a.prompt || a.action)}</div>
                <div class="listing-doors">
                  <button class="poster-action poster-action--small poster-action--row" onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}</button>
                  <button class="poster-action poster-action--small poster-action--row poster-action--danger" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}</button>
                </div>
              </div>
            `)}
          </div>`}
    </div>`;
}

export function renderActivityTab(ctx) {
  const { orgId, wsId, ws } = ctx;
  return html`
    <${ActivityPanel} orgId=${orgId} wsId=${wsId} />
    ${(ws.decisions || []).length > 0 ? html`
      <div class="pj-section poster-row--thing">
        <div class="pj-section-title poster-day-title poster-day-title--quiet">${t('organisms.decisions') || 'Recent decisions'}</div>
        <${TimelineList}>${ws.decisions.slice(-8).reverse().map((d, i) => html`
          <${TimelineRow} key=${'dec' + i} category="made" when=${d._createdAt ? fmtDate(d._createdAt) : ''} text=${(String(d.summary || ''))} />
        `)}<//>
      </div>` : null}`;
}
