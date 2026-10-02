/**
 * @file public/views/profile/access/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the Access page: one key (an app's grant or a token) with who holds it,
 *   what it may do in words, when it was last used and a door; what opens under an app's key (each
 *   right on its own line behind a "take away" door, the base package said once, the spending
 *   ceiling where the app may buy, the doors to open the app and to revoke the key); the open
 *   sessions by device and by agent; the servers allowed to verify the person's identity; and one
 *   secret from the vault — its name, the spelling an extension writes into a header, what names it
 *   today, and the write-only field that replaces its value.
 * @structure keyRow · keyOpen · secretRow · sessionsBlock · federationBlock
 * @usage import { keyRow, secretRow, sessionsBlock, federationBlock } from './rows.js';
 * @version-history
 *   v1.18.0 -- 2026-10-02 -- The question mark that explains morsels: commerce.morsels on the spending ceiling's Label (components/HelpTip.js).
 *   v1.17.0 --2026-09-26 -- Every part is a component that takes data, and the file writes no class
 *     (component plan, page group G3): a key and a secret are List rows (Name, Desc, Who, When, Doors)
 *     with the opened Panel, an opened key's rights a dense List (a base package's line dim), the
 *     spending ceiling and the replaced value a TextField with its actions, the sessions a dense List
 *     under their row (name-n-when), the servers allowed to verify you a dense List under their row
 *     and the TextField that adds one. Put back from main as tones: a key's time in coral when it is
 *     unused (When warn), "used by nothing" dim (Tinted dim), a host's label kept whole (Tinted whole).
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The rights of an opened key are the Listing too (a right, its words, its door), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- A key's row and a secret's row are the Listing (listing-row and its name, words, who and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-17 -- A secret row says the one address its value may go to, or that the first
 *     call that uses it sets that address.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-13 -- Compose access detail frames and extract inline layout.
 *   v1.1.0 — 2026-09-06 — secretRow: the vault's rows for section 04. It shows the name and never
 *     the value, because the value cannot be read back from the server either.
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { x, n, dateWord, timeWord, rightGroups } from './frame.js';
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors, Panel } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Figure, Tinted } from '/components/Figure.js';
import { TextField } from '/components/TextField.js';
import { HelpLabel } from '/components/HelpTip.js';

const doorWord = (open) => (open ? x('close') : x('open'));

/* A host name in the narrow "who" column breaks at its dots (nuotta.apps. / aimeat.io) rather than
   wherever the column runs out: a soft break after each dot is taken before the emergency break
   that overflow-wrap would make mid-word. */
const dotted = (s) => s.split(' · ').map((part, i) => html`${i ? ' · ' : ''}${part.includes('.') ? part.split('.').map((seg, j) => (j ? html`.<wbr />${seg}` : seg)) : part}`);

/* ── 02: one key ─────────────────────────────────────────────────────────────────────────────── */

export function keyRow(ctx, row) {
  const open = ctx.openKey === row.id;
  const last = row.last ? html`${dateWord(row.last)}<br />${timeWord(row.last)}` : x('neverUsed');
  const words = row.words.length ? row.words.join(', ') : x('nothing');
  return html`
    <${Row} key=${row.id} open=${open}>
      <${Name} onOpen=${() => ctx.toggleKey(row.id)} meta=${dotted(row.sub)} warn=${row.subLow}>${row.name}<//>
      <${Desc}>${row.level?.low ? html`<b>${words}</b>` : words}${row.base ? html` · ${x('baseTag')}` : null}${row.canSpend ? html` · <b>${row.spendCap == null ? x('spendNoLimitShort') : x('spendCapShort', { cap: n(row.spendCap) })}</b>` : null}<//>
      <${When} warn=${row.lastLow}>${last}${row.lastLow && row.idle != null ? html`<br />${x('unusedDays', { n: row.idle })}` : null}<//>
      <${Doors}>
        ${row.kind === 'app' ? html`<${Action} small row expanded=${open} onClick=${() => ctx.toggleKey(row.id)}>${doorWord(open)}<//>` : null}
        <${Action} small row tone=${row.level?.low ? 'danger' : undefined} disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${ctx.busy === row.id ? x('revoking') : x('revoke')}<//>
      <//>
      ${open && row.kind === 'app' ? keyOpen(ctx, row) : null}
    <//>`;
}

