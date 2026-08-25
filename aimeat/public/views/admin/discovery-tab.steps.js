/**
 * @file discovery-tab.steps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The steps an operator has to go and take at Google, Bing and IndexNow, written as a
 *   CHECKED list rather than as advice.
 *
 *   Advice is what this replaces. An operator can read "paste the verification tag" and paste it
 *   into the wrong field, or into the right field on a node that is not the one Search Console is
 *   looking at, and nothing tells them. So each step that CAN be checked is checked: the
 *   verification step fetches this node's own front page and looks for the tag, and reports green
 *   only when the tag is genuinely being served. The steps that cannot be checked from here — what
 *   somebody did inside Search Console — say so plainly instead of pretending.
 *
 * @structure DiscoverySteps({ status, onChanged }) — five steps, each with what to copy
 * @usage <${DiscoverySteps} status=${status} onChanged=${load} />
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useToast, Toast } from './shared.js';
import * as adminService from '/js/services/admin.js';

/** A value the operator has to move somewhere else, with the one gesture that moves it. */
function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // The refusal IS the answer: clipboard access is denied on an insecure origin and in
      // locked-down browsers, the value stays selectable text on the page, and the button simply
      // does not say "Copied". Nothing failed that a log would help anyone with.
      // eslint-disable-next-line aimeat/no-silent-catch -- a denied clipboard is a permission answer
    } catch {
      setCopied(false);
    }
  }, [value]);
  return html`<div class="adm-seo-copy">
    <span class="adm-seo-copy-label">${label}</span>
    <code class="adm-seo-copy-value">${value}</code>
    <button class="btn-ghost" onClick=${copy}>
      ${copied ? t('dashboard.seo.copied') : t('dashboard.seo.copy')}
    </button>
  </div>`;
}

/**
 * A link out to the service the step is actually performed in, with this node's own address
 * already in it where the service accepts one.
 *
 * Naming a service in prose and leaving the reader to find it is the difference between an
 * instruction and a step. Every one of these opens in a new tab: the operator is mid-way through a
 * checklist and losing this page to a navigation would lose their place in it.
 */
function StepLink({ href, label }) {
  return html`<a class="adm-seo-step-link btn-outline" href=${href} target="_blank" rel="noopener">
    ${label} ↗
  </a>`;
}

function Step({ n, title, done, checkable, children }) {
  // Three states, not two. A cross says the step FAILED, and for the verification steps that is a
  // claim this page cannot make: it can see a meta tag on the front page, and it is blind to a DNS
  // record — which is the BETTER method, the one Google offers first, and the one that covers the
  // application addresses too. Reporting a domain-verified site as a failure is worse than
  // reporting nothing. So `checkable` means "we can confirm this one way", and its absence is a
  // neutral dot rather than a cross.
  const mark = done ? '✓' : (checkable ? '✗' : '·');
  const tone = done ? 'done' : (checkable ? 'todo' : 'manual');
  return html`<li class=${`adm-seo-step adm-seo-step-${tone}`}>
    <span class="adm-seo-step-mark" aria-hidden="true">${mark}</span>
    <div class="adm-seo-step-body">
      <h4>${n}. ${title}</h4>
      ${children}
    </div>
  </li>`;
}

