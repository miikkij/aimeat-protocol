/**
 * @file public/components/DocTree.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The document tree of a workspace's document space: the index on the left and the open
 *   document beside it (the children). The index holds sections that nest, each with its colour, its
 *   name (renamed in place), and its ways on (a new document in it, a sub-section, remove); under a
 *   section its documents, each with a drag grip, its colour, its name that opens it, and its ways on
 *   (archive or unarchive, delete); a series of parts ("Plan — part 2") folds under one row with its
 *   count. The documents no section holds stand under "Unsorted". A page passes the tree as data and
 *   what happens; it never writes a class. The look is css/components/doc-tree.css and the colour
 *   tokens of css/components/colour-tag.css.
 *   It owns its behaviour: a document is dragged onto a section (or onto "Unsorted") to file it
 *   there, a series opens and closes on its head, a section's name is renamed on a double click or
 *   its ✎ and saved when the field is left or Enter is pressed.
 *
 *   The data:
 *   - sections: [{ id, name, colour, items, children }] (children are sections again).
 *   - unsorted: the items no section holds, or null.
 *   - an item: { kind: 'doc', id, title, draft, colour, active } or
 *     { kind: 'series', key, name, draft, open, parts: [doc items] }.
 *   - empty: the words when the space has neither sections nor documents.
 *   - editing: the id of the section whose name is being edited.
 *   - archived: the space shows its archived documents (the door is "unarchive").
 *   - words: { drag, draft, archive, unarchive, remove, delete, rename, newDocHere, addSub,
 *     sectionName, unnamed, unsorted, colour, noColour }.
 *   The handlers: onOpen(id), onDocColour(id, c), onArchive(id), onDelete(id), onSeries(key, open),
 *   onSectionColour(secId, c), onRename(secId), onName(secId, name), onNameDone(), onNewDoc(secId),
 *   onAddSub(secId), onRemoveSection(secId), onMove(docId, secId|null).
 * @structure DocTree(props)
 * @usage html`<${DocTree} sections=${tree} unsorted=${loose} words=${words} onOpen=${open} …>${theOpenDocument}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the document tree of views/profile/organisms/workspace/doc-space.js as
 *     a component with its own class names (.doc-tree*); the look it had inside a workspace page (the
 *     only place it is drawn). A section's name is the Sub-heading (Jouni's decision "Sub-heading");
 *     the open document's row is on the sun with the ink rail as before (page migration G2b).
 */
