/**
 * @file decide-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's own controls for the decision model (TARGET-080, AIMEAT.decide), and what
 *   it has decided for them.
 *
 *   WHY THIS PAGE EXISTS WHEN CHAT IS THE ROAD IN. Two settings here cannot be done from a chat, on
 *   purpose: the owner's own TypeSafe key (a key typed into a chat is a key in a transcript) and the
 *   data policy (the switch the scrubber obeys: an agent that could change it could turn off the
 *   cleaning of its own traffic). Everything else, asking and reading decisions, is on MCP.
 *
 *   IT SAYS WHO PAYS AND WHAT LEAVES. The first line is whether the model is on and whose key pays.
 *   The policy is phrased as what is let through, and every class starts unticked: silence means
 *   scrubbed.
 *
 *   AND IT SHOWS WHAT HAPPENED. The last decisions, newest first, each with what it was about, what it
 *   decided, the model version and whether a person reviewed it.
 * @structure DecideCard — the collapsible card, mounted in the profile AI tab
 * @usage import { DecideCard } from './decide-card.js'; html`<${DecideCard} />`
 * @version-history
 *   2026-09-22 -- The key field tells password managers to leave it alone again (passwordManager={false}).
 *   2026-09-22 -- Composed from the shared set: the card is the AI page's opening section, the policy
 *     switches are shared fields, a decision is a shared row with its two verdicts as actions; it no
 *     longer uses the decide-card rules in profile.css.
 *   v1.3.0 — 2026-09-20 — Every decision carries the person's own verdict: it was right, it was
 *     wrong. Nothing in the browser recorded a review before, so the register's "a human looked at
 *     it" half could only be written over MCP. The verdict already recorded stays on screen and
 *     unpressable, and the opposite stays live: that is the way back from a mis-tap, because the
 *     gate's row is gone from the open-items list the moment the first answer lands.
 *   v1.2.0 — 2026-09-20 — The decision rules section (decide-rules.js), and a recent decision says
 *     which rule made it and what the outcome was.
 *   v1.1.0 — 2026-09-19 — A key test: one tiny real call on the key that would pay.
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { reviewDecision } from '/js/services/decide.js';
import { DecideRules } from './decide-rules.js';
import { Stack, Columns, ListRow, Field, Text, Action } from '/components/poster-parts.js';
import { CardSection, StatusLine } from './ai/frame.js';

const shortTime = (iso) => String(iso ?? '').slice(0, 16).replace('T', ' ');

/** One answer as a short phrase: the option picked, a percentage, or a level. */
function answerText(a) {
  if (!a) return '';
  if (a.type === 'choice') return String(a.value);
  if (a.type === 'noul') return `${Math.round(Number(a.value) * 100)} %`;
  // A scale answer is a probability-weighted level. Levels are numbered from 0 on the wire (measured
  // against the live model; TypeSafe's pages say 1), so the nearest level's own words are shown.
  const words = a.legend && a.legend[String(Math.round(Number(a.value)))];
  return typeof words === 'string' ? words : Number(a.value).toFixed(1);
}

/** A link that means "take me to this card": `?open=decide-card` (it survives in-app navigation,
 *  which drops a fragment) or `#decide-card` on a cold load. */
function askedFor() {
  return new URLSearchParams(window.location.search).get('open') === 'decide-card' || window.location.hash === '#decide-card';
}

