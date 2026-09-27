/**
 * @file public/views/admin/capabilities-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab listing all registered capabilities — searchable list with
 *   input/output schema keys, source type, invocation/error stats, and a row that opens in place
 *   showing full JSON schemas, owner, status, auth, vouches, and usage.
 *
 * @structure
 *   - CapabilitiesTab({ session }): default component; fetches /v1/admin/capabilities, filters, opens rows
 *   - schemaKeys(schema): summarizes a JSON schema's property keys + types for the compact columns
 *
 * @version-history
 *   v1.2.0 — 2026-09-27 — On the library components (page group G5): the search is the Search line
 *     with its count, the table the List whose row opens its Panel in place (a click anywhere on the
 *     row, Enter on its name), the schemas Code blocks that scroll, the facts under them a Row of
 *     words. A capability the operator switched off is a faded row; errors over zero in the danger
 *     colour. The file writes no class and no style.
 *   v1.1.0 — 2026-09-05 — The callable column says ✓ or ✗ instead of two emoji: no emoji anywhere in the interface.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, Badge, Empty, Spinner } from './shared.js';
import { List, Row, Name, Cell, Num, Panel, SearchLine } from '/components/List.js';
import { Code, Label } from '/components/Mark.js';
import { Tinted } from '/components/Figure.js';
import { Note } from '/components/Note.js';
import { CardGrid } from '/components/Card.js';
import { Row as Line, Stack } from '/components/Layout.js';

function schemaKeys(schema) {
  if (!schema || typeof schema !== 'object') return '';
  const props = schema.properties || schema;
  return Object.entries(props)
    .filter(([k]) => !['type','properties','items','required','description','nullable','enum'].includes(k))
    .map(([k, v]) => {
      const spec = (v && typeof v === 'object') ? v : {};
      let t = spec.type || '?';
      if (t === 'object' && spec.properties) t = '{...}';
      if (t === 'array' && spec.items) t = '[...]';
      return k + ':' + t;
    }).join(', ');
}

/** One schema in the opened row: its name, then the schema or the word that says there is none. */
function Schema({ label, schema }) {
  return html`<${Stack} gap="tight">
    <${Label} block>${label}<//>
    ${schema ? html`<${Code} block scroll>${JSON.stringify(schema, null, 2)}<//>` : html`<${Note} kind="quiet" inline>None<//>`}
  <//>`;
}

export default function CapabilitiesTab({ session }) {
  const [caps, setCaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!session) return;
    session.fetch('/v1/admin/capabilities?per_page=200').then(res => {
      setCaps(res.data?.capabilities || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session]);

  if (loading) return html`<${Spinner} text=${t('common.loading')} />`;
  if (!caps.length) return html`<${Empty} text=${t('capabilities.noCapabilities')} />`;

  const filtered = filter
    ? caps.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.id.toLowerCase().includes(filter.toLowerCase()))
    : caps;

  const head = ['ID', t('capabilities.name'), 'Input', 'Output', t('capabilities.sourceType'), t('capabilities.callable'),
    { label: t('capabilities.invocations'), num: true }, { label: t('capabilities.errors'), num: true }];
  const dash = html`<${Tinted} tone="dim">—<//>`;

  return html`
    <${SearchLine} text value=${filter} placeholder=${t('common.search')} onInput=${e => setFilter(e.target.value)}
      note=${`${filtered.length} / ${caps.length}`} />
    <${List} cols="id-name-in-out-state-mark-n-n" head=${head} labels>
      ${filtered.map(c => {
        const s = c.stats || {};
        const override = c.operatorOverride;
        const isExp = expanded === c.id;
        const inputKeys = schemaKeys(c.inputSchema);
        const outputKeys = schemaKeys(c.outputSchema);
        return html`
          <${Row} key=${c.id} faded=${!!override?.disabled} open=${isExp}
            onToggle=${() => setExpanded(isExp ? null : c.id)}>
            <${Cell} meta clip title=${c.id}>${escHtml(c.id)}<//>
            <${Name} meta=${c.summary ? escHtml(c.summary) : null} clip>${escHtml(c.name)}<//>
            <${Cell} meta clip title=${inputKeys}>${inputKeys || dash}<//>
            <${Cell} meta clip title=${outputKeys}>${outputKeys || dash}<//>
            <${Cell}><${Badge} type=${c.source?.type || 'manual'} /><//>
            <${Cell}>${c.callable ? '✓' : '✗'}<//>
            <${Num}>${num(s.totalInvocations || 0)}<//>
            <${Num}>${s.errorCount > 0 ? html`<${Tinted} tone="danger">${num(s.errorCount)}<//>` : num(s.errorCount || 0)}<//>
            ${isExp ? html`<${Panel}>
              <${CardGrid} cols="two">
                <${Schema} label="Input Schema" schema=${c.inputSchema} />
                <${Schema} label="Output Schema" schema=${c.outputSchema} />
              <//>
              <${Line} wrap gap="large" above="small">
                <span>Owner: <${Code}>${escHtml(c.ownerGhii || '')}<//></span>
                <span>Status: <${Badge} type=${c.status === 'active' ? 'success' : c.status === 'disabled' ? 'danger' : 'warning'} label=${c.status} /></span>
                <span>Auth: ${c.authRequired}</span>
                <span>Vouches: ${c.trust?.vouchCount || 0}</span>
                <span>Avg: ${s.avgResponseMs || 0}ms</span>
              <//>
              ${c.usage ? html`<${Code} block>${escHtml(c.usage.slice(0,200))}<//>` : null}
            <//>` : null}
          <//>`;
      })}
    <//>
  `;
}
