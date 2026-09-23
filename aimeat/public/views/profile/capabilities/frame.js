/**
 * @file public/views/profile/capabilities/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Capabilities page's views share: the words (x), how the flat registry is
 *   grouped by whoever provides a capability (an extension with its actions, an app with its tools,
 *   an agent with its offers, a hand-added one on its own), the words for who may call and what it
 *   costs, the text an agent gets, the crumb and the cross-page rail links.
 * @structure x · providerOf · groupCapabilities · authWord · costWord · agentRule · agentTextFor ·
 *   crumb · pageLinks · openTab
 * @usage import { x, groupCapabilities, agentRule } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Kyvykkyydet-sivu", direction A, with the
 *     registry extended to app tools and agent offers; wish-kyvykkyydet-rekisteri-ja-sivu).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export const x = (key, vars) => t('capspage.' + key, vars);

/** The shelf a capability sits on and the group it belongs to. Cortexes are the Libraries page's and are left out. */
export function providerOf(c) {
  const type = c.source?.type || 'manual';
  const parts = String(c.id).split(':');
  if (type === 'extension') return { shelf: 'ext', key: 'ext:' + parts[1], name: parts[1], member: parts.slice(2).join(':') };
  if (type === 'app-tool') return { shelf: 'app', key: 'app:' + parts[1], name: parts[1], member: parts.slice(2).join(':') };
  if (type === 'offering') return { shelf: 'agent', key: 'agent:' + parts[1], name: parts[1], member: parts.slice(2).join(':') };
  if (type === 'cortex') return { shelf: 'cortex', key: c.id, name: c.name, member: '' };
  return { shelf: 'other', key: c.id, name: c.name || c.id, member: '' };
}

/** One group per provider: its members in registry order, with the sums the row shows. */
export function groupCapabilities(caps, ownerGhii) {
  const groups = new Map();
  for (const c of caps) {
    const p = providerOf(c);
    if (p.shelf === 'cortex') continue;
    let g = groups.get(p.key);
    if (!g) {
      g = { key: p.key, shelf: p.shelf, name: p.name, type: c.source?.type || 'manual', ownerGhii: c.ownerGhii, own: c.ownerGhii === ownerGhii, version: c.source?.version || '', members: [], calls: 0, errors: 0, vouches: 0, priced: false, callable: false, summary: c.summary || '', visibility: c.visibility, status: c.status };
      groups.set(p.key, g);
    }
    g.members.push({ ...c, member: p.member || c.name });
    g.calls += c.stats?.totalInvocations || 0;
    g.errors += c.stats?.errorCount || 0;
    g.vouches += c.trust?.vouchCount || 0;
    if (c.cost && (c.cost.morsels > 0 || c.cost.amount > 0)) g.priced = true;
    if (c.callable) g.callable = true;
    if (c.visibility !== 'public') g.visibility = c.visibility;
    if (c.status !== 'active') g.status = c.status;
    if (!g.summary && c.summary) g.summary = c.summary;
  }
  // The registry lists in update order, which moves a member every time it is called; by name it stays put.
  for (const g of groups.values()) g.members.sort((a, b) => String(a.member).localeCompare(String(b.member)));
  return [...groups.values()];
}

export const ownerName = (ghii) => String(ghii || '').split('@')[0];
export const authWord = (c) => (c.authRequired === 'none' ? x('auth.none') : c.authRequired === 'anonymous' ? x('auth.anonymous') : x('auth.registered'));
export function costWord(c) {
  if (!c.cost) return x('cost.free');
  if (c.cost.morsels > 0) return x('cost.morsels', { n: c.cost.morsels });
  if (c.cost.amount > 0) return `${c.cost.amount} ${c.cost.currency || ''}`.trim();
  return x('cost.free');
}
/** Words that only differ per member when they differ: an action's own summary is shown only when it is not the group's. */
export const memberSummary = (g, c) => (c.summary && c.summary !== g.summary ? c.summary : '');

/** The rule an agent gets with the page's slab. English, since it is for the model. */
export function agentRule(nodeUrl) {
  return [
    `Capabilities on this AIMEAT node: find first with aimeat_capabilities_list (search by word; callable=true for what runs here), read one with aimeat_capabilities_get (input and output shape), then call with aimeat_capabilities_invoke by id, e.g. "ext:tinki:listings".`,
    `Without MCP: GET ${nodeUrl}/v1/capabilities and POST ${nodeUrl}/v1/capabilities/<id>/invoke.`,
    'source app-tool and offering entries are discovery only: their usage names the contract door (aimeat_exchange_offerings → aimeat_exchange_accept, then aimeat_app_tool_invoke or aimeat_exchange_work). A cortex is a browser library the app loads; it is on the Libraries page, not callable here.',
    `The node's own tools (memory, apps, organisms, ...) are a different catalogue: aimeat_discover.`,
  ].join('\n');
}

/** What one provider hands an agent: every member's id, summary, auth, cost and input shape. */
export function agentTextFor(g, details) {
  const lines = [`${g.name} (${g.type}): ${g.summary || ''}`.trim(), ''];
  for (const c of g.members) {
    const d = details[c.id] || c;
    lines.push(`- ${c.id}${c.callable ? '' : ' (discovery only)'}: ${c.summary || ''}`.trimEnd());
    if (d.usage) lines.push(`  usage: ${d.usage}`);
    if (d.inputSchema && Object.keys(d.inputSchema).length) lines.push(`  input: ${JSON.stringify(d.inputSchema)}`);
    if (c.cost) lines.push(`  cost: ${JSON.stringify(c.cost)}`);
  }
  return lines.join('\n');
}

/**
 * A schema's properties, whether it is JSON Schema ({ properties, required }) or the flat map an
 * extension manifest uses ({ name: { type, required, description } }).
 */
export function schemaProps(schema) {
  if (!schema || typeof schema !== 'object') return { props: {}, required: new Set() };
  if (schema.properties && typeof schema.properties === 'object') return { props: schema.properties, required: new Set(schema.required || []) };
  const props = {};
  const required = new Set();
  for (const [k, v] of Object.entries(schema)) {
    if (!v || typeof v !== 'object' || !('type' in v || 'description' in v)) continue;
    props[k] = v;
    if (v.required === true) required.add(k);
  }
  return { props, required };
}

/** The properties of an input schema as words: "q*: string, limit: number". */
export function schemaWords(schema) {
  const { props, required } = schemaProps(schema);
  return Object.entries(props).map(([k, v]) => `${k}${required.has(k) ? '*' : ''}: ${v.type || '?'}`).join(', ');
}

export const callsWord = (n) => (n === 1 ? x('callsOne') : x('callsN', { n }));
export const vouchesWord = (n) => (n === 1 ? x('vouchesOne') : x('vouchesN', { n }));

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('capabilities.tabLabel')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('extensions')}><i>→</i>${t('profile.tabs.extensions')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('libraries')}><i>→</i>${t('librariesTab.tabLabel')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('offers')}><i>→</i>${t('profile.tabs.offers')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>`;
}
