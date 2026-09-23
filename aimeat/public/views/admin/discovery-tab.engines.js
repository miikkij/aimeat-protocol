/**
 * @file discovery-tab.engines.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the admin Discovery page: one row per search engine — how it hears
 *   about this site, whether it has been shown the site is yours, the proof field, and the doors
 *   out to where the step is actually done.
 *
 *   This replaces a five-step list. A step is advice; a row is a fact with a field in it. Bing goes
 *   first because it is what ChatGPT and Copilot search and the only engine that listens to
 *   instant updates, and because an unverified site is the one thing on this page that only the
 *   operator can fix. The tag rows are green only when the tag is genuinely on the live front page
 *   (the parent fetches it); a DNS proof cannot be seen from here, so no tag is a neutral chip
 *   rather than a cross, and the row says so.
 *
 * @structure DiscoveryEngines({ status, served, onRecheck, onChanged }) — Bing, Google, the rest
 * @usage <${DiscoveryEngines} status=${status} served=${served} onRecheck=${checkServed} onChanged=${load} />
 * @version-history
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared component set: each engine a shared list row
 *     with its chip, its doors as text actions and its proof field in the row's body; no sheet of
 *     its own.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face). Replaces
 *     discovery-tab.steps.js.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, useToast, Toast } from './shared.js';
import { Section, Stack, Text, Action, ListRow, Field } from '/components/poster-parts.js';
import * as adminService from '/js/services/admin.js';
import { baseOf } from './discovery-tab.shared.js';

const S = (key, params) => t('dashboard.seo.' + key, params);

/** The proof field: a shared field in which the code that is already saved is the placeholder. */
function CodeField({ value, onInput, placeholder, set, label }) {
  return html`<${Field} value=${value} spellCheck=${false} autoComplete="off" passwordManager=${false}
    ariaLabel=${label} placeholder=${set ? S('engines.codeSet') : placeholder}
    onInput=${e => onInput(e.target.value)} />`;
}

/** A door out to the service the step is performed in. Opens in a new tab: the operator is mid-way through a list. */
function Out({ href, label }) {
  return html`<${Action} kind="text" href=${href} target="_blank">${label}<//>`;
}

function TagChip({ seen, checked }) {
  if (!checked) return html`<${Badge} type="muted" label=${S('engines.checking')} />`;
  return seen
    ? html`<${Badge} type="healthy" label=${S('engines.tagSeen')} />`
    : html`<${Badge} type="watch" label=${S('engines.noTagSeen')} />`;
}

export function DiscoveryEngines({ status, served, onRecheck, onChanged }) {
  const [google, setGoogle] = useState('');
  const [bing, setBing] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();

  const base = baseOf(status);
  const host = base.replace(/^https?:\/\//, '');
  const enc = encodeURIComponent(base);
  // The bare welcome page, NOT ?resource_id=<url>. Prefilling the URL drops the operator into the
  // URL-prefix form, which covers this host and nothing under it — so the application addresses,
  // which are subdomains, stay invisible to that property. The DOMAIN property is the right one.
  const GSC = 'https://search.google.com/search-console/welcome';
  const GSC_SITEMAPS = `https://search.google.com/search-console/sitemaps?resource_id=${enc}`;
  const BING = 'https://www.bing.com/webmasters/';
  const siteAt = (engine) => `https://www.${engine}.com/search?q=${encodeURIComponent('site:' + host)}`;

  const save = useCallback(async () => {
    const changes = [];
    if (google.trim()) changes.push({ path: 'seo.verification_google', value: google.trim() });
    if (bing.trim()) changes.push({ path: 'seo.verification_bing', value: bing.trim() });
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await adminService.saveConfig(changes);
      setGoogle(''); setBing('');
      showSuccess(S('engines.saved'));
      await onChanged();
      await onRecheck();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [google, bing, onChanged, onRecheck, showSuccess, showError]);

  const ix = status.indexnow;
  const keyChip = !ix.key_configured
    ? html`<${Badge} type="muted" label=${S('now.chipNoKey')} />`
    : ix.key_served === false
      ? html`<${Badge} type="danger" label=${S('now.chipKeyMissing')} />`
      : html`<${Badge} type=${ix.key_served ? 'healthy' : 'muted'} label=${ix.key_served ? S('now.chipKeyServed') : S('now.chipKeyUnchecked')} />`;

  return html`
    <${Section} id="adm-disc-02" title=${S('engines.title')} count="02" description=${S('engines.lead')}
      actions=${html`<${Action} onClick=${onRecheck}>${S('engines.recheck')}<//>`}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${ListRow} name=${S('engines.bing')} detail=${S('engines.bingWhy')} detailKind="text"
        value=${html`<${TagChip} seen=${served.bing} checked=${served.checked} />`}
        actions=${html`
          <${Out} href=${BING} label=${S('engines.openBing')} />
          <${Out} href=${siteAt('bing')} label=${S('engines.siteAt', { engine: 'Bing', host })} />`}>
        <${Stack} density="compact">
          <${Text}>${served.bing ? S('engines.bingHowOk') : S('engines.bingHow')}<//>
          ${served.bing ? null : html`
            <${CodeField} value=${bing} onInput=${setBing} label=${S('engines.bing')} placeholder=${S('engines.bingCode')} set=${status.verification.bing} />
            <${Text} kind="caption" tone="muted">${S('engines.afterCode')} ${S('engines.dnsNote')}<//>`}
        <//>
      <//>

      <${ListRow} name=${S('engines.google')} detail=${S('engines.googleWhy')} detailKind="text"
        value=${html`<${TagChip} seen=${served.google} checked=${served.checked} />`}
        actions=${html`
          <${Out} href=${GSC} label=${S('engines.openGsc')} />
          <${Out} href=${GSC_SITEMAPS} label=${S('engines.submitLists')} />
          <${Out} href=${siteAt('google')} label=${S('engines.siteAt', { engine: 'Google', host })} />`}>
        <${Stack} density="compact">
          <${Text}>${served.google ? S('engines.googleHowOk') : S('engines.googleHow')}<//>
          ${served.google ? null : html`
            <${CodeField} value=${google} onInput=${setGoogle} label=${S('engines.google')} placeholder=${S('engines.googleCode')} set=${status.verification.google} />`}
          <${Text} kind="caption" tone="muted">${S('engines.googleLists')} <${Text} kind="mono">${status.sitemap.url}<//> <${Text} kind="mono">${status.sitemap.index_url}<//><//>
        <//>
      <//>

      <${ListRow} name=${S('engines.others')} detail=${S('engines.othersWhy')} detailKind="text"
        value=${keyChip}
        actions=${ix.key_url ? html`<${Out} href=${ix.key_url} label=${S('engines.openKey')} />` : null}>
        <${Text}>${ix.key_configured ? S('engines.othersHow') : S('engines.othersNoKey')}<//>
      <//>

      <${Stack} direction="wrap" align="center">
        <${Action} disabled=${saving || (!google.trim() && !bing.trim())} onClick=${save}>${S('engines.save')}<//>
        ${(google || bing) ? html`<${Action} onClick=${() => { setGoogle(''); setBing(''); }}>${S('discard')}<//>` : null}
      <//>
    <//>`;
}
