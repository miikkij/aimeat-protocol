/**
 * @file public/views/appcat/dialogs/settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's Settings dialog (features F119, F135): "Appearance" with Theme (Dark / Light,
 *   applied on Save) and Language (applied at once, on the change), and "AIMEAT Server" with the Server
 *   URL, read-only, always the address that served the page. Cancel and Save.
 *   appcat keeps nothing in the browser's own storage (Jouni: "selaimen omaa tallennusta ei pitäisi
 *   olla"), so the theme is the site's own (js/theme.js setTheme, the same choice the site's look
 *   picker makes) and the language is the site's own language switch (js/i18n.js switchLocale). The
 *   old page's copy of both in localStorage.appLauncherConfig is gone with it, and so is its
 *   preference sync (F353): that wrote the choice into a new anonymous principal's memory on every
 *   save, which nothing could read back, and its only reader was the old page's own config.
 *   The language list has the site's three languages; the old page had English and Suomi only.
 * @structure SettingsDialog({ close })
 * @usage openDialog('settings')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the two parts are the dialog's own (Section part), each label at the
 *     left of its field with a rule under the row (Fields beside), as the old page drew them.
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { Fields } from '/components/Field.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Action, Loud } from '/components/Action.js';
import { getTheme, setTheme } from '/js/theme.js';
import { switchLocale, onLocaleChange } from '/js/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { x, lang } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** The languages by their own names, as a language list shows them. */
const LANGUAGES = [['en', 'English'], ['fi', 'Suomi'], ['es', 'Español']];

export default function SettingsDialog({ close }) {
  const [theme, setThemeChoice] = useState(getTheme());
  const [, tick] = useState(0);
  // The words follow a language change made here, at once, as the old page's did.
  useEffect(() => onLocaleChange(() => tick((n) => n + 1)), []);

  const save = () => {
    setTheme(theme === 'dark' ? 'dark' : 'light');
    close();
  };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return html`<${Dialog} title=${x('settings.title')} size="md" onClose=${close}
    footer=${html`
      <${Action} onClick=${close}>${x('common.cancel')}<//>
      <${Loud} control onClick=${save}>${x('common.save')}<//>`}>
    <${Section} part title=${x('settings.appearance')}>
      <${Fields} plain beside>
        <${Select} label=${x('settings.theme')} value=${theme} onChange=${setThemeChoice}
          options=${[['dark', x('theme.dark')], ['light', x('theme.light')]]} />
        <${Select} label=${x('settings.language')} value=${lang()}
          onChange=${(v) => { switchLocale(v); }} options=${LANGUAGES} />
      <//>
    <//>
    <${Section} part title=${x('settings.server')}>
      <${Fields} plain beside>
        <${TextField} type="url" readOnly label=${x('settings.serverUrl')} value=${origin}
          title=${x('settings.serverUrlHint')} autoComplete="off" />
      <//>
    <//>
  <//>`;
}
