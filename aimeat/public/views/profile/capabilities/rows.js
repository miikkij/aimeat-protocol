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
 *   v1.16.0 -- 2026-09-26 -- An opened provider's members are the Listing (listing, listing-row, the id as the name with its state as the line under it, the words cell, the figure cell, the doors), a unification: the look most tabs use.
 *   v1.15.0 -- 2026-09-26 -- A try's answer is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.14.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The dot before a provider's name is the Status dot (.status-dot, active or inactive), a unification.
 *   v1.10.0 -- 2026-09-25 -- An opened provider's facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- A provider's row is the Listing (listing-row and its name, words and doors cells, the open panel), a unification: the look most tabs use. The column for the agent keeps its typewriter face on a span inside a plain cell.
 *   v1.8.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { x, ownerName, authWord, costWord, memberSummary, agentTextFor, schemaWords, callsWord, vouchesWord, openTab } from './frame.js';

const dot = (g) => html`<i class=${`status-dot ${g.status === 'active' ? 'status-dot--active' : 'status-dot--inactive'}`} aria-hidden="true"></i>`;

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
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${g.key}>
      <div class="listing-name">${dot(g)}${g.name}${g.version && g.shelf === 'ext' ? html`<span class="poster-chip">v${g.version}</span>` : null}<small>${subLine(g)}</small></div>
      <div class="listing-desc">${g.summary || ''}${ids.length > 1 || g.shelf !== 'other' ? html`<span class="cp-acts">${ids.slice(0, 6).join(' · ')}${ids.length > 6 ? ` · +${ids.length - 6}` : ''}</span>` : null}</div>
      <div><span class="cp-me">${idForm(g)}<small>${[g.callable ? authWord(g.members[0]) : x('discoveryOnly'), g.priced ? x('pricedShort') : '', g.calls ? callsWord(g.calls) : x('callsNone'), g.vouches ? vouchesWord(g.vouches) : ''].filter(Boolean).join(' · ')}</small></span></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggle(g)}>${open ? x('close') : x('open')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.copyForAgent(g)}>${x('copyAgent')}</button>
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
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${g.summary || ''}</p>
      <span class="poster-label">${g.shelf === 'ext' ? x('actions') : g.shelf === 'app' ? x('tools') : g.shelf === 'agent' ? x('offers') : x('capability')} · ${x('idFormIs', { form: idForm(g) })}</span>
      <div class="listing listing--id-desc-n-doors cp-act">
        ${g.members.map((c) => html`
          <div class="listing-row" key=${c.id}>
            <div class="listing-name"><code class="code-inline">${c.member || c.id}</code>${c.status !== 'active' ? html`<small class="listing-meta">${x('status.' + c.status)}</small>` : null}</div>
            <div class="listing-desc">${memberSummary(g, c) || (g.members.length === 1 ? '' : x('sameAsProvider'))}<small>${x('inputOut', { input: schemaWords(ctx.details[c.id]?.inputSchema || c.inputSchema) || x('nothing'), output: schemaWords(ctx.details[c.id]?.outputSchema || c.outputSchema) || x('json') })}${c.cost ? ` · ${costWord(c)}` : ''}</small></div>
            <div class="listing-n">${callsWord(c.stats?.totalInvocations || 0)}</div>
            <div class="listing-doors">${c.callable ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleTest(g, c)}>${test && test.id === c.id ? x('close') : x('try')}</button>` : html`<small class="cp-dim">${x('discoveryOnly')}</small>`}</div>
          </div>`)}
      </div>
      ${test ? html`
        <div class="cp-test poster-box poster-box--copy">
          <span class="poster-label">${x('tryTitle', { id: test.id })}</span>
          <textarea class="og-textarea cp-test-in" rows="3" value=${test.input} onInput=${(e) => ctx.setTestInput(e.target.value)}></textarea>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" disabled=${test.running} onClick=${() => ctx.runTest()}>${x('run')}</button><span class="poster-hint">${x('tryHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}</span></div>
          ${test.result ? html`<span class="poster-label">${test.result.ok ? x('tryOk') : x('tryFail')}</span><pre class="code-block cp-out">${test.result.text}</pre>` : null}
        </div>` : null}
      <div class="facts">
        <div class="facts-k poster-label">${x('forAgent')}</div><div class="facts-v">${g.callable ? html`<code class="code-inline">${invokeLine}</code><small>${x('forAgentSub', { id: first?.id || '' })} · <${CopyButton} text=${agentTextFor(g, ctx.details)} className="og-crumb-link" label=${x('copyAgent')} copiedLabel=${x('copied')} /></small>` : html`${usage}<small>${x('discoveryOnlySub')} · <${CopyButton} text=${agentTextFor(g, ctx.details)} className="og-crumb-link" label=${x('copyAgent')} copiedLabel=${x('copied')} /></small>`}</div>
        <div class="facts-k poster-label">${x('whoMayCall')}</div><div class="facts-v">${first ? `${authWord(first)} · ${g.priced ? x('pricedLong') : x('cost.free')}` : ''}<small>${x('whoMayCallSub')}</small></div>
        <div class="facts-k poster-label">${x('trust')}</div><div class="facts-v">${g.vouches ? vouchesWord(g.vouches) : x('noVouches')} · ${g.members.some((c) => c.trust?.operatorReviewed) ? x('reviewed') : x('notReviewed')}<small>${x('trustSub')}${!g.own && first ? html` · <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.vouch(g)}>${g.members.some((c) => ctx.vouched[c.id]) ? x('unvouch') : x('vouch')}</button>` : null}</small></div>
        <div class="facts-k poster-label">${x('calls')}</div><div class="facts-v">${x('callsLong', { n: g.calls, errors: g.errors })}<small>${ctx.policy?.call_counting ? x('callsCounted') : x('callsProxyOnly')}</small></div>
        ${sourceTab ? html`<div class="facts-k poster-label">${x('sourceK')}</div><div class="facts-v"><button type="button" class="poster-action poster-action--more" onClick=${() => openTab(sourceTab)}>${x('sourceLink.' + g.shelf, { name: g.name })}</button><small>${x('sourceSub.' + g.shelf)}</small></div>` : null}
        ${g.type === 'manual' && first ? html`<div class="facts-k poster-label">${x('webhook')}</div><div class="facts-v">${ctx.details[first.id]?.webhookUrl || first.webhookUrl || x('webhookNone')}<small>${x('webhookSub')}</small></div>` : null}
      </div>
      <div class="og-doors listing-open-doors">
        <${CopyButton} text=${agentTextFor(g, ctx.details)} className="poster-action poster-action--small" label=${x('copyAgent')} copiedLabel=${x('copied')} />
        ${g.own ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setVisibility(g, g.visibility === 'public' ? 'private' : 'public')}>${g.visibility === 'public' ? x('hideFromAgents') : x('showToAgents')}</button>` : null}
        ${g.own && g.type === 'manual' ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.remove(g)}>${x('remove')}</button>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggle(g)}>${x('close')}</button>
      </div>
    </div>`;
}

export const loadingRow = () => html`<p class="poster-quiet cp-empty loading-mark">${t('common.loading')}</p>`;
