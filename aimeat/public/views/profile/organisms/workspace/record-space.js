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
 *   v1.13.0 -- 2026-09-30 -- The comment thread is told whether the viewer is the organism's creator or
 *     an admin (canModerate), so it offers Delete on every comment for them.
 *   v1.12.0 -- 2026-09-26 -- The records are the List (mark-name-doors): the colour picker as the row's
 *     mark and the colour's rail on the row, a draft's warn rail and its status before the name, the
 *     name as the door that opens the record, the AI label after it, the status as a tag, and the doors
 *     (Edit, Publish, Unarchive, the archive and delete icons); an opened record (its AI label, its
 *     fields as Facts, its comments) and a draft's editor stand in the row's Panel; the new record's
 *     form in the raised Object box. The space's own head and description, which the page head
 *     already says (main's page rule hid the head), go. The page writes no class (page migration G2b).
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
import { AiLabel } from '/components/ai-label.js';
import { ColorPicker } from '/components/ColorPicker.js';
import { Action, Loud, Icon } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Lead, Doors } from '/components/List.js';
import { SchemaForm } from '/views/profile/organisms/schema-form.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
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
  if (!rows.length) return html`<${Note} kind="quiet">${t('organisms.noFields') || 'No fields'}<//>`;
  return html`<${Facts} rows=${rows.map(([k, v]) => ({ key: k, k: wsT(`${ot.namespace}.${k}`) || k, v: renderFieldVal(v) }))} />`;
}

// A record-space tab: schema-form add/edit + draft and published record lists (with comments).
// The space's name, its "+ Add draft" and its description are the page head's (cover.js renderPage).
export function renderRecordSpace(ctx, ot) {
  const {
    wsT, adding, addingId, addingSchema, busy, addingInitial, saveDraft,
    cancelForm, draftsFor, itemColor, setItemColor, toggleExpand, startEdit, publish, removeObject,
    expandedRec, orgId, wsId, showToast, commentsByKey, cKey, reloadComments, objectsFor,
    showArchived, reopen, setRecordArchived, wsCanEdit,
  } = ctx;
  const drafts = draftsFor(ot.name);
  const objects = objectsFor(ot.name);
  const comments = (id) => html`<${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${id} showToast=${showToast} batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, id)]} onReload=${reloadComments} canModerate=${wsCanEdit} />`;
  const opened = (rec) => html`${recordAiLabel(rec, 'block')}${recordFields(ctx, ot, rec)}${comments(rec.id)}`;
  const colour = (id) => html`<${Lead}><${ColorPicker} value=${itemColor(ot.name, id)} onPick=${(c) => setItemColor(ot.name, id, c)} /><//>`;
  const del = (id, name) => html`<${Icon} small label=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, id, name)}>🗑<//>`;

  return html`
    ${adding === ot.name && !addingId && (addingSchema
      ? html`<div ref=${(el) => {
          // Scroll the freshly opened form into view ONCE. On a phone the form used to open
          // below the fold, so "+ Add draft" looked like a dead button (UX-remake v3, P12,
          // measured). The dataset flag stops re-scrolling on every keystroke re-render.
          if (el && !el.dataset.scrolledIntoView) {
            el.dataset.scrolledIntoView = '1';
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }}><${Box} tone="raised"><${SchemaForm} key=${'sf-new'} schema=${addingSchema} busy=${busy} initial=${addingInitial}
          idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
          onSave=${(v) => saveDraft(ot, v)} onCancel=${cancelForm} /><//></div>`
      : html`<${Note} kind="loading" />`)}

    <${List} key=${ot.name} cols="mark-name-doors" keepCols empty=${t('organisms.noneYet') || 'none yet'}>
      ${drafts.map((d, i) => {
        const name = String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id || '');
        const editing = adding === ot.name && addingId === d.id;
        return html`
          <${Row} key=${'d' + i} colour=${itemColor(ot.name, d.id) || undefined} rail="warn"
            open=${editing || !!expandedRec[ot.name + ':' + d.id]}
            panel=${editing
              ? (addingSchema
                ? html`<${SchemaForm} key=${'sf-' + d.id} schema=${addingSchema} busy=${busy} initial=${addingInitial}
                    idPrefix=${ot.name} namespace=${ot.namespace} wsT=${wsT}
                    onSave=${(v) => saveDraft(ot, { ...v, id: addingId })} onCancel=${cancelForm} />`
                : html`<${Note} kind="loading" />`)
              : opened(d)}>
            ${colour(d.id)}
            <${Name} onOpen=${() => toggleExpand(ot, d.id)} before=${html`<${Mark} kind="status" tone="attention">${t('organisms.draft') || 'draft'}<//>`}
              after=${recordAiLabel(d, 'inline')}>${name}<//>
            <${Doors}>
              <${Action} small onClick=${() => startEdit(ot, d)} disabled=${busy}>${t('organisms.edit') || 'Edit'}<//>
              <${Loud} control onClick=${() => publish(ot, d.id)} disabled=${busy}>${t('organisms.publish') || 'Publish'}<//>
              ${del(d.id, String(d[PRIMARY_FIELD[ot.name] || 'title'] || d.id))}
            <//>
          <//>`;
      })}
      ${objects.map((o, i) => html`
        <${Row} key=${'o' + i} colour=${itemColor(ot.name, o.id) || undefined}
          open=${!!expandedRec[ot.name + ':' + o.id]} panel=${opened(o)}>
          ${colour(o.id)}
          <${Name} onOpen=${() => toggleExpand(ot, o.id)} after=${recordAiLabel(o, 'inline')}
            tag=${o.status ? String(o.status) : null}>${String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.summary || o.id || '')}<//>
          <${Doors}>
            ${!showArchived && !drafts.some(dr => dr.id === o.id) ? html`
              <${Action} small title=${t('organisms.reopenEditHint') || 'Reopen for editing — creates an editable draft from the published version'} disabled=${busy} onClick=${() => reopen(ot, o.id)}>${t('organisms.edit') || 'Edit'}<//>` : null}
            ${showArchived
              ? html`<${Action} small title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, false)}>${'♻️ '}${t('organisms.unarchive') || 'Unarchive'}<//>`
              : html`<${Icon} small label=${t('organisms.archive') || 'Archive'} disabled=${busy} onClick=${() => setRecordArchived(ot, o.id, true)}>🗄️<//>`}
            ${del(o.id, String(o[PRIMARY_FIELD[ot.name] || 'title'] || o.id))}
          <//>
        <//>`)}
    <//>`;
}
