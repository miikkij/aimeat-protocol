/**
 * @file views/profile/agents/allow-always-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Allow always, for all my AIs": the permissions every one of the person's AIs holds
 *   without the person answering each time (GET and PUT /v1/ai-standing, services/ai-standing/).
 *   Mounted as a section of the Agents page. A permission notice and an agent's publish request link
 *   here with `section=allow-always&word=<words>`: the section opens scrolled into view with those
 *   words picked out, so one more tick and Save answers "always" (Jouni, 2026-11-20).
 *
 *   What the page shows: each permission in plain words, ticked when it is on, with who set it and
 *   when; the money and the delete permissions only when the node lets them stand, otherwise as a
 *   line that says the node's operator decides. Every act an AI does on one of these is written to the
 *   person's feed, and the section says so before Save.
 * @structure AllowAlwaysSection({ showToast })
 * @usage html`<${AllowAlwaysSection} showToast=${showToast} />`
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn, getLocale, onLocaleChange } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { date } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { useLoadState, LoadFailed } from '/js/load-state.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { HelpLabel } from '/components/HelpTip.js';
import { Note } from '/components/Note.js';
import { Check } from '/components/Check.js';
import { Fields, FormActions } from '/components/Field.js';
import { Loud } from '/components/Action.js';
import { SubHeading } from '/components/SubHeading.js';
import { scrollToSection } from '/components/Rail.js';

const at = (iso) => date(iso);

/** The page's query: the words a notice asked to pick out (`?word=a,b`) and whether it opened this section. */
function fromUrl() {
  const q = new URLSearchParams(location.search);
  return {
    words: (q.get('word') || '').split(',').map((w) => w.trim()).filter(Boolean),
    section: q.get('section') === 'allow-always',
  };
}

export function AllowAlwaysSection({ showToast }) {
  const [view, setView] = useState(null);
  const [picked, setPicked] = useState(null);   // Set of words ticked on the form, null until loaded
  const [saving, setSaving] = useState(false);
  const load = useLoadState(false);
  const { ok: loadOk, fail: loadFail } = load;
  const query = useMemo(fromUrl, []);
  const asked = query.words;

  // keepPicked: a language switch asks only for the names again, and what the person ticked and has
  // not saved yet stays ticked.
  const read = useCallback(async ({ keepPicked = false } = {}) => {
    try {
      const resp = await apiGet(`/v1/ai-standing?lang=${encodeURIComponent(getLocale())}`);
      const v = resp?.data ?? null;
      setView(v);
      // A word a notice named is ticked for the person, ready for Save; nothing is saved until they press it.
      const on = new Set((v?.words ?? []).filter((w) => w.on).map((w) => w.scope));
      for (const w of asked) if ((v?.words ?? []).some((x) => x.scope === w && x.allowed)) on.add(w);
      setPicked((cur) => (keepPicked && cur ? cur : on));
      loadOk();
    } catch (err) {
      swallowed('allow-always: read', err);
      loadFail(err);
    }
  }, [asked, loadOk, loadFail]);

  useEffect(() => { read(); }, [read]);
  // The permission names come in the page's language from the server: a language switch asks again.
  useEffect(() => onLocaleChange(() => { read({ keepPicked: true }); }), [read]);
  // Opened from a notice (section=allow-always): the section comes into view once it has its words.
  const fromNotice = query.section;
  useEffect(() => { if (fromNotice && view) requestAnimationFrame(() => scrollToSection('agp-always')); }, [fromNotice, !!view]);   // eslint-disable-line react-hooks/exhaustive-deps -- once, when the words arrive
  // Any agent change rides the 'agents' domain, so a live update keeps what the person ticked too.
  useEffect(() => onLiveUpdate(['agents'], () => { if (!saving) read({ keepPicked: true }); }), [read, saving]);

  const toggle = (scope, on) => setPicked((cur) => {
    const next = new Set(cur ?? []);
    if (on) next.add(scope); else next.delete(scope);
    return next;
  });

  const save = useCallback(async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const resp = await apiPut(`/v1/ai-standing?lang=${encodeURIComponent(getLocale())}`, { scopes: [...picked] });
      setView(resp?.data ?? view);
      showToast(tn('profile.agents.always.saved', resp?.data?.agents_changed ?? 0));
    } catch (err) {
      showToast(err?.message || t('profile.agents.always.saveError'), true);
    } finally {
      setSaving(false);
    }
  }, [picked, view, showToast]);

  if (load.failed) return html`<${LoadFailed} onRetry=${() => read()} />`;
  if (!view || !picked) return html`<${Note} kind="quiet">${t('common.loading')}<//>`;
  if (!view.enabled) return html`<${Note} kind="lead">${t('profile.agents.always.off')}<//>`;

  const row = (w) => html`
    <${Check} key=${w.scope} checked=${picked.has(w.scope)} disabled=${!w.allowed && !w.on}
      onChange=${(on) => toggle(w.scope, on)}
      hint=${w.on && w.set_at ? t('profile.agents.always.setOn', { date: at(w.set_at) })
        : asked.includes(w.scope) ? t('profile.agents.always.asked') : undefined}>
      ${w.plain}
    <//>`;

  const groups = [
    ['other', t('profile.agents.always.groupOther'), null],
    ['money', t('profile.agents.always.groupMoney'), view.money_allowed ? null : t('profile.agents.always.moneyOff')],
    ['delete', t('profile.agents.always.groupDelete'), view.delete_allowed ? null : t('profile.agents.always.deleteOff')],
  ];

  return html`
    <${Note} kind="lead"><${HelpLabel} term="agents.allowAlways" label=${t('profile.agents.always.term')}>${t('profile.agents.always.term')}<//> ${t('profile.agents.always.lede')}<//>
    <${Fields}>
      ${groups.map(([cls, title, closed]) => {
        const words = view.words.filter((w) => w.class === cls);
        if (!words.length) return null;
        return html`
          <${SubHeading} level=${4}>${title}<//>
          ${closed && !words.some((w) => w.on) ? html`<${Note} kind="hint">${closed}<//>` : words.map(row)}`;
      })}
      <${Note} kind="hint">${t('profile.agents.always.logged')}<//>
      <${FormActions}>
        <${Loud} control onClick=${save} disabled=${saving}>${saving ? '...' : t('profile.agents.always.save')}<//>
      <//>
    <//>
  `;
}

export default AllowAlwaysSection;
