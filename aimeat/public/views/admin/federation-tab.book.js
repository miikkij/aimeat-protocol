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
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt, Badge, Row } from './shared.js';

const S = (key, params) => t('admin.fed.' + key, params);

/** Section 04: every node in the federation, not only the ones this node talks to. */
export function TheBook({ overview, onRebuild, onMirror }) {
  const { book, this_node: me } = overview;

  return html`
    <section class="og-sec" id="adm-fed-04">
      <div class="og-sec-h">
        <h2>${S('book.title')}<small>04</small></h2>
        <div class="og-doors">
          ${book.is_primary
    ? html`<button type="button" class="og-door og-door--quiet" onClick=${onRebuild}>${S('book.rebuild')}</button>`
    : html`<button type="button" class="og-door og-door--quiet" onClick=${onMirror}>${S('book.mirror')}</button>`}
        </div>
      </div>
      <p class="adm-intro">${book.is_primary ? S('book.leadPrimary') : S('book.leadMirror')}</p>

      ${!book.present || !book.nodes.length
    ? html`<div class="adm-fed-empty">${S('book.empty')}</div>`
    : html`
      <div class="adm-fed-scroll"><table class="adm-fed-tbl">
        <thead><tr>
          <th>${S('book.colNode')}</th>
          <th>${S('book.colRunBy')}</th>
          <th>${S('book.colVersion')}</th>
          <th>${S('book.colOffers')}</th>
          <th>${S('book.colLetsIn')}</th>
        </tr></thead>
        <tbody>
          ${book.nodes.map(n => html`<tr key=${n.node_id}>
            <td>
              <b class="mono">${n.node_id}</b>
              ${n.is_this_node ? html`<span class="adm-fed-mark">${S('book.thisNode')}</span>` : null}
              ${n.keeps_book ? html`<span class="adm-fed-mark adm-fed-mark--quiet">${S('book.keeper')}</span>` : null}
              ${!n.listed ? html`<span class="adm-fed-mark adm-fed-mark--quiet">${S('book.unlisted')}</span>` : null}
            </td>
            <td>
              ${n.operators.length
    ? n.operators.slice(0, 3).map(o => html`<span class="adm-fed-sub" title=${o.ghii}>${o.display_name || o.ghii}</span>`)
    : html`<span class="adm-fed-maynot">—</span>`}
              ${n.operators.length > 3 ? html`<span class="adm-fed-maynot">${S('book.andMore', { n: n.operators.length - 3 })}</span>` : null}
            </td>
            <td class="mono" data-col=${S('book.colVersion')}>
              ${n.software_version || '—'}
              ${n.versions_behind
    ? html`<span class="adm-fed-behind">${S('book.behind', { n: num(n.versions_behind) })}</span>`
    : n.software_version && n.software_version === overview.newest_version
      ? html`<span class="adm-fed-same">${S('book.newest')}</span>`
      : null}
            </td>
            <td>
              ${n.offers.nothing
    ? html`<span class="adm-fed-nothing">${S('book.offersNothing')}</span>`
    : S('book.offersSome', {
      a: num(n.offers.actions), g: num(n.offers.agents),
      b: num(n.offers.boards), c: num(n.offers.csms),
    })}
            </td>
            <td>
              <span class="adm-fed-sub">${S('book.letsIn_' + (n.auth_policy || 'disabled'))}</span>
              ${n.open_join ? html`<span class="adm-fed-sub adm-fed-maynot">${S('book.openJoin')}</span>` : null}
              ${n.cross_federation ? html`<span class="adm-fed-sub adm-fed-maynot">${S('book.crossFed')}</span>` : null}
            </td>
          </tr>`)}
        </tbody>
      </table></div>
      <p class="adm-fed-note">
        ${S('book.stamp', {
      edition: num(book.edition ?? 0),
      by: book.issued_by || '—',
      when: dt(book.issued_at),
      age: book.age_days === null ? S('book.ageUnknown') : S('book.ageDays', { n: num(book.age_days) }),
    })}
      </p>`}

      ${book.present && book.age_days !== null && book.age_days >= 7 && !book.is_primary && html`
        <div class="og-box adm-fed-box--after">
          <span class="og-box-label">${S('book.staleLabel', { n: num(book.age_days) })}</span>
          ${S('book.staleBody', { id: me.node_id })}
        </div>`}
    </section>`;
}

