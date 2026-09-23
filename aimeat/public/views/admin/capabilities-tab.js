/**
 * @file public/views/admin/capabilities-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab listing all registered capabilities — searchable table with
 *   input/output schema keys, source type, invocation/error stats, and an expandable per-row
 *   panel showing full JSON schemas, owner, status, auth, vouches, and usage.
 *
 * @structure
 *   - CapabilitiesTab({ session }): default component; fetches /v1/admin/capabilities, filters, expands rows
 *   - schemaKeys(schema): summarizes a JSON schema's property keys + types for the compact columns
 *
 * @version-history
 *   v1.2.0 — 2026-09-22 — Composed from the shared component set: the search is the shared toolbar
 *     with its count, the list the shared table, and the opened capability a record above the table
 *     (the shared table has no row that opens in place), reached by its name, which is now the
 *     button, with the summary as its tooltip and in full in the record. The name keeps to one
 *     line; the id and the schema keys are plain cell text that wraps at hyphens and commas, so all
 *     eight columns fit at desktop width; a disabled capability's row is muted. No inline style and no hex
 *     colour any more. On a phone the table stays a table and scrolls sideways: stacked, twenty
 *     rows of eight label-value pairs made the page four times as long.
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
import { Stack, Columns, Toolbar, Table, Surface, Action, Text, scrollToId } from '/components/poster-parts.js';

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

/** The opened capability: both schemas side by side, then its facts in one wrapping row. */
function CapabilityRecord({ c }) {
  const s = c.stats || {};
  return html`
    <${Surface} kind="record" id="adm-cap-open">
      <${Stack}>
        <${Text} kind="heading" size="small">${escHtml(c.name)}<//>
        ${c.summary ? html`<${Text}>${escHtml(c.summary)}<//>` : null}
        <${Columns} layout="equal" collapse=${600}>
          <${Stack} density="compact">
            <${Text} kind="label">Input Schema<//>
            ${c.inputSchema ? html`<${Surface} kind="code">${JSON.stringify(c.inputSchema, null, 2)}<//>` : html`<${Text} tone="muted">None<//>`}
          <//>
          <${Stack} density="compact">
            <${Text} kind="label">Output Schema<//>
            ${c.outputSchema ? html`<${Surface} kind="code">${JSON.stringify(c.outputSchema, null, 2)}<//>` : html`<${Text} tone="muted">None<//>`}
          <//>
        <//>
        <${Stack} direction="wrap" align="center">
          <${Text} kind="mono">Owner: ${escHtml(c.ownerGhii || '')}<//>
          <${Stack} direction="horizontal" align="center" density="compact"><${Text} kind="label">Status:<//><${Badge} type=${c.status === 'active' ? 'success' : c.status === 'disabled' ? 'danger' : 'warning'} label=${c.status} /><//>
          <${Text} kind="mono">Auth: ${String(c.authRequired)}<//>
          <${Text} kind="mono">Vouches: ${c.trust?.vouchCount || 0}<//>
          <${Text} kind="mono">Avg: ${s.avgResponseMs || 0}ms<//>
        <//>
        ${c.usage ? html`<${Surface} kind="code">${escHtml(c.usage.slice(0, 200))}<//>` : null}
      <//>
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
  const open = expanded ? caps.find(c => c.id === expanded) : null;
  const toggle = (id) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next) setTimeout(() => scrollToId('adm-cap-open'), 0);
  };
  const dash = html`<${Text} tone="muted">—<//>`;

  return html`
    <${Stack}>
      <${Toolbar} search=${{ ariaLabel: t('common.search'), placeholder: t('common.search'), value: filter, onInput: (e) => setFilter(e.target.value) }}
        count=${`${filtered.length} / ${caps.length}`} />
      ${open && html`<${CapabilityRecord} c=${open} />`}
      <${Table} rowTones=${filtered.map(c => (c.operatorOverride?.disabled ? 'muted' : undefined))}
        headers=${['ID', t('capabilities.name'), 'Input', 'Output', t('capabilities.sourceType'), t('capabilities.callable'), t('capabilities.invocations'), t('capabilities.errors')]}
        rows=${filtered.map(c => {
          const s = c.stats || {};
          const inputKeys = schemaKeys(c.inputSchema);
          const outputKeys = schemaKeys(c.outputSchema);
          return [
            // The id wraps at its hyphens: with every column on one line the table is wider than the
            // page column, and a mono Text part would break it inside a word.
            { text: escHtml(c.id), title: c.id },
            // The name opens the record. The summary is its tooltip and is printed in full in the
            // record: a one-line summary here takes the clamp's 22rem, and with it the table no
            // longer fits its column beside the other six.
            // One line, so a narrow column cannot break the name inside a word.
            { text: html`<${Action} kind="text" title=${c.summary || undefined} expanded=${expanded === c.id} onClick=${() => toggle(c.id)}>${escHtml(c.name)}<//>`, clamp: true, title: c.summary || c.name },
            // Clamped keys would take 22rem each for the same reason; as plain cell text they wrap at
            // their commas and never inside a key (a mono Text part may break anywhere).
            inputKeys ? { text: inputKeys, title: inputKeys } : dash,
            outputKeys ? { text: outputKeys, title: outputKeys } : dash,
            html`<${Badge} type=${c.source?.type || 'manual'} />`,
            c.callable ? '✓' : '✗',
            { text: num(s.totalInvocations || 0), align: 'end' },
            s.errorCount > 0 ? html`<${Text} tone="danger">${num(s.errorCount)}<//>` : { text: num(s.errorCount || 0), align: 'end' },
          ];
        })} />
    <//>
  `;
}
