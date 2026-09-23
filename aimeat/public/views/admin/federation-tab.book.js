/**
 * @file federation-tab.book.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 04 and 06 of the Federation page, plus the reference doors and the two
 *   forms: the federation book, what the federation offers, and the twenty explainers that used to
 *   sit between the controls.
 *
 *   THE BOOK NOW SAYS HOW OLD IT IS. It is a signed directory of every node in the federation, kept
 *   by the genesis node and mirrored here, and it carries `issued_at`. The page printed the edition
 *   number and who signed it in small grey type and dropped the date — so the one thing that says
 *   whether to press Mirror was the one thing left out.
 *
 *   AND WHICH ROW IS YOU. The book contains this node's own card beside every other node's, and
 *   every row was drawn the same. Two marks: the row that is this node, and the row that keeps the
 *   book everybody else mirrors.
 *
 *   THE REFERENCE IS ONE DOOR, not twenty. The nine bus topics, the five per-section explainers and
 *   the twenty-five endpoint lines are the same text, at the foot of the page, where somebody
 *   reading them once can find them and somebody working can walk past them.
 * @structure
 *   - TheBook (04) — the directory, its age, and who keeps it
 *   - WhatIsOffered (06) — the network directory, searched
 *   - Reference — the explainers and the endpoint list, behind three doors
 *   - AddPeerForm / TestNodeForm — the two forms, opened from section 03
 * @usage Imported by views/admin/federation-tab.js.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the book and the directory as shared
 *     tables, the marks as chips, the two forms in the shared aside with shared fields, the reference
 *     doors as tabs over headings and code surfaces.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt, Badge, Row } from './shared.js';
import { Section, Stack, Table, Toolbar, Field, Chip, Action, Surface, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.fed.' + key, params);

/** Section 04: every node in the federation, not only the ones this node talks to. */
export function TheBook({ overview, onRebuild, onMirror }) {
  const { book, this_node: me } = overview;

  return html`<${Section} id="adm-fed-04" title=${S('book.title')} count="04"
    description=${book.is_primary ? S('book.leadPrimary') : S('book.leadMirror')}
    actions=${book.is_primary
      ? html`<${Action} onClick=${onRebuild}>${S('book.rebuild')}<//>`
      : html`<${Action} onClick=${onMirror}>${S('book.mirror')}<//>`}>
    <${Stack}>
      ${!book.present || !book.nodes.length
        ? html`<${Text} tone="muted">${S('book.empty')}<//>`
        : html`
          <${Table} collapse=${900} label=${S('book.title')}
            headers=${[S('book.colNode'), S('book.colRunBy'), S('book.colVersion'), S('book.colOffers'), S('book.colLetsIn')]}
            rows=${book.nodes.map(n => [
              html`<${Stack} density="compact"><${Text} kind="mono">${n.node_id}<//>
                <${Stack} direction="wrap" density="compact">
                  ${n.is_this_node ? html`<${Chip} tone="sun">${S('book.thisNode')}<//>` : null}
                  ${n.keeps_book ? html`<${Chip} tone="muted">${S('book.keeper')}<//>` : null}
                  ${!n.listed ? html`<${Chip} tone="muted">${S('book.unlisted')}<//>` : null}
                <//><//>`,
              html`<${Stack} density="compact">
                ${n.operators.length
                  ? n.operators.slice(0, 3).map(o => html`<${Text} key=${o.ghii} kind="caption" title=${o.ghii}>${o.display_name || o.ghii}<//>`)
                  : html`<${Text} kind="caption" tone="muted">—<//>`}
                ${n.operators.length > 3 ? html`<${Text} kind="caption" tone="muted">${S('book.andMore', { n: n.operators.length - 3 })}<//>` : null}
              <//>`,
              html`<${Stack} density="compact"><${Text} kind="mono">${n.software_version || '—'}<//>
                ${n.versions_behind
                  ? html`<${Text} kind="caption" tone="coral">${S('book.behind', { n: num(n.versions_behind) })}<//>`
                  : n.software_version && n.software_version === overview.newest_version
                    ? html`<${Text} kind="caption" tone="success">${S('book.newest')}<//>`
                    : null}<//>`,
              n.offers.nothing
                ? html`<${Text} kind="caption" tone="coral">${S('book.offersNothing')}<//>`
                : S('book.offersSome', {
                  a: num(n.offers.actions), g: num(n.offers.agents),
                  b: num(n.offers.boards), c: num(n.offers.csms),
                }),
              html`<${Stack} density="compact">
                <${Text} kind="caption">${S('book.letsIn_' + (n.auth_policy || 'disabled'))}<//>
                ${n.open_join ? html`<${Text} kind="caption" tone="muted">${S('book.openJoin')}<//>` : null}
                ${n.cross_federation ? html`<${Text} kind="caption" tone="muted">${S('book.crossFed')}<//>` : null}
              <//>`,
            ])} />
          <${Text} kind="mono" tone="muted">${S('book.stamp', {
            edition: num(book.edition ?? 0),
            by: book.issued_by || '—',
            when: dt(book.issued_at),
            age: book.age_days === null ? S('book.ageUnknown') : S('book.ageDays', { n: num(book.age_days) }),
          })}<//>`}

      ${book.present && book.age_days !== null && book.age_days >= 7 && !book.is_primary && html`<${Surface} kind="aside"><${Stack} density="compact">
        <${Text} kind="label">${S('book.staleLabel', { n: num(book.age_days) })}<//>
        <${Text}>${S('book.staleBody', { id: me.node_id })}<//>
      <//><//>`}
    <//>
  <//>`;
}