/** Section 06: what the federation as a whole is offering, searched. */
export function WhatIsOffered({ entries, loading, q, onQ }) {
  return html`
    <section class="og-sec" id="adm-fed-06">
      <div class="og-sec-h">
        <h2>${S('dir.title')}<small>06</small></h2>
      </div>
      <div class="adm-fed-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="16" y1="16" x2="21" y2="21"></line></svg>
        <input type="search" value=${q} placeholder=${S('dir.search')} onInput=${(e) => onQ(e.target.value)} />
      </div>
      ${loading
    ? html`<div class="adm-fed-empty">${S('dir.loading')}</div>`
    : !entries.length
      ? html`<div class="adm-fed-empty">${q ? S('dir.noMatch', { q }) : S('dir.empty')}</div>`
      : html`<div class="adm-fed-scroll"><table class="adm-fed-tbl">
        <thead><tr>
          <th>${S('dir.colWhat')}</th>
          <th>${S('dir.colName')}</th>
          <th>${S('dir.colNode')}</th>
          <th>${S('dir.colKind')}</th>
        </tr></thead>
        <tbody>
          ${entries.map((e, i) => html`<tr key=${(e.id || e.name || '') + i}>
            <td><${Badge} type=${e.type === 'action' ? 'info' : e.type === 'agent' ? 'success' : e.type === 'board' ? 'warning' : 'muted'} label=${e.type} /></td>
            <td><b>${e.name || e.id || '—'}</b></td>
            <td class="mono">${e.source_node || '—'}</td>
            <td data-col=${S('dir.colKind')}>${e.category || e.service_type || '—'}</td>
          </tr>`)}
        </tbody>
      </table></div>`}
    </section>`;
}

/** The form that adds a peer by hand, opened from section 03. */
export function AddPeerForm({ busy, onAdd, onClose }) {
  const [nodeId, setNodeId] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return html`
    <div class="og-box adm-fed-box--after">
      <span class="og-box-label">${S('add.label')}</span>
      ${S('add.body')}
      <div class="adm-fed-form">
        <label class="adm-fld"><span>${S('add.nodeId')}</span>
          <input class="adm-input" value=${nodeId} onInput=${e => setNodeId(e.target.value)} placeholder="aimeat-city-001-prod" /></label>
        <label class="adm-fld adm-fld--wide"><span>${S('add.url')}</span>
          <input class="adm-input" value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://node.example" /></label>
        <label class="adm-fld adm-fld--wide"><span>${S('add.key')}</span>
          <input class="adm-input" value=${key} onInput=${e => setKey(e.target.value)} placeholder=${S('add.keyPlaceholder')} /></label>
      </div>
      <div class="adm-fed-acts">
        <button type="button" class="og-door" disabled=${busy || !nodeId || !url || !key}
          onClick=${() => onAdd(nodeId, url, key)}>${S('add.go')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${S('add.cancel')}</button>
      </div>
      <p class="adm-fed-note">${S('add.keyNote')}</p>
    </div>`;
}

/** The form that asks whether another node could be peered with at all. */
export function TestNodeForm({ busy, result, onTest, onClose }) {
  const [url, setUrl] = useState('');
  return html`
    <div class="og-box adm-fed-box--after">
      <span class="og-box-label">${S('test.label')}</span>
      ${S('test.body')}
      <div class="adm-fed-form">
        <label class="adm-fld adm-fld--wide"><span>${S('test.url')}</span>
          <input class="adm-input" value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://other-node.example" /></label>
      </div>
      <div class="adm-fed-acts">
        <button type="button" class="og-door" disabled=${busy || !url} onClick=${() => onTest(url)}>${busy ? S('test.going') : S('test.go')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${S('test.cancel')}</button>
      </div>
      ${result && html`
        <div class="adm-fed-after--tight">
          ${result.error
    ? html`<p class="adm-fed-state adm-fed-state--bad">${result.error}</p>`
    : html`
      ${Row({ title: S('test.target'), why: null, chip: null, value: result.target_url || '—' })}
      ${Row({
      title: S('test.ready'), why: S('test.readyWhy'), chip: html`<${Badge}
        type=${result.ready ? 'success' : 'danger'} label=${result.ready ? S('test.yes') : S('test.no')} />`, value: '',
    })}
      ${Object.entries(result.checks || {}).map(([k, v], i, a) => Row({
      title: k, why: null,
      chip: html`<${Badge} type=${v.passed ? 'success' : 'danger'} label=${v.passed ? '✓' : '✗'} />`,
      value: v.detail || '', last: i === a.length - 1,
    }))}`}
        </div>`}
    </div>`;
}

/**
 * The reference, at the foot, behind three doors.
 *
 * It used to be twenty separate collapsibles wedged between the controls: six under "How federation
 * works", nine under the bus, five one per section, and a twenty-five-line endpoint list. Same
 * text, one place, and a person working can walk past it.
 */
