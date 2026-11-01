/**
 * @file public/views/profile/offers/data-product.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One data product as its own page inside the Offers page (design canvas "Data ulos",
 *   board Tarjoama, the opened product): its version, its schedule and next run, the actions Share,
 *   Sell on EXCHANGE and Withdraw, the figures (rows, versions, shares, reads in seven days), and five
 *   tabs: Shares and readers, Versions, Columns, Connection and Origin. It reads the definition
 *   (GET /v1/dataproducts/{name}), the package (GET /v1/datapackages/{owner}/{name}), its versions and
 *   the owner's parties, whose shares of this package are the readers; it reads them again on every
 *   live update, never on a timer. Made of the component kit: the page passes data, never a class.
 * @structure ProductPage · SharesTab · VersionsTab · ColumnsTab · OriginTab
 * @usage html`<${ProductPage} ctx=${ctx} name=${name} />`
 * @version-history
 *   v1.1.0 — 2026-11-01 — A product that runs when its source changes says so, with the run after a seen
 *     change; the shares to people on other AIMEAT nodes are readers too; refusals in the page's
 *     language (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D3, D5, D6, D9).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { num, ago, date as fmtDate } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import * as dp from '/js/services/dataproducts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tabs } from '/components/Tabs.js';
import { Box } from '/components/Box.js';
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors, Group } from '/components/List.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { renderPage } from './frame.js';
import { ConnectSteps } from './data-connect.js';
import { ShareDialog } from './share-dialog.js';
import { SellDialog } from './sell-dialog.js';
import { d, freshWord, scheduleWords, nextRunWords, versionNumber, productTitle, shortHash, audienceWord, errText } from './data-model.js';

const TABS = ['shares', 'versions', 'columns', 'connect', 'origin'];

/**
 * The live shares of this package: across the owner's parties, each with its party, and the shares to
 * people on other AIMEAT nodes (GET /v1/dataproducts/{name} `visitor_shares`), each as its own reader.
 */
function sharesOf(parties, name, visitorShares = []) {
  const out = [];
  for (const p of parties || []) for (const s of p.shares || []) if (s.package === name && s.status === 'active') out.push({ ...s, party: p });
  for (const s of visitorShares) out.push({ ...s, party: { kind: 'visitor', display_name: s.display_name || s.recipient } });
  return out;
}

function SharesTab({ shares, onRevoke, busy }) {
  // The owner's own row closes the list: the owner and their agents read every product.
  return html`<${List} cols="name-who-doors" labels head=${[d('product.colWho'), d('product.colUntil'), '']}
    rows=${[...shares, { owner: true }]} render=${(s) => (s.owner
      ? html`<${Row} key="owner"><${Name} meta=${d('product.owner')}>${d('product.youAndAgents')}<//><${Who} /><${Doors} /><//>`
      : html`<${Row} key=${s.id}>
        <${Name} meta=${[d('party.kind.' + s.party.kind), s.party.kind === 'visitor' ? s.recipient : '', s.purpose].filter(Boolean).join(' · ')}>${s.party.display_name}<//>
        <${Who} sub=${s.last_read_at ? d('product.lastRead', { when: ago(s.last_read_at) }) : d('product.notRead')}>${d('product.until', { date: fmtDate(s.expires) })}<//>
        <${Doors}><${Action} small row tone="danger" disabled=${busy} onClick=${() => onRevoke(s)}>${d('product.revoke')}<//><//>
      <//>`)} />
    ${shares.length ? null : html`<${Note} kind="quiet">${d('product.noShares')}<//>`}`;
}

function VersionsTab({ versions, retention }) {
  return html`<${List} cols="name-desc-count-when-doors" labels
    head=${[d('product.colVersion'), d('product.colChanges'), { label: d('product.colRows'), num: true }, d('product.colWhen'), '']}
    empty=${d('product.noVersions')} rows=${versions} render=${(v) => {
      const use = v.in_use || {};
      const sub = [use.pinned_by_shares?.length ? d('product.pinnedN', { n: use.pinned_by_shares.length }) : null,
        use.party_reads_30d ? d('product.reads30', { n: num(use.party_reads_30d) }) : null,
        use.removed_next ? d('product.removedNext') : null].filter(Boolean).join(' · ');
      return html`<${Row} key=${v.contentHash} selected=${v.current}>
        <${Name} meta=${shortHash(v.contentHash)} warn=${!!use.removed_next} tag=${v.current ? d('product.current') : null}>${d('product.versionN', { n: versionNumber(versions, v.contentHash) })}<//>
        <${Desc} sub=${sub || undefined} lines=${2}>${v.changes}<//>
        <${Num}>${num(v.rowCount)}<//>
        <${When}>${ago(v.at)}<//>
        <${Doors}><${Action} small row href=${v.descriptorUrl} newTab>${d('product.descriptor')}<//><//>
      <//>`;
    }} />
    <${Note}>${retention ? d('product.retention.' + (retention.unit || 'versions'), { n: retention.keep }) : d('product.retentionAll')}<//>`;
}

