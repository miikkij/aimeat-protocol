/**
 * @file security-tab.packs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin Security page's security classes (plan doc-mvlftkh9zmc9, C7.5): the Finnish
 *   classes (TL IV to TL I) and the NATO classes, each pack with the classes that are on, a choice of
 *   the highest class to switch on, and Switch on / Switch off. GET and PUT /v1/classification/packs,
 *   the same service the MCP tool's pack_list and pack_set call.
 *
 *   THE TOP CLASSES ASK FIRST. The two highest classes of each pack need the operator to tick that
 *   this node is not an accredited system; the server refuses them without it (decision 10.8), and
 *   the tick sits next to the choice, unticked, every time.
 * @structure PacksSection({ number, onOk, onError })
 * @usage imported by security-tab.js
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvlftkh9zmc9, C7.5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Row as Line } from '/components/Layout.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.security.packs.' + key, params);
const lang = () => (document.documentElement.lang || 'en').slice(0, 2);
const nameOf = (n) => (n && (n[lang()] || n.en)) || '';

/** One pack: its classes, the highest to switch on, the tick for a top class, and the two doors. */
function PackRow({ pack, busy, onSet }) {
  const [upTo, setUpTo] = useState(pack.upTo || [...pack.labels].reverse().find(l => !l.top)?.id || pack.labels[0]?.id);
  const [ack, setAck] = useState(false);
  const chosen = pack.labels.findIndex(l => l.id === upTo);
  const top = pack.labels.slice(0, chosen + 1).some(l => l.top);
  const on = pack.labels.filter(l => l.active).map(l => nameOf(l.name));
  return html`
    <div>
      <${Line} wrap gap="medium" below="small">
        <${Select} fit value=${upTo} ariaLabel=${P('upTo')} onChange=${setUpTo}
          options=${pack.labels.map(l => [l.id, nameOf(l.name)])} />
        ${top ? html`<${Check} checked=${ack} onChange=${setAck}>${P('acknowledge')}<//>` : ''}
        <${Actions}>
          <${Action} small soft disabled=${busy || (top && !ack) || (pack.on && upTo === pack.upTo)}
            onClick=${() => onSet(pack.id, true, upTo, ack)}>${pack.on ? P('change') : P('on')}<//>
          ${pack.on ? html`<${Action} small soft disabled=${busy} onClick=${() => onSet(pack.id, false)}>${P('off')}<//>` : ''}
        <//>
      <//>
      <${Note} kind="meta">${on.length ? P('nowOn', { classes: on.join(', ') }) : P('nowOff')}<//>
    </div>`;
}

export function PacksSection({ number, onOk, onError }) {
  const [packs, setPacks] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/classification/packs');
      setPacks(r?.data?.packs || []);
    } catch (e) { swallowed('security-tab.packs: load', e); setPacks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['classification'], load), [load]);

  const set = async (pack, on, upTo, ack) => {
    setBusy(true);
    try {
      const r = await apiPut('/v1/classification/packs', on ? { pack, on, upTo, acknowledgeNotAccredited: ack } : { pack, on });
      onOk?.(r?.data?.pending ? P('waits') : on ? P('switchedOn') : P('switchedOff'));
      await load();
    } catch (e) {
      onError?.(e?.message || P('failed'));
      swallowed('security-tab.packs: set', e);
    }
    setBusy(false);
  };

  return html`
    <${Section} id="adm-sec-packs" num=${number} title=${P('title')}>
      <${Note} kind="lead">${P('lead')}<//>
      ${packs === null ? '' : html`<${Readings} rows=${packs.map((p, i) => ({
        key: p.id,
        name: nameOf(p.name),
        why: html`<${PackRow} pack=${p} busy=${busy} onSet=${set} />`,
        value: p.on ? (p.top ? P('stateTop') : P('stateOn')) : P('stateOff'),
        last: i === packs.length - 1,
      }))} />`}
      <${Note} kind="hint">${P('notAccredited')}<//>
    <//>`;
}
