/**
 * @file public/views/profile/organisms/per-member-setting.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism setting that shows its value report per member to the creators and admins
 *   (services/value/per-member.ts): one check line with its question mark (organism.value_per_member).
 *   Only a creator changes it; an admin reads its state. It writes the creator's own meta record
 *   `organism.<id>.meta.valuereport` { perMember } with the ordinary memory write, which lets only the
 *   organism's creators and admins write meta.*, and the node counts only a creator's copy. Composed
 *   from library components only.
 *   PerMemberNotice tells every member, on the organism's page, that the setting is on and shows their
 *   own numbers; countItems is the figure strip both views share.
 * @structure PerMemberSetting({ org, isCreator, showToast }) · countItems(signals) · PerMemberNotice({ info })
 * @usage html`<${PerMemberSetting} org=${org} isCreator=${isCreator} showToast=${showToast} />`
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-j-senkohtaiset-korjausluvut-tiimin-vet-j-lle-kun-luoja-kytke).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const x = (k, v) => t('organisms.perMember.' + k, v);

export function PerMemberSetting({ org, isCreator, showToast }) {
  const key = `organism.${org.id}.meta.valuereport`;
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // The organism's report says what is in force (any creator's copy); a creator writes their own.
    try {
      const r = await apiGet(`/v1/organisms/${encodeURIComponent(org.id)}/value`);
      setOn(r?.data?.per_member?.on === true);
    } catch (e) { swallowed('per-member-setting: load', e); setOn(false); }
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const change = async (next) => {
    setBusy(true);
    try {
      await apiPost('/v1/memory', { key, value: { perMember: next } });
      setOn(next);
      showToast?.(x(next ? 'turnedOn' : 'turnedOff'));
    } catch (e) { showToast?.(e?.message || x('failed'), true); } finally { setBusy(false); }
  };

  if (on === null) return null;
  return html`
    <${Check} checked=${on} disabled=${!isCreator || busy} help="organism.value_per_member"
      hint=${isCreator ? x(on ? 'hintOn' : 'hintOff') : x('hintAdmin')} onChange=${change}>${x('label')}<//>`;
}

/** The four counts of one person, as the figure strip draws them. */
export const countItems = (s) => [
  { key: 'made', n: (s.produced ?? 0) + (s.refined ?? 0), label: x('made') },
  { key: 'corrected', n: s.corrected ?? 0, label: x('corrected') },
  { key: 'rejected', n: s.rejected ?? 0, label: x('rejected') },
  { key: 'used', n: s.used ?? 0, label: x('used') },
];

/**
 * What every member reads on the organism's page while the creators see the report per member: that
 * it is on, and their own numbers for the last 30 days (`value_per_member` of GET /v1/organisms/:id).
 */
export function PerMemberNotice({ info }) {
  if (!info?.on) return null;
  return html`
    <${Stack} gap="small">
      <${Note} kind="lead">${x('notice')}<//>
      <${FigureStrip} flush items=${countItems(info.yours || {})} />
      <${Note}>${x('yoursWindow')}<//>
    <//>`;
}
