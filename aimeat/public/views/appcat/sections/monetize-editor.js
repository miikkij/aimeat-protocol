/**
 * @file public/views/appcat/sections/monetize-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tool editor of the Monetize section: one tool of the app's manifest, asked as four
 *   numbered questions in order (what the tool is, what a call costs, whether it goes on the
 *   marketplace with its ODPS description, how a bought call is delivered), the second currency and
 *   the pacing burn folded under the price. As the old catalogue's js/monetize.js editorHtml and
 *   readEditor: the save MERGES over the tool being edited, so the fields this editor does not show
 *   (inputSchema, outputSchema, plans) survive; clearing a field the editor does own removes it;
 *   money is kept in 6-decimal micro-units, and `pricesMoney` only when two currencies are set; an
 *   empty pacing burn is deleted (the node's default), 0 is kept (pacing off).
 * @structure ToolEditor({ d, m, index }) · readEditor(base, form, odpsOpen)
 * @usage html`<${ToolEditor} key=${m.editing} d=${d} m=${m} index=${m.editing} />`
 * @version-history
 *   v1.2.0 — 2026-10-02 — The question marks that explain the price and the market: commerce.morsels, commerce.pacing_toll (TextField help), commerce.exchange_listing (Check help); the toll and exchange hints moved into them (components/HelpTip.js).
 *   v1.1.0 —2026-09-27 — Parity with the old page (appcat sections-d): the form under the heavy rule
 *     (Fields `plain chapter ruled`), each question a StepCard `question`, the fields in the old grids
 *     (two wide and a short currency; two), "List in EXCHANGE" a Check `strong`, the chapter's door
 *     row and the status line that keeps its room.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's js/monetize.js.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { StepCard, StepLede } from '/components/StepCard.js';
import { x } from '/views/appcat/i18n.js';
import { patchManifest, manifestNow, writeManifest, MONEY_UNIT, CURRENCIES } from '/views/appcat/sections/tools-manifest.js';
import { OdpsToolBlock, odpsFormOf, readOdpsTool } from '/views/appcat/sections/odps-tool.js';

const html = htm.bind(h);

/** Tool names become sku segments (app-tool:<owner>/<appId>:<name>), the rule src/models/app-tool-schemas.ts enforces. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** The editor's fields, filled from the tool being edited ({} for a new one). */
function formOf(tool) {
  const cur = (tool.priceMoney && tool.priceMoney.currency) || 'EUR';
  // The second money price is any declared currency that is not the primary one.
  const second = (tool.pricesMoney || []).filter((p) => p && p.currency !== cur && p.amount > 0)[0];
  return {
    name: tool.name || '',
    desc: tool.description || '',
    morsels: tool.price && tool.price.morsels ? String(tool.price.morsels) : '',
    money: tool.priceMoney && tool.priceMoney.amount > 0 ? String(tool.priceMoney.amount / MONEY_UNIT) : '',
    currency: cur,
    money2: second ? String(second.amount / MONEY_UNIT) : '',
    currency2: (second && second.currency) || (cur === 'EUR' ? 'USD' : 'EUR'),
    toll: typeof tool.tollMorsels === 'number' ? String(tool.tollMorsels) : '',
    exchange: !!tool.exchange,
    action: tool.action_id || '',
    agent: tool.agent || '',
    ...odpsFormOf(tool),
  };
}

/**
 * The fields read into a manifest tool, merged over `base`. Returns { tool } or { error } (the
 * words the old page said as a notice).
 */
