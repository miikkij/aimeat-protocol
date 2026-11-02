/**
 * @file public/views/profile/offers/data-connect.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a program reads a data product (design canvas "Data ulos", boards Vaihe6-Valmis,
 *   Tarjoama's tab "Connection", Vastaanottaja and Julkinen-sivu, and the test plan Power-BI-Excel):
 *   the addresses (the OData feed, each table's CSV, the Frictionless descriptor and the ODPS sheet),
 *   who may open them, and the steps for Excel, Power BI, DuckDB, pandas and one's own AI. Made of the
 *   component kit.
 *
 *   THE STEPS FOLLOW THE TEST PLAN (board Power-BI-Excel). Excel, Power BI and Tableau read the OData
 *   feed with Basic sign-in: the user is the share's name `<owner>/<party>`, the password its key.
 *   DuckDB reads the CSV, or the Frictionless descriptor and its relative paths, with a token in an
 *   http secret (`BEARER_TOKEN`); pandas reads the CSV or the rows a page at a time with the token in
 *   its header. Both get the token from POST /v1/parties/token with the same name and key. A data
 *   product that is public needs none of it.
 *
 *   THREE CALLERS, ONE COMPONENT.
 *   - The owner (product page, wizard step 6): the steps name what the connection file carries.
 *   - The recipient page (`cred`: { user, key }): the steps carry the recipient's own name and key.
 *   - The public dataset page (`variant` 'public'): the board's four tabs, Excel and Power BI, DuckDB,
 *     Python and one's own AI over MCP, with no sign-in in any of them.
 * @structure addressesOf · ConnectSteps
 * @usage html`<${ConnectSteps} owner=${owner} name=${name} pkg=${pkg} />`
 *        html`<${ConnectSteps} owner=${owner} name=${name} pkg=${pkg} cred=${{ user, key }} />`
 *        html`<${ConnectSteps} owner=${owner} name=${name} pkg=${pkg} variant="public" title=${title} />`
 * @version-history
 *   v1.1.1 — 2026-11-01 — The steps of the chosen tool stand in a TabPanel (role tabpanel; WP10e B17).
 *   v1.1.0 — 2026-11-01 — The steps and the code follow the Power-BI-Excel board (DuckDB's BEARER_TOKEN
 *     secret, the Frictionless descriptor's relative path, pandas paging); `cred` fills in the
 *     recipient's own name and key, and `variant` 'public' draws the public page's four tabs (WP9b).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D3.3).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { Facts } from '/components/Facts.js';
import { Tabs, TabPanel } from '/components/Tabs.js';
import { StepList } from '/components/StepList.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { d } from './data-model.js';

const enc = encodeURIComponent;
const TOOLS = ['excel', 'powerbi', 'duckdb', 'pandas', 'ai'];
const PUBLIC_TOOLS = ['office', 'duckdb', 'python', 'mcp'];

/** The addresses of one product's newest version. `pkg` is GET /v1/datapackages/{owner}/{name}. */
export function addressesOf(owner, name, pkg) {
  const base = window.location.origin;
  const tables = (pkg?.descriptor?.resources || []).map((r) => r.name);
  const firstPath = pkg?.descriptor?.resources?.[0]?.path || '';
  return {
    odata: `${base}/v1/odata/${enc(owner)}/${enc(name)}`,
    csv: tables.map((tb) => ({ table: tb, url: `${base}/v1/datapackages/${enc(owner)}/${enc(name)}/rows/${enc(tb)}?format=csv` })),
    rows: tables.length ? `${base}/v1/datapackages/${enc(owner)}/${enc(name)}/rows/${enc(tables[0])}` : '',
    descriptor: pkg?.descriptor_url || '',
    // The descriptor's own folder: a resource's relative path (data/<table>.csv) is read from there.
    resource: pkg?.descriptor_url && firstPath ? pkg.descriptor_url.replace(/datapackage\.json(?:\?.*)?$/, firstPath) : '',
    // The ODPS sheet answers YAML by default (routes/datapackages.ts), computed when it is read; without
    // a version it describes the newest one.
    odps: pkg ? `${base}/v1/datapackages/${enc(owner)}/${enc(name)}/odps` : '',
    token: `${base}/v1/parties/token`,
    mcp: `${base}/v1/mcp`,
    tables,
  };
}

