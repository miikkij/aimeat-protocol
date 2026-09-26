/**
 * @file public/views/profile/organisms/workspace/record-space.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A record-space tab for organism workspaces: the schema-form add/edit and the draft +
 *   published record lists (with inline field view, color tags, archive/reopen/delete, and comments).
 *   Pure render functions driven by a ctx bag assembled by the parent Workspace. Extracted from
 *   workspace.js to satisfy max-file-lines with no behaviour change.
 * @structure recordAiLabel (internal), recordFields (internal), renderRecordSpace
 * @usage import { renderRecordSpace } from '/views/profile/organisms/workspace/record-space.js';
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- A record's fields are the Facts (css/components/facts.css), a unification: the look most tabs use. Each field's name stands left of its value instead of above it.
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 3: the AI-transparency label on every record that owes
 *     one — the compact chip in the list row (first exposure), the block form with the
 *     "How this was made" link in the expanded view. Fed by `_aiProvenance` from the workspace read.
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { LoadingLine } from '/views/profile/shared.js';
import { QuietNote } from '/components/QuietNote.js';
import { AiLabel } from '/components/ai-label.js';
import { SchemaForm } from '/views/profile/organisms/schema-form.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
import { ColorPicker } from './color-picker.js';
import { PRIMARY_FIELD, renderFieldVal } from './helpers.js';

/**
 * The AI-transparency label for one record (TARGET-058). Two placements, one component:
 *   - the LIST row gets the compact chip, because "at first exposure" means before the reader has
 *     opened anything;
 *   - the EXPANDED view gets the block form with the "How this was made" link, which is the
 *     interactive second layer the Code of Practice encourages.
 * Whether anything renders at all is decided by `disclosure.required` inside the component, from the
 * server's disclosureFor(). Nothing here tests the record's level — that logic belongs in one place
 * and this is not it.
 */
function recordAiLabel(rec, variant) {
  return html`<${AiLabel} record=${rec?._aiProvenance} variant=${variant}
    recordUrl=${variant === 'block' ? rec?._aiProvenanceUrl : undefined} />`;
}

