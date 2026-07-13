/**
 * @file public/views/profile/organisms/workspace/doc-space.js
 * @description A document-space tab for organism workspaces: the left section-tree index (with an
 *   Unsorted group + drag-to-file, inline rename, color tags, multi-part series collapse) and the
 *   main area showing the active document (view/edit) with comments. A pure render function driven
 *   by a ctx bag assembled by the parent Workspace. Extracted from workspace.js to satisfy
 *   max-file-lines with no behaviour change.
 * @structure renderDocSpace
 * @usage import { renderDocSpace } from '/views/profile/organisms/workspace/doc-space.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { EmptyState } from '/components/EmptyState.js';
import { slugifyHeading } from '/components/Markdown.js';
import { DocumentView, DocumentEditor } from '/views/profile/organisms/document.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
import { ColorPicker } from './color-picker.js';
import { groupDocs } from './helpers.js';

// A document-space: left index (section tree + documents, with an Unsorted group) + a main
// area showing the active document (view/edit). Sections nest via parentId; documents are
// tied to a section's documents[] (or unsorted). Edits to the tree persist immediately.
export function renderDocSpace(ctx, ot) {
  const {
    sectionsByType, mergedDocs, activeDoc, itemColor, draggedDoc, setItemColor, setActiveDoc,
    showArchived, busy, setRecordArchived, removeObject, moveDocToSection, expandedSeries,
    setExpandedSeries, editingSec, setEditingSec, setSecName, commitSecName, setSectionColor,
    addSection, removeSection, spaceDesc, wsT, orgId, savePage, publish, popOut, showToast, wsId,
    commentsByKey, cKey, reloadComments,
  } = ctx;
  const secs = sectionsByType[ot.name] || [];
  const docs = mergedDocs(ot);
  const docById = {}; docs.forEach(d => { docById[d.id] = d; });
  const used = new Set(); secs.forEach(s => (s.documents || []).forEach(id => used.add(id)));
  const unsorted = docs.filter(d => !used.has(d.id));
  const childrenOf = (pid) => secs.filter(s => (s.parentId || null) === (pid || null));
  const isActive = (d) => activeDoc?.type === ot.name && activeDoc.page?.id === d.id;

  const docItem = (d) => html`
    <div class="pj-doc-item ${isActive(d) ? 'active' : ''} ${itemColor(ot.name, d.id) ? 'pj-colored pj-tag-' + itemColor(ot.name, d.id) : ''}" key=${'di' + d.id}
      draggable=${true}
      onDragStart=${(e) => { draggedDoc.current = { type: ot.name, id: d.id }; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch { /* noop */ } } }}
      onDragEnd=${() => { draggedDoc.current = null; }}>
      <span class="pj-grip" title=${t('organisms.dragHint') || 'Drag into a section'}>⠿</span>
      <${ColorPicker} value=${itemColor(ot.name, d.id)} onPick=${(c) => setItemColor(ot.name, d.id, c)} />
      <button class="pj-doc-link" onClick=${() => setActiveDoc({ type: ot.name, mode: 'view', page: d })}>
        ${d._draft ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span> ` : ''}${d.title || d.id}
      </button>
      ${showArchived
        ? html`<button class="pj-icon-btn" title=${t('organisms.unarchive') || 'Unarchive'} disabled=${busy} onClick=${() => setRecordArchived(ot, d.id, false)}>♻️</button>`
        : html`<button class="pj-icon-btn" title=${t('organisms.archive') || 'Archive'} disabled=${busy} onClick=${() => setRecordArchived(ot, d.id, true)}>🗄️</button>`}
      <button class="pj-icon-btn pj-doc-del" title=${t('organisms.delete') || 'Delete'} disabled=${busy} onClick=${() => removeObject(ot.namespace, d.id, d.title || d.id)}>🗑</button>
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
      <div class="pj-doc-series ${open ? 'open' : ''}" key=${'ser-' + g.base}>
        <button class="pj-doc-series-head" onClick=${() => setExpandedSeries(s => ({ ...s, [key]: !open }))}>
          <span class="pj-ov-chevron">${open ? '▾' : '▸'}</span>
          <span class="pj-doc-series-name">${g.base}</span>
          <span class="pj-org-tab-count">${g.parts.length}</span>
          ${g.parts.some(p => p._draft) ? html`<span class="badge badge-warn pj-mini">${t('organisms.draft') || 'draft'}</span>` : null}
        </button>
        ${open ? html`<div class="pj-doc-series-parts">${g.parts.map(docItem)}</div>` : null}
      </div>`;
  });

  const renderSection = (sec) => html`
    <div class="pj-sec ${sec.color ? 'pj-colored pj-tag-' + sec.color : ''}" key=${sec.id} onDragOver=${allowDrop} onDrop=${dropOn(sec.id)}>
      <div class="pj-sec-head">
        <${ColorPicker} value=${sec.color} onPick=${(c) => setSectionColor(ot.name, sec.id, c)} />
        ${editingSec === sec.id
          ? html`<input class="input-field input-xs pj-sec-name" autofocus placeholder=${t('organisms.sectionName') || 'Section name'}
              value=${sec.name} onInput=${e => setSecName(ot.name, sec.id, e.target.value)}
              onBlur=${() => commitSecName(ot.name)} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`
          : html`<span class="pj-sec-name-text" onDblClick=${() => setEditingSec(sec.id)}>${(sec.name || t('organisms.unnamed') || '(unnamed)')}</span>`}
        <button class="pj-icon-btn" title=${t('organisms.rename') || 'Rename'} onClick=${() => setEditingSec(sec.id)}>✎</button>
        <button class="pj-icon-btn" title=${t('organisms.newDocHere') || 'New document here'} onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' }, sectionId: sec.id })}>+</button>
        <button class="pj-icon-btn" title=${t('organisms.addSubsection') || 'Sub-section'} onClick=${() => addSection(ot.name, sec.id)}>⊕</button>
        <button class="pj-icon-btn" title=${t('organisms.remove') || 'Remove'} onClick=${() => removeSection(ot.name, sec.id, sec.name)}>✕</button>
      </div>
      ${renderDocList((sec.documents || []).map(id => docById[id]).filter(Boolean))}
      ${childrenOf(sec.id).map(renderSection)}
    </div>`;

  return html`
    <div class="pj-section" key=${ot.name}>
      <div class="pj-section-head">
        <span class="pj-section-title">${(wsT('type.' + ot.name) || ot.name)}<span class="pj-doc-tag">${t('organisms.docs') || 'docs'}</span></span>
        <button class="btn-outline btn-sm" onClick=${() => addSection(ot.name, null)}>${'+ '}${t('organisms.section') || 'Section'}</button>
        <button class="btn-outline btn-sm" onClick=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' } })}>${'+ '}${t('organisms.newPage') || 'New document'}</button>
      </div>
      ${spaceDesc(ot) ? html`<div class="section-desc">${spaceDesc(ot)}</div>` : null}
      <div class="pj-docspace">
        <div class="pj-doc-index">
          ${childrenOf(null).map(renderSection)}
          ${unsorted.length > 0 ? html`
            <div class="pj-sec" onDragOver=${allowDrop} onDrop=${dropOn(null)}><div class="pj-sec-head"><span class="pj-sec-name pj-muted">${t('organisms.unsorted') || 'Unsorted'}</span></div>${renderDocList(unsorted)}</div>` : null}
          ${docs.length === 0 && secs.length === 0 ? html`<${EmptyState} text=${t('organisms.noneYet') || 'none yet'} />` : null}
        </div>
        <div class="pj-doc-main">
          ${(() => {
            if (activeDoc?.type !== ot.name) return html`<${EmptyState} icon="📄" text=${t('organisms.selectDoc') || 'Select a document, or create one.'} />`;
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
                  const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.querySelector('.pj-doc-view [id="' + slugifyHeading(anchor) + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                  if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                  const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                  if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                  else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
                }} />
              <${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${livePage.id} showToast=${showToast}
                batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, livePage.id)]} onReload=${reloadComments} />`;
          })()}
        </div>
      </div>
    </div>`;
}