export function DiscoverySteps({ status, onChanged }) {
  const [google, setGoogle] = useState('');
  const [bing, setBing] = useState('');
  const [saving, setSaving] = useState(false);
  // What the LIVE front page carries, fetched from this node's own root. The config saying a token
  // is set is not the same claim as the tag reaching a crawler, and the second is the one that
  // makes Search Console verify.
  const [served, setServed] = useState({ google: false, bing: false, checked: false });
  const [toast, showError, showSuccess, clearToast] = useToast();

  const checkServed = useCallback(async () => {
    try {
      const res = await fetch('/', { headers: { Accept: 'text/html' }, cache: 'no-store' });
      const body = await res.text();
      // The whole head, cut at </head> rather than at a byte count. A fixed slice was the first
      // attempt and it was wrong in a way that reported a working tag as missing: the injected tags
      // are added just BEFORE the closing tag, at the end of a head that is already twenty-odd
      // kilobytes of importmap. Everything after </head> is the app, and there are no meta tags in
      // it, so this stays bounded without guessing where the head ends.
      const close = body.toLowerCase().indexOf('</head>');
      const head = close >= 0 ? body.slice(0, close) : body;
      setServed({
        google: /<meta name="google-site-verification"\s+content="[^"]+"/i.test(head),
        bing: /<meta name="msvalidate\.01"\s+content="[^"]+"/i.test(head),
        checked: true,
      });
    } catch (err) {
      // The page not answering is a fact about this browser's request, not about the tag — so the
      // step stays "not seen" rather than turning into a failure the operator would chase. Logged
      // anyway: a front page that will not fetch from inside the dashboard is worth knowing about,
      // and this is the only place that would notice.
      console.warn('Discovery: could not read the live front page to check the verification tags', err);
      setServed({ google: false, bing: false, checked: true });
    }
  }, []);

  useEffect(() => { checkServed(); }, [checkServed, status]);

  const saveTokens = useCallback(async () => {
    const changes = [];
    if (google.trim()) changes.push({ path: 'seo.verification_google', value: google.trim() });
    if (bing.trim()) changes.push({ path: 'seo.verification_bing', value: bing.trim() });
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await adminService.saveConfig(changes);
      setGoogle(''); setBing('');
      showSuccess(t('dashboard.seo.tokensSaved'));
      await onChanged();
      await checkServed();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [google, bing, onChanged, checkServed, showSuccess, showError]);

  const base = status.sitemap.url.replace(/\/sitemap\.xml$/, '');
  // Search Console addresses a site as a "resource"; handing it this node's own URL puts the
  // operator on the right property instead of a chooser. The check tools all take ?url=.
  const enc = encodeURIComponent(base);
  const GSC = `https://search.google.com/search-console/welcome?resource_id=${enc}`;
  const GSC_SITEMAPS = `https://search.google.com/search-console/sitemaps?resource_id=${enc}`;
  const BING = 'https://www.bing.com/webmasters/';
  const INDEXNOW = 'https://www.bing.com/indexnow';
  const RICH_RESULTS = `https://search.google.com/test/rich-results?url=${enc}`;
  const SCHEMA_VALIDATOR = `https://validator.schema.org/#url=${enc}`;
  const PAGESPEED = `https://pagespeed.web.dev/analysis?url=${enc}`;

  return html`<section class="adm-card">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <h3>${t('dashboard.seo.stepsTitle')}</h3>
    <p class="adm-muted">${t('dashboard.seo.stepsIntro')}</p>

    <ol class="adm-seo-steps">
      <${Step} n="1" title=${t('dashboard.seo.step1Title')}
               done=${served.google} checkable=${false}>
        <p>${t('dashboard.seo.step1Body')}</p>
        <p class="adm-muted">${t('dashboard.seo.step1Dns')}</p>
        <${StepLink} href=${GSC} label=${t('dashboard.seo.openGsc')} />
        <label class="adm-seo-field">
          <span class="adm-seo-field-label">${t('dashboard.seo.googleToken')}</span>
          <input type="text" value=${google} placeholder=${status.verification.google ? t('dashboard.seo.tokenSet') : ''}
                 onInput=${e => setGoogle(e.target.value)} />
        </label>
        <p class=${served.google ? 'adm-seo-ok' : 'adm-muted'}>
          ${served.checked
            ? (served.google ? t('dashboard.seo.tagServed') : t('dashboard.seo.tagOrDns'))
            : t('dashboard.seo.tagChecking')}
        </p>
      <//>

      <${Step} n="2" title=${t('dashboard.seo.step2Title')} done=${false} checkable=${false}>
        <p>${t('dashboard.seo.step2Body')}</p>
        <${CopyRow} label=${t('dashboard.seo.rowSitemap')} value=${status.sitemap.url} />
        <${CopyRow} label=${t('dashboard.seo.rowSitemapIndex')} value=${status.sitemap.index_url} />
        <p class="adm-muted">${t('dashboard.seo.step2Why')}</p>
        <${StepLink} href=${GSC_SITEMAPS} label=${t('dashboard.seo.openGscSitemaps')} />
      <//>

      <${Step} n="3" title=${t('dashboard.seo.step3Title')}
               done=${served.bing} checkable=${false}>
        <p>${t('dashboard.seo.step3Body')}</p>
        <${StepLink} href=${BING} label=${t('dashboard.seo.openBing')} />
        <label class="adm-seo-field">
          <span class="adm-seo-field-label">${t('dashboard.seo.bingToken')}</span>
          <input type="text" value=${bing} placeholder=${status.verification.bing ? t('dashboard.seo.tokenSet') : ''}
                 onInput=${e => setBing(e.target.value)} />
        </label>
        <p class=${served.bing ? 'adm-seo-ok' : 'adm-muted'}>
          ${served.checked
            ? (served.bing ? t('dashboard.seo.tagServed') : t('dashboard.seo.tagOrDns'))
            : t('dashboard.seo.tagChecking')}
        </p>
      <//>

      <${Step} n="4" title=${t('dashboard.seo.step4Title')}
               done=${status.indexnow.key_configured} checkable=${true}>
        <p>${t('dashboard.seo.step4Body')}</p>
        ${status.indexnow.key_configured
          ? html`<${CopyRow} label=${t('dashboard.seo.keyFile')} value=${status.indexnow.key_url} />`
          : html`<p class="adm-muted">${t('dashboard.seo.step4NoKey')}</p>`}
        <p class="adm-muted">${t('dashboard.seo.step4Google')}</p>
        ${status.indexnow.key_configured
          ? null
          : html`<${StepLink} href=${INDEXNOW} label=${t('dashboard.seo.openIndexnow')} />`}
      <//>

      <${Step} n="5" title=${t('dashboard.seo.step5Title')} done=${false} checkable=${false}>
        <p>${t('dashboard.seo.step5Body')}</p>
        <p class="adm-muted">${t('dashboard.seo.step5Current', {
          state: status.robots.training_crawlers_blocked
            ? t('dashboard.seo.trainingBlocked') : t('dashboard.seo.trainingAllowed'),
        })}</p>
        <p class="adm-muted"><a href=${`${base}/robots.txt`} target="_blank" rel="noopener">${t('dashboard.seo.seePolicy')}</a></p>
      <//>
    </ol>

    <div class="adm-seo-actions">
      <button class="btn-primary" disabled=${saving || (!google.trim() && !bing.trim())}
              onClick=${saveTokens}>
        ${t('dashboard.seo.saveTokens')}
      </button>
      <button class="btn-ghost" onClick=${checkServed}>${t('dashboard.seo.recheck')}</button>
    </div>

    <h4>${t('dashboard.seo.checkTitle')}</h4>
    <p class="adm-muted">${t('dashboard.seo.checkIntro')}</p>
    <div class="adm-seo-actions">
      <${StepLink} href=${RICH_RESULTS} label=${t('dashboard.seo.checkRich')} />
      <${StepLink} href=${SCHEMA_VALIDATOR} label=${t('dashboard.seo.checkSchema')} />
      <${StepLink} href=${PAGESPEED} label=${t('dashboard.seo.checkSpeed')} />
    </div>
  </section>`;
}