/** Section 06: what the federation as a whole is offering, searched. */
export function WhatIsOffered({ entries, loading, q, onQ }) {
  return html`<${Section} id="adm-fed-06" title=${S('dir.title')} count="06">
    <${Stack}>
      <${Toolbar} search=${{ ariaLabel: S('dir.search'), placeholder: S('dir.search'), value: q, onInput: (e) => onQ(e.target.value) }} />
      ${loading
        ? html`<${Text} tone="muted">${S('dir.loading')}<//>`
        : !entries.length
          ? html`<${Text} tone="muted">${q ? S('dir.noMatch', { q }) : S('dir.empty')}<//>`
          : html`<${Table} collapse=${640} label=${S('dir.title')}
            headers=${[S('dir.colWhat'), S('dir.colName'), S('dir.colNode'), S('dir.colKind')]}
            rows=${entries.map(e => [
              html`<${Badge} type=${e.type === 'action' ? 'info' : e.type === 'agent' ? 'success' : e.type === 'board' ? 'warning' : 'muted'} label=${e.type} />`,
              html`<strong>${e.name || e.id || '—'}</strong>`,
              { text: e.source_node || '—', mono: true },
              e.category || e.service_type || '—',
            ])} />`}
    <//>
  <//>`;
}

/** The form that adds a peer by hand, opened from section 03. */
export function AddPeerForm({ busy, onAdd, onClose }) {
  const [nodeId, setNodeId] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return html`<${Surface} kind="aside"><${Stack}>
    <${Stack} density="compact">
      <${Text} kind="label">${S('add.label')}<//>
      <${Text}>${S('add.body')}<//>
    <//>
    <${Field} label=${S('add.nodeId')} value=${nodeId} onInput=${e => setNodeId(e.target.value)} placeholder="aimeat-city-001-prod" />
    <${Field} type="url" label=${S('add.url')} value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://node.example" />
    <${Field} label=${S('add.key')} value=${key} passwordManager=${false} onInput=${e => setKey(e.target.value)} placeholder=${S('add.keyPlaceholder')} />
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" disabled=${busy || !nodeId || !url || !key} onClick=${() => onAdd(nodeId, url, key)}>${S('add.go')}<//>
      <${Action} kind="text" onClick=${onClose}>${S('add.cancel')}<//>
    <//>
    <${Text} kind="caption" tone="muted">${S('add.keyNote')}<//>
  <//><//>`;
}

/** The form that asks whether another node could be peered with at all. */
export function TestNodeForm({ busy, result, onTest, onClose }) {
  const [url, setUrl] = useState('');
  return html`<${Surface} kind="aside"><${Stack}>
    <${Stack} density="compact">
      <${Text} kind="label">${S('test.label')}<//>
      <${Text}>${S('test.body')}<//>
    <//>
    <${Field} type="url" label=${S('test.url')} value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://other-node.example" />
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" disabled=${busy || !url} onClick=${() => onTest(url)}>${busy ? S('test.going') : S('test.go')}<//>
      <${Action} kind="text" onClick=${onClose}>${S('test.cancel')}<//>
    <//>
    ${result && (result.error
      ? html`<${Text} tone="danger">${result.error}<//>`
      : html`<div>
        ${Row({ title: S('test.target'), why: null, chip: null, value: result.target_url || '—' })}
        ${Row({
          title: S('test.ready'), why: S('test.readyWhy'), chip: html`<${Badge}
            type=${result.ready ? 'success' : 'danger'} label=${result.ready ? S('test.yes') : S('test.no')} />`, value: '',
        })}
        ${Object.entries(result.checks || {}).map(([k, v]) => Row({
          title: k, why: null,
          chip: html`<${Badge} type=${v.passed ? 'success' : 'danger'} label=${v.passed ? '✓' : '✗'} />`,
          value: v.detail || '',
        }))}
      </div>`)}
  <//><//>`;
}

