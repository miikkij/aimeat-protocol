/**
 * @file StartPageSetting.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which page a sign-in lands on: the home, the chat, or settings and controls. ONE
 *   component, mounted in the home's own settings and at the foot of the settings-and-controls
 *   overview, so the wording and the behaviour cannot drift apart.
 *
 *   It replaces the switch that used to move a person between "the new home" and "the old
 *   profile". That control was a navigation link and an account setting in one button, so going to
 *   look at the profile changed where you landed the next morning, and the header carried no way
 *   back. The two pages are layers of one thing now (the home in front, settings and controls
 *   behind it) and every door between them is a plain link. What is left to choose is only this:
 *   where the site's front door and the sign-in put you.
 *
 *   Choosing is stored on the ACCOUNT, so it follows to another device, and it changes the page
 *   you are on not at all. The chat is offered only where this node has one.
 * @structure StartPageSetting()
 * @usage
 *   import { StartPageSetting } from '/components/StartPageSetting.js';
 *   html`<${StartPageSetting} />`
 * @version-history
 *   2026-09-13: Shared fields and choices own the start-page selector.
 *   v1.0.0 — 2026-08-27 — Initial, in place of HomeUiSwitch.js.
 */
import { h } from 'preact';
import { Stack, Text, Action } from '/components/poster-parts.js';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const OPTIONS = [
  { id: 'home', key: 'home.startPage.home', fallback: 'Home' },
  { id: 'chat', key: 'home.startPage.chat', fallback: 'Chat' },
  { id: 'profile', key: 'home.startPage.controls', fallback: 'Settings & controls' },
];

export function StartPageSetting() {
  const [ui, setUi] = useState(null);           // 'home' | 'chat' | 'profile'
  const [chatHere, setChatHere] = useState(true); // whether this node has a chat to land in
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/v1/home/ui-track')
      .then(r => { if (alive) setUi(r?.data?.ui ?? 'home'); })
      .catch(e => { swallowed('StartPageSetting: ui-track', e); if (alive) setUi('home'); });
    apiGet('/v1/chat/status')
      .then(r => { if (alive && r?.data && r.data.enabled === false) setChatHere(false); })
      .catch(e => swallowed('StartPageSetting: chat status', e));
    return () => { alive = false; };
  }, []);

  const choose = useCallback(async (next) => {
    if (next === ui || busy) return;
    setBusy(true);
    try {
      await api('/v1/home/ui-track', { method: 'PUT', body: JSON.stringify({ ui: next }) });
      setUi(next);
    } catch (e) {
      swallowed('StartPageSetting: choose', e);
    } finally {
      setBusy(false);
    }
  }, [ui, busy]);

  // Render nothing until the choice is known: a control that flips its own state a moment after
  // you read it is worse than one that arrives a moment late.
  if (!ui) return null;

  const options = OPTIONS.filter(o => o.id !== 'chat' || chatHere || ui === 'chat');
  return html`<${Stack}>
    <${Text} kind="label">${tr('home.startPage.title','Start page')}<//>
    <${Text} tone="muted">${tr('home.startPage.hint','Where you land when you sign in or arrive at the front page.')}<//>
    <${Stack} direction="wrap" role="radiogroup" label=${tr('home.startPage.title','Start page')}>
      ${options.map(o=>html`<${Action} key=${o.id} kind="tab" semantics="radio" selected=${ui===o.id} disabled=${busy} onClick=${()=>choose(o.id)}>
        ${tr(o.key,o.fallback)}<//>`)}
    <//><//>`;
}