function ColumnsTab({ descriptor }) {
  const resources = descriptor?.resources || [];
  if (!resources.length) return html`<${Note} kind="quiet">${d('product.noColumns')}<//>`;
  return html`<${List} cols="name-kind-words" head=${[d('wizard.colOut'), d('wizard.colType'), d('wizard.colDesc')]}>
    ${resources.map((r) => html`
      <${Group} key=${r.name} title=${r.name} count=${d('list.rows', { n: num(r.rowCount || 0) })}>
        ${(r.schema?.fields || []).map((f) => html`<${Row} key=${r.name + f.name}>
          <${Name} code>${f.name}<//><${Cell} meta>${f.type}<//><${Desc}>${f.description || '–'}<//>
        <//>`)}
      <//>`)}
  <//>`;
}

function OriginTab({ def, descriptor }) {
  const a = descriptor?.aimeat || {};
  const sources = a.sources || def?.sources || [];
  return html`<${Facts} wide rows=${[
    { k: d('origin.sources'), v: sources.map((s) => html`<${FactLine} key=${s.id} sub=${s.address}>${s.id} · ${d('kind.' + s.kind)}${s.title ? ` · ${s.title}` : ''}<//>`) },
    def?.combine && { k: d('origin.combine'), v: d('combine.' + def.combine.mode) },
    (a.transformations || []).length && { k: d('origin.transformations'), v: a.transformations.map((tr, i) => html`<${FactLine} key=${i}>${tr.what}<//>`) },
    (a.lineage || []).length && { k: d('origin.lineage'), v: a.lineage.join(', '), mono: true },
    { k: d('origin.license'), v: a.license || descriptor?.licenses?.[0]?.name || d('origin.noLicense'), missing: !a.license },
    a.producedBy && { k: d('origin.producedBy'), v: a.producedBy.gaii, mono: true, sub: ago(a.producedBy.at) },
    a.contentHash && { k: d('origin.hash'), v: a.contentHash, mono: true },
  ]} />`;
}

export function ProductPage({ ctx, name, tab: initialTab, share: openShare }) {
  const owner = ctx.data.owner;
  const [state, setState] = useState(null);   // { def, schedule, pkg, versions, retention, shares, failed }
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'shares');
  const [shareOpen, setShareOpen] = useState(!!openShare);
  const [sellOpen, setSellOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const got = await dp.getProduct(name);
      const published = !!got?.package?.content_hash;
      const [pkg, ver, parties] = await Promise.all([
        published ? dp.getPackage(owner, name).catch((err) => { swallowed('data-product: package', err); return null; }) : null,
        published ? dp.listVersions(owner, name).catch((err) => { swallowed('data-product: versions', err); return null; }) : null,
        dp.listParties().catch((err) => { swallowed('data-product: parties', err); return null; }),
      ]);
      setState({ def: got.definition, schedule: got.schedule, nextChange: got.next_change_run_at || null, pkg, versions: ver?.versions || [], retention: ver?.retention_policy || null, shares: sharesOf(parties?.parties, name, got.visitor_shares) });
    } catch (err) { swallowed('data-product: load', err); setState({ failed: errText(err, 'product.loadFailed') }); }
  }, [name, owner]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const crumbs = [{ label: d('list.title'), go: () => ctx.pickView({ kind: 'page', id: 'data' }) }];
  if (!state) return renderPage(ctx, { id: 'data', crumbs: [...crumbs, name], title: name, children: html`<${Note} kind="loading" />` });
  if (state.failed) return renderPage(ctx, { id: 'data', crumbs: [...crumbs, name], title: name, children: html`<${Note} kind="message" error>${state.failed}<//>` });

  const { def, schedule, pkg, versions, shares, nextChange } = state;
  const latest = pkg?.latest;
  const withdrawn = latest?.status === 'withdrawn';
  const fresh = pkg?.freshness;
  const current = versions.find((v) => v.current);
  const rows = (pkg?.descriptor?.resources || []).reduce((n, r) => n + (r.rowCount || 0), 0);
  const title = productTitle({ title: def.title, name });
  const reads7 = shares.reduce((n, s) => n + (s.reads_7d || 0), 0);

  const run = async () => {
    setBusy(true);
    try { const out = await dp.runProduct(name); ctx.showToast(out?.unchanged ? d('product.unchanged') : d('product.ran')); await load(); ctx.data.reload(); }
    catch (err) { ctx.showToast(errText(err, 'product.runFailed')); }
    setBusy(false);
  };
  const withdraw = () => ctx.confirm(d('product.withdrawConfirm', { title, n: shares.length }), async () => {
    setBusy(true);
    try { await dp.withdrawPackage(owner, name); ctx.showToast(d('product.withdrawn', { title })); await load(); ctx.data.reload(); }
    catch (err) { ctx.showToast(errText(err, 'product.withdrawFailed')); }
    setBusy(false);
  }, { danger: true, title: d('product.withdraw'), confirmLabel: d('product.withdraw') });
  const revoke = (s) => ctx.confirm(d('product.revokeConfirm', { who: s.party.display_name }), async () => {
    setBusy(true);
    try { await dp.revokeShare(s.id); ctx.showToast(d('product.revoked', { who: s.party.display_name })); await load(); ctx.data.reload(); }
    catch (err) { ctx.showToast(errText(err, 'product.revokeFailed')); }
    setBusy(false);
  }, { danger: true, title: d('product.revoke'), confirmLabel: d('product.revoke') });

  const line = [
    current ? d('product.versionN', { n: versionNumber(versions, current.contentHash) }) : d('product.notPublished'),
    scheduleWords(schedule || def.schedule),
    schedule?.next_run_at ? d('product.nextRun', { when: nextRunWords(schedule.next_run_at) })
      : nextChange ? d('product.nextChangeRun', { when: nextRunWords(nextChange) }) : null,
  ].filter(Boolean).join(' · ');
  const marks = [
    withdrawn ? { label: d('list.withdrawn'), tone: 'dim' } : fresh ? { label: freshWord(fresh.state), tone: ['late', 'stale'].includes(fresh.state) ? 'coral' : undefined } : null,
    { label: audienceWord(latest?.visibility || def.visibility, ctx.data.orgNames) },
    latest?.exchange?.exchange ? { label: d('product.onSale'), tone: 'sun' } : null,
  ].filter(Boolean);
  const actions = html`
    ${withdrawn ? html`<${Loud} disabled=${busy} onClick=${run}>${d('product.publishAgain')}<//>`
      : current ? html`<${Loud} onClick=${() => setShareOpen(true)}>${d('product.share')}<//>`
        : html`<${Loud} disabled=${busy} onClick=${run}>${d('product.runNow')}<//>`}
    ${current && !withdrawn ? html`
      <${Action} small onClick=${() => setSellOpen(true)}>${latest?.exchange?.exchange ? d('product.sellEdit') : d('product.sell')}<//>
      <${Action} small soft disabled=${busy} onClick=${run}>${d('product.runNow')}<//>
      <${Action} small tone="danger" disabled=${busy} onClick=${withdraw}>${d('product.withdraw')}<//>` : null}`;
  const strip = html`<${FigureStrip} items=${[
    { key: 'rows', n: num(rows), label: d('product.figRows'), sub: def.lastRun?.at ? d('product.lastRun', { when: ago(def.lastRun.at) }) : '' },
    { key: 'versions', n: versions.length, label: d('product.figVersions'), sub: fresh ? freshWord(fresh.state) : '' },
    { key: 'shares', n: shares.length, label: d('product.figShares'), sub: '' },
    { key: 'reads', n: num(reads7), label: d('product.figReads'), sub: '' },
  ]} />`;
  const body = {
    shares: html`<${SharesTab} shares=${shares} onRevoke=${revoke} busy=${busy} />`,
    versions: html`<${VersionsTab} versions=${versions} retention=${state.retention} />`,
    columns: html`<${ColumnsTab} descriptor=${pkg?.descriptor} />`,
    connect: current ? html`<${ConnectSteps} owner=${owner} name=${name} pkg=${pkg} visibility=${latest?.visibility} />` : html`<${Note} kind="quiet">${d('product.notPublishedYet')}<//>`,
    origin: html`<${OriginTab} def=${def} descriptor=${pkg?.descriptor} />`,
  }[tab];

  return renderPage(ctx, {
    id: 'data', crumbs: [...crumbs, title], label: d('product.label'), title, marks, desc: line, actions, strip,
    after: html`
      <${ShareDialog} open=${shareOpen} onClose=${() => setShareOpen(false)} product=${{ name, title }} versions=${versions}
        showToast=${ctx.showToast} onShared=${() => { load(); ctx.data.reload(); }} />
      <${SellDialog} open=${sellOpen} onClose=${() => setSellOpen(false)} owner=${owner} name=${name} title=${title}
        current=${latest?.exchange} mode=${ctx.data.intermediation} showToast=${ctx.showToast} onSaved=${load} />`,
    children: html`
      ${def.lastRun && def.lastRun.ok === false ? html`<${Note} kind="aside" size="small">${d('product.lastRunFailed', { when: ago(def.lastRun.at), error: def.lastRun.error || '' })}<//>` : null}
      ${fresh && ['late', 'stale'].includes(fresh.state) ? html`<${Note} kind="aside" size="small">${d('fresh.why.' + fresh.state)}<//>` : null}
      <${Tabs} kind="view" label=${d('product.tabsLabel')} value=${tab} onSelect=${setTab}
        items=${TABS.map((tb) => ({ value: tb, label: d('product.tab.' + tb), count: tb === 'shares' ? shares.length : tb === 'versions' ? versions.length : undefined }))} />
      <${Box} tone="tabbed">${body}<//>`,
  });
}
