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
 *   v1.12.0 -- 2026-09-30 -- The comment thread is told whether the viewer is the organism's creator or
 *     an admin (canModerate), so it offers Delete on every comment for them.
 *   v1.11.0 -- 2026-09-26 -- The tree is the library's DocTree (components/DocTree.js), given as data: its
 *     drag to a section, rename in place, colours, series and doors are the component's; the open
 *     document sits in its main column. The space's own head (name, "+ Section", "+ New document")
 *     and its description, which main's page rule hid or showed a second time under the page head
 *     that already says them, go. "Select a document" is the quiet line with its 📄. The page writes
 *     no class (page migration G2b).
 *   v1.10.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.6.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- A button that is a mark, not a word (a delete or close mark, a menu's
 *     dots, an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's
 *     decision "Icon button").
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- Compose the document index top rule with poster-row--thing.
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { slugifyHeading } from '/components/Markdown.js';
import { DocTree } from '/components/DocTree.js';
import { Note } from '/components/Note.js';
import { DocumentView, DocumentEditor } from '/views/profile/organisms/document.js';
import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
import { groupDocs } from './helpers.js';

// A document-space: left index (section tree + documents, with an Unsorted group) + a main
// area showing the active document (view/edit). Sections nest via parentId; documents are
// tied to a section's documents[] (or unsorted). Edits to the tree persist immediately.
// The space's name, its "+ Section" and "+ New document" and its description are the page head's
// (cover.js renderPage); this draws the tree and the open document.
export function renderDocSpace(ctx, ot) {
  const {
    sectionsByType, mergedDocs, activeDoc, itemColor, setItemColor, setActiveDoc,
    showArchived, busy, setRecordArchived, removeObject, moveDocToSection, expandedSeries,
    setExpandedSeries, editingSec, setEditingSec, setSecName, commitSecName, setSectionColor,
    addSection, removeSection, orgId, savePage, publish, popOut, showToast, wsId,
    commentsByKey, cKey, reloadComments, wsCanEdit,
  } = ctx;
  const secs = sectionsByType[ot.name] || [];
  const docs = mergedDocs(ot);
  const docById = {}; docs.forEach(d => { docById[d.id] = d; });
  const used = new Set(); secs.forEach(s => (s.documents || []).forEach(id => used.add(id)));
  const unsorted = docs.filter(d => !used.has(d.id));
  const childrenOf = (pid) => secs.filter(s => (s.parentId || null) === (pid || null));
  const isActive = (d) => activeDoc?.type === ot.name && activeDoc.page?.id === d.id;

  // The tree as data for the library's DocTree: a document, or a multi-part series collapsed under
  // one row (see groupDocs). A series opens by itself while one of its parts is the open document.
  const docItem = (d) => ({ kind: 'doc', id: d.id, title: d.title || d.id, draft: !!d._draft, colour: itemColor(ot.name, d.id) || null, active: isActive(d) });
  const itemsOf = (list) => groupDocs(list).map((g) => {
    if (g.single) return docItem(g.single);
    const key = ot.name + ':' + g.base;
    return { kind: 'series', key, name: g.base, draft: g.parts.some(p => p._draft), open: g.parts.some(isActive) || !!expandedSeries[key], parts: g.parts.map(docItem) };
  });
  const sectionOf = (sec) => ({
    id: sec.id, name: sec.name, colour: sec.color || null,
    items: itemsOf((sec.documents || []).map(id => docById[id]).filter(Boolean)),
    children: childrenOf(sec.id).map(sectionOf),
  });
  const secById = {}; secs.forEach(s => { secById[s.id] = s; });
  const docOf = (id) => docById[id] || { id, title: id };
  const words = {
    drag: t('organisms.dragHint') || 'Drag into a section', draft: t('organisms.draft') || 'draft',
    archive: t('organisms.archive') || 'Archive', unarchive: t('organisms.unarchive') || 'Unarchive',
    delete: t('organisms.delete') || 'Delete', rename: t('organisms.rename') || 'Rename',
    newDocHere: t('organisms.newDocHere') || 'New document here', addSub: t('organisms.addSubsection') || 'Sub-section',
    remove: t('organisms.remove') || 'Remove', sectionName: t('organisms.sectionName') || 'Section name',
    unnamed: t('organisms.unnamed') || '(unnamed)', unsorted: t('organisms.unsorted') || 'Unsorted',
  };

  return html`
    <${DocTree} key=${ot.name} sections=${childrenOf(null).map(sectionOf)} unsorted=${unsorted.length ? itemsOf(unsorted) : null}
      empty=${docs.length === 0 && secs.length === 0 ? (t('organisms.noneYet') || 'none yet') : null}
      editing=${editingSec} archived=${showArchived} busy=${busy} words=${words}
      onOpen=${(id) => setActiveDoc({ type: ot.name, mode: 'view', page: docOf(id) })}
      onDocColour=${(id, c) => setItemColor(ot.name, id, c)}
      onArchive=${(id) => setRecordArchived(ot, id, !showArchived)}
      onDelete=${(id) => removeObject(ot.namespace, id, docOf(id).title || id)}
      onSeries=${(key, open) => setExpandedSeries(s => ({ ...s, [key]: open }))}
      onSectionColour=${(secId, c) => setSectionColor(ot.name, secId, c)}
      onRename=${(secId) => setEditingSec(secId)}
      onName=${(secId, v) => setSecName(ot.name, secId, v)}
      onNameDone=${() => commitSecName(ot.name)}
      onNewDoc=${(secId) => setActiveDoc({ type: ot.name, mode: 'edit', page: { id: '', title: '', markdown: '' }, sectionId: secId })}
      onAddSub=${(secId) => addSection(ot.name, secId)}
      onRemoveSection=${(secId) => removeSection(ot.name, secId, secById[secId]?.name)}
      onMove=${(docId, secId) => moveDocToSection(ot.name, docId, secId)}>
          ${(() => {
            if (activeDoc?.type !== ot.name) return html`<${Note} kind="quiet">${'📄 '}${t('organisms.selectDoc') || 'Select a document, or create one.'}<//>`;
            // Re-resolve the open document against the freshly-loaded list by id, so after a save (or
            // a live-update / F5 restore that only kept the id) the view shows the current draft —
            // with its correct draft badge, published copy, and Draft/Published toggle.
            const livePage = (activeDoc.page && activeDoc.page.id && docById[activeDoc.page.id]) || activeDoc.page;
            if (activeDoc.mode === 'edit') return html`
              <${DocumentEditor} key=${'ed-' + (livePage.id || 'new')} orgId=${orgId} page=${livePage} busy=${busy} onSave=${(p) => savePage(ot, p, activeDoc.sectionId)} onCancel=${() => setActiveDoc(null)} />`;
            return html`
              <${DocumentView} key=${'view-' + livePage.id} page=${livePage} busy=${busy} inPage
                onEdit=${() => setActiveDoc({ type: ot.name, mode: 'edit', page: livePage })}
                onPublish=${() => publish(ot, livePage.id)}
                onPopOut=${() => popOut(ot.name, livePage.id)}
                onWikiLink=${(content) => {
                  const [titlePart, headingPart] = String(content).split('#');
                  const title = titlePart.trim();
                  const anchor = (headingPart || '').trim();
                  const scrollToAnchor = () => { if (anchor) setTimeout(() => { const el = document.querySelector('.doc-view-body [id="' + slugifyHeading(anchor) + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); };
                  if (!title) { scrollToAnchor(); return; }   // [[#Heading]] → jump within the current document
                  const target = docs.find(d => (d.title || '').toLowerCase() === title.toLowerCase());
                  if (target) { setActiveDoc({ type: ot.name, mode: 'view', page: target }); scrollToAnchor(); }
                  else showToast((t('organisms.docNotFound') || 'No document titled “{title}”').replace('{title}', title));
                }} />
              <${WorkspaceComments} orgId=${orgId} ws=${wsId} space=${ot.name} instanceId=${livePage.id} showToast=${showToast}
                batched=${true} initialComments=${commentsByKey[cKey(wsId, ot.name, livePage.id)]} onReload=${reloadComments} canModerate=${wsCanEdit} />`;
          })()}
    <//>`;
}