/** Headings and paragraphs of one reference body, from [titleKey, detailKey] pairs. */
const refBody = (lead, pairs) => html`<${Stack}>
  ${lead && html`<${Text}>${t(lead)}<//>`}
  ${pairs.map(([title, detail]) => html`<${Stack} key=${title} density="compact">
    <${Text} kind="label">${t(title)}<//><${Text}>${t(detail)}<//>
  <//>`)}
<//>`;

/**
 * The endpoint list, grouped: [title key, endpoint lines].
 * @type {Array<[string, string[]]>}
 */
const API_GROUPS = [
  ['ref.apiPeers', ['GET  /v1/admin/federation/overview', 'GET  /v1/federation/peers', 'POST /v1/federation/peers',
    'PUT  /v1/federation/peers/:nodeId', 'DELETE /v1/federation/peers/:nodeId', 'POST /v1/federation/peer/activate']],
  ['ref.apiRequests', ['POST /v1/federation/peer/introduce', 'POST /v1/federation/peer/request',
    'GET  /v1/admin/peering/requests', 'PUT  /v1/admin/peering/requests/:id']],
  ['ref.apiExchange', ['POST /v1/federation/replicate', 'POST /v1/federation/catalogue-sync',
    'POST /v1/federation/heartbeat', 'GET  /v1/federation/directory']],
  ['ref.apiCross', ['POST /v1/federation/route', 'POST /v1/federation/cross-node/work', 'GET  /v1/federation/resolve/:gaii']],
  ['ref.apiMoney', ['POST /v1/federation/settle', 'POST /v1/federation/settle/outbound']],
  ['ref.apiSecurity', ['POST /v1/federation/key-exchange', 'POST /v1/federation/trust-advisory', 'POST /v1/federation/test']],
];

/**
 * The reference, at the foot, behind three doors.
 *
 * It used to be twenty separate collapsibles wedged between the controls: six under "How federation
 * works", nine under the bus, five one per section, and a twenty-five-line endpoint list. Same
 * text, one place, and a person working can walk past it.
 */
export function Reference() {
  const [open, setOpen] = useState(null);
  const door = (id, label) => html`<${Action} kind="tab" selected=${open === id}
    onClick=${() => setOpen(open === id ? null : id)}>${label}<//>`;

  return html`<${Stack} id="adm-fed-ref">
    <${Stack} direction="wrap" align="center">
      <${Text} kind="label">${S('ref.title')}<//>
      ${door('how', S('ref.how'))}
      ${door('bus', S('ref.bus'))}
      ${door('api', S('ref.api'))}
      <${Text} kind="caption" tone="muted">${S('ref.note')}<//>
    <//>

    ${open === 'how' && refBody('dashboard.federationHelpDetail', [
      ['dashboard.fedHowJoinTitle', 'dashboard.fedHowJoinDetail'],
      ['dashboard.fedHowReplicationTitle', 'dashboard.fedHowReplicationDetail'],
      ['dashboard.fedHowSettlementsTitle', 'dashboard.fedHowSettlementsDetail'],
      ['dashboard.fedHowRoutingTitle', 'dashboard.fedHowRoutingDetail'],
    ])}

    ${open === 'bus' && refBody('dashboard.fedBusExplain', [
      ['dashboard.fedBusHeartbeatTitle', 'dashboard.fedBusHeartbeatDetail'],
      ['dashboard.fedBusReplicateTitle', 'dashboard.fedBusReplicateDetail'],
      ['dashboard.fedBusCatalogueTitle', 'dashboard.fedBusCatalogueDetail'],
      ['dashboard.fedBusRoutingTitle', 'dashboard.fedBusRoutingDetail'],
      ['dashboard.fedBusSettlementTitle', 'dashboard.fedBusSettlementDetail'],
      ['dashboard.fedBusTrustTitle', 'dashboard.fedBusTrustDetail'],
      ['dashboard.fedBusKeyExchangeTitle', 'dashboard.fedBusKeyExchangeDetail'],
      ['dashboard.fedBusCrossWorkTitle', 'dashboard.fedBusCrossWorkDetail'],
      ['dashboard.fedBusResolveTitle', 'dashboard.fedBusResolveDetail'],
    ])}

    ${open === 'api' && html`<${Stack}>
      ${API_GROUPS.map(([title, lines]) => html`<${Stack} key=${title} density="compact">
        <${Text} kind="label">${S(title)}<//>
        <${Surface} kind="code">${lines.join('\n')}<//>
      <//>`)}
    <//>`}
  <//>`;
}
