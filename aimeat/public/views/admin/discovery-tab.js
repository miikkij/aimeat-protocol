/**
 * @file discovery-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Discovery page in the poster face (design canvas "AIMEAT Admin Discovery"):
 *   whether this node can be found in a search engine, how it describes itself when it is, and
 *   what the operator still has to go and do.
 *
 *   The question an operator actually has is "am I findable, and what is left". The page opens on
 *   the word (FINDABLE or TURNED AWAY), six rows read from what is BEING SERVED rather than from the
 *   settings — a verification code that was typed in but never reached the page looks the same as a
 *   working one until somebody checks — and the numeral strip. Then one row per search engine,
 *   the instant updates with the whole site in one notice, the identity, the application list, and
 *   the outside checks beside the paste for the operator's own AI.
 *
 * @structure
 *   DiscoveryTab (default) — load, the front-page tag check, RightNow (01) and the strip, then the
 *     sections from the sibling files: engines (02), instant (03), identity (04), apps (05), and
 *     Checks (06) here. The row, the stamp and the base come from discovery-tab.shared.js.
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.0 — 2026-09-11 — The poster face: the status word, the metric rows, the strip, six numbered
 *     sections, and the tag check shared between 01 and 02. The five steps became one row per
 *     engine (discovery-tab.engines.js) and the instant updates a section of their own
 *     (discovery-tab.indexnow.js); the identity moved to discovery-tab.identity.js.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Spinner, ErrorBox, Badge, useToast, Toast } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getNodeUrl } from '/js/services/auth.js';
import * as adminService from '/js/services/admin.js';
import { DiscoveryEngines } from './discovery-tab.engines.js';
import { DiscoveryInstant } from './discovery-tab.indexnow.js';
import { DiscoveryIdentity } from './discovery-tab.identity.js';
import { DiscoveryApps } from './discovery-tab.apps.js';
import { buildDiscoveryPrompt } from './discovery-tab.prompt.js';
import { Row, when, baseOf } from './discovery-tab.shared.js';

const S = (key, params) => t('dashboard.seo.' + key, params);

/** The chip for the key file: no key, served, not served, or unchecked. */
function keyChip(ix) {
  if (!ix.key_configured) return html`<${Badge} type="muted" label=${S('now.chipNoKey')} />`;
  if (ix.key_served === true) return html`<${Badge} type="healthy" label=${S('now.chipKeyServed')} />`;
  if (ix.key_served === false) return html`<${Badge} type="danger" label=${S('now.chipKeyMissing')} />`;
  return html`<${Badge} type="muted" label=${S('now.chipKeyUnchecked')} />`;
}

