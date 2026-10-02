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
 *   v2.23.0 -- 2026-10-02 -- The question marks that explain the workspace settings: workspace.autonomy, workspace.member_changes, workspace.publish_gate (components/HelpTip.js).
 *   2026-09-25 -- Settings: "Members' changes", the workspace's rule for a change from a member who is
 *     neither its creator nor an admin (made at once, or waits for approval).
 *   v2.22.0 -- 2026-09-26 -- Every part is a library component that takes data: the boxes are the Object
 *     box, the groups of a panel the section Card, a group heading the Sub-heading or the row Label,
 *     the fields the Text field, Text area and Select with their label and hint (the Field family),
 *     the check boxes and radio dots the Check, the lists of spaces, shared documents and publishes
 *     the List, a chart the Object box with its name and its Hide/Show door, the parts of the settings
 *     Splits (the hairline between them), the danger zone the settings box (SettingBox, irreversible),
 *     the public viewer's link and copy the action link (`href` + `newTab`, `copy`). The page writes
 *     no class (page migration G2b).
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
import { Mermaid } from '/components/Mermaid.js';
import { Box, SettingBox } from '/components/Box.js';
import { Card } from '/components/Card.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading, HeadDesc } from '/components/SubHeading.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Fields, FormActions } from '/components/Field.js';
import { Row as Line, Stack, Split, Space } from '/components/Layout.js';
import { List, Row, Name, Cell, Doors, Group } from '/components/List.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { WorkspaceGenerator } from './generator.js';

export function renderSpacesAdd(ctx) {
  const { newSpaceName, setNewSpaceName, addSpaceHandler, busy, setShowSpaces } = ctx;
  const nameWords = t('organisms.spaceName') || 'New space name';
  return html`
    <${Box}>
      <${SubHeading} desc=${t('organisms.addDocSpaceDesc') || 'A document space is a free-form wiki (sections + markdown pages). Record types need a schema, so they are designed with AI in Settings → Process (restructure).'}>${t('organisms.addDocSpaceTitle') || 'Add a document space'}<//>
      <${Space} above="small">
        <${TextField} size="medium" placeholder=${nameWords} ariaLabel=${nameWords} value=${newSpaceName} onInput=${setNewSpaceName} onEnter=${() => addSpaceHandler()}
          actions=${html`
            <${Loud} control onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}<//>
            <${Action} small onClick=${() => setShowSpaces(false)}>${t('organisms.cancel') || 'Cancel'}<//>`} />
      <//>
    <//>`;
}

