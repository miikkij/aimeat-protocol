/**
 * @file public/components/MindMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A structure map a person can click: the options that redraw it (drop-downs and check
 *   boxes in one line), the diagram (a Mermaid chart), and the hint under it. A node pressed in the
 *   diagram reaches the page as its words and its id, and the page says where it leads. A page passes
 *   the chart's source, its options as data and what a pressed node does; it never writes a class.
 *   The frame is the Object box (components/Box.js); the rest is css/components/mind-map.css, the
 *   heat colours of its nodes theme tokens.
 *
 *   options: [{ kind: 'select', key, label, value, options, onChange } | { kind: 'check', key, label,
 *   checked, onChange }]; onNode({ text, id, inNode }): `text` is the pressed node's words (a mind
 *   map's nodes have no id), `id` the id of the flowchart node it is in, `inNode` whether it is in one.
 * @structure MindMap({ chart, options, onNode, hint })
 * @usage html`<${MindMap} chart=${src} options=${opts} onNode=${go} hint=${t('mindmap.clickHint')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the map of views/profile/organisms/mindmap.js (its options row,
 *     canvas and hint) as a component with its own sheet; the builders and the click resolution stay
 *     in the page module (page migration G2b).
 */
import { h } from 'preact';
import htm from 'htm';
import { Box } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Mermaid } from '/components/Mermaid.js';

const html = htm.bind(h);

function Option({ o }) {
  if (o.kind === 'check') return html`<${Check} inline checked=${o.checked} onChange=${o.onChange}>${o.label}<//>`;
  return html`<label class="mind-map-option"><span>${o.label}</span><${Select} fit value=${o.value} options=${o.options} onChange=${o.onChange} /></label>`;
}

export function MindMap({ chart, options, onNode, hint }) {
  const press = (e) => {
    const g = e.target?.closest?.('.mindmap-node, [class*="mindmap"], g');
    const node = e.target?.closest?.('.node');
    onNode?.({ text: (g?.textContent) || e.target?.textContent || '', id: node?.id || '', inNode: !!node });
  };
  const list = (options || []).filter(Boolean);
  return html`
    <${Box}>
      ${list.length ? html`<div class="mind-map-options">${list.map((o) => html`<${Option} key=${o.key} o=${o} />`)}</div>` : null}
      <div class="mind-map-canvas" onClick=${press}><${Mermaid} chart=${chart} /></div>
      ${hint ? html`<${Note}>${hint}<//>` : null}
    <//>`;
}

export default MindMap;
