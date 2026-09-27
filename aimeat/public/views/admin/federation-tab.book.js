/**
 * @file federation-tab.book.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 04 and 06 of the Federation page, plus the reference doors and the two
 *   forms: the federation book, what the federation offers, and the twenty explainers that used to
 *   sit between the controls. The parts draw library components and pass them data; they write no
 *   class.
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
 *   v2.0.0 — 2026-09-27 — Library components, no class: the book and the directory are Lists (each
 *     cell says its column on a narrow screen), this node's row wears the sun tag and the keeper's
 *     and the unlisted rows the dim one, the directory search is the SearchLine with its magnifier,
 *     the forms are text fields in the settings box, the reference doors are fold tabs (the open one
 *     on the sun) over sub-headings and code lines.
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
import { Section } from '/components/Section.js';
import { List, Row as ListRow, Name, Desc, Who, Cell, SearchLine } from '/components/List.js';
import { Tinted } from '/components/Figure.js';
import { Action, Actions } from '/components/Action.js';
import { SettingBox } from '/components/Box.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { Tab } from '/components/Tabs.js';
import { Stack, Space, Row as Line } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Mark, Label, Code } from '/components/Mark.js';

const S = (key, params) => t('admin.fed.' + key, params);

/** A version, and how far behind the newest it is (in the warn colour), or that it is the newest. */
function Version({ version, behind, newest }) {
  const same = !behind && version && version === newest;
  return html`
    <${Cell} meta sub=${same ? S('book.newest') : undefined}>
      ${version || '—'}
      ${behind ? html` <${Tinted} strong tone="warn">${S('book.behind', { n: num(behind) })}<//>` : null}
    <//>`;
}

/** Section 04: every node in the federation, not only the ones this node talks to. */
export function TheBook({ overview, onRebuild, onMirror }) {
  const { book, this_node: me } = overview;

  return html`
    <${Section} id="adm-fed-04" num="04" title=${S('book.title')}
      doors=${book.is_primary
    ? html`<${Action} small soft onClick=${onRebuild}>${S('book.rebuild')}<//>`
    : html`<${Action} small soft onClick=${onMirror}>${S('book.mirror')}<//>`}>
      <${Note} kind="lead">${book.is_primary ? S('book.leadPrimary') : S('book.leadMirror')}<//>

      ${!book.present || !book.nodes.length
    ? html`<${Note} kind="quiet">${S('book.empty')}<//>`
    : html`
      <${List} cols="name-who-code-desc-desc" labels
        head=${[S('book.colNode'), S('book.colRunBy'), S('book.colVersion'), S('book.colOffers'), S('book.colLetsIn')]}>
        ${book.nodes.map(n => html`
          <${ListRow} key=${n.node_id}>
            <${Name} asKey marks=${[
              n.is_this_node ? html`<${Mark} key="me" tone="sun">${S('book.thisNode')}<//>` : null,
              n.keeps_book ? html`<${Mark} key="keeper" tone="dim">${S('book.keeper')}<//>` : null,
              !n.listed ? html`<${Mark} key="unlisted" tone="dim">${S('book.unlisted')}<//>` : null,
            ]}>${n.node_id}<//>
            <${Who}>
              <${Stack} gap="none">
                ${n.operators.length
      ? n.operators.slice(0, 3).map(o => html`<${Note} kind="meta" key=${o.ghii} title=${o.ghii}>${o.display_name || o.ghii}<//>`)
      : html`<${Tinted} tone="dim">—<//>`}
                ${n.operators.length > 3 ? html`<${Note} kind="meta">${S('book.andMore', { n: n.operators.length - 3 })}<//>` : null}
              <//>
            <//>
            <${Version} version=${n.software_version} behind=${n.versions_behind} newest=${overview.newest_version} />
            <${Desc}>
              ${n.offers.nothing
      ? html`<${Tinted} tone="warn">${S('book.offersNothing')}<//>`
      : S('book.offersSome', {
        a: num(n.offers.actions), g: num(n.offers.agents),
        b: num(n.offers.boards), c: num(n.offers.csms),
      })}
            <//>
            <${Desc}>
              <${Stack} gap="none">
                <${Note} kind="meta">${S('book.letsIn_' + (n.auth_policy || 'disabled'))}<//>
                ${n.open_join ? html`<${Note} kind="meta">${S('book.openJoin')}<//>` : null}
                ${n.cross_federation ? html`<${Note} kind="meta">${S('book.crossFed')}<//>` : null}
              <//>
            <//>
          <//>`)}
      <//>
      <${Note}>
        ${S('book.stamp', {
      edition: num(book.edition ?? 0),
      by: book.issued_by || '—',
      when: dt(book.issued_at),
      age: book.age_days === null ? S('book.ageUnknown') : S('book.ageDays', { n: num(book.age_days) }),
    })}
      <//>`}

      ${book.present && book.age_days !== null && book.age_days >= 7 && !book.is_primary && html`
        <${Space} above="large">
          <${SettingBox} label=${S('book.staleLabel', { n: num(book.age_days) })}>
            ${S('book.staleBody', { id: me.node_id })}
          <//>
        <//>`}
    <//>`;
}