import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';
import { ColorPicker, colourClass } from '/components/ColorPicker.js';
import { Icon } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function DocTree(props) {
  const {
    sections = [], unsorted = null, empty, editing, archived, busy, words = {},
    onOpen, onDocColour, onArchive, onDelete, onSeries, onSectionColour, onRename, onName, onNameDone,
    onNewDoc, onAddSub, onRemoveSection, onMove, children,
  } = props;
  const dragged = useRef(null);
  const draft = html`<${Mark} kind="status" tone="attention">${words.draft}<//>`;

  // A section (or "Unsorted") is a drop target: a document dragged onto it is filed there.
  const allowDrop = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };
  const dropOn = (secId) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragged.current) { onMove?.(dragged.current, secId); dragged.current = null; }
  };

  const docItem = (d) => html`
    <div key=${'di' + d.id} class=${cx('doc-tree-item', d.active && 'is-active poster-chip--sun', d.colour && `doc-tree-rail ${colourClass(d.colour)}`)}
      draggable="true"
      onDragStart=${(e) => {
        dragged.current = d.id;
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch (err) { swallowed('DocTree: drag data', err); } }
      }}
      onDragEnd=${() => { dragged.current = null; }}>
      <span class="doc-tree-grip" title=${words.drag} aria-hidden="true">⠿</span>
      <${ColorPicker} value=${d.colour} title=${words.colour} noneLabel=${words.noColour} onPick=${(c) => onDocColour?.(d.id, c)} />
      <button type="button" class="doc-tree-link" aria-current=${d.active ? 'true' : undefined} onClick=${() => onOpen?.(d.id)}>
        ${d.draft ? html`${draft} ` : null}${d.title}
      </button>
      ${archived
        ? html`<${Icon} small label=${words.unarchive} disabled=${busy} onClick=${() => onArchive?.(d.id)}>♻️<//>`
        : html`<${Icon} small label=${words.archive} disabled=${busy} onClick=${() => onArchive?.(d.id)}>🗄️<//>`}
      <${Icon} small label=${words.delete} disabled=${busy} onClick=${() => onDelete?.(d.id)}>🗑<//>
    </div>`;

  const renderItems = (items) => (items || []).map((it) => {
    if (it.kind !== 'series') return docItem(it);
    return html`
      <div class="doc-tree-series" key=${'ser-' + it.key}>
        <button type="button" class="doc-tree-series-head" aria-expanded=${it.open ? 'true' : 'false'} onClick=${() => onSeries?.(it.key, !it.open)}>
          <span class="doc-tree-arrow" aria-hidden="true">${it.open ? '▾' : '▸'}</span>
          <span class="doc-tree-series-name">${it.name}</span>
          <${Mark} kind="count" tone="tally">${it.parts.length}<//>
          ${it.draft ? draft : null}
        </button>
        ${it.open ? html`<div class="doc-tree-parts">${it.parts.map(docItem)}</div>` : null}
      </div>`;
  });

  const renderSection = (sec) => html`
    <div key=${sec.id} class=${cx('doc-tree-sec', sec.colour && `doc-tree-rail ${colourClass(sec.colour)}`)} onDragOver=${allowDrop} onDrop=${dropOn(sec.id)}>
      <div class="doc-tree-sec-head">
        <${ColorPicker} value=${sec.colour} title=${words.colour} noneLabel=${words.noColour} onPick=${(c) => onSectionColour?.(sec.id, c)} />
        ${editing === sec.id
          ? html`<span class="doc-tree-grow"><${TextField} autoFocus placeholder=${words.sectionName} ariaLabel=${words.sectionName}
              value=${sec.name} onInput=${(v) => onName?.(sec.id, v)} onBlur=${() => onNameDone?.()}
              onEnter=${(v, e) => e.currentTarget.blur()} /></span>`
          : html`<span class="doc-tree-sec-name sub-heading" onDblClick=${() => onRename?.(sec.id)}>${sec.name || words.unnamed}</span>`}
        <${Icon} small label=${words.rename} onClick=${() => onRename?.(sec.id)}>✎<//>
        <${Icon} small label=${words.newDocHere} onClick=${() => onNewDoc?.(sec.id)}>+<//>
        <${Icon} small label=${words.addSub} onClick=${() => onAddSub?.(sec.id)}>⊕<//>
        <${Icon} small label=${words.remove} onClick=${() => onRemoveSection?.(sec.id)}>✕<//>
      </div>
      ${renderItems(sec.items)}
      ${(sec.children || []).map(renderSection)}
    </div>`;

  const nothing = sections.length === 0 && !(unsorted && unsorted.length);
  return html`
    <div class="doc-tree">
      <div class="doc-tree-index poster-row--thing">
        ${sections.map(renderSection)}
        ${unsorted && unsorted.length ? html`
          <div class="doc-tree-sec" onDragOver=${allowDrop} onDrop=${dropOn(null)}>
            <div class="doc-tree-sec-head"><span class="doc-tree-sec-name doc-tree-sec-name--quiet">${words.unsorted}</span></div>
            ${renderItems(unsorted)}
          </div>` : null}
        ${nothing && empty ? html`<${Note} kind="quiet">${empty}<//>` : null}
      </div>
      <div class="doc-tree-main">${children}</div>
    </div>`;
}

export default DocTree;