// Read-only field view for a record (skips the underscore-prefixed metadata the read attaches).
function recordFields(ctx, ot, rec) {
  const { wsT } = ctx;
  const rows = Object.entries(rec || {}).filter(([k, v]) =>
    !k.startsWith('_') && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  if (!rows.length) return html`<div class="poster-quiet pj-rec-empty">${t('organisms.noFields') || 'No fields'}</div>`;
  return html`<div class="facts">${rows.map(([k, v]) => html`
    <div class="facts-k poster-label" key=${'k:' + k}>${wsT(`${ot.namespace}.${k}`) || k}</div>
    <div class="facts-v" key=${k}>${renderFieldVal(v)}</div>`)}</div>`;
}

// A record-space tab: schema-form add/edit + draft and published record lists (with comments).
export function renderRecordSpace(ctx, ot) {
  const {
    wsT, startAdd, spaceDesc, adding, addingId, addingSchema, busy, addingInitial, saveDraft,
    cancelForm, draftsFor, itemColor, setItemColor, toggleExpand, startEdit, publish, removeObject,
    expandedRec, orgId, wsId, showToast, commentsByKey, cKey, reloadComments, objectsFor,
    showArchived, reopen, setRecordArchived,
  } = ctx;
  return html`
    <div class="pj-section poster-row--thing" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title sub-heading">${(wsT('type.' + ot.name) || ot.name)}</span>
        ${ot.append ? null : html`<button class="poster-action poster-action--small" onClick=${() => startAdd(ot)}>${'+ '}${t('organisms.addDraft') || 'Add draft'}</button>`}
      </div>
      ${spaceDesc(ot) ? html`<div class="section-desc">${spaceDesc(ot)}</div>` : null}

      ${adding === ot.name && !addingId && (addingSchema
        ? html`<div class="pj-rec-edit pj-rec-edit-new" ref=${(el) => {
            // Scroll the freshly opened form into view ONCE. On a phone the form used to open
            // below the fold, so "+ Add draft" looked like a dead button (UX-remake v3, P12,
            // measured). The dataset flag stops re-scrolling on every keystroke re-render.
            if (el && !el.dataset.scrolledIntoView) {
              el.dataset.scrolledIntoView = '1';
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }}>${html`<${SchemaForm} key=${'sf-new'} schema=${addingSchema} busy=${busy} initial=${addingInitial}
            idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
            onSave=${(v) => saveDraft(ot, v)} onCancel=${cancelForm} />`}</div>`
        : html`<${LoadingLine} />`)}

      ${draftsFor(ot.name).map((d, i) => html`
        <div class="pj-rec ${itemColor(ot.name, d.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, d.id) : ''}" key=${'d' + i}>
          <div class="pj-item pj-item-draft">
            <${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />
            <span class="poster-status poster-status--attention">${t('organisms.draft') || 'draft'}</span>
            <button class="pj-rec-title" onClick=${() => toggleExpand(ot, d.id)}>${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || '')}</button>
            ${recordAiLabel(d, 'inline')}
            <button class="poster-action poster-action--small" onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}</button>
            <button class="poster-slab poster-slab--control" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>
            <button class="poster-icon poster-icon--small" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id))}>🗑</button>
          </div>
          ${adding === ot.name && addingId === d.id
            ? html`<div class="pj-rec-edit">${addingSchema
                ? html`<${SchemaForm} key=${'sf-' + d.id} schema=${addingSchema} busy=${busy} initial=${addingInitial}
                    idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
                    onSave=${(v) => saveDraft(ot, { ...v, id: addingId })} onCancel=${cancelForm} />`
                : html`<${LoadingLine} />`}</div>`
            : (expandedRec[ot.name + ':' + d.id] ? html`<div class="pj-rec-fields">${recordAiLabel(d, 'block')}${recordFields(ctx, ot, d)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${d.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, d.id)]} onReload=${reloadComments} />` : null)}
        </div>
      `)}

      ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
        ? html`<${QuietNote}>${t('organisms.noneYet') || 'none yet'}<//>`
        : objectsFor(ot.name).map((o, i) => html`
          <div class="pj-rec ${itemColor(ot.name, o.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, o.id) : ''}" key=${'o' + i}>
            <div class="pj-item">
              <${ColorPicker} value=${itemColor(ot.name, o.id)} onPick=${(c) => setItemColor(ot.name, o.id, c)} />
              <button class="pj-rec-title" onClick=${() => toggleExpand(ot, o.id)}>${String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || '')}</button>
              ${recordAiLabel(o, 'inline')}
              ${o.status ? html`<span class="poster-chip">${(o.status)}</span>` : null}
              ${!showArchived && !draftsFor(ot.name).some(dr => dr.id === o.id) ? html`
                <button class="poster-action poster-action--small" title=${t('organisms.reopenEditHint') || 'Reopen for editing — creates an editable draft from the published version'} disabled=${busy} onClick=${() => reopen(ot, o.id)}>${t('organisms.edit') || 'Edit'}</button>` : null}
              ${showArchived
                ? html`<button class="poster-action poster-action--small" title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, false)}>${'♻️ '}${t('organisms.unarchive') || 'Unarchive'}</button>`
                : html`<button class="poster-icon poster-icon--small" title=${t('organisms.archive') || 'Archive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, true)}>🗄️</button>`}
              <button class="poster-icon poster-icon--small" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, o.id, String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.id))}>🗑</button>
            </div>
            ${expandedRec[ot.name + ':' + o.id] ? html`<div class="pj-rec-fields">${recordAiLabel(o, 'block')}${recordFields(ctx, ot, o)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${o.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, o.id)]} onReload=${reloadComments} />` : null}
          </div>
        `)
      }
    </div>`;
}