/** The directory's kind of thing, as the tone of its status mark. */
const KIND_BADGE = { action: 'info', agent: 'success', board: 'warning' };

/** Section 06: what the federation as a whole is offering, searched. */
export function WhatIsOffered({ entries, loading, q, onQ }) {
  return html`
    <${Section} id="adm-fed-06" num="06" title=${S('dir.title')}>
      <${SearchLine} find value=${q} placeholder=${S('dir.search')} onInput=${(e) => onQ(e.target.value)} />
      <${List} cols="state-name-code-desc" labels loading=${loading ? S('dir.loading') : false}
        empty=${q ? S('dir.noMatch', { q }) : S('dir.empty')}
        head=${[S('dir.colWhat'), S('dir.colName'), S('dir.colNode'), S('dir.colKind')]}>
        ${entries.map((e, i) => html`
          <${ListRow} key=${(e.id || e.name || '') + i}>
            <${Cell}><${Badge} type=${KIND_BADGE[e.type] || 'muted'} label=${e.type} /><//>
            <${Name}>${e.name || e.id || '—'}<//>
            <${Cell} meta>${e.source_node || '—'}<//>
            <${Desc}>${e.category || e.service_type || '—'}<//>
          <//>`)}
      <//>
    <//>`;
}

/** The form that adds a peer by hand, opened from section 03. */
export function AddPeerForm({ busy, onAdd, onClose }) {
  const [nodeId, setNodeId] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return html`
    <${Space} above="large">
      <${SettingBox} label=${S('add.label')}>
        ${S('add.body')}
        <${Space} above="medium">
          <${Fields} cols=${3}>
            <${TextField} label=${S('add.nodeId')} value=${nodeId} onInput=${setNodeId} placeholder="aimeat-city-001-prod" />
            <${TextField} label=${S('add.url')} value=${url} onInput=${setUrl} placeholder="https://node.example" />
            <${TextField} label=${S('add.key')} value=${key} onInput=${setKey} placeholder=${S('add.keyPlaceholder')} />
          <//>
        <//>
        <${Actions}>
          <${Action} small disabled=${busy || !nodeId || !url || !key}
            onClick=${() => onAdd(nodeId, url, key)}>${S('add.go')}<//>
          <${Action} small soft onClick=${onClose}>${S('add.cancel')}<//>
        <//>
        <${Note}>${S('add.keyNote')}<//>
      <//>
    <//>`;
}

