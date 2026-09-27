/**
 * @file public/views/appcat/sections/promote.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Promote section of the app detail view, for an own published app: a short pitch
 *   in English and Finnish that shows this app on the owner's public profile, the translate buttons
 *   (the owner's own AI through POST /v1/ai/complete), "Save promotion" and "Stop promoting", and the
 *   "Promoted" mark on the headline while it is on. The promotions are ONE public memory record per
 *   owner, `app-catalog.promoted` = { version: 1, updatedAt, items: [{ ref: "owner/filename", text: { en, fi } }] },
 *   read with GET /v1/memory/app-catalog.promoted?soft=1 and written whole with POST /v1/memory
 *   (visibility public). The portfolio page reads it, so its shape is kept exactly as the old
 *   catalogue's js/promote.js wrote it; clearing both texts takes the app out of the list.
 * @structure meta (with doors: the Promoted mark) · PromoteSection({ d }) · loadPromoted() ·
 *   setPromotion(ref, text)
 * @usage loaded by the detail view: import('./sections/promote.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the "Promoted" mark stands on
 *     the headline's slab (meta.doors), as the old h3's badge did; the chapter's lead, form, door rows
 *     and the two status lines that keep their room while empty (Note lead/report `chapter`, Fields
 *     `plain chapter spaced`, Actions `chapter`), so the section spaces as the old one.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's js/promote.js
 *     and detail.js buildPromoteSection / detailPromoteSave / detailTranslateDesc.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { apiGet, apiPost } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Fields } from '/components/Field.js';
import { TextArea } from '/components/TextField.js';
import { x } from '/views/appcat/i18n.js';
import { translateText } from '/views/appcat/ai-calls.js';

const html = htm.bind(h);

const KEY = 'app-catalog.promoted';
/** ref → { en, fi }; null until read. */
let promoted = null;
let reading = null;
/** The marks on the headline listen here, so a save turns the mark on or off at once. */
const listeners = new Set();
function emit() { for (const fn of listeners) fn(); }

/** Read the owner's promotions (signed out: none). Never throws; a missing record is "none yet". */
export function loadPromoted() {
  if (!getSession()?.jwt) { promoted = {}; return Promise.resolve(promoted); }
  if (reading) return reading;
  reading = apiGet('/v1/memory/' + encodeURIComponent(KEY) + '?soft=1')
    .then((res) => {
      const items = Array.isArray(res?.data?.value?.items) ? res.data.value.items : [];
      const map = {};
      for (const it of items) {
        if (it && typeof it.ref === 'string' && it.text && typeof it.text === 'object') map[it.ref] = { en: it.text.en || '', fi: it.text.fi || '' };
      }
      promoted = map;
      emit();
      return promoted;
    })
    .catch((e) => { console.warn('appcat: the promotions could not be read', e); return promoted || {}; })
    .finally(() => { reading = null; });
  return reading;
}

/**
 * Set (or, with both texts blank, clear) one app's promotion and write the whole public record.
 * Resolves to whether the app is promoted now.
 */
export async function setPromotion(ref, text) {
  // The record is written whole, so the other apps' promotions must be in hand first.
  if (promoted === null) await loadPromoted();
  const en = text && text.en ? String(text.en).trim() : '';
  const fi = text && text.fi ? String(text.fi).trim() : '';
  const next = { ...(promoted || {}) };
  if (!en && !fi) delete next[ref]; else next[ref] = { en, fi };
  promoted = next;
  emit();
  if (getSession()?.jwt) {
    const items = Object.keys(next).map((r) => ({ ref: r, text: next[r] || {} }));
    try {
      await apiPost('/v1/memory', { key: KEY, value: { version: 1, updatedAt: new Date().toISOString(), items }, visibility: 'public' });
    } catch (e) {
      // Best effort, as the old page: the status line still says what was asked for.
      console.warn('appcat: the promotions could not be saved', e);
    }
  }
  return !!(en || fi);
}

