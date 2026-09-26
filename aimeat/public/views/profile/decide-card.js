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
 *   v1.17.0 — 2026-09-26 — Every part is a kit component (Touch keeps every control 44px, FoldSection, TextField, Check in BoxList and BoxLine rows, the verdict as the row's doors, SubHeading, Note, Action, Layout): the card writes no class; the anchor #decide-card and ?open=decide-card are unchanged (page group G8).
 *   v1.16.0 — 2026-09-26 — A decision's line beside its subject is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.15.0 — 2026-09-26 — The decision classes and policies beside their check boxes are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.14.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.13.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.10.0 — 2026-09-25 — A section that is one row until it is opened is the FoldSection (the folded row with its lead): the AI tab's decide, transparency and compliance cards and the classic AI settings; their own heads, chevrons and body rules go (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-25 — The last lines that say nothing is there are the quiet sentence (.poster-quiet); the ecosystem's empty frame goes, its second line is the Hint (Jouni's decision "Empty line", a unification).
 *   v1.8.0 — 2026-09-25 — The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.1 — 2026-09-23 — The header speaks of the chosen provider: its name and model, and for a
 *     local one that no key is needed, instead of the key fields alone.
 *   v1.4.0 — 2026-09-23 — Decision providers: the providers part (decide-providers.js) between the
 *     data policy and the rules, and each recent decision names the provider that answered.
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
import { DecideProviders, providerTitle } from './decide-providers.js';
import { Hint } from '/components/Hint.js';
import { FoldSection } from '/components/FoldSection.js';
import { BoxList, BoxLine } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { Space, Touch } from '/components/Layout.js';

/** A small heading inside the card, with main's space above it. */
const sub = (words) => html`<${Space} above="large"><${SubHeading} level=${4}>${words}<//><//>`;

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

  // The header speaks of the provider the owner's decisions go to, not of the key fields alone: with
  // a local default the key fields are empty and the model answers all the same.
  const chosen = (settings?.providers?.providers || []).find(p => p.id === settings.providers.default) || null;
  const payer = !settings ? ''
    : chosen && chosen.kind === 'local' ? t('decideCard.payerLocal', { provider: chosen.title })
      : chosen && chosen.source === 'owner' ? (chosen.auth?.has_key || chosen.auth?.type === 'none'
        ? t('decideCard.payerOwnProvider', { provider: chosen.title }) : t('decideCard.payerOwnProviderNoKey', { provider: chosen.title }))
        : settings.has_own_key ? t('decideCard.payerOwn')
          : settings.node_key_available ? t('decideCard.payerNode')
            : settings.available ? '' : t('decideCard.payerNone');
  const statusLine = !settings ? '' : !settings.enabled ? t('decideCard.statusOff')
    : chosen ? t('decideCard.statusOnProvider', { provider: chosen.title, model: chosen.model })
      : t('decideCard.statusOn', { model: settings.model });

  // Touch: every control in this card is a thumb's target, as main's .pf-aitr made it.
  return html`
    <${Touch} id="decide-card">
      <${FoldSection} num="" title=${t('decideCard.title')} lead=${t('decideCard.desc')} open=${!collapsed} onToggle=${() => setCollapsed(c => !c)}>
          ${msg && html`<${Note} kind="message" error=${msg.error} role="status">${msg.key ? t(msg.key, msg.params) : msg.text}<//>`}
          ${!settings && !msg && html`<${Note} kind="loading">${t('decideCard.loading')}<//>`}

          ${settings && html`
            <${Hint}>
              ${statusLine}
              ${payer ? ` ${payer}` : ''}
            <//>

            ${sub(t('decideCard.keyTitle'))}
            <${Hint}>${settings.has_own_key ? t('decideCard.keySet') : t('decideCard.keyNotSet')}<//>
            <${TextField} box unmanaged ariaLabel=${t('decideCard.keyLabel')} placeholder=${t('decideCard.keyLabel')}
              value=${keyInput} onInput=${setKeyInput} disabled=${!!busy}
              actions=${html`<${Action} small onClick=${saveKey} disabled=${!!busy || !keyInput.trim()}>${t('decideCard.keySave')}<//>`} />
            <${Space} above="small"><${Actions}>
              ${(settings.has_own_key || settings.node_key_available) && html`
                <${Action} small soft onClick=${testKey} disabled=${!!busy}>
                  ${busy === 'test' ? t('decideCard.keyTesting') : t('decideCard.keyTest')}
                <//>`}
              ${settings.has_own_key && html`
                <${Action} small soft onClick=${removeKey} disabled=${!!busy}>
                  ${t('decideCard.keyRemove')}
                <//>`}
            <//><//>

            ${sub(t('decideCard.policyTitle'))}
            <${Hint}>${t('decideCard.policyDesc')}<//>
            <${BoxList}>
              ${settings.pii_classes.map(cls => html`
                <${BoxLine} key=${cls}>
                  <${Check} checked=${settings.policy.allow.includes(cls)} disabled=${!!busy} onChange=${() => toggleClass(cls)}>${t(`decideCard.class.${cls}`)}<//>
                <//>`)}
              <${BoxLine} key="storeState">
                <${Check} checked=${settings.policy.storeState} disabled=${!!busy}
                  onChange=${() => save({ policy: { store_state: !settings.policy.storeState } }, 'decideCard.policySaved')}>${t('decideCard.storeState')}<//>
              <//>
              <${BoxLine} key="publicOptOut">
                <${Check} checked=${settings.policy.allowPublicOptOut} disabled=${!!busy}
                  onChange=${() => save({ policy: { allow_public_opt_out: !settings.policy.allowPublicOptOut } }, 'decideCard.policySaved')}>${t('decideCard.publicOptOut')}<//>
              <//>
            <//>
          `}

          ${settings && settings.providers && html`<${DecideProviders} view=${settings.providers} onSaved=${load} />`}

          ${settings && html`<${DecideRules} available=${!!settings.available} providers=${settings.providers || null} />`}

          ${recent && html`
            ${sub(t('decideCard.recentTitle'))}
            ${recent.decisions.length === 0
              ? html`<${Note} kind="quiet">${t('decideCard.recentNone')}<//>`
              : html`<${BoxList}>
                  ${recent.decisions.map(d => html`<${BoxLine} key=${d.id}
                      name=${d.record.gates || d.subject || t('decideCard.noSubject')}
                      meta=${[decisionAnswers(d), decisionLine(d, settings)]}
                      doors=${verdictDoors(d, busy, review)} />`)}
                <//>`}
            <${Hint}>${t('decideCard.recentTotal', { total: String(recent.total) })}<//>
          `}
      <//>
    <//>`;
}

/** A decision's first three answers, as "question: answer". */
function decisionAnswers(d) {
  return Object.entries(d.record.answers).slice(0, 3).map(([id, a]) => `${id}: ${answerText(a)}`).join(' · ');
}

/** A decision's rule and outcome, when, where it ran and on what, and the person's verdict. */
function decisionLine(d, settings) {
  return `${d.rule ? `${d.rule} · ${t(`decideRules.outcome.${d.outcome}`)} · ` : ''}${shortTime(d.createdAt)} · ${d.provider ? `${providerTitle(settings?.providers, d.provider)} · ` : ''}${d.model}${d.record.cachedFrom ? ` · ${t('decideCard.cached')}` : ''}${d.record.review ? ` · ${t(`decideCard.review.${d.record.review.outcome}`)}` : ''}`;
}

/**
 * The person's own verdict, on EVERY decision, answered or not. The gate's row on the open-items
 * list carries the same two buttons, but a decision made with the gate off never passes through that
 * list, and it is just as much theirs to judge. This is the only place the register's "a human
 * looked at it" half can be written from a browser — and the only way back from a mis-tap, which is
 * why the answered one stays on screen, greyed and unpressable, with the opposite still live.
 */
function verdictDoors(d, busy, review) {
  const done = d.record.review?.outcome;
  return html`
    <${Action} small disabled=${!!busy || done === 'confirmed'} title=${done === 'confirmed' ? t('decideCard.review.already') : ''}
      onClick=${() => review(d.id, 'confirmed')}>${t('decideCard.review.confirmAction')}<//>
    <${Action} small disabled=${!!busy || done === 'overridden'} title=${done === 'overridden' ? t('decideCard.review.already') : ''}
      onClick=${() => review(d.id, 'overridden')}>${t('decideCard.review.overrideAction')}<//>`;
}

export default DecideCard;