/** The form that asks whether another node could be peered with at all. */
export function TestNodeForm({ busy, result, onTest, onClose }) {
  const [url, setUrl] = useState('');
  return html`
    <${Space} above="large">
      <${SettingBox} label=${S('test.label')}>
        ${S('test.body')}
        <${Space} above="medium">
          <${TextField} label=${S('test.url')} value=${url} onInput=${setUrl} onEnter=${() => url && !busy && onTest(url)}
            placeholder="https://other-node.example" />
        <//>
        <${Actions}>
          <${Action} small disabled=${busy || !url} onClick=${() => onTest(url)}>${busy ? S('test.going') : S('test.go')}<//>
          <${Action} small soft onClick=${onClose}>${S('test.cancel')}<//>
        <//>
        ${result && html`
          <${Space} above="medium">
            ${result.error
      ? html`<${Note} kind="message" error>${result.error}<//>`
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
          <//>`}
      <//>
    <//>`;
}

/** The explainer under one reference door: a sub-heading and its paragraph, per topic. */
function Topics({ lead, topics }) {
  return html`
    <${Stack} gap="small">
      ${lead ? html`<${Note}>${lead}<//>` : null}
      ${topics.map(([title, detail]) => html`
        <${SubHeading} key=${title} level=${5}>${t(title)}<//>
        <${Note}>${t(detail)}<//>`)}
    <//>`;
}

/** The endpoint list: a sub-heading per group and one line of code per route. */
function Endpoints({ groups }) {
  return html`
    <${Stack} gap="small">
      ${groups.map(([title, routes]) => html`
        <${SubHeading} key=${title} level=${5}>${S(title)}<//>
        <${Stack} gap="none">${routes.map((r) => html`<${Code} key=${r}>${r}<//>`)}<//>`)}
    <//>`;
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
    <${Tab} tone="fold" on=${open === id} expanded=${open === id}
      onClick=${() => setOpen(open === id ? null : id)}>${label}<//>`;

  return html`
    <${Section} id="adm-fed-ref" plain>
      <${Line} wrap gap="large" align="baseline">
        <${Label}>${S('ref.title')}<//>
        ${door('how', S('ref.how'))}
        ${door('bus', S('ref.bus'))}
        ${door('api', S('ref.api'))}
        <${Note} kind="meta" inline mono>${S('ref.note')}<//>
      <//>

      ${open === 'how' && html`<${Space} above="medium"><${Topics} lead=${t('dashboard.federationHelpDetail')} topics=${[
        ['dashboard.fedHowJoinTitle', 'dashboard.fedHowJoinDetail'],
        ['dashboard.fedHowReplicationTitle', 'dashboard.fedHowReplicationDetail'],
        ['dashboard.fedHowSettlementsTitle', 'dashboard.fedHowSettlementsDetail'],
        ['dashboard.fedHowRoutingTitle', 'dashboard.fedHowRoutingDetail'],
      ]} /><//>`}

      ${open === 'bus' && html`<${Space} above="medium"><${Topics} lead=${t('dashboard.fedBusExplain')} topics=${[
        ['dashboard.fedBusHeartbeatTitle', 'dashboard.fedBusHeartbeatDetail'],
        ['dashboard.fedBusReplicateTitle', 'dashboard.fedBusReplicateDetail'],
        ['dashboard.fedBusCatalogueTitle', 'dashboard.fedBusCatalogueDetail'],
        ['dashboard.fedBusRoutingTitle', 'dashboard.fedBusRoutingDetail'],
        ['dashboard.fedBusSettlementTitle', 'dashboard.fedBusSettlementDetail'],
        ['dashboard.fedBusTrustTitle', 'dashboard.fedBusTrustDetail'],
        ['dashboard.fedBusKeyExchangeTitle', 'dashboard.fedBusKeyExchangeDetail'],
        ['dashboard.fedBusCrossWorkTitle', 'dashboard.fedBusCrossWorkDetail'],
        ['dashboard.fedBusResolveTitle', 'dashboard.fedBusResolveDetail'],
      ]} /><//>`}

      ${open === 'api' && html`<${Space} above="medium"><${Endpoints} groups=${[
        ['ref.apiPeers', ['GET  /v1/admin/federation/overview', 'GET  /v1/federation/peers', 'POST /v1/federation/peers',
          'PUT  /v1/federation/peers/:nodeId', 'DELETE /v1/federation/peers/:nodeId', 'POST /v1/federation/peer/activate']],
        ['ref.apiRequests', ['POST /v1/federation/peer/introduce', 'POST /v1/federation/peer/request',
          'GET  /v1/admin/peering/requests', 'PUT  /v1/admin/peering/requests/:id']],
        ['ref.apiExchange', ['POST /v1/federation/replicate', 'POST /v1/federation/catalogue-sync',
          'POST /v1/federation/heartbeat', 'GET  /v1/federation/directory']],
        ['ref.apiCross', ['POST /v1/federation/route', 'POST /v1/federation/cross-node/work', 'GET  /v1/federation/resolve/:gaii']],
        ['ref.apiMoney', ['POST /v1/federation/settle', 'POST /v1/federation/settle/outbound']],
        ['ref.apiSecurity', ['POST /v1/federation/key-exchange', 'POST /v1/federation/trust-advisory', 'POST /v1/federation/test']],
      ]} /><//>`}
    <//>`;
}
