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
 *   v1.17.0 -- 2026-09-26 -- On the component kit (page group G7): a provider's row, its members and its opened panel are the List (the status dot and the version tag are the Name's, the member ids the words' line, the id form and its call line a typewriter cell), the try panel the Box's copy tone with the TextArea and the tall Code block, the facts the Facts (the copy inside a value the Action's link tone, main's crumb link). The file writes no class.
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
import { Action, Actions } from '/components/Action.js';
import { Code, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { TextArea } from '/components/TextField.js';
import { List, Row, Name, Desc, Num, Cell, Doors, Panel } from '/components/List.js';
import { x, ownerName, authWord, costWord, memberSummary, agentTextFor, schemaWords, callsWord, vouchesWord, openTab } from './frame.js';

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
  const acts = ids.length > 1 || g.shelf !== 'other' ? `${ids.slice(0, 6).join(' · ')}${ids.length > 6 ? ` · +${ids.length - 6}` : ''}` : null;
  const callLine = [g.callable ? authWord(g.members[0]) : x('discoveryOnly'), g.priced ? x('pricedShort') : '', g.calls ? callsWord(g.calls) : x('callsNone'), g.vouches ? vouchesWord(g.vouches) : ''].filter(Boolean).join(' · ');
  return html`
    <${Row} key=${g.key} open=${open}>
      <${Name} dot=${g.status === 'active' ? 'active' : 'inactive'} tag=${g.version && g.shelf === 'ext' ? 'v' + g.version : null} meta=${subLine(g)}>${g.name}<//>
      <${Desc} sub=${acts}>${g.summary || ''}<//>
      <${Cell} meta>${idForm(g)}<br />${callLine}<//>
      <${Doors}>
        <${Action} small row onClick=${() => ctx.toggle(g)}>${open ? x('close') : x('open')}<//>
        <${Action} small row soft onClick=${() => ctx.copyForAgent(g)}>${x('copyAgent')}<//>
      <//>
      ${open ? providerOpen(ctx, g) : null}
    <//>`;
}

function providerOpen(ctx, g) {
  const test = ctx.test && ctx.test.key === g.key ? ctx.test : null;
  const first = g.members[0];
  const invokeLine = first ? `aimeat_capabilities_invoke { id: "${first.id}", input: { … } }` : '';
  const sourceTab = g.shelf === 'ext' ? 'extensions' : g.shelf === 'app' ? 'apps' : g.shelf === 'agent' ? 'agents' : null;
  const usage = ctx.details[first?.id]?.usage || first?.usage || '';
  const agentText = agentTextFor(g, ctx.details);
  const copyAgent = html`<${Action} tone="link" copy=${agentText} copiedLabel=${x('copied')}>${x('copyAgent')}<//>`;
  const toggleVouch = () => ctx.vouch(g);
  const doors = html`
    <${Action} small copy=${agentText} copiedLabel=${x('copied')}>${x('copyAgent')}<//>
    ${g.own ? html`<${Action} small soft onClick=${() => ctx.setVisibility(g, g.visibility === 'public' ? 'private' : 'public')}>${g.visibility === 'public' ? x('hideFromAgents') : x('showToAgents')}<//>` : null}
    ${g.own && g.type === 'manual' ? html`<${Action} small soft onClick=${() => ctx.remove(g)}>${x('remove')}<//>` : null}
    <${Action} small soft onClick=${() => ctx.toggle(g)}>${x('close')}<//>`;
  const member = (c) => {
    const words = memberSummary(g, c) || (g.members.length === 1 ? '' : x('sameAsProvider'));
    const io = `${x('inputOut', { input: schemaWords(ctx.details[c.id]?.inputSchema || c.inputSchema) || x('nothing'), output: schemaWords(ctx.details[c.id]?.outputSchema || c.outputSchema) || x('json') })}${c.cost ? ` · ${costWord(c)}` : ''}`;
    const tryIt = () => ctx.toggleTest(g, c);
    return html`
      <${Row} key=${c.id}>
        <${Name} code meta=${c.status !== 'active' ? x('status.' + c.status) : null}>${c.member || c.id}<//>
        <${Desc} sub=${io}>${words}<//>
        <${Num}>${callsWord(c.stats?.totalInvocations || 0)}<//>
        <${Doors}>${c.callable ? html`<${Action} small soft onClick=${tryIt}>${test && test.id === c.id ? x('close') : x('try')}<//>` : html`<${Note} kind="meta" inline>${x('discoveryOnly')}<//>`}<//>
      <//>`;
  };
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${g.summary || ''}<//>
      <${Label} block>${g.shelf === 'ext' ? x('actions') : g.shelf === 'app' ? x('tools') : g.shelf === 'agent' ? x('offers') : x('capability')} · ${x('idFormIs', { form: idForm(g) })}<//>
      <${List} cols="id-desc-n-doors" apart>${g.members.map(member)}<//>
      ${test ? html`
        <${Box} tone="copy">
          <${Label} block>${x('tryTitle', { id: test.id })}<//>
          <${TextArea} rows=${3} value=${test.input} onInput=${(v) => ctx.setTestInput(v)} ariaLabel=${x('tryTitle', { id: test.id })} />
          <${Actions}><${Action} small disabled=${test.running} onClick=${() => ctx.runTest()}>${x('run')}<//><${Note} inline>${x('tryHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}<//><//>
          ${test.result ? html`<${Label} block>${test.result.ok ? x('tryOk') : x('tryFail')}<//><${Code} block tall>${test.result.text}<//>` : null}
        <//>` : null}
      <${Facts} rows=${[
        g.callable
          ? { k: x('forAgent'), v: invokeLine, mono: true, sub: html`${x('forAgentSub', { id: first?.id || '' })} · ${copyAgent}` }
          : { k: x('forAgent'), v: usage, sub: html`${x('discoveryOnlySub')} · ${copyAgent}` },
        { k: x('whoMayCall'), v: first ? `${authWord(first)} · ${g.priced ? x('pricedLong') : x('cost.free')}` : '', sub: x('whoMayCallSub') },
        { k: x('trust'), v: `${g.vouches ? vouchesWord(g.vouches) : x('noVouches')} · ${g.members.some((c) => c.trust?.operatorReviewed) ? x('reviewed') : x('notReviewed')}`,
          sub: html`${x('trustSub')}${!g.own && first ? html` · <${Action} tone="more" onClick=${toggleVouch}>${g.members.some((c) => ctx.vouched[c.id]) ? x('unvouch') : x('vouch')}<//>` : null}` },
        { k: x('calls'), v: x('callsLong', { n: g.calls, errors: g.errors }), sub: ctx.policy?.call_counting ? x('callsCounted') : x('callsProxyOnly') },
        sourceTab && { k: x('sourceK'), v: html`<${Action} tone="more" onClick=${() => openTab(sourceTab)}>${x('sourceLink.' + g.shelf, { name: g.name })}<//>`, sub: x('sourceSub.' + g.shelf) },
        g.type === 'manual' && first && { k: x('webhook'), v: ctx.details[first.id]?.webhookUrl || first.webhookUrl || x('webhookNone'), sub: x('webhookSub') },
      ]} />
    <//>`;
}

export const loadingRow = () => html`<${List} loading=${t('common.loading')} />`;