export function readEditor(base, f, odpsOpen) {
  const name = f.name.trim();
  if (!NAME_RE.test(name)) return { error: x('monetize.nameInvalid') };
  const tool = { ...(base || {}) };
  tool.name = name;
  const desc = f.desc.trim();
  if (desc) tool.description = desc; else delete tool.description;
  const morsels = parseInt(f.morsels, 10);
  if (Number.isFinite(morsels) && morsels > 0) tool.price = { morsels, unit: 'per-call' };
  else delete tool.price;
  const moneyRaw = f.money.trim();
  if (moneyRaw) {
    const major = parseFloat(moneyRaw.replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) return { error: x('monetize.moneyInvalid') };
    tool.priceMoney = { amount: Math.round(major * MONEY_UNIT), currency: f.currency };
  } else delete tool.priceMoney;
  // The same call sold in a second currency: `pricesMoney` carries the full set the EXCHANGE
  // projection lists from; `priceMoney` stays the primary for every other reader.
  const money2Raw = f.money2.trim();
  let money2 = null;
  if (money2Raw) {
    const major2 = parseFloat(money2Raw.replace(',', '.'));
    if (!Number.isFinite(major2) || major2 <= 0) return { error: x('monetize.moneyInvalid') };
    money2 = { amount: Math.round(major2 * MONEY_UNIT), currency: f.currency2 };
  }
  const moneySet = [];
  if (tool.priceMoney) moneySet.push(tool.priceMoney);
  if (money2 && (!tool.priceMoney || tool.priceMoney.currency !== money2.currency)) moneySet.push(money2);
  if (moneySet.length > 1) tool.pricesMoney = moneySet; else delete tool.pricesMoney;
  // The listing exists because this flag says so; turning it off removes the listing (never a contract).
  if (f.exchange) tool.exchange = true; else delete tool.exchange;
  // Empty means "whatever the node decides", which is not an explicit 0 ("never pace this one").
  const tollRaw = f.toll.trim();
  if (tollRaw === '') delete tool.tollMorsels;
  else {
    const toll = parseInt(tollRaw, 10);
    if (!Number.isFinite(toll) || toll < 0 || toll > 100) return { error: x('monetize.tollInvalid') };
    tool.tollMorsels = toll;
  }
  const actionId = f.action.trim();
  if (actionId) tool.action_id = actionId; else delete tool.action_id;
  const agent = f.agent.trim();
  if (agent) tool.agent = agent; else delete tool.agent;
  const od = readOdpsTool(base, f, odpsOpen);
  if (od.odps) tool.odps = od.odps; else delete tool.odps;
  if (od.provenance) tool.provenance = od.provenance; else delete tool.provenance;
  return { tool };
}

/**
 * One numbered question of the editor over a hairline: the number on ink, the title in the section
 * face, the lede, then its fields in line with the title (the old page's .mz-group; StepCard `question`).
 */
function Question({ n, title, lede, children }) {
  return html`<${StepCard} question num=${n} title=${title}>
    ${lede ? html`<${StepLede}>${lede}<//>` : null}
    ${children}
  <//>`;
}

