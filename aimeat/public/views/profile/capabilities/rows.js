/**
 * @file public/views/profile/capabilities/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One provider's row on the Capabilities page and what opens under it. The row: the
 *   provider (an extension, an app, an agent, or a hand-added capability) with its version, whose it
 *   is and how many members; what it gives and the member ids; the id form an agent uses, who may
 *   call and the call count; the doors. Opened: every member with its own summary, input shape,
 *   calls and a try door; the try panel; the agent's invoke line; who may call and the cost; trust
 *   (vouches, review) with the vouch door; calls with the counting note; where the source is managed.
 * @structure providerRow · providerOpen
 * @usage import { providerRow } from './rows.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { x, ownerName, authWord, costWord, memberSummary, agentTextFor, schemaWords, callsWord, vouchesWord, openTab } from './frame.js';

const dot = (g) => html`<i class=${`cp-dot ${g.status === 'active' ? 'is-on' : ''}`} aria-hidden="true"></i>`;

function subLine(g) {
  const parts = [g.own ? x('own') : x('ownedBy', { owner: ownerName(g.ownerGhii) })];
  if (g.shelf === 'ext') parts.push(x('actionsN', { n: g.members.length }));
  else if (g.shelf === 'app') parts.push(x('toolsN', { n: g.members.length }));
  else if (g.shelf === 'agent') parts.push(x('offersN', { n: g.members.length }));
  else parts.push(x('type.' + g.type));
  if (g.priced) parts.push(x('priced'));
  if (g.visibility !== 'public') parts.push(x('hidden'));
  if (g.status !== 'active') parts.push(x('status.' + g.status));
  return parts.join(' · ');
}

const idForm = (g) => (g.shelf === 'ext' ? `ext:${g.name}:<${x('actionWord')}>` : g.shelf === 'app' ? `app-tool:${g.name}:<${x('toolWord')}>` : g.shelf === 'agent' ? `offering:${g.name}:<${x('offerWord')}>` : g.members[0]?.id || '');

export function providerRow(ctx, g) {
  const open = ctx.expanded === g.key;
  const ids = g.members.map((m) => m.member).filter(Boolean);
  return html`
    <div class=${`cp-p ${open ? 'is-open' : ''}`} key=${g.key}>
      <div class="cp-nm">${dot(g)}${g.name}${g.version && g.shelf === 'ext' ? html`<span class="cp-tag">v${g.version}</span>` : null}<small>${subLine(g)}</small></div>
      <div class="cp-ds">${g.summary || ''}${ids.length > 1 || g.shelf !== 'other' ? html`<span class="cp-acts">${ids.slice(0, 6).join(' · ')}${ids.length > 6 ? ` · +${ids.length - 6}` : ''}</span>` : null}</div>
      <div class="cp-me">${idForm(g)}<small>${[g.callable ? authWord(g.members[0]) : x('discoveryOnly'), g.priced ? x('pricedShort') : '', g.calls ? callsWord(g.calls) : x('callsNone'), g.vouches ? vouchesWord(g.vouches) : ''].filter(Boolean).join(' · ')}</small></div>
      <div class="cp-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggle(g)}>${open ? x('close') : x('open')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.copyForAgent(g)}>${x('copyAgent')}</button>
      </div>
      ${open ? providerOpen(ctx, g) : null}
    </div>`;
}

function providerOpen(ctx, g) {
  const test = ctx.test && ctx.test.key === g.key ? ctx.test : null;
  const first = g.members[0];
  const invokeLine = first ? `aimeat_capabilities_invoke { id: "${first.id}", input: { … } }` : '';
  const sourceTab = g.shelf === 'ext' ? 'extensions' : g.shelf === 'app' ? 'apps' : g.shelf === 'agent' ? 'agents' : null;
  const usage = ctx.details[first?.id]?.usage || first?.usage || '';
  return html`
    <div class="cp-open">
      <p class="cp-lead">${g.summary || ''}</p>
      <span class="og-label">${g.shelf === 'ext' ? x('actions') : g.shelf === 'app' ? x('tools') : g.shelf === 'agent' ? x('offers') : x('capability')} · ${x('idFormIs', { form: idForm(g) })}</span>
      <div class="cp-act">
        ${g.members.map((c) => html`
          <div key=${'i' + c.id}><code>${c.member || c.id}</code>${c.status !== 'active' ? html`<small>${x('status.' + c.status)}</small>` : null}</div>
          <div key=${'d' + c.id}>${memberSummary(g, c) || (g.members.length === 1 ? '' : x('sameAsProvider'))}<small>${x('inputOut', { input: schemaWords(ctx.details[c.id]?.inputSchema || c.inputSchema) || x('nothing'), output: schemaWords(ctx.details[c.id]?.outputSchema || c.outputSchema) || x('json') })}${c.cost ? ` · ${costWord(c)}` : ''}</small></div>
          <div key=${'n' + c.id} class="cp-n">${callsWord(c.stats?.totalInvocations || 0)}</div>
          <div key=${'t' + c.id}>${c.callable ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleTest(g, c)}>${test && test.id === c.id ? x('close') : x('try')}</button>` : html`<small class="cp-dim">${x('discoveryOnly')}</small>`}</div>`)}
      </div>
      ${test ? html`
        <div class="cp-test">
          <span class="og-label">${x('tryTitle', { id: test.id })}</span>
          <textarea class="og-textarea cp-test-in" rows="3" value=${test.input} onInput=${(e) => ctx.setTestInput(e.target.value)}></textarea>
          <div class="og-doors"><button type="button" class="og-door" disabled=${test.running} onClick=${() => ctx.runTest()}>${x('run')}</button><span class="cp-hint">${x('tryHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}</span></div>
          ${test.result ? html`<span class="og-label">${test.result.ok ? x('tryOk') : x('tryFail')}</span><pre class="cp-out">${test.result.text}</pre>` : null}
        </div>` : null}
      <div class="cp-kv">
        <div class="cp-k">${x('forAgent')}</div><div class="cp-v">${g.callable ? html`<code>${invokeLine}</code><small>${x('forAgentSub', { id: first?.id || '' })} · <${CopyButton} text=${agentTextFor(g, ctx.details)} className="og-crumb-link" label=${x('copyAgent')} copiedLabel=${x('copied')} /></small>` : html`${usage}<small>${x('discoveryOnlySub')} · <${CopyButton} text=${agentTextFor(g, ctx.details)} className="og-crumb-link" label=${x('copyAgent')} copiedLabel=${x('copied')} /></small>`}</div>
        <div class="cp-k">${x('whoMayCall')}</div><div class="cp-v">${first ? `${authWord(first)} · ${g.priced ? x('pricedLong') : x('cost.free')}` : ''}<small>${x('whoMayCallSub')}</small></div>
        <div class="cp-k">${x('trust')}</div><div class="cp-v">${g.vouches ? vouchesWord(g.vouches) : x('noVouches')} · ${g.members.some((c) => c.trust?.operatorReviewed) ? x('reviewed') : x('notReviewed')}<small>${x('trustSub')}${!g.own && first ? html` · <button type="button" class="og-crumb-link cp-linkbtn" onClick=${() => ctx.vouch(g)}>${g.members.some((c) => ctx.vouched[c.id]) ? x('unvouch') : x('vouch')}</button>` : null}</small></div>
        <div class="cp-k">${x('calls')}</div><div class="cp-v">${x('callsLong', { n: g.calls, errors: g.errors })}<small>${ctx.policy?.call_counting ? x('callsCounted') : x('callsProxyOnly')}</small></div>
        ${sourceTab ? html`<div class="cp-k">${x('sourceK')}</div><div class="cp-v"><button type="button" class="og-crumb-link cp-linkbtn" onClick=${() => openTab(sourceTab)}>${x('sourceLink.' + g.shelf, { name: g.name })}</button><small>${x('sourceSub.' + g.shelf)}</small></div>` : null}
        ${g.type === 'manual' && first ? html`<div class="cp-k">${x('webhook')}</div><div class="cp-v">${ctx.details[first.id]?.webhookUrl || first.webhookUrl || x('webhookNone')}<small>${x('webhookSub')}</small></div>` : null}
      </div>
      <div class="og-doors cp-open-doors">
        <${CopyButton} text=${agentTextFor(g, ctx.details)} className="og-door" label=${x('copyAgent')} copiedLabel=${x('copied')} />
        ${g.own ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setVisibility(g, g.visibility === 'public' ? 'private' : 'public')}>${g.visibility === 'public' ? x('hideFromAgents') : x('showToAgents')}</button>` : null}
        ${g.own && g.type === 'manual' ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.remove(g)}>${x('remove')}</button>` : null}
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle(g)}>${x('close')}</button>
      </div>
    </div>`;
}

export const loadingRow = () => html`<p class="cp-empty">${t('common.loading')}</p>`;
