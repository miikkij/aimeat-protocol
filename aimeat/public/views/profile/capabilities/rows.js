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
 *   2026-09-22 -- Composed from the shared component set: ListRow with a status marker and the
 *     version as a Chip, the members as compact rows, the opened record a Surface of KeyValue rows,
 *     the try panel a Field and a code Surface; no own CSS.
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ListRow, Stack, KeyValue, Field, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { x, ownerName, authWord, costWord, memberSummary, agentTextFor, schemaWords, callsWord, vouchesWord, openTab } from './frame.js';

/** A KeyValue whose value is a body and a quieter note under it. */
const kv = (label, body, note) => html`<${KeyValue} label=${label}>
  <${Stack} density="compact"><div>${body}</div>${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}<//>
<//>`;

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
  return html`<${ListRow} key=${g.key} density="compact" marker=${g.status === 'active' ? 'success' : 'muted'}
    name=${html`${g.name}${g.version && g.shelf === 'ext' ? html` <${Chip}>v${g.version}<//>` : null}`}
    detail=${subLine(g)}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggle(g)}>${open ? x('close') : x('open')}<//>
      <${Action} onClick=${() => ctx.copyForAgent(g)}>${x('copyAgent')}<//>`}>
    <${Stack} density="compact">
      ${g.summary ? html`<${Text}>${g.summary}<//>` : null}
      ${ids.length > 1 || g.shelf !== 'other' ? html`<${Text} kind="mono" tone="muted">${ids.slice(0, 6).join(' · ')}${ids.length > 6 ? ` · +${ids.length - 6}` : ''}<//>` : null}
      <${Stack} direction="wrap" density="compact"><${Text} kind="mono">${idForm(g)}<//>
      <${Text} kind="caption" tone="muted">${[g.callable ? authWord(g.members[0]) : x('discoveryOnly'), g.priced ? x('pricedShort') : '', g.calls ? callsWord(g.calls) : x('callsNone'), g.vouches ? vouchesWord(g.vouches) : ''].filter(Boolean).join(' · ')}<//><//>
      ${open ? providerOpen(ctx, g) : null}
    <//>
  <//>`;
}

function providerOpen(ctx, g) {
  const test = ctx.test && ctx.test.key === g.key ? ctx.test : null;
  const first = g.members[0];
  const invokeLine = first ? `aimeat_capabilities_invoke { id: "${first.id}", input: { … } }` : '';
  const sourceTab = g.shelf === 'ext' ? 'extensions' : g.shelf === 'app' ? 'apps' : g.shelf === 'agent' ? 'agents' : null;
  const usage = ctx.details[first?.id]?.usage || first?.usage || '';
  const copyAgent = html`<${CopyAction} kind="text" text=${agentTextFor(g, ctx.details)} label=${x('copyAgent')} copiedLabel=${x('copied')} />`;
  return html`
    <${Surface} kind="record">
      <${Stack}>
        ${g.summary ? html`<${Text} kind="lead">${g.summary}<//>` : null}
        <${Text} kind="label">${g.shelf === 'ext' ? x('actions') : g.shelf === 'app' ? x('tools') : g.shelf === 'agent' ? x('offers') : x('capability')} · ${x('idFormIs', { form: idForm(g) })}<//>
        <${Stack} density="compact">
          ${g.members.map((c) => html`<${ListRow} key=${'m' + c.id} density="compact" name=${c.member || c.id}
            detail=${c.status !== 'active' ? x('status.' + c.status) : undefined}
            value=${callsWord(c.stats?.totalInvocations || 0)}
            actions=${c.callable ? html`<${Action} expanded=${!!(test && test.id === c.id)} onClick=${() => ctx.toggleTest(g, c)}>${test && test.id === c.id ? x('close') : x('try')}<//>`
              : html`<${Text} kind="caption" tone="muted">${x('discoveryOnly')}<//>`}>
            <${Stack} density="compact">
              ${memberSummary(g, c) || g.members.length !== 1 ? html`<${Text}>${memberSummary(g, c) || x('sameAsProvider')}<//>` : null}
              <${Text} kind="mono" tone="muted">${x('inputOut', { input: schemaWords(ctx.details[c.id]?.inputSchema || c.inputSchema) || x('nothing'), output: schemaWords(ctx.details[c.id]?.outputSchema || c.outputSchema) || x('json') })}${c.cost ? ` · ${costWord(c)}` : ''}<//>
            <//>
          <//>`)}
        <//>
        ${test ? html`
          <${Stack} density="compact">
            <${Field} type="textarea" label=${x('tryTitle', { id: test.id })} rows=${3} value=${test.input} onInput=${(e) => ctx.setTestInput(e.target.value)} />
            <${Stack} direction="horizontal" align="center">
              <${Action} disabled=${test.running} onClick=${() => ctx.runTest()}>${x('run')}<//>
              <${Text} kind="caption" tone="muted">${x('tryHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}<//>
            <//>
            ${test.result ? html`<${Text} kind="label">${test.result.ok ? x('tryOk') : x('tryFail')}<//>
              <${Surface} kind="code" tone=${test.result.ok ? 'plain' : 'danger'}>${test.result.text}<//>` : null}
          <//>` : null}
        <div>
          ${g.callable
            ? kv(x('forAgent'), html`<${Text} kind="mono">${invokeLine}<//>`, html`${x('forAgentSub', { id: first?.id || '' })} · ${copyAgent}`)
            : kv(x('forAgent'), usage, html`${x('discoveryOnlySub')} · ${copyAgent}`)}
          ${kv(x('whoMayCall'), first ? `${authWord(first)} · ${g.priced ? x('pricedLong') : x('cost.free')}` : '', x('whoMayCallSub'))}
          ${kv(x('trust'), `${g.vouches ? vouchesWord(g.vouches) : x('noVouches')} · ${g.members.some((c) => c.trust?.operatorReviewed) ? x('reviewed') : x('notReviewed')}`,
            html`${x('trustSub')}${!g.own && first ? html` · <${Action} kind="text" onClick=${() => ctx.vouch(g)}>${g.members.some((c) => ctx.vouched[c.id]) ? x('unvouch') : x('vouch')}<//>` : null}`)}
          ${kv(x('calls'), x('callsLong', { n: g.calls, errors: g.errors }), ctx.policy?.call_counting ? x('callsCounted') : x('callsProxyOnly'))}
          ${sourceTab ? kv(x('sourceK'), html`<${Action} kind="text" onClick=${() => openTab(sourceTab)}>${x('sourceLink.' + g.shelf, { name: g.name })}<//>`, x('sourceSub.' + g.shelf)) : null}
          ${g.type === 'manual' && first ? kv(x('webhook'), ctx.details[first.id]?.webhookUrl || first.webhookUrl || x('webhookNone'), x('webhookSub')) : null}
        </div>
        <${Stack} direction="wrap">
          <${CopyAction} text=${agentTextFor(g, ctx.details)} label=${x('copyAgent')} copiedLabel=${x('copied')} />
          ${g.own ? html`<${Action} onClick=${() => ctx.setVisibility(g, g.visibility === 'public' ? 'private' : 'public')}>${g.visibility === 'public' ? x('hideFromAgents') : x('showToAgents')}<//>` : null}
          ${g.own && g.type === 'manual' ? html`<${Action} tone="danger" onClick=${() => ctx.remove(g)}>${x('remove')}<//>` : null}
          <${Action} onClick=${() => ctx.toggle(g)}>${x('close')}<//>
        <//>
      <//>
    <//>`;
}

export const loadingRow = () => html`<${Text} tone="muted">${t('common.loading')}<//>`;
