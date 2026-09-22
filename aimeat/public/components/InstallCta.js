/**
 * @file InstallCta.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own "install this as an app" suggestion — the browser never makes one.
 *
 *   Rendered where a person already is (Home, the chat): a small dismissible card offering the
 *   browser's real install dialog through the offer held by /js/install-prompt.js. On iOS, where
 *   no such offer exists, the card explains Share → Add to Home Screen instead. Where there is
 *   neither an offer nor an iOS path (desktop Firefox), it renders nothing: instructions that end
 *   nowhere are worse than silence.
 * @structure InstallCta({ compact }) — compact drops the body line for tight surfaces (chat).
 * @usage import { InstallCta } from '/components/InstallCta.js';  html`<${InstallCta} />`
 * @version-history
 *   2026-09-13: Shared surfaces and actions own the install offer.
 *   v1.0.0 — 2026-08-16 — Initial: prompt-backed card + iOS hint + per-browser dismissal.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Surface, Stack, Text, Action } from '/components/poster-parts.js';
import { t } from '/js/i18n.js';
import {
    installAvailable, isInstalled, isIos, promptInstall, onInstallChange,
    dismissInstall, installDismissed,
} from '/js/install-prompt.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function InstallCta({ compact = false }) {
    const [, bump] = useState(0);
    useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);

    if (isInstalled() || installDismissed()) return null;
    const offer = installAvailable();
    const ios = isIos();
    if (!offer && !ios) return null;

    const install = async () => {
        await promptInstall();
        // Declining the browser dialog counts as an answer too: the card stops asking either way.
        dismissInstall();
    };

    return html`<${Surface} kind="aside" role="note"><${Stack} density=${compact ? 'compact' : 'normal'}>
      <${Text} kind="heading">${tr('install.title','Put AIMEAT.IO behind its own button')}<//>
      ${!compact && html`<${Text}>${offer
        ? tr('install.body','Installed, it opens in its own window, shows unread counts on its icon, and takes shares straight into your chat.')
        : tr('install.iosBody','On iPhone and iPad: open the Share menu and choose "Add to Home Screen".')}<//>`}
      ${compact && !offer && html`<${Text}>${tr('install.iosBody','On iPhone and iPad: open the Share menu and choose "Add to Home Screen".')}<//>`}
      <${Stack} direction="wrap">
        ${offer && html`<${Action} kind="primary" onClick=${install}>${tr('install.install','Install')}<//>`}
        <${Action} onClick=${() => dismissInstall()}>${tr('install.notNow','Not now')}<//>
      <//>
    <//><//>`;
}
