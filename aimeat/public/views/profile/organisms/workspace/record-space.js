/**
 * @file public/views/profile/organisms/workspace/record-space.js
 * @description A record-space tab for organism workspaces: the schema-form add/edit and the draft +
 *   published record lists (with inline field view, color tags, archive/reopen/delete, and comments).
 *   Pure render functions driven by a ctx bag assembled by the parent Workspace. Extracted from
 *   workspace.js to satisfy max-file-lines with no behaviour change.
 * @structure recordFields (internal), renderRecordSpace
 * @usage import { renderRecordSpace } from '/views/profile/organisms/workspace/record-space.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { EmptyState } from '/components/EmptyState.js';
import { SchemaForm } from '/views/profile/organisms/schema-form.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
import { ColorPicker } from './color-picker.js';
import { PRIMARY_FIELD, renderFieldVal } from './helpers.js';

// Read-only field view for a record (skips the underscore-prefixed metadata the read attaches).
function recordFields(ctx, ot, rec) {
  const { wsT } = ctx;
  const rows = Object.entries(rec || {}).filter(([k, v]) =>
    !k.startsWith('_') && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  if (!rows.length) return html`<div class="pj-muted pj-rec-empty">${t('organisms.noFields') || 'No fields'}</div>`;
  return rows.map(([k, v]) => html`<div class="pj-rec-field" key=${k}>
    <div class="pj-rec-field-label">${wsT(`${ot.namespace}.${k}`) || k}</div>
    <div class="pj-rec-field-val">${renderFieldVal(v)}</div>
  </div>`);
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
    <div class="pj-section" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title">${(wsT('type.' + ot.name) || ot.name)}</span>
        ${ot.append ? null : html`<button class="btn-outline btn-sm" onClick=${() => startAdd(ot)}>${'+ '}${t('organisms.addDraft') || 'Add draft'}</button>`}
      </div>
      ${spaceDesc(ot) ? html`<div class="section-desc">${spaceDesc(ot)}</div>` : null}

      ${adding === ot.name && !addingId && (addingSchema
        ? html`<div class="pj-rec-edit pj-rec-edit-new">${html`<${SchemaForm} key=${'sf-new'} schema=${addingSchema} busy=${busy} initial=${addingInitial}
            idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
            onSave=${(v) => saveDraft(ot, v)} onCancel=${cancelForm} />`}</div>`
        : html`<${Spinner} />`)}

      ${draftsFor(ot.name).map((d, i) => html`
        <div class="pj-rec ${itemColor(ot.name, d.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, d.id) : ''}" key=${'d' + i}>
          <div class="pj-item pj-item-draft">
            <${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />
            <span class="badge badge-warn">${t('organisms.draft') || 'draft'}</span>
            <button class="pj-rec-title" onClick=${() => toggleExpand(ot, d.id)}>${String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || '')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}</button>
            <button class="btn-primary btn-sm" onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}</button>
            <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id))}>🗑</button>
          </div>
          ${adding === ot.name && addingId === d.id
            ? html`<div class="pj-rec-edit">${addingSchema
                ? html`<${SchemaForm} key=${'sf-' + d.id} schema=${addingSchema} busy=${busy} initial=${addingInitial}
                    idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
                    onSave=${(v) => saveDraft(ot, { ...v, id: addingId })} onCancel=${cancelForm} />`
                : html`<${Spinner} />`}</div>`
            : (expandedRec[ot.name + ':' + d.id] ? html`<div class="pj-rec-fields">${recordFields(ctx, ot, d)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${d.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, d.id)]} onReload=${reloadComments} />` : null)}
        </div>
      `)}

      ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
        ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />`
        : objectsFor(ot.name).map((o, i) => html`
          <div class="pj-rec ${itemColor(ot.name, o.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, o.id) : ''}" key=${'o' + i}>
            <div class="pj-item">
              <${ColorPicker} value=${itemColor(ot.name, o.id)} onPick=${(c) => setItemColor(ot.name, o.id, c)} />
              <button class="pj-rec-title" onClick=${() => toggleExpand(ot, o.id)}>${String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || '')}</button>
              ${o.status ? html`<span class="badge badge-info">${(o.status)}</span>` : null}
              ${!showArchived && !draftsFor(ot.name).some(dr => dr.id === o.id) ? html`
                <button class="btn-ghost btn-sm" title=${t('organisms.reopenEditHint') || 'Reopen for editing — creates an editable draft from the published version'} disabled=${busy} onClick=${() => reopen(ot, o.id)}>${t('organisms.edit') || 'Edit'}</button>` : null}
              ${showArchived
                ? html`<button class="btn-ghost btn-sm" title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, false)}>${'♻️ '}${t('organisms.unarchive') || 'Unarchive'}</button>`
                : html`<button class="pj-icon-btn" title=${t('organisms.archive') || 'Archive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, true)}>🗄️</button>`}
              <button class="pj-icon-btn" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, o.id, String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.id))}>🗑</button>
            </div>
            ${expandedRec[ot.name + ':' + o.id] ? html`<div class="pj-rec-fields">${recordFields(ctx, ot, o)}</div><${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${o.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, o.id)]} onReload=${reloadComments} />` : null}
          </div>
        `)
      }
    </div>`;
}