export function DecideCard() {
  const [collapsed, setCollapsed] = useState(() => !askedFor());
  const [settings, setSettings] = useState(null);
  const [recent, setRecent] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      apiGet('/v1/ai/decide/settings'),
      apiGet('/v1/ai/decisions?limit=10'),
    ]);
    setSettings(prev => (JSON.stringify(prev) === JSON.stringify(s?.data ?? null) ? prev : (s?.data ?? null)));
    setRecent(prev => (JSON.stringify(prev) === JSON.stringify(d?.data ?? null) ? prev : (d?.data ?? null)));
  }, []);

  // Arriving by that link lands ON the card, open, not at the top of a long tab with it shut.
  // Once, when the content first arrives: a later save must not pull the page back up.
  // The answer is taken at mount: the profile view rewrites the address to `?tab=ai` right after.
  const wanted = useRef(!collapsed);
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !settings || !wanted.current) return;
    landed.current = true;
    document.getElementById('decide-card')?.scrollIntoView({ block: 'start' });
  }, [settings]);

  useEffect(() => {
    if (!collapsed && !settings) load().catch(err => setMsg({ text: err?.message || t('decideCard.loadFailed'), error: true }));
  }, [collapsed, settings, load]);

  useEffect(() => {
    const handler = () => { if (!collapsed) load().catch(err => swallowed('decide-card: live reload', err)); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [collapsed, load]);

  // A success message is kept as its locale KEY, not its text, so it follows a language switch.
  const save = async (body, okKey) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiPut('/v1/ai/decide/settings', body);
      setSettings(r?.data ?? settings);
      setMsg({ key: okKey, error: false });
    } catch (err) {
      setMsg({ text: err?.message || t('decideCard.saveFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    await save({ api_key: keyInput.trim() }, 'decideCard.keySaved');
    setKeyInput('');
  };

  const removeKey = async () => {
    setBusy(true);
    try {
      const r = await apiDelete('/v1/ai/decide/settings/key');
      setSettings(r?.data ?? settings);
      setMsg({ key: 'decideCard.keyRemoved', error: false });
    } catch (err) {
      setMsg({ text: err?.message || t('decideCard.saveFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  // One tiny real call on the key that would pay (own, else the server's). A refused key comes back
  // as ok:false with words, not as an HTTP error, so it is shown the same way a success is.
  const testKey = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const r = await apiPost('/v1/ai/decide/settings/test', {});
      const d = r?.data ?? {};
      setMsg(d.ok
        ? { key: 'decideCard.keyTestOk', params: { model: d.model || '' }, error: false }
        : { text: d.message || t('decideCard.keyTestFailed'), error: true });
    } catch (err) {
      setMsg({ text: err?.message || t('decideCard.keyTestFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  // The person's verdict on one decision. The node records it and, when the gate put that decision
  // on their open items, takes that row off in the same call.
  const review = async (id, outcome) => {
    setBusy('review');
    setMsg(null);
    try {
      await reviewDecision(id, outcome);
      setMsg({ key: `decideCard.review.saved.${outcome}`, error: false });
      await load();
    } catch (err) {
      setMsg({ text: err?.message || t('decideCard.saveFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const toggleClass = (cls) => {
    const allow = new Set(settings.policy.allow);
    if (allow.has(cls)) allow.delete(cls); else allow.add(cls);
    return save({ policy: { allow: [...allow] } }, 'decideCard.policySaved');
  };

  const payer = !settings ? '' : settings.has_own_key ? t('decideCard.payerOwn')
    : settings.node_key_available ? t('decideCard.payerNode') : t('decideCard.payerNone');

  // Each policy line is an on/off switch that is stored the moment it is pressed.
  const check = (label, checked, onChange) => html`<${Action} kind="choice" semantics="switch" title=${label} selected=${!!checked} disabled=${!!busy} onClick=${onChange} />`;

  return html`
    <${CardSection} id="decide-card" title=${t('decideCard.title')} description=${t('decideCard.desc')}
      open=${!collapsed} onToggle=${() => setCollapsed(c => !c)}>
      ${msg && html`<${StatusLine} error=${msg.error}>${msg.key ? t(msg.key, msg.params) : msg.text}<//>`}
      ${!settings && !msg && html`<${Text} tone="muted">${t('decideCard.loading')}<//>`}

      ${settings && html`
        <${Text}>
          ${settings.enabled ? t('decideCard.statusOn', { model: settings.model }) : t('decideCard.statusOff')}
          ${' '}${payer}
        <//>

        <${Text} kind="heading" size="small">${t('decideCard.keyTitle')}<//>
        <${Text} tone="muted">${settings.has_own_key ? t('decideCard.keySet') : t('decideCard.keyNotSet')}<//>
        <${Stack} direction="horizontal" align="end">
          <${Field} type="password" autoComplete="off" passwordManager=${false} ariaLabel=${t('decideCard.keyLabel')} placeholder=${t('decideCard.keyLabel')}
            value=${keyInput} onInput=${e => setKeyInput(e.currentTarget.value)} disabled=${!!busy} />
          <${Action} onClick=${saveKey} disabled=${!!busy || !keyInput.trim()}>${t('decideCard.keySave')}<//>
        <//>
        <${Stack} direction="wrap" align="center">
          ${(settings.has_own_key || settings.node_key_available) && html`
            <${Action} onClick=${testKey} disabled=${!!busy}>${busy === 'test' ? t('decideCard.keyTesting') : t('decideCard.keyTest')}<//>`}
          ${settings.has_own_key && html`<${Action} tone="danger" onClick=${removeKey} disabled=${!!busy}>${t('decideCard.keyRemove')}<//>`}
        <//>

        <${Text} kind="heading" size="small">${t('decideCard.policyTitle')}<//>
        <${Text} tone="muted">${t('decideCard.policyDesc')}<//>
        <${Columns} collapse="640" density="compact">
          ${settings.pii_classes.map(cls => html`<div key=${cls}>${check(t(`decideCard.class.${cls}`), settings.policy.allow.includes(cls), () => toggleClass(cls))}</div>`)}
        <//>
        ${check(t('decideCard.storeState'), settings.policy.storeState, () => save({ policy: { store_state: !settings.policy.storeState } }, 'decideCard.policySaved'))}
        ${check(t('decideCard.publicOptOut'), settings.policy.allowPublicOptOut, () => save({ policy: { allow_public_opt_out: !settings.policy.allowPublicOptOut } }, 'decideCard.policySaved'))}
      `}

      ${settings && html`<${DecideRules} available=${!!settings.available} />`}

      ${recent && html`
        <${Text} kind="heading" size="small">${t('decideCard.recentTitle')}<//>
        ${recent.decisions.length === 0
          ? html`<${Text} tone="muted">${t('decideCard.recentNone')}<//>`
          : html`<div>
              ${recent.decisions.map(d => html`
                <${ListRow} key=${d.id} density="compact" name=${d.record.gates || d.subject || t('decideCard.noSubject')}
                  detailKind="text" detail=${Object.entries(d.record.answers).slice(0, 3).map(([id, a]) => `${id}: ${answerText(a)}`).join(' · ')}
                  actions=${html`
                    ${/* The person's own verdict, on EVERY decision, answered or not. The gate's
                         row on the open-items list carries the same two buttons, but a decision
                         made with the gate off never passes through that list, and it is just as
                         much theirs to judge. This is the only place the register's "a human
                         looked at it" half can be written from a browser — and the only way back
                         from a mis-tap, which is why the answered one stays on screen, greyed and
                         unpressable, with the opposite still live. */''}
                    <${Action} tone="success"
                      disabled=${!!busy || d.record.review?.outcome === 'confirmed'}
                      title=${d.record.review?.outcome === 'confirmed' ? t('decideCard.review.already') : ''}
                      onClick=${() => review(d.id, 'confirmed')}>${t('decideCard.review.confirmAction')}<//>
                    <${Action} tone="danger"
                      disabled=${!!busy || d.record.review?.outcome === 'overridden'}
                      title=${d.record.review?.outcome === 'overridden' ? t('decideCard.review.already') : ''}
                      onClick=${() => review(d.id, 'overridden')}>${t('decideCard.review.overrideAction')}<//>`}>
                  <${Text} kind="mono" tone="muted">
                    ${d.rule ? `${d.rule} · ${t(`decideRules.outcome.${d.outcome}`)} · ` : ''}${shortTime(d.createdAt)} · ${d.model}${d.record.cachedFrom ? ` · ${t('decideCard.cached')}` : ''}
                    ${d.record.review ? ` · ${t(`decideCard.review.${d.record.review.outcome}`)}` : ''}
                  <//>
                <//>`)}
            </div>`}
        <${Text} kind="caption" tone="muted">${t('decideCard.recentTotal', { total: String(recent.total) })}<//>
      `}
    <//>`;
}

export default DecideCard;