/** Section 01: the word, its sentence, the log line, the six rows. */
function RightNow({ status, served, toSection, onToggle, busy }) {
  const off = status.indexing === 'off';
  const ix = status.indexnow;
  const proofs = (served.google ? 1 : 0) + (served.bing ? 1 : 0);
  const lines = [];
  if (off) lines.push(S('now.lineOff'));
  else {
    lines.push(S('now.lineOn'));
    if (served.checked && proofs === 0) lines.push(S('now.lineNoProof'));
    if (ix.key_configured && !ix.everything.last_sent_at) lines.push(S('now.lineNoWhole'));
  }
  const keyWord = !ix.key_configured ? S('now.logNoKey')
    : ix.key_served === true ? S('now.logKeyOk')
    : ix.key_served === false ? S('now.logKeyNo') : S('now.logKeyUnknown');
  const log = [
    'robots.txt',
    S('now.logPages', { n: status.sitemap.page_count }),
    S('now.logHosts', { n: status.sitemap.app_host_count }),
    keyWord,
    S('now.logRead', { at: new Date().toLocaleTimeString() }),
  ].join(' · ');
  const last = ix.last;
  const lastValue = last
    ? S('now.instantVal', { n: last.urlCount, at: when(last.at), status: last.status ?? S('instant.noAnswer') })
    : S('now.instantNever');
  const openDoor = (href) => html`<a class="og-door og-door--quiet" href=${href} target="_blank" rel="noopener">${S('open')}</a>`;
  return html`
    <section class="og-sec og-sec--first" id="adm-disc-01">
      <div class="og-sec-h"><h2>${S('now.title')}<small>01</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet ${off ? '' : 'og-door--danger'}" disabled=${busy} onClick=${onToggle}>
            ${off ? S('now.turnOn') : S('now.turnOff')}
          </button>
        </div>
      </div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status ${off ? 'danger' : ''}">${off ? S('now.wordOff') : S('now.wordOn')}</div>
          <p class="adm-alert-line">${lines.join(' ')}</p>
          <div class="adm-ov-up">${log}</div>
        </div>
        <div>
          ${Row({ title: S('now.crawl'), why: S('now.crawlWhy'),
            chip: html`<${Badge} type=${off ? 'danger' : 'healthy'} label=${S('now.chipServed')} />`,
            value: status.robots.content_signal })}
          ${Row({ title: S('now.training'), why: S('now.trainingWhy'),
            chip: html`<${Badge} type=${status.robots.training_crawlers_blocked ? 'watch' : 'info'} label=${status.robots.training_crawlers_blocked ? S('now.chipKeptOut') : S('now.chipLetIn')} />`,
            value: html`<button type="button" class="og-door og-door--quiet" onClick=${() => toSection('config')}>${S('change')}</button>` })}
          ${Row({ title: S('now.pages'), why: S('now.pagesWhy'),
            chip: html`<${Badge} type="healthy" label=${S('now.chipPages', { n: status.sitemap.page_count })} />`,
            value: html`/sitemap.xml · ${openDoor(status.sitemap.url)}` })}
          ${Row({ title: S('now.appList'), why: S('now.appListWhy'),
            chip: html`<${Badge} type=${status.apps.on > 0 ? 'healthy' : 'muted'} label=${S('now.chipOf', { n: status.apps.on, total: status.apps.total })} />`,
            value: html`/sitemap-index.xml · ${openDoor(status.sitemap.index_url)}` })}
          ${Row({ title: S('now.proofs'), why: S('now.proofsWhy'),
            chip: html`<${Badge} type=${proofs === 2 ? 'healthy' : 'watch'} label=${served.checked ? S('now.chipProofs', { n: proofs }) : S('engines.checking')} />`,
            value: html`Google · Bing · <button type="button" class="og-door og-door--quiet" onClick=${() => toSection('02')}>${S('now.toEngines')}</button>` })}
          ${Row({ title: S('now.instant'), why: S('now.instantWhy'),
            chip: keyChip(ix), value: lastValue, last: true })}
        </div>
      </div>
      <${Strip} status=${status} proofs=${proofs} />
    </section>`;
}

/** The numeral strip: the pages, the findable applications, the engines that know you, the last notice. */
function Strip({ status, proofs }) {
  const last = status.indexnow.last;
  const scopeWord = (scope) => S('now.scope_' + (scope || 'app'));
  return html`
    <div class="og-strip">
      <div><b>${status.sitemap.page_count}</b><span>${S('now.stripPages')}</span><small>${S('now.stripPagesSub')}</small></div>
      <div><b>${status.apps.on}</b><span>${S('now.stripApps')}</span><small>${S('now.stripAppsSub', { total: status.apps.total, pending: status.apps.pending })}</small></div>
      <div><b class=${proofs === 0 ? 'adm-disc-coral' : ''}>${S('now.stripOf', { n: proofs })}</b><span>${S('now.stripEngines')}</span><small>${proofs === 2 ? S('now.stripEnginesBoth') : proofs === 1 ? S('now.stripEnginesOne') : S('now.stripEnginesNone')}</small></div>
      <div><b>${last ? last.urlCount : 0}</b><span>${S('now.stripLast')}</span><small>${last ? S('now.stripLastSub', { at: when(last.at), what: scopeWord(last.scope) }) : S('now.stripLastNone')}</small></div>
    </div>`;
}