export function Reference() {
  const [open, setOpen] = useState(null);
  const door = (id, label) => html`
    <button type="button" class="og-door og-door--quiet ${open === id ? 'og-door--danger' : ''}"
      onClick=${() => setOpen(open === id ? null : id)}>${label}</button>`;

  return html`
    <section class="og-sec" id="adm-fed-ref">
      <div class="adm-fed-ref">
        <span class="adm-fed-lbl adm-fed-lbl--flush">${S('ref.title')}</span>
        ${door('how', S('ref.how'))}
        ${door('bus', S('ref.bus'))}
        ${door('api', S('ref.api'))}
        <span class="adm-fed-ref-note">${S('ref.note')}</span>
      </div>

      ${open === 'how' && html`<div class="adm-fed-refbody">
        <p>${t('dashboard.federationHelpDetail')}</p>
        <h5>${t('dashboard.fedHowJoinTitle')}</h5><p>${t('dashboard.fedHowJoinDetail')}</p>
        <h5>${t('dashboard.fedHowReplicationTitle')}</h5><p>${t('dashboard.fedHowReplicationDetail')}</p>
        <h5>${t('dashboard.fedHowSettlementsTitle')}</h5><p>${t('dashboard.fedHowSettlementsDetail')}</p>
        <h5>${t('dashboard.fedHowRoutingTitle')}</h5><p>${t('dashboard.fedHowRoutingDetail')}</p>
      </div>`}

      ${open === 'bus' && html`<div class="adm-fed-refbody">
        <p>${t('dashboard.fedBusExplain')}</p>
        <h5>${t('dashboard.fedBusHeartbeatTitle')}</h5><p>${t('dashboard.fedBusHeartbeatDetail')}</p>
        <h5>${t('dashboard.fedBusReplicateTitle')}</h5><p>${t('dashboard.fedBusReplicateDetail')}</p>
        <h5>${t('dashboard.fedBusCatalogueTitle')}</h5><p>${t('dashboard.fedBusCatalogueDetail')}</p>
        <h5>${t('dashboard.fedBusRoutingTitle')}</h5><p>${t('dashboard.fedBusRoutingDetail')}</p>
        <h5>${t('dashboard.fedBusSettlementTitle')}</h5><p>${t('dashboard.fedBusSettlementDetail')}</p>
        <h5>${t('dashboard.fedBusTrustTitle')}</h5><p>${t('dashboard.fedBusTrustDetail')}</p>
        <h5>${t('dashboard.fedBusKeyExchangeTitle')}</h5><p>${t('dashboard.fedBusKeyExchangeDetail')}</p>
        <h5>${t('dashboard.fedBusCrossWorkTitle')}</h5><p>${t('dashboard.fedBusCrossWorkDetail')}</p>
        <h5>${t('dashboard.fedBusResolveTitle')}</h5><p>${t('dashboard.fedBusResolveDetail')}</p>
      </div>`}

      ${open === 'api' && html`<div class="adm-fed-refbody">
        <h5>${S('ref.apiPeers')}</h5>
        <code>GET  /v1/admin/federation/overview</code>
        <code>GET  /v1/federation/peers</code>
        <code>POST /v1/federation/peers</code>
        <code>PUT  /v1/federation/peers/:nodeId</code>
        <code>DELETE /v1/federation/peers/:nodeId</code>
        <code>POST /v1/federation/peer/activate</code>
        <h5>${S('ref.apiRequests')}</h5>
        <code>POST /v1/federation/peer/introduce</code>
        <code>POST /v1/federation/peer/request</code>
        <code>GET  /v1/admin/peering/requests</code>
        <code>PUT  /v1/admin/peering/requests/:id</code>
        <h5>${S('ref.apiExchange')}</h5>
        <code>POST /v1/federation/replicate</code>
        <code>POST /v1/federation/catalogue-sync</code>
        <code>POST /v1/federation/heartbeat</code>
        <code>GET  /v1/federation/directory</code>
        <h5>${S('ref.apiCross')}</h5>
        <code>POST /v1/federation/route</code>
        <code>POST /v1/federation/cross-node/work</code>
        <code>GET  /v1/federation/resolve/:gaii</code>
        <h5>${S('ref.apiMoney')}</h5>
        <code>POST /v1/federation/settle</code>
        <code>POST /v1/federation/settle/outbound</code>
        <h5>${S('ref.apiSecurity')}</h5>
        <code>POST /v1/federation/key-exchange</code>
        <code>POST /v1/federation/trust-advisory</code>
        <code>POST /v1/federation/test</code>
      </div>`}
    </section>`;
}