/** The editor of tools[index], or of a new tool when index is -2. */
export function ToolEditor({ d, m, index }) {
  const base = index >= 0 && m.doc && m.doc.tools[index] ? m.doc.tools[index] : {};
  const [form, setForm] = useState(() => formOf(base));
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const currencies = CURRENCIES.map((c) => [c, c]);

  const save = async () => {
    const now = manifestNow();
    if (now.busy || !now.doc) return;
    const read = readEditor(index >= 0 ? now.doc.tools[index] : null, form, now.toolOpen);
    if (read.error) { d.notice(read.error, 'error'); return; }
    const tools = now.doc.tools.slice();
    const dup = tools.findIndex((t, i) => t.name === read.tool.name && i !== index);
    if (dup !== -1) { d.notice(x('monetize.nameTaken'), 'error'); return; }
    if (index >= 0) tools[index] = read.tool; else tools.push(read.tool);
    patchManifest({ busy: true });
    setStatus('…');
    // Over the loaded record: its root also carries the app-level odps/provenance defaults.
    const next = { ...now.doc, tools };
    try {
      await writeManifest(next);
      patchManifest({ doc: next, editing: -1, busy: false });
      d.notice(x('monetize.saved'), 'success');
    } catch (e) {
      patchManifest({ busy: false });
      setStatus(x('monetize.saveFailed') + ': ' + e.message);
      d.notice(x('monetize.saveFailed') + ': ' + e.message, 'error');
    }
  };

  // The old editor (.mz-form): four numbered questions under the heavy rule, the second currency and
  // the pacing burn folded under "a second currency", then Save and Cancel and the status line.
  return html`<${Fields} plain chapter ruled>
    <${Question} n="1" title=${x('mz.group.what')}>
      <${Fields} plain chapter>
        <${TextField} label=${x('monetize.name')} maxLength=${80} value=${form.name} placeholder="summarize" onInput=${(v) => set({ name: v })} />
        <${TextField} label=${x('monetize.desc')} maxLength=${500} value=${form.desc} hint=${x('mz.descHint')} onInput=${(v) => set({ desc: v })} />
      <//>
    <//>
    <${Question} n="2" title=${x('mz.group.price')} lede=${x('mz.priceLede')}>
      <${Fields} plain chapter cols=${3}>
        <${TextField} type="number" min=${0} step=${1} label=${x('monetize.priceMorsels')} help="commerce.morsels" value=${form.morsels} placeholder="0" onInput=${(v) => set({ morsels: v })} />
        <${TextField} inputMode="decimal" label=${x('monetize.priceMoney')} value=${form.money} placeholder="0.002" onInput=${(v) => set({ money: v })} />
        <${Select} label=${x('monetize.currency')} options=${currencies} value=${form.currency} onChange=${(v) => set({ currency: v })} />
      <//>
      <${Actions} chapter>
        <${Action} tone="more" expanded=${more} onClick=${() => setMore(!more)}>${x('mz.more.price')}<//>
      <//>
      ${more ? html`<${Fields} plain chapter>
        <${Fields} plain chapter cols=${3}>
          <${TextField} inputMode="decimal" label=${x('monetize.money2')} value=${form.money2} placeholder="0.002" onInput=${(v) => set({ money2: v })} />
          <${Select} label=${x('monetize.currency2')} options=${currencies} value=${form.currency2} onChange=${(v) => set({ currency2: v })} />
        <//>
        <${Note} kind="hint">${x('monetize.money2Hint')}<//>
        <${TextField} type="number" min=${0} max=${100} step=${1} label=${x('monetize.toll')} help="commerce.pacing_toll" value=${form.toll} placeholder="0" onInput=${(v) => set({ toll: v })} />
      <//>` : null}
    <//>
    <${Question} n="3" title=${x('mz.group.market')} lede=${x('mz.marketLede')}>
      <${Check} strong checked=${form.exchange} help="commerce.exchange_listing" onChange=${(on) => set({ exchange: on })}>${x('monetize.exchange')}<//>
      <${OdpsToolBlock} d=${d} m=${m} tool=${base} form=${form} set=${set} />
    <//>
    <${Question} n="4" title=${x('mz.group.delivery')} lede=${x('mz.deliveryLede')}>
      <${Fields} plain chapter cols=${2}>
        <${TextField} label=${x('monetize.actionId')} maxLength=${200} value=${form.action} placeholder="ext:my-extension:summarize" hint=${x('monetize.actionIdHint')} onInput=${(v) => set({ action: v })} />
        <${TextField} label=${x('monetize.agent')} maxLength=${100} value=${form.agent} placeholder="assistant" hint=${x('monetize.agentHint')} onInput=${(v) => set({ agent: v })} />
      <//>
    <//>
    <${Actions} chapter>
      <${Loud} control disabled=${m.busy} onClick=${save}>${x('detail.saveDetails')}<//>
      <${Action} small onClick=${() => patchManifest({ editing: -1 })}>${x('detail.cancelEdit')}<//>
    <//>
    <${Note} kind="report" chapter keep tone="busy">${status}<//>
  <//>`;
}
