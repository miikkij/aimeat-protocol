/**
 * @file public/views/profile/offers/data-connect.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a program reads a data product (design canvas "Data ulos", boards Vaihe6-Valmis and
 *   Tarjoama's tab "Connection"): the addresses (the OData feed, each table's CSV, the Frictionless
 *   descriptor and the ODPS sheet), who may open them, and the steps for Excel, Power BI, DuckDB,
 *   pandas and one's own AI. The steps name what the connection file of a named share carries (the
 *   party's name as the user, its key as the password, the token address for a program that sends a
 *   Bearer header), so a person gives them to the recipient as they are. Made of the component kit.
 * @structure addressesOf · ConnectSteps
 * @usage html`<${ConnectSteps} owner=${owner} name=${name} pkg=${pkg} />`
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D3.3).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { Facts } from '/components/Facts.js';
import { Tabs } from '/components/Tabs.js';
import { StepList } from '/components/StepList.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { d } from './data-model.js';

const enc = encodeURIComponent;
const TOOLS = ['excel', 'powerbi', 'duckdb', 'pandas', 'ai'];

/** The addresses of one product's newest version. `pkg` is GET /v1/datapackages/{owner}/{name}. */
export function addressesOf(owner, name, pkg) {
  const base = window.location.origin;
  const tables = (pkg?.descriptor?.resources || []).map((r) => r.name);
  return {
    odata: `${base}/v1/odata/${enc(owner)}/${enc(name)}`,
    csv: tables.map((tb) => ({ table: tb, url: `${base}/v1/datapackages/${enc(owner)}/${enc(name)}/rows/${enc(tb)}?format=csv` })),
    descriptor: pkg?.descriptor_url || '',
    // The ODPS sheet answers YAML by default (routes/datapackages.ts), computed when it is read; without
    // a version it describes the newest one.
    odps: pkg ? `${base}/v1/datapackages/${enc(owner)}/${enc(name)}/odps` : '',
    token: `${base}/v1/parties/token`,
    tables,
  };
}

/** The address facts with a copy door each, and the steps per tool under the tool tabs. */
export function ConnectSteps({ owner, name, pkg, visibility }) {
  const [tool, setTool] = useState('excel');
  const a = addressesOf(owner, name, pkg);
  const table = a.tables[0] || 'rows';
  const csv = a.csv[0]?.url || '';
  const copy = (text) => html`<${Action} small soft copy=${text}>${d('connect.copy')}<//>`;
  const rows = [
    { k: d('connect.odata'), v: a.odata, mono: true, action: copy(a.odata) },
    ...a.csv.map((c) => ({ k: d('connect.csv', { table: c.table }), v: c.url, mono: true, action: copy(c.url) })),
    a.descriptor && { k: d('connect.descriptor'), v: a.descriptor, mono: true, sub: d('connect.descriptorSub'), action: copy(a.descriptor) },
    a.odps && { k: d('connect.odps'), v: a.odps, mono: true, sub: d('connect.odpsSub'), action: copy(a.odps) },
  ];
  const isPublic = visibility === 'public';
  const steps = {
    excel: [d('connect.excel1'), d('connect.excel2', { url: a.odata }), d('connect.excel3'), d('connect.excel4', { table })],
    powerbi: [d('connect.powerbi1'), d('connect.powerbi2', { url: a.odata }), d('connect.powerbi3'), d('connect.powerbi4', { table })],
    duckdb: [d('connect.duckdb1', { url: a.token }), d('connect.duckdb2')],
    pandas: [d('connect.pandas1', { url: a.token }), d('connect.pandas2')],
    ai: [d('connect.ai1'), d('connect.ai2', { name })],
  };
  const code = {
    duckdb: `INSTALL httpfs; LOAD httpfs;\nCREATE SECRET aimeat (TYPE http, EXTRA_HTTP_HEADERS MAP {'Authorization': 'Bearer <token>'});\nSELECT * FROM read_csv_auto('${csv}');`,
    pandas: `import requests, pandas as pd\ntoken = requests.post('${a.token}', data={'grant_type': 'client_credentials', 'client_id': '<owner/party>', 'client_secret': '<key>'}).json()['access_token']\ndf = pd.read_csv('${csv}', storage_options={'Authorization': f'Bearer {token}'})`,
  }[tool];
  return html`
    <${Facts} rows=${rows} />
    <${Note}>${isPublic ? d('connect.openPublic') : d('connect.openPrivate')}<//>
    <${Tabs} kind="view" label=${d('connect.toolLabel')} value=${tool} onSelect=${setTool}
      items=${TOOLS.map((tl) => ({ value: tl, label: d('connect.tool.' + tl) }))} />
    <${Box} tone="tabbed">
      <${StepList} steps=${steps[tool]} />
      ${code ? html`<${Code} block>${code}<//>` : null}
      <${Note}>${d('connect.after.' + tool)}<//>
    <//>`;
}
