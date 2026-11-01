/**
 * @file public/views/dataset.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public page of one data package (design canvas "Data ulos", board Julkinen-sivu;
 *   /v1/dataset/{owner}/{name}), the page the DCAT feed, schema.org, the dataset sitemap and the
 *   IndexNow notice name. No sign-in: the crumb, the title and its one sentence, the facts (who made
 *   it and with what, how fresh it is and when it last changed, its size, its licence), "Use this
 *   data" with the tabs Excel and Power BI, DuckDB, Python and one's own AI over MCP with the real
 *   addresses, the columns from the Table Schema, how it was made and its versions, "Need more?"
 *   with a way to ask the maker, and the machine-readable links (datapackage.json, odps.yaml, DCAT).
 *
 *   ONLY A PUBLIC PACKAGE. The page reads GET /v1/datapackages/{owner}/{name} with no session, so a
 *   package nobody without an account may read answers 404 here as there; the shell gave its head
 *   (title, description, the schema.org Dataset) only for a public one (routes/portal.ts).
 *   Made of the component kit: it passes data and never a class.
 * @structure Dataset (default) · open · producerWords · bytesWords
 * @usage routed at /v1/dataset/<owner>/<name> by spa.html
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9b).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { num, date as fmtDate } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { PageFrame } from '/components/PageFrame.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Section } from '/components/Section.js';
import { Box } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Beside, Stack } from '/components/Layout.js';
import { AskPage } from '/components/AskPage.js';
import { d, freshWord, versionNumber } from './profile/offers/data-model.js';
import { ConnectSteps } from './profile/offers/data-connect.js';
import { ColumnsTab } from './profile/offers/data-product.js';

const p = (key, vars) => d('dataset.' + key, vars);

/** A public read with no session: the envelope's data, or null for a 404. */
async function open(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())?.data ?? null;
}

/** Who or what made it, from the descriptor's producer. */
function producerWords(producer) {
  if (!producer?.kind) return '';
  return p('producer.' + producer.kind, { ref: producer.ref || '' });
}

/** A size in kilobytes or megabytes. */
const bytesWords = (n) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

export default function Dataset() {
  const [, , , owner = '', name = ''] = window.location.pathname.split('/').map(decodeURIComponent);
  const [state, setState] = useState(null);   // { pkg, versions } | { missing } | { failed }

  useEffect(() => {
    const base = `/v1/datapackages/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    Promise.all([open(base), open(`${base}/versions`).catch((err) => { swallowed('dataset: versions', err); return null; })])
      .then(([pkg, ver]) => setState(pkg ? { pkg, versions: ver?.versions || [] } : { missing: true }))
      .catch((err) => { swallowed('dataset: load', err); setState({ failed: true }); });
  }, [owner, name]);

  if (!state) return html`<${PageFrame} loading><${Note} kind="loading" /><//>`;
  if (state.missing || state.failed) {
    return html`<${AskPage} title=${p('missingTitle')}>
      <${Note} kind="lead">${state.missing ? p('missing') : p('failed')}<//>
    <//>`;
  }

  const { pkg, versions } = state;
  const desc = pkg.descriptor || {};
  const a = desc.aimeat || {};
  const resources = desc.resources || [];
  const rows = resources.reduce((n, r) => n + (r.rowCount || 0), 0);
  const bytes = resources.reduce((n, r) => n + (r.bytes || 0), 0);
  const title = desc.title || desc.name || name;
  const fresh = pkg.freshness;
  const licence = desc.licenses?.[0]?.name || a.license || '';
  // The maker's account on this node, from the descriptor's permanent address (/v1/pub/<owner>@<node>/…).
  const pub = /\/v1\/pub\/([^/]+)\//.exec(pkg.descriptor_url || '');
  const ghii = pub ? decodeURIComponent(pub[1]) : owner;
  const ask = `/v1/profile?tab=messages&to=${encodeURIComponent(ghii)}&subject=${encodeURIComponent(p('askSubject', { title }))}`;
  const current = versions.find((v) => v.current) || versions[0];
  const sources = a.sources || [];
  const transformations = a.transformations || [];

  const strip = html`<${FigureStrip} items=${[
    { key: 'maker', n: owner, label: p('maker'), sub: producerWords(a.producer) },
    { key: 'fresh', n: fresh ? freshWord(fresh.state) : p('noFresh'), label: p('freshness'), tone: fresh && ['late', 'stale'].includes(fresh.state) ? 'notice' : undefined,
      sub: fresh?.last_success_at ? p('updated', { date: fmtDate(fresh.last_success_at) }) : '' },
    { key: 'size', n: p('rows', { n: num(rows) }), label: p('size'), sub: bytes ? p('csvSize', { size: bytesWords(bytes) }) : '' },
    { key: 'licence', n: licence || p('noLicence'), label: p('licence'), sub: p('licenceSub') },
  ]} />`;

  const side = html`<${Stack} gap="large">
    <${Actions}><${Loud} href="#dataset-use">${p('openExcel')}<//><//>
    <${Box} name=${p('howMade')}>
      <${Note}>${p('howMadeText', { producer: producerWords(a.producer) || p('producer.manual'), sources: sources.length, changes: transformations.length, versions: versions.length })}<//>
      ${transformations.slice(0, 3).map((tr, i) => html`<${Note} key=${i} kind="quiet">${tr.what}<//>`)}
      <${Actions}><${Action} small href=${pkg.descriptor_url} newTab>${p('provenance')}<//><//>
    <//>
    <${Box} name=${p('needMore')}>
      <${Note}>${p('needMoreText')}<//>
      <${Actions}><${Action} small href=${ask}>${p('askAccess')}<//><//>
    <//>
    <${Box} name=${p('machine')}>
      <${Actions}>
        <${Action} small tone="file" href=${pkg.descriptor_url} newTab>datapackage.json<//>
        <${Action} small tone="file" href=${pkg.odps_url} newTab>odps.yaml<//>
        <${Action} small tone="file" href="/v1/catalogue/dcat" newTab>DCAT<//>
      <//>
    <//>
  <//>`;

  return html`<${PageFrame}>
    <${SettingsPage} name="dataset" crumb=${[p('catalogue'), title]}
      title=${title} desc=${desc.description || p('noDescription')} strip=${strip}>
      <${Beside} side=${side}>
        <${Section} first id="dataset-use" title=${p('use')}>
          <${ConnectSteps} owner=${owner} name=${name} pkg=${pkg} variant="public" title=${title} />
        <//>
        <${Section} id="dataset-columns" title=${p('columns')}>
          <${ColumnsTab} descriptor=${desc} head=${[p('colName'), p('colType'), p('colDesc')]} />
        <//>
        <${Section} id="dataset-versions" title=${p('versions')}>
          ${versions.length ? html`<${Note}>${p('versionsText', { n: versionNumber(versions, current?.contentHash), date: current?.at ? fmtDate(current.at) : '' })}<//>` : null}
          ${versions.slice(0, 5).map((v) => html`<${Note} key=${v.contentHash} kind="quiet">${p('versionLine', { n: versionNumber(versions, v.contentHash), date: v.at ? fmtDate(v.at) : '', changes: v.changes || '' })}<//>`)}
        <//>
      <//>
    <//>
  <//>`;
}
