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
 * @structure keyRow · keyOpen · secretRow · sessionsBlock · federationBlock · msgLine
 * @usage import { keyRow, secretRow, sessionsBlock, federationBlock } from './rows.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: a key and a secret are ListRows whose
 *     open body holds the rights, the spending ceiling or the replace field; the sessions are a
 *     table; the federation servers are compact rows with a Field to add one; no own classes. A
 *     host name wraps where the text part wraps it rather than only after its dots.
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
import { Stack, ListRow, KeyValue, Table, Toolbar, Surface, Text, Action, Field } from '/components/poster-parts.js';
import { x, n, dateWord, timeWord, rightGroups } from './frame.js';

const doorWord = (open) => (open ? x('close') : x('open'));

/** A form's message: coral when it refuses, green when it went through. */
export const msgLine = (m) => (m ? html`<${Text} kind="caption" tone=${m.error ? 'coral' : 'success'}>${m.text}<//>` : null);

/* ── 02: one key ─────────────────────────────────────────────────────────────────────────────── */

export function keyRow(ctx, row) {
  const open = ctx.openKey === row.id;
  const words = row.words.length ? row.words.join(', ') : x('nothing');
  const extra = [row.base ? x('baseTag') : '', row.canSpend ? (row.spendCap == null ? x('spendNoLimitShort') : x('spendCapShort', { cap: n(row.spendCap) })) : ''].filter(Boolean);
  const last = row.last ? `${dateWord(row.last)} ${timeWord(row.last)}` : x('neverUsed');
  return html`
    <${ListRow} key=${row.id} name=${row.name} onOpen=${() => ctx.toggleKey(row.id)}
      detail=${row.sub} value=${html`<${Stack} density="compact">
        <${Text} kind="mono" tone=${row.lastLow ? 'coral' : 'muted'}>${last}<//>
        ${row.lastLow && row.idle != null ? html`<${Text} kind="caption" tone="coral">${x('unusedDays', { n: row.idle })}<//>` : null}
      <//>`}
      actions=${html`
        ${row.kind === 'app' ? html`<${Action} kind="text" expanded=${open} onClick=${() => ctx.toggleKey(row.id)}>${doorWord(open)}<//>` : null}
        <${Action} kind="text" tone=${row.level?.low ? 'danger' : 'plain'} disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${ctx.busy === row.id ? x('revoking') : x('revoke')}<//>`}>
      <${Text} kind="caption" tone=${row.level?.low ? 'coral' : 'muted'}>${words}${extra.length ? ' · ' + extra.join(' · ') : ''}<//>
      ${open && row.kind === 'app' ? keyOpen(ctx, row) : null}
    <//>`;
}

function keyOpen(ctx, row) {
  const groups = rightGroups(row.scopes, ctx.basePackage);
  const minutes = Math.max(1, Math.round((ctx.ov?.access_ttl_seconds || 900) / 60));
  const canTake = (g) => groups.length > 1 || g.scopes.length < row.scopes.length;
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text}>${x('open.lead', { name: row.name })} ${x('open.applies', { min: minutes })}<//>
      <${Stack} density="compact">
        ${groups.map((g) => html`<${KeyValue} key=${g.id} label=${g.label} value=${html`<${Stack} direction="horizontal" align="between">
          <${Stack} density="compact">
            <${Text} tone=${g.base ? 'muted' : 'plain'}>${g.text}<//>
            ${g.base ? html`<${Text} kind="caption" tone="muted">${x('open.baseSub', { n: ctx.baseHolders })}<//>` : null}
          <//>
          ${canTake(g) ? html`<${Action} kind="text" disabled=${ctx.busy === row.id} onClick=${() => ctx.takeAway(row, g)}>${x('open.takeAway')}<//>`
            : html`<${Text} kind="caption" tone="muted">${x('open.lastRight')}<//>`}
        <//>`} />`)}
      <//>
      ${row.canSpend ? html`<${Stack} density="compact">
        <${Text} kind="label">${x('spend.title')}<//>
        <${Text} tone="muted">${row.spendCap == null ? x('spend.noLimit') : x('spend.used', { spent: n(row.spent), cap: n(row.spendCap) })}<//>
        <${Stack} direction="wrap" density="compact" align="end">
          <${Field} type="number" width="narrow" min="0" step="1" inputMode="numeric" ariaLabel=${x('spend.title')} placeholder=${x('spend.placeholder')}
            value=${ctx.spendDraft[row.id] ?? ''} onInput=${(e) => ctx.setSpendDraft(row.id, e.target.value)} />
          <${Action} disabled=${ctx.busy === row.id} onClick=${() => ctx.setSpendCap(row, ctx.spendDraft[row.id])}>${x('spend.set')}<//>
          ${row.spent > 0 ? html`<${Action} kind="text" disabled=${ctx.busy === row.id} onClick=${() => ctx.setSpendCap(row, null, true)}>${x('spend.reset')}<//>` : null}
        <//>
      <//>` : null}
      <${Stack} direction="wrap" density="compact" align="center">
        <${Action} tone="danger" disabled=${ctx.busy === row.id} onClick=${() => ctx.revokeKey(row)}>${x('open.revokeAll')}<//>
        ${row.grant?.app_origin ? html`<${Action} kind="text" href=${row.grant.app_origin} target="_blank">${x('open.openApp')}<//>` : null}
        <${Text} kind="caption" tone="muted">${x('open.revokeHint')}<//>
      <//>
    <//><//>`;
}

/* ── 05: one secret ─────────────────────────────────────────────────────────────────────────── */

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
    <${ListRow} key=${row.name} name=${row.name} detail=${'{{secret:' + row.name + '}}'}
      value=${html`<${Stack} density="compact">
        <${Text} kind="mono">${dateWord(row.setAt)}<//>
        <${Text} kind="caption" tone="muted">${replaced ? x('secrets.colReplaced') + ' ' + dateWord(replaced) : x('secrets.neverReplaced')}<//>
      <//>`}
      actions=${html`
        <${Action} kind="text" expanded=${open} onClick=${() => ctx.openReplace(row.name)}>${open ? x('close') : x('secrets.replace')}<//>
        <${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => ctx.deleteSecret(row)}>${x('secrets.delete')}<//>`}>
      <${Stack} density="compact">
        <${Text} kind="caption" tone=${used.length ? 'plain' : 'muted'}>${x('secrets.colUsedBy')}: ${used.length ? used.join(', ') : x('secrets.usedByNone')}<//>
        <${Text} kind="caption" tone="muted">${hosts.length ? x('secrets.goesTo', { host: hosts.join(', ') }) : x('secrets.notBound')}<//>
      <//>
      ${open ? secretReplace(ctx, row, busy) : null}
    <//>`;
}

/** The one field that writes a value, on the row it belongs to. It is never filled from the server. */
function secretReplace(ctx, row, busy) {
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text} kind="label">${x('secrets.replaceTitle', { name: row.name })}<//>
      <${Text}>${x('secrets.replaceHint')}<//>
      <${Toolbar} label=${x('secrets.replaceTitle', { name: row.name })} actions=${html`
        <${Action} disabled=${busy || !ctx.replaceValue} onClick=${() => ctx.writeSecret(row.name, ctx.replaceValue, true)}>${busy ? x('secrets.saving') : x('secrets.replaceSave')}<//>
        <${Action} kind="text" onClick=${() => ctx.openReplace(row.name)}>${x('cancel')}<//>`}>
        <${Field} type="password" autoComplete="new-password" spellCheck=${false} ariaLabel=${x('secrets.value')} placeholder=${x('secrets.valuePlaceholder')}
          value=${ctx.replaceValue} onInput=${(e) => ctx.setReplaceValue(e.target.value)} />
      <//>
      ${msgLine(ctx.secretMsg)}
      <${Text} kind="caption" tone="muted">${x('secrets.valueHint')}<//>
    <//><//>`;
}

/* ── 01: the open sessions ──────────────────────────────────────────────────────────────────── */

export function sessionsBlock(ctx) {
  const s = ctx.ov.sign_in.sessions;
  const devices = s.mine.by_device;
  const agents = s.agents;
  const at = (iso) => (iso ? `${dateWord(iso)} ${timeWord(iso)}` : '');
  const rows = devices.map((d) => [
    html`<${Stack} density="compact"><${Text}><strong>${d.label || x('deviceUnknown')}</strong><//>
      ${s.mine.current && (s.mine.current.device_label ?? null) === d.label ? html`<${Text} kind="caption" tone="muted">${x('thisDeviceAmong')}<//>` : null}<//>`,
    html`<${Text} kind="number" size="small">${n(d.count)}<//>`,
    html`<${Text} kind="mono">${at(d.last_used_at)}<//>`,
  ]);
  if (agents.total) {
    rows.push([
      html`<${Stack} density="compact"><${Text}><strong>${x('agentsRow', { n: agents.distinct })}</strong><//>
        <${Text} kind="caption" tone="muted">${agents.by_agent.slice(0, 6).map((a) => a.name).join(', ')}${agents.by_agent.length > 6 ? ` +${agents.by_agent.length - 6}` : ''}<//><//>`,
      html`<${Text} kind="number" size="small">${n(agents.total)}<//>`,
      html`<${Text} kind="mono">${at(agents.by_agent[0]?.last_used_at)}<//>`,
    ]);
  }
  return html`<${Table} density="compact" collapse="560" label=${x('row.sessions')}
    headers=${[x('col.device'), x('col.sessions'), x('col.lastUsed')]} rows=${rows} />`;
}

/* ── 01: the servers that may verify this identity ─────────────────────────────────────────── */

export function federationBlock(ctx) {
  const fed = ctx.fed;
  return html`<${Stack} density="compact">
    ${fed.nodes.map((c) => html`<${ListRow} key=${c.id} density="compact" name=${c.recipient.replace('node:', '')} detail=${dateWord(c.granted_at)}
      actions=${html`<${Action} kind="text" disabled=${fed.all || ctx.busy === c.id} onClick=${() => ctx.removeFedNode(c)}>${x('fed.remove')}<//>`} />`)}
    <${Toolbar} label=${x('row.federation')}
      actions=${html`<${Action} disabled=${fed.all || ctx.busy === 'fed' || !ctx.fedInput.trim()} onClick=${() => ctx.addFedNode()}>${x('fed.add')}<//>`}>
      <${Field} ariaLabel=${x('fed.addPlaceholder')} placeholder=${x('fed.addPlaceholder')} disabled=${fed.all} value=${ctx.fedInput}
        onInput=${(e) => ctx.setFedInput(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ctx.addFedNode()} />
    <//>
    <${Text} kind="caption" tone="muted">${fed.all ? x('fed.allHint') : x('fed.listHint')}<//>
  <//>`;
}
