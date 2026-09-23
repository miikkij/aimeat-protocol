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
 *   2026-09-22 -- Composed from the shared set: a record is a ListRow that opens in place (its fields as
 *     KeyValue rows), the row's icon buttons are one Menu (Unarchive stays a worded action in the
 *     archive view); the repeated space head that the page already shows is gone. No class of its own.
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
import { Stack, Surface, ListRow, KeyValue, Chip, Action, Menu, Text } from '/components/poster-parts.js';
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
  if (!rows.length) return html`<${Text} kind="caption" tone="muted">${t('organisms.noFields') || 'No fields'}<//>`;
  return rows.map(([k, v]) => html`<${KeyValue} key=${k} label=${wsT(`${ot.namespace}.${k}`) || k} value=${renderFieldVal(v)} />`);
}

const loading = () => html`<${Text} tone="muted">${t('profile.loading')}<//>`;

// A record-space tab: schema-form add/edit + draft and published record lists (with comments).
export function renderRecordSpace(ctx, ot) {
  const {
    wsT, adding, addingId, addingSchema, busy, addingInitial, saveDraft,
    cancelForm, draftsFor, itemColor, setItemColor, toggleExpand, startEdit, publish, removeObject,
    expandedRec, orgId, wsId, showToast, commentsByKey, cKey, reloadComments, objectsFor,
    showArchived, reopen, setRecordArchived,
  } = ctx;
  const titleOf = (r, fallback) => String(r[PRIMARY_FIELD[ot.name] || 'title'] || fallback || r.id || '');
  const opened = (r) => html`<${Stack} density="compact">${recordAiLabel(r, 'block')}${recordFields(ctx, ot, r)}<//>
    <${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${r.id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, r.id)]} onReload=${reloadComments} />`;
  return html`<${Stack} key=${ot.name}>
    ${adding === ot.name && !addingId && (addingSchema
      ? html`<${Surface} kind="box" surfaceRef=${(el) => {
          // Scroll the freshly opened form into view ONCE. On a phone the form used to open
          // below the fold, so "+ Add draft" looked like a dead button (UX-remake v3, P12,
          // measured). The dataset flag stops re-scrolling on every keystroke re-render.
          if (el && !el.dataset.scrolledIntoView) {
            el.dataset.scrolledIntoView = '1';
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }}><${SchemaForm} key=${'sf-new'} schema=${addingSchema} busy=${busy} initial=${addingInitial}
          idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
          onSave=${(v) => saveDraft(ot, v)} onCancel=${cancelForm} /><//>`
      : loading())}

    <${Stack} density="compact">
      ${draftsFor(ot.name).map((d, i) => {
        const open = !!expandedRec[ot.name + ':' + d.id];
        return html`
        <${ListRow} key=${'d' + i} density="compact" selected=${open}
          mark=${html`<${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />`}
          name=${titleOf(d)} onOpen=${() => toggleExpand(ot, d.id)}
          actions=${html`<${Chip} tone="sun">${t('organisms.draft') || 'draft'}<//>
            ${recordAiLabel(d, 'inline')}
            <${Action} kind="text" onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}<//>
            <${Action} onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}<//>
            <${Menu} label=${t('organisms.moreActions') || 'More actions'} items=${[
              { label: t('organisms.delete') || 'Delete', danger: true, disabled: busy, onClick: () => removeObject(ot.namespace, d.id, titleOf(d)) },
            ]} />`}>
          ${adding === ot.name && addingId === d.id
            ? (addingSchema
              ? html`<${SchemaForm} key=${'sf-' + d.id} schema=${addingSchema} busy=${busy} initial=${addingInitial}
                  idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
                  onSave=${(v) => saveDraft(ot, { ...v, id: addingId })} onCancel=${cancelForm} />`
              : loading())
            : (open ? opened(d) : null)}
        <//>`;
      })}

      ${objectsFor(ot.name).length === 0 && draftsFor(ot.name).length === 0
        ? html`<${Text} tone="muted">${t('organisms.noneYet') || 'none yet'}<//>`
        : objectsFor(ot.name).map((o, i) => {
          const open = !!expandedRec[ot.name + ':' + o.id];
          return html`
          <${ListRow} key=${'o' + i} density="compact" selected=${open}
            mark=${html`<${ColorPicker} value=${itemColor(ot.name, o.id)} onPick=${(c) => setItemColor(ot.name, o.id, c)} />`}
            name=${titleOf(o, o.summary)} onOpen=${() => toggleExpand(ot, o.id)}
            actions=${html`${recordAiLabel(o, 'inline')}
              ${o.status ? html`<${Chip}>${o.status}<//>` : null}
              ${!showArchived && !draftsFor(ot.name).some(dr => dr.id === o.id) ? html`
                <${Action} kind="text" title=${t('organisms.reopenEditHint') || 'Reopen for editing — creates an editable draft from the published version'} disabled=${busy} onClick=${() => reopen(ot, o.id)}>${t('organisms.edit') || 'Edit'}<//>` : null}
              ${showArchived
                ? html`<${Action} title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, false)}>${t('organisms.unarchive') || 'Unarchive'}<//>`
                : null}
              <${Menu} label=${t('organisms.moreActions') || 'More actions'} items=${[
                !showArchived && { label: t('organisms.archive') || 'Archive', disabled: busy, onClick: () => setRecordArchived(ot, o.id, true) },
                { label: t('organisms.delete') || 'Delete', danger: true, disabled: busy, onClick: () => removeObject(ot.namespace, o.id, titleOf(o)) },
              ]} />`}>
            ${open ? opened(o) : null}
          <//>`;
        })}
    <//>
  <//>`;
}