export function renderSettingsPanel(ctx) {
  const {
    ws, sName, setSName, sSummary, setSSummary, sAutonomy, setSAutonomy, saveSettings, busy, wsDirty,
    resetSettingsForm, setShowSettings, isDocSpace, removeSpaceHandler, newSpaceName, setNewSpaceName,
    addSpaceHandler, gateOn, showFlow, setShowFlow, showRegenerate, setShowRegenerate, delConfirm,
    setDelConfirm, delWorkspace, orgId, wsId, showToast, load, genBusy, setGenBusy, setMemberChanges,
  } = ctx;
  const spaceWords = t('organisms.docSpaceNamePlaceholder') || 'New document space name';
  return html`
    <${Box}>
      <${Note} kind="meta">${[
        `${t('organisms.template') || 'Template'} ${(ws.manifest?.kind || '-')}`,
        ws.manifest?.updatedAt ? `${t('organisms.lastSaved') || 'Last saved'} ${fmtDate(ws.manifest.updatedAt)}` : null,
      ].filter(Boolean).join(' · ')}<//>

      <${Box}>
        <${Label} block>${t('organisms.formIdentity') || 'Identity'}<//>
        <${Fields}>
          <${TextField} label=${t('organisms.wsName') || 'Name'} value=${sName} onInput=${setSName} />
          <${TextArea} label=${t('organisms.wsSummary') || 'Summary'} rows=${2} value=${sSummary} onInput=${setSSummary} />
        <//>

        <${Space} above="large"><${Label} block>${t('organisms.formAgentPolicy') || 'Agent policy'}<//><//>
        <${Select} label=${t('organisms.autonomy') || 'AI autonomy (L1 cautious → L5 free)'} value=${sAutonomy} onChange=${setSAutonomy}
          help="workspace.autonomy"
          options=${['L1', 'L2', 'L3', 'L4', 'L5'].map(l => [l, `${l} — ${t(`organisms.autonomyLevels.${l}`) || ''}`])} />

        <${FormActions}>
          <${Loud} control onClick=${saveSettings} disabled=${busy || !wsDirty}>${t('organisms.saveChanges') || 'Save changes'}<//>
          <${Action} small onClick=${() => { resetSettingsForm(); setShowSettings(false); }}>${t('organisms.cancel') || 'Cancel'}<//>
        <//>
      <//>

      <${Split}>
        <${Label} block>${t('organisms.spaces') || 'Spaces'}<//>
        <${Note}>${t('organisms.spacesRemoveHint') || 'These actions apply immediately. Removing a space hides its section — the data stays in memory and comes back if a space with the same name is added again.'}<//>
        <${List} cols="name-state" keepCols>
          ${(ws.manifest?.objectTypes || []).map(ot => html`
            <${Row} key=${'sp' + ot.name}>
              <${Name} tag=${isDocSpace(ot) ? (t('organisms.docs') || 'docs') : (t('organisms.recordsMode') || 'records')}>${(ot.name)}<//>
              <${Doors}><${Action} small row onClick=${() => removeSpaceHandler(ot.name)} disabled=${busy}>${t('organisms.remove') || 'Remove'}<//><//>
            <//>
          `)}
        <//>
        <${Space} above="medium">
          <${TextField} size="medium" placeholder=${spaceWords} ariaLabel=${spaceWords} value=${newSpaceName} onInput=${setNewSpaceName}
            actions=${html`<${Action} small onClick=${addSpaceHandler} disabled=${busy || !newSpaceName.trim()}>${t('organisms.addSpace') || '+ Add'}<//>`} />
        <//>
      <//>

      <${Split}>
        <${Label} block>${t('organisms.memberChanges.title') || "Members' changes"}<//>
        <${Note}>${t('organisms.memberChanges.hint') || 'When a member who is neither the creator nor an admin adds a space or changes sections:'}<//>
        <${Select} label=${t('organisms.memberChanges.label') || 'Their change'} value=${ws.rules?.member_changes || 'suggest'} disabled=${busy}
          help="workspace.member_changes" onChange=${setMemberChanges}
          options=${[
            ['suggest', t('organisms.memberChanges.suggest') || 'waits until the creator or an admin approves it'],
            ['direct', t('organisms.memberChanges.direct') || 'is made at once, with their name on it'],
          ]} />
      <//>

      <${Split}>
        <${Label} block>${t('organisms.formProcess') || 'Process'}<//>
        ${ws.manifest ? html`
          <${Box} name=${'🔄 ' + (t('organisms.editFlow') || 'How editing works here')}
            end=${html`<${Action} small expanded=${showFlow} onClick=${() => setShowFlow(s => !s)}>${showFlow ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}<//>`}>
            ${showFlow ? html`<${Mermaid} chart=${orgService.buildEditFlowMermaid(ws.manifest, gateOn)} />` : null}
          <//>` : null}
        <${Action} small expanded=${showRegenerate} onClick=${() => setShowRegenerate(s => !s)}>
          ${showRegenerate ? (t('organisms.cancel') || 'Cancel') : (t('organisms.restructure') || '✨ Restructure / add types with AI')}
        <//>
        ${showRegenerate ? html`<${WorkspaceGenerator} orgId=${orgId} wsId=${wsId} showToast=${showToast}
          onApplied=${load} onOpenSettings=${() => setShowSettings(true)} showRegenerate=${showRegenerate}
          manifest=${ws?.manifest} genBusy=${genBusy} setGenBusy=${setGenBusy} />` : null}
      <//>

      <${Split}>
        <${SettingBox} label=${t('organisms.dangerZone') || 'Danger zone'} irreversible>
          <${HeadDesc}>${t('organisms.deleteWarn') || 'Deleting the workspace removes the manifest and ALL its data — drafts, published records, version history — and its schemas. The organism stays. This cannot be undone.'}<//>
          <${TextField} label=${(t('organisms.deleteConfirmLabel') || 'Type the workspace name to confirm') + ': ' + (ws.manifest?.name || '')}
            value=${delConfirm} onInput=${setDelConfirm} placeholder=${ws.manifest?.name || ''} />
          <${Action} small tone="danger" onClick=${delWorkspace}
            disabled=${busy || delConfirm.trim() !== (ws.manifest?.name || '').trim()}>${t('organisms.deleteWorkspace') || 'Delete workspace'}<//>
        <//>
      <//>
    <//>`;
}

export function renderShareTab(ctx) {
  const { share, docTypes, shareBusy, patchShare, objectsFor, wsT, isDocPublic, sharePw, setSharePw, showToast, anythingPublic, orgId, wsId } = ctx;
  const pwWords = t('organisms.sharePasswordPlaceholder') || 'Share password (4–128 chars)';
  const viewerUrl = orgService.publicViewerUrl(orgId, wsId);
  return html`
    <${Card} tone="section">
      <${HeadDesc}>${t('organisms.sharePublicDesc') || 'Make published document-space pages readable by anyone with the link — no login required. Drafts are never shared. Anything you make public is also announced on the public activity feed on the front page.'}<//>
      ${share && docTypes.length > 0 ? html`
        <${Space} above="small" below="large">
          ${share.public
            ? html`<${Box} packed>
                <${Line} wrap gap="medium" justify="between">
                  <span>${t('organisms.feedPublishedAll') || '📣 This whole workspace is published to the public feed.'}</span>
                  <${Action} small disabled=${shareBusy} onClick=${() => patchShare({ public: false })}>${t('organisms.feedUnpublish') || 'Unpublish'}<//>
                <//>
              <//>`
            : html`<${Loud} control disabled=${shareBusy}
                onClick=${() => { if (window.confirm(t('organisms.feedPublishConfirm') || 'Publish every published document in this workspace to the public activity feed on the front page?')) patchShare({ public: true }); }}>
                ${t('organisms.feedPublishBtn') || '📣 Publish to public feed'}
              <//>`}
        <//>` : null}
      ${docTypes.length === 0 ? html`<${Note} kind="quiet">${t('organisms.noDocSpaces') || 'This workspace has no document spaces to share.'}<//>` : html`
        ${!share && shareBusy ? html`<${Note} kind="loading">${t('organisms.loading') || 'Loading…'}<//>` : null}
        ${share ? html`
          <${List} cols="name">
            ${docTypes.map(ot => {
              const docs = objectsFor(ot.name);
              const spaceOn = !!(share.spaces && share.spaces[ot.name]);
              return html`
                <${Row} key=${'sh' + ot.name}>
                  <${Cell}>
                    <${Check} checked=${spaceOn} disabled=${shareBusy} onChange=${(on) => patchShare({ spaces: { [ot.name]: on } })}>
                      ${wsT('type.' + ot.name) || ot.name} <${Mark}>${docs.length} ${t('organisms.docs') || 'docs'}<//>
                    <//>
                    ${docs.length === 0
                      ? html`<${Note} kind="quiet">${t('organisms.noPublishedDocs') || 'No published documents yet — publish a page to share it.'}<//>`
                      : html`<${List} cols="name-doors" keepCols dense under>
                          ${docs.map(d => {
                            const on = isDocPublic(ot.name, d.id);
                            return html`
                              <${Row} key=${'shd' + d.id}>
                                <${Cell}><${Check} checked=${on} disabled=${shareBusy} onChange=${(v) => patchShare({ docs: { [`${ot.name}/${d.id}`]: v } })}>${d.title || d.id}<//><//>
                                <${Doors}>${on ? html`<${Action} small href=${orgService.publicViewerUrl(orgId, wsId, { type: ot.name, id: d.id })} newTab>${t('organisms.openLink') || 'open ↗'}<//>` : null}<//>
                              <//>`;
                          })}
                        <//>`}
                  <//>
                <//>`;
            })}
          <//>` : null}
        ${share ? html`
          <${Box}>
            <${SubHeading}>${t('organisms.shareAccessTitle') || 'Who can open the shared pages'}<//>
            <${Stack}>
              <${Check} radio name="pj-share-access" checked=${share.access === 'open'} disabled=${shareBusy}
                onChange=${() => patchShare({ access: 'open' })}>${t('organisms.shareAccessOpen') || 'Anyone with the link (default)'}<//>
              <${Check} radio name="pj-share-access" checked=${share.access === 'password'} disabled=${shareBusy}
                onChange=${(on, e) => {
                  if (share.has_password) { patchShare({ access: 'password' }); return; }
                  if (sharePw.trim().length >= 4) { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); return; }
                  // No password yet: don't error out — keep the current mode, point at the field instead.
                  e.currentTarget.checked = share.access === 'password';
                  showToast(t('organisms.sharePasswordMissing') || 'Type a password (at least 4 characters) below — setting it turns password protection on');
                  const inp = document.getElementById('pj-share-pw-input'); if (inp) inp.focus();
                }}>${t('organisms.shareAccessPassword') || 'Anyone with the link and the password'}<//>
              <${Space} above="none">
                <${Line} wrap>
                  <${Mark} kind="status" tone=${share.has_password ? 'fine' : 'off'}>${share.has_password
                    ? (t('organisms.sharePasswordSet') || '🔑 A password is set')
                    : (t('organisms.sharePasswordUnset') || 'No password set')}<//>
                  <${TextField} type="password" id="pj-share-pw-input" size="medium" autoComplete="new-password"
                    placeholder=${pwWords} ariaLabel=${pwWords} value=${sharePw} disabled=${shareBusy} onInput=${setSharePw} />
                  <${Action} small disabled=${shareBusy || sharePw.trim().length < 4}
                    onClick=${() => { patchShare({ access: 'password', password: sharePw.trim() }); setSharePw(''); }}>
                    ${share.has_password ? (t('organisms.sharePasswordChange') || 'Change password') : (t('organisms.sharePasswordSave') || 'Set password')}
                  <//>
                  ${share.has_password ? html`
                    <${Action} small disabled=${shareBusy}
                      onClick=${() => { if (window.confirm(t('organisms.sharePasswordClearConfirm') || 'Remove the share password? The shared pages become link-only.')) patchShare({ access: 'open', password: null }); }}>
                      ${t('organisms.sharePasswordClear') || 'Remove password'}
                    <//>` : null}
                <//>
              <//>
              <${Check} radio name="pj-share-access" checked=${share.access === 'account'} disabled=${shareBusy}
                onChange=${() => patchShare({ access: 'account' })}>${t('organisms.shareAccessAccount') || 'Signed-in users only — any account on this node, not just members'}<//>
            <//>
            <${Note}>${t('organisms.shareAccessNote') || "Default: anyone with the link. Workspace members always see these pages through their membership regardless of this choice — it only gates the public link. If you don't want outsiders at all, simply don't share."}<//>
          <//>` : null}
        ${anythingPublic() ? html`
          <${Actions}>
            <${Action} small href=${viewerUrl} newTab>${'🔗 '}${t('organisms.openPublicViewer') || 'Open public viewer'}<//>
            <${Action} small copy=${window.location.origin + viewerUrl} onCopied=${() => showToast(t('organisms.linkCopied') || 'Link copied')}>${t('common.copyLink') || 'Copy link'}<//>
          <//>` : null}
      `}
    <//>`;
}