/** The "Promoted" mark on the headline's slab while the app is promoted (the old h3's badge). */
function PromotedMark({ appRef }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const cur = (promoted && promoted[appRef]) || {};
  return cur.en || cur.fi ? html`<${Mark} tone="on">${x('promote.on')}<//>` : null;
}

export const meta = {
  id: 'promote', title: 'promote.title', show: (d) => !!d.isOwnPublished,
  doors: (d) => html`<${PromotedMark} appRef=${d.ref} />`,
};

/** A status line that keeps its room while empty: grey while working, green when done, coral when refused. */
function Status({ s }) {
  const tone = s && s.tone === 'ok' ? 'ok' : (s && s.tone === 'err' ? 'refused' : 'busy');
  return html`<${Note} kind="report" chapter keep tone=${tone}>${(s && s.text) || ''}<//>`;
}

export default function PromoteSection({ d }) {
  const [map, setMap] = useState(promoted);
  const [text, setText] = useState(() => ({ en: promoted?.[d.ref]?.en || '', fi: promoted?.[d.ref]?.fi || '' }));
  const [trStatus, setTrStatus] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let live = true;
    loadPromoted().then((m) => {
      if (!live) return;
      setMap(m);
      setText({ en: m[d.ref]?.en || '', fi: m[d.ref]?.fi || '' });
    });
    return () => { live = false; };
  }, [d.ref]);

  const cur = (map && map[d.ref]) || {};
  const on = !!(cur.en || cur.fi);

  const runTranslate = async (src, dst) => {
    const words = (text[src] || '').trim();
    if (!words) { setTrStatus({ text: x('detail.trNeedSource') }); return; }
    if (!getSession()?.jwt) { setTrStatus({ text: x('detail.aiLoginNeeded') }); return; }
    setTrStatus({ text: x('detail.translating') });
    try {
      const out = await translateText(words, src, dst);
      if (!out) { setTrStatus({ text: '✘ ' + x('detail.trEmpty'), tone: 'err' }); return; }
      setText((t) => ({ ...t, [dst]: out }));
      setTrStatus({ text: '✔ ' + x('detail.trDone'), tone: 'ok' });
    } catch (e) {
      setTrStatus({ text: '✘ ' + (e.message || x('promote.translateFailed')), tone: 'err' });
    }
  };

  const save = async (next) => {
    setStatus({ text: x('promote.saving') });
    const nowOn = await setPromotion(d.ref, next);
    setMap(promoted);
    setText({ en: promoted?.[d.ref]?.en || '', fi: promoted?.[d.ref]?.fi || '' });
    // The old page drew the whole detail again after a save, which emptied the translate line.
    setTrStatus(null);
    setStatus({ text: '✔ ' + (nowOn ? x('promote.saved') : x('promote.removed')), tone: 'ok' });
  };

  return html`
    <${Note} kind="lead" chapter>${x('promote.hint')}<//>
    <${Fields} plain chapter spaced>
      <${TextArea} label=${x('promote.en')} rows=${2} maxLength=${500} value=${text.en} onInput=${(v) => setText((t) => ({ ...t, en: v }))} />
      <${TextArea} label=${x('promote.fi')} rows=${2} maxLength=${500} value=${text.fi} onInput=${(v) => setText((t) => ({ ...t, fi: v }))} />
    <//>
    <${Actions} chapter>
      <${Action} small onClick=${() => runTranslate('en', 'fi')}>${x('detail.translateEnFi')}<//>
      <${Action} small onClick=${() => runTranslate('fi', 'en')}>${x('detail.translateFiEn')}<//>
    <//>
    <${Status} s=${trStatus} />
    <${Actions} chapter>
      <${Loud} control onClick=${() => save(text)}>${x('promote.save')}<//>
      ${on ? html`<${Action} small onClick=${() => save({ en: '', fi: '' })}>${x('promote.remove')}<//>` : null}
    <//>
    <${Status} s=${status} />`;
}