function keyOpen(ctx, row) {
  const groups = rightGroups(row.scopes, ctx.basePackage);
  const minutes = Math.max(1, Math.round((ctx.ov?.access_ttl_seconds || 900) / 60));
  const canTake = (g) => groups.length > 1 || g.scopes.length < row.scopes.length;
  const busy = ctx.busy === row.id;
  return html`
    <${Panel} doors=${html`
      <${Action} small tone="danger" disabled=${busy} onClick=${() => ctx.revokeKey(row)}>${x('open.revokeAll')}<//>
      ${row.grant?.app_origin ? html`<${Action} small soft href=${row.grant.app_origin} newTab>${x('open.openApp')}<//>` : null}
      <${Note} inline>${x('open.revokeHint')}<//>`}>
      <${Note} kind="lead">${x('open.lead', { name: row.name })} ${x('open.applies', { min: minutes })}<//>
      <${List} cols="label-words-doors" dense apart>
        ${groups.map((g) => html`
          <${Row} key=${g.id}>
            <${Cell} dim=${g.base}><${Label}>${g.label}<//><//>
            ${g.base ? html`<${Desc} sub=${x('open.baseSub', { n: ctx.baseHolders })}>${g.text}<//>` : html`<${Cell}>${g.text}<//>`}
            <${Doors}>${canTake(g)
              ? html`<${Action} small row soft disabled=${busy} onClick=${() => ctx.takeAway(row, g)}>${x('open.takeAway')}<//>`
              : html`<${Note} inline>${x('open.lastRight')}<//>`}<//>
          <//>`)}
      <//>
      ${row.canSpend ? html`
        <${Label} block><${HelpLabel} term="commerce.morsels" label=${x('spend.title')}>${x('spend.title')}<//><//>
        <${Note}>${row.spendCap == null ? x('spend.noLimit') : x('spend.used', { spent: n(row.spent), cap: n(row.spendCap) })}<//>
        <${TextField} type="number" size="short" min="0" step="1" inputMode="numeric" ariaLabel=${x('spend.title')}
          placeholder=${x('spend.placeholder')} value=${ctx.spendDraft[row.id] ?? ''} onInput=${(v) => ctx.setSpendDraft(row.id, v)}
          actions=${html`
            <${Action} small disabled=${busy} onClick=${() => ctx.setSpendCap(row, ctx.spendDraft[row.id])}>${x('spend.set')}<//>
            ${row.spent > 0 ? html`<${Action} small soft disabled=${busy} onClick=${() => ctx.setSpendCap(row, null, true)}>${x('spend.reset')}<//>` : null}`} />` : null}
    <//>`;
}

/* ── 04: one secret ─────────────────────────────────────────────────────────────────────────── */

/**
 * One row of the vault. The sub-line is the spelling an extension writes into a header, because
 * that is the only thing a person needs to carry away from here; the value is not on this row, in
 * this file or in the answer the page read.
 * The address line under "used by" says where the value may go: a vault secret is bound to the host
 * of the first call that uses it, and every other host is refused.
 * @param {any} ctx @param {{ name: string, setAt?: string, updatedAt?: string, usedBy?: string[], hosts?: string[] }} row
 */
export function secretRow(ctx, row) {
  const open = ctx.replaceName === row.name;
  const busy = ctx.busy === 'secret:' + row.name;
  const used = Array.isArray(row.usedBy) ? row.usedBy : [];
  const hosts = Array.isArray(row.hosts) ? row.hosts : [];
  const replaced = row.updatedAt && row.updatedAt !== row.setAt ? row.updatedAt : null;
  return html`
    <${Row} key=${row.name} open=${open}>
      <${Name} meta=${'{{secret:' + row.name + '}}'}>${row.name}<//>
      <${Who} sub=${hosts.length ? secretHostLine(hosts) : x('secrets.notBound')}>${used.length ? used.join(', ') : html`<${Tinted} tone="dim">${x('secrets.usedByNone')}<//>`}<//>
      <${When}>${dateWord(row.setAt)}<br />${replaced ? x('secrets.colReplaced') + ' ' + dateWord(replaced) : x('secrets.neverReplaced')}<//>
      <${Doors}>
        <${Action} small row expanded=${open} onClick=${() => ctx.openReplace(row.name)}>${open ? x('close') : x('secrets.replace')}<//>
        <${Action} small row tone="danger" disabled=${busy} onClick=${() => ctx.deleteSecret(row)}>${x('secrets.delete')}<//>
      <//>
      ${open ? secretReplace(ctx, row, busy) : null}
    <//>`;
}

/**
 * "Sent only to <host>". A host may break after a dot and nowhere else: broken at its hyphen it
 * reads as two addresses, and cut short with an ellipsis it hides the one thing the line is for.
 * The sentence is split around a marker so the translation decides where the host goes.
 */
function secretHostLine(hosts) {
  const marker = ' ';
  const [before, after = ''] = x('secrets.goesTo', { host: marker }).split(marker);
  // The last two labels stay together, so a line never ends up holding only "com".
  const host = (h) => {
    const parts = h.split('.');
    const labels = parts.length > 1 ? [...parts.slice(0, -2), parts.slice(-2).join('.')] : parts;
    // Each label is kept whole (Tinted whole: never broken inside, not at its hyphen), so the line
    // breaks only at the <wbr /> between labels.
    return labels.map((part, i) =>
      html`<${Tinted} whole>${part}${i < labels.length - 1 ? '.' : ''}<//>${i < labels.length - 1 ? html`<wbr />` : null}`);
  };
  return html`${before}${hosts.map((h, i) => html`${i ? ', ' : ''}${host(h)}`)}${after}`;
}

/** The one field that writes a value, on the row it belongs to. It is never filled from the server. */
function secretReplace(ctx, row, busy) {
  return html`
    <${Panel}>
      <${Label} block>${x('secrets.replaceTitle', { name: row.name })}<//>
      <${Note} kind="lead">${x('secrets.replaceHint')}<//>
      <${TextField} type="password" autoComplete="new-password" spellCheck=${false} ariaLabel=${x('secrets.value')}
        placeholder=${x('secrets.valuePlaceholder')} value=${ctx.replaceValue} onInput=${(v) => ctx.setReplaceValue(v)}
        actions=${html`
          <${Action} small disabled=${busy || !ctx.replaceValue} onClick=${() => ctx.writeSecret(row.name, ctx.replaceValue, true)}>${busy ? x('secrets.saving') : x('secrets.replaceSave')}<//>
          <${Action} small soft onClick=${() => ctx.openReplace(row.name)}>${x('cancel')}<//>`} />
      ${ctx.secretMsg ? html`<${Note} kind="message" error=${ctx.secretMsg.error}>${ctx.secretMsg.text}<//>` : null}
      <${Note}>${x('secrets.valueHint')}<//>
    <//>`;
}

/* ── 01: the open sessions ──────────────────────────────────────────────────────────────────── */

export function sessionsBlock(ctx) {
  const s = ctx.ov.sign_in.sessions;
  const devices = s.mine.by_device;
  const agents = s.agents;
  const at = (iso) => (iso ? `${dateWord(iso)} ${timeWord(iso)}` : '');
  return html`
    <${List} cols="name-n-when" keepCols dense under head=${[x('col.device'), { label: x('col.sessions'), num: true }, x('col.lastUsed')]}>
      ${devices.map((d) => html`
        <${Row} key=${'d' + (d.label || '')}>
          <${Name} meta=${s.mine.current && (s.mine.current.device_label ?? null) === d.label ? x('thisDeviceAmong') : null}>${d.label || x('deviceUnknown')}<//>
          <${Num}><${Figure} small n=${n(d.count)} /><//>
          <${When}>${at(d.last_used_at)}<//>
        <//>`)}
      ${agents.total ? html`
        <${Row} key="agents">
          <${Name} meta=${`${agents.by_agent.slice(0, 6).map((a) => a.name).join(', ')}${agents.by_agent.length > 6 ? ` +${agents.by_agent.length - 6}` : ''}`}>${x('agentsRow', { n: agents.distinct })}<//>
          <${Num}><${Figure} small n=${n(agents.total)} /><//>
          <${When}>${at(agents.by_agent[0]?.last_used_at)}<//>
        <//>` : null}
    <//>`;
}

/* ── 01: the servers that may verify this identity ─────────────────────────────────────────── */

export function federationBlock(ctx) {
  const fed = ctx.fed;
  return html`
    ${fed.nodes.length ? html`<${List} cols="name-desc-doors" keepCols dense under>${fed.nodes.map((c) => html`
      <${Row} key=${c.id}>
        <${Name} asKey>${c.recipient.replace('node:', '')}<//>
        <${Desc}>${dateWord(c.granted_at)}<//>
        <${Doors}><${Action} small row soft disabled=${fed.all || ctx.busy === c.id} onClick=${() => ctx.removeFedNode(c)}>${x('fed.remove')}<//><//>
      <//>`)}<//>` : null}
    <${TextField} placeholder=${x('fed.addPlaceholder')} ariaLabel=${x('fed.addPlaceholder')} disabled=${fed.all} value=${ctx.fedInput}
      onInput=${(v) => ctx.setFedInput(v)} onEnter=${() => ctx.addFedNode()}
      actions=${html`
        <${Action} small disabled=${fed.all || ctx.busy === 'fed' || !ctx.fedInput.trim()} onClick=${() => ctx.addFedNode()}>${x('fed.add')}<//>
        <${Note} inline>${fed.all ? x('fed.allHint') : x('fed.listHint')}<//>`} />`;
}