export function renderReviewTab(ctx) {
  const { gateOn, toggleGate, busy, approvals, resolve } = ctx;
  return html`
    <${Card} tone="section">
      <${Check} inline checked=${gateOn} onChange=${() => toggleGate()} disabled=${busy}
        help="workspace.publish_gate">
        ${'🔒 '}${t('organisms.publishGate') || 'Require review before publishing'}
      <//>
      ${approvals.length === 0
        ? html`<${Note} kind="quiet">${t('organisms.reviewEmpty') || 'Nothing waiting for review.'}<//>`
        : html`
          <${Space} above="large"><${SubHeading}>${t('organisms.needsDecision') || 'Needs your decision'} (${approvals.length})<//><//>
          <${List} cols="name-state" keepCols>
            ${approvals.map(a => html`
              <${Row} key=${a.id}>
                <${Name}>${(a.prompt || a.action)}<//>
                <${Doors}>
                  <${Action} small row onClick=${() => resolve(a.id, 'approve')} disabled=${busy}>${t('organisms.approve') || 'Approve'}<//>
                  <${Action} small row tone="danger" onClick=${() => resolve(a.id, 'reject')} disabled=${busy}>${t('organisms.reject') || 'Reject'}<//>
                <//>
              <//>
            `)}
          <//>`}
    <//>`;
}

export function renderActivityTab(ctx) {
  const { orgId, wsId, ws } = ctx;
  return html`
    <${ActivityPanel} orgId=${orgId} wsId=${wsId} />
    ${(ws.decisions || []).length > 0 ? html`
      <${Card} tone="section">
        <${Group} quiet title=${t('organisms.decisions') || 'Recent decisions'}>
          <${TimelineList}>${ws.decisions.slice(-8).reverse().map((d, i) => html`
            <${TimelineRow} key=${'dec' + i} category="made" when=${d._createdAt ? fmtDate(d._createdAt) : ''} text=${(String(d.summary || ''))} />
          `)}<//>
        <//>
      <//>` : null}`;
}