/** The code a program runs, for a tool: with the token (a share) or without (a public product). */
function codeFor(tool, a, { open, user, key }) {
  const csv = a.csv[0]?.url || '';
  const who = user || '<owner/party>';
  const secret = key || '<key>';
  if (tool === 'duckdb') {
    return open
      ? `SELECT * FROM read_csv('${csv}');`
      : `INSTALL httpfs; LOAD httpfs;\nCREATE SECRET jako (\n  TYPE http,\n  BEARER_TOKEN '<token>'\n);\nSELECT * FROM read_csv('${csv}');${a.resource ? `\n-- Frictionless: ${a.descriptor}\nSELECT count(*) FROM read_csv('${a.resource}');` : ''}`;
  }
  if (tool === 'pandas' || tool === 'python') {
    return open
      ? `import pandas as pd\ndf = pd.read_csv('${csv}')`
      : `import json, urllib.request, urllib.parse, pandas as pd\nbody = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': '${who}', 'client_secret': '${secret}'}).encode()\ntoken = json.load(urllib.request.urlopen('${a.token}', body))['access_token']\nauth = {'Authorization': f'Bearer {token}'}\ndf = pd.read_csv('${csv}', storage_options=auth)\n# A page at a time: ${a.rows}?offset=0&limit=500`;
  }
  return '';
}

/** The address facts with a copy door each, and the steps per tool under the tool tabs. */
export function ConnectSteps({ owner, name, pkg, visibility, cred, variant, title }) {
  const pub = variant === 'public';
  const tools = pub ? PUBLIC_TOOLS : TOOLS;
  const [tool, setTool] = useState(tools[0]);
  const a = addressesOf(owner, name, pkg);
  const table = a.tables[0] || 'rows';
  const copy = (text) => html`<${Action} small soft copy=${text}>${d('connect.copy')}<//>`;
  const open = pub || visibility === 'public';
  const rows = [
    { k: d('connect.odata'), v: a.odata, mono: true, action: copy(a.odata) },
    ...a.csv.map((c) => ({ k: d('connect.csv', { table: c.table }), v: c.url, mono: true, action: copy(c.url) })),
    a.descriptor && { k: d('connect.descriptor'), v: a.descriptor, mono: true, sub: d('connect.descriptorSub'), action: copy(a.descriptor) },
    a.odps && { k: d('connect.odps'), v: a.odps, mono: true, sub: d('connect.odpsSub'), action: copy(a.odps) },
    cred && { k: d('connect.user'), v: cred.user, mono: true, action: copy(cred.user) },
  ];
  // The Basic step names the recipient's own user when the page knows it.
  const basic = cred ? d('connect.basicYours', { user: cred.user }) : d('connect.excel3');
  const steps = pub ? {
    office: [d('connect.excel1'), d('connect.excel2', { url: a.odata }), d('connect.anonymous'), d('connect.excel4', { table })],
    duckdb: [d('connect.duckdbOpen')],
    python: [d('connect.pandasOpen')],
    mcp: [d('connect.ai1'), d('connect.mcpAddress', { url: a.mcp }), d('connect.ai2', { name: title || name })],
  } : {
    excel: [d('connect.excel1'), d('connect.excel2', { url: a.odata }), open ? d('connect.anonymous') : basic, d('connect.excel4', { table })],
    powerbi: [d('connect.powerbi1'), d('connect.powerbi2', { url: a.odata }), open ? d('connect.anonymous') : basic, d('connect.powerbi4', { table })],
    duckdb: open ? [d('connect.duckdbOpen')] : [d('connect.duckdb1', { url: a.token }), d('connect.duckdb2')],
    pandas: open ? [d('connect.pandasOpen')] : [d('connect.pandas1', { url: a.token }), d('connect.pandas2')],
    ai: [d('connect.ai1'), d('connect.ai2', { name })],
  };
  const code = codeFor(tool, a, { open, user: cred?.user, key: cred?.key });
  const after = pub ? d('connect.afterPublic.' + tool) : d('connect.after.' + tool);
  return html`
    ${pub ? null : html`<${Facts} rows=${rows} />`}
    ${pub ? null : html`<${Note}>${open ? d('connect.openPublic') : cred ? d('connect.openYours') : d('connect.openPrivate')}<//>`}
    <${Tabs} kind="view" label=${d('connect.toolLabel')} value=${tool} onSelect=${setTool}
      items=${tools.map((tl) => ({ value: tl, label: d('connect.tool.' + tl) }))} />
    <${Box} tone="tabbed"><${TabPanel} value=${tool} label=${d('connect.tool.' + tool)}>
      <${StepList} steps=${steps[tool]} />
      ${code ? html`<${Code} block scroll>${code}<//>` : null}
      ${tool === 'office' || tool === 'excel' || tool === 'powerbi' ? html`<${Code} block scroll>${a.odata}<//>` : null}
      <${Note}>${after}<//>
    <//><//>`;
}