/** Section 06: the outside checks, and the paste for the operator's own AI. */
function Checks({ status }) {
  const base = baseOf(status);
  const enc = encodeURIComponent(base);
  const paste = buildDiscoveryPrompt({ url: getNodeUrl() });
  const open = (href) => html`<a class="og-door og-door--quiet" href=${href} target="_blank" rel="noopener">${S('open')}</a>`;
  return html`
    <section class="og-sec" id="adm-disc-06">
      <div class="og-sec-h"><h2>${S('checks.title')}<small>06</small></h2>
        <div class="og-doors"><${CopyButton} text=${paste} label=${S('checks.copyAi')} className="og-door og-door--quiet" /></div></div>
      <div class="adm-disc-checks">
        <div>
          <p class="adm-disc-lead">${S('checks.lead')}</p>
          ${Row({ title: S('checks.rich'), why: S('checks.richWhy'), chip: null, value: open(`https://search.google.com/test/rich-results?url=${enc}`) })}
          ${Row({ title: S('checks.schema'), why: S('checks.schemaWhy'), chip: null, value: open(`https://validator.schema.org/#url=${enc}`) })}
          ${Row({ title: S('checks.speed'), why: S('checks.speedWhy'), chip: null, value: open(`https://pagespeed.web.dev/analysis?url=${enc}`) })}
          ${Row({ title: S('checks.bingInspect'), why: S('checks.bingInspectWhy'), chip: null, value: open('https://www.bing.com/webmasters/urlinspection'), last: true })}
        </div>
        <div class="og-box">
          <span class="og-box-label">${S('checks.aiLabel')}</span>
          <div class="adm-disc-paste">${paste}</div>
        </div>
      </div>
    </section>`;
}

export default function DiscoveryTab({ switchPage }) {
  useViewCSS('/css/views/admin-discovery.css');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // What the LIVE front page carries, fetched from this node's own root. The config saying a token
  // is set is not the same claim as the tag reaching a crawler, and the second is the one that
  // makes Search Console verify.
  const [served, setServed] = useState({ google: false, bing: false, checked: false });
  const [toast, showError, showSuccess, clearToast] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const resp = await adminService.getSeoStatus();
      setStatus(resp?.data || null);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus(null);
    }
  }, []);

  const checkServed = useCallback(async () => {
    try {
      const res = await fetch('/', { headers: { Accept: 'text/html' }, cache: 'no-store' });
      const body = await res.text();
      // The whole head, cut at </head> rather than at a byte count: the injected tags are added
      // just BEFORE the closing tag, at the end of a head that is already twenty-odd kilobytes of
      // importmap, and a fixed slice once reported a working tag as missing.
      const close = body.toLowerCase().indexOf('</head>');
      const head = close >= 0 ? body.slice(0, close) : body;
      setServed({
        google: /<meta name="google-site-verification"\s+content="[^"]+"/i.test(head),
        bing: /<meta name="msvalidate\.01"\s+content="[^"]+"/i.test(head),
        checked: true,
      });
    } catch (err) {
      // The page not answering is a fact about this browser's request, not about the tag — so the
      // row stays "not seen" rather than turning into a failure the operator would chase.
      console.warn('Discovery: could not read the live front page to check the verification tags', err);
      setServed({ google: false, bing: false, checked: true });
    }
  }, []);

  useEffect(() => { load(); checkServed(); }, [load, checkServed]);
  // The app states change when an owner flips their own switch, from a surface that is not this
  // page; a notice stamps the apps; a saved setting changes what is served.
  useEffect(() => onLiveUpdate(['apps', 'config', 'features'], () => load()), [load]);

  const toSection = (n) => {
    if (n === 'config') { switchPage('config'); return; }
    document.getElementById('adm-disc-' + n)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleIndexing = useCallback(async () => {
    if (!status) return;
    const on = status.indexing === 'off';
    setBusy(true);
    try {
      await adminService.saveConfig([{ path: 'seo.indexing', value: on ? 'on' : 'off' }]);
      showSuccess(on ? S('now.indexingOnOk') : S('now.indexingOffOk'));
      await load();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [status, load, showSuccess, showError]);

  if (error) return html`<${ErrorBox} message=${error} />`;
  if (!status) return html`<${Spinner} text=${S('loading')} />`;

  return html`<div class="adm-disc">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${RightNow} status=${status} served=${served} toSection=${toSection} onToggle=${toggleIndexing} busy=${busy} />
    <${DiscoveryEngines} status=${status} served=${served} onRecheck=${checkServed} onChanged=${load} />
    <${DiscoveryInstant} status=${status} onChanged=${load} />
    <${DiscoveryIdentity} status=${status} onChanged=${load} />
    <${DiscoveryApps} status=${status} onChanged=${load} />
    <${Checks} status=${status} />
  </div>`;
}
