/**
 * @file public/views/profile/organisms/workspace/doc-space.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A document-space tab for organism workspaces: the left section-tree index (with an
 *   Unsorted group + drag-to-file, inline rename, color tags, multi-part series collapse) and the
 *   main area showing the active document (view/edit) with comments. A pure render function driven
 *   by a ctx bag assembled by the parent Workspace. Extracted from workspace.js to satisfy
 *   max-file-lines with no behaviour change.
 * @structure renderDocSpace
 * @usage import { renderDocSpace } from '/views/profile/organisms/workspace/doc-space.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set: the index and the document are two Columns, a section,
 *     a series and a document are ListRows (drag and drop on plain wrappers), a row's icon buttons are
 *     one Menu; the repeated space head that the page already shows is gone. The colour-tag dot stays
 *     (ColorPicker). No class of its own.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- Compose the document index top rule with poster-row--thing.
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Columns, Stack, ListRow, Chip, Menu, Field, Text } from '/components/poster-parts.js';
import { slugifyHeading } from '/components/Markdown.js';
import { DocumentView, DocumentEditor } from '/views/profile/organisms/document.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
import { ColorPicker } from './color-picker.js';
import { groupDocs } from './helpers.js';
import { swallowed } from '/js/swallowed.js';

// A document-space: left index (section tree + documents, with an Unsorted group) + a main
// area showing the active document (view/edit). Sections nest via parentId; documents are
// tied to a section's documents[] (or unsorted). Edits to the tree persist immediately.
export function renderDocSpace(ctx, ot) {
  const {
    sectionsByType, mergedDocs, activeDoc, itemColor, draggedDoc, setItemColor, setActiveDoc,
    showArchived, busy, setRecordArchived, removeObject, moveDocToSection, expandedSeries,
    setExpandedSeries, editingSec, setEditingSec, setSecName, commitSecName, setSectionColor,
    addSection, removeSection, orgId, savePage, publish, popOut, showToast, wsId,
    commentsByKey, cKey, reloadComments,
  } = ctx;
  const secs = sectionsByType[ot.name] || [];
  const docs = mergedDocs(ot);
  const docById = {}; docs.forEach(d => { docById[d.id] = d; });
  const used = new Set(); secs.forEach(s => (s.documents || []).forEach(id => used.add(id)));
  const unsorted = docs.filter(d => !used.has(d.id));
  const childrenOf = (pid) => secs.filter(s => (s.parentId || null) === (pid || null));
  const isActive = (d) => activeDoc?.type === ot.name && activeDoc.page?.id === d.id;

  const draftChip = html`<${Chip} tone="sun">${t('organisms.draft') || 'draft'}<//>`;
  // The row is dragged by a plain wrapper, because a list row takes no drag handlers.
  const docItem = (d) => html`
    <div key=${'di' + d.id} draggable=${true} title=${t('organisms.dragHint') || 'Drag into a section'}
      onDragStart=${(e) => { draggedDoc.current = { type: ot.name, id: d.id }; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch (err) { swallowed('doc-space: docItem', err); } } }}
      onDragEnd=${() => { draggedDoc.current = null; }}>
      <${ListRow} density="compact" selected=${isActive(d)}
        mark=${html`<${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />`}
        name=${d.title || d.id} onOpen=${() => setActiveDoc({ type: ot.name, mode: 'view', page: d })}
        actions=${html`${d._draft ? draftChip : null}
          <${Menu} label=${t('organisms.moreActions') || 'More actions'} items=${[
            showArchived
              ? { label: t('organisms.unarchive') || 'Unarchive', disabled: busy, onClick: () => setRecordArchived(ot, d.id, false) }
              : { label: t('organisms.archive') || 'Archive', disabled: busy, onClick: () => setRecordArchived(ot, d.id, true) },
            { label: t('organisms.delete') || 'Delete', danger: true, disabled: busy, onClick: () => removeObject(ot.namespace, d.id, d.title || d.id) },
          ]} />`} />
    </div>`;

  // A section is a drop target — dragging a document onto it (or its header) files it here.
  const dropOn = (secId) => (e) => { e.preventDefault(); e.stopPropagation(); if (draggedDoc.current?.type === ot.name) { moveDocToSection(ot.name, draggedDoc.current.id, secId); draggedDoc.current = null; } };
  const allowDrop = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };

  // Render a document list with multi-part series collapsed (see groupDocs). A series auto-opens
  // when the active document is one of its parts; otherwise it toggles on the header click.
  const renderDocList = (list) => groupDocs(list).map((g) => {
    if (g.single) return docItem(g.single);
    const key = ot.name + ':' + g.base;
    const open = g.parts.some(isActive) || !!expandedSeries[key];
    return html`
      <${ListRow} key=${'ser-' + g.base} density="compact" arrow=${true} selected=${open}
        name=${g.base} onOpen=${() => setExpandedSeries(s => ({ ...s, [key]: !open }))} value=${g.parts.length}
        actions=${g.parts.some(p => p._draft) ? draftChip : null}>
        ${open ? html`<${Stack} density="compact">${g.parts.map(docItem)}<//>` : null}
      <//>`;
  });

  // A section and its drop zone: a plain wrapper carries the drop handlers.
  const renderSection = (sec) => html`
    <div key=${sec.id} onDragOver=${allowDrop} onDrop=${dropOn(sec.id)}>
      <${ListRow} density="compact"
        mark=${html`<${ColorPicker} value=${sec.color} onPick=${(c) => setSectionColor(ot.name, sec.id, c)} />`}
        name=${editingSec === sec.id
          ? html`<${Field} placeholder=${t('organisms.sectionName') || 'Section name'} inputRef=${commitOnBlur(() => commitSecName(ot.name))}
              value=${sec.name} onInput=${e => setSecName(ot.name, sec.id, e.target.value)}
              onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`
          : html`<span onDblClick=${() => setEditingSec(sec.id)}>${sec.name || t('organisms.unnamed') || '(unnamed)'}</span>`}
        actions=${html`<${Menu} label=${t('organisms.moreActions') || 'More actions'} items=${[
          { label: t('organisms.rename') || 'Rename', onClick: () => setEditingSec(sec.id) },
          { label: t('organisms.newDocHere') || 'New document here', onClick: () => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' }, sectionId: sec.id }) },
          { label: t('organisms.addSubsection') || 'Sub-section', onClick: () => addSection(ot.name, sec.id) },
          { label: t('organisms.remove') || 'Remove', danger: true, onClick: () => removeSection(ot.name, sec.id, sec.name) },
        ]} />`}>
        <${Stack} density="compact">
          ${renderDocList((sec.documents || []).map(id => docById[id]).filter(Boolean))}
          ${childrenOf(sec.id).map(renderSection)}
        <//>
      <//>
    </div>`;

  return html`
    <${Columns} layout="trailing" collapse="900" key=${ot.name}>
      <${Stack} density="compact">
        ${childrenOf(null).map(renderSection)}
        ${unsorted.length > 0 ? html`
          <div onDragOver=${allowDrop} onDrop=${dropOn(null)}>
            <${Stack} density="compact"><${Text} kind="label" tone="muted">${t('organisms.unsorted') || 'Unsorted'}<//>${renderDocList(unsorted)}<//>
          </div>` : null}
        ${docs.length === 0 && secs.length === 0 ? html`<${Text} tone="muted">${t('organisms.noneYet') || 'none yet'}<//>` : null}
      <//>
      <${Stack}>
        ${(() => {
          if (activeDoc?.type !== ot.name) return html`<${Text} tone="muted">${t('organisms.selectDoc') || 'Select a document, or create one.'}<//>`;
          // Re-resolve the open document against the freshly-loaded list by id, so after a save (or
          // a live-update / F5 restore that only kept the id) the view shows the current draft —
          // with its correct draft badge, published copy, and Draft/Published toggle.
          const livePage = (activeDoc.page && activeDoc.page.id && docById[activeDoc.page.id]) || activeDoc.page;
          if (activeDoc.mode === 'edit') return html`
            <${DocumentEditor} key=${'ed-' + (livePage.id || 'new')} orgId=${orgId} page=${livePage} busy=${busy} onSave=${(p) => savePage(ot, p, activeDoc.sectionId)} onCancel=${() => setActiveDoc(null)} />`;
          return html`
            <${DocumentView} key=${'view-' + livePage.id} page=${livePage} busy=${busy}
              onEdit=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: livePage })}
              onPublish=${() => publish(ot, livePage.id)}
              onPopOut=${() => popOut(ot.name, livePage.id)}
              onWikiLink=${(content) => {
                const [titlePart, headingPart] = String(content).split('#');
                const title = titlePart.trim();
                const anchor = (headingPart || '').trim();
                const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.getElementById(slugifyHeading(anchor)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
              }} />
            <${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${livePage.id} showToast=${showToast}
              batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, livePage.id)]} onReload=${reloadComments} />`;
        })()}
      <//>
    <//>`;
}

/** The section-name field takes the focus once when it opens (the old input's autofocus) and
 *  commits the name when it is left (the old input's blur), wired once per field element. */
const commitOnBlur = (commit) => (el) => {
  if (!el || el.dataset.focused) return;
  el.dataset.focused = 'yes';
  el.addEventListener('blur', commit);
  el.focus();
};
