/**
 * @file discovery-tab.indexnow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 03 of the admin Discovery page: the instant updates. The key file as
 *   fetched from outside, whether a publish announces itself, the last notice and what IndexNow
 *   answered, whether the whole site has ever gone out as one notice, and the box that sends it.
 *
 *   The box exists because nothing had ever sent the whole site from the node: a publish announces
 *   one application, and the hand-run script sends the pages alone. An operator who read "2
 *   addresses sent" on the old page and asked why Bing showed nothing had no button to press. The
 *   list can be read before it is sent, because the number on the slab is a promise and a person
 *   wants to see what it stands for.
 *
 * @structure DiscoveryInstant({ status, onChanged }) — the four rows, the box, the last notices,
 *   the plan dialog
 * @usage <${DiscoveryInstant} status=${status} onChanged=${load} />
 * @version-history
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face).
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, useToast, Toast } from './shared.js';
import { Modal } from '/components/Modal.js';
import * as adminService from '/js/services/admin.js';
import { Row, when } from './discovery-tab.shared.js';
import { swallowed } from '/js/swallowed.js';

const S = (key, params) => t('dashboard.seo.' + key, params);

/** "/8a54…8724.txt" from the key file's address: the key is a machine thing, and forty characters say nothing. */
function shortKeyPath(keyUrl) {
  try {
    const path = new URL(keyUrl).pathname;
    const m = /^\/([0-9a-z-]+)\.txt$/i.exec(path);
    if (!m || m[1].length <= 12) return path;
    return `/${m[1].slice(0, 4)}…${m[1].slice(-4)}.txt`;
  } catch (err) {
    swallowed('discovery: key url', err);
    return keyUrl;
  }
}

/** What IndexNow answered, as a word and a tone. */
function runChip(run) {
  if (!run) return html`<${Badge} type="muted" label=${S('instant.none')} />`;
  if (run.ok) return html`<${Badge} type="healthy" label=${S('instant.accepted')} />`;
  if (run.failed.length >= run.hosts) return html`<${Badge} type="danger" label=${S('instant.refused')} />`;
  return html`<${Badge} type="watch" label=${S('instant.partly')} />`;
}

/** One line of the log: when, how many, on how many hosts, the answer, what it covered, who sent it. */
function RunLine({ run }) {
  const who = run.by ? S('instant.runBy', { who: run.by }) : S('instant.runAuto');
  return html`
    <div class="adm-disc-run">
      <span>${when(run.at)}</span>
      <b>${S('instant.runCount', { n: run.urlCount, hosts: run.hosts })}</b>
      <span>${run.status ?? S('instant.noAnswer')}${run.failed.length ? ` · ${S('instant.runFailed', { n: run.failed.length })}` : ''}</span>
      <span>${S('now.scope_' + (run.scope || 'app'))}</span>
      <span>${who}</span>
    </div>`;
}

export function DiscoveryInstant({ status, onChanged }) {
  const [sending, setSending] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();

  const ix = status.indexnow;
  const off = status.indexing === 'off';
  const can = ix.key_configured && !off;
  const everything = ix.everything;

  const announce = useCallback(async (scope) => {
    setSending(scope);
    try {
      const r = await adminService.announceIndexNow(scope);
      if (r?.ok === false) throw new Error(r.error?.message || 'refused');
      showSuccess(r?.data?.note || S('instant.sentOk'));
      setPlanOpen(false);
      await onChanged();
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setSending(null);
    }
  }, [onChanged, showSuccess, showError]);

  const openPlan = useCallback(async () => {
    try {
      const r = await adminService.getIndexNowPlan('all');
      if (r?.ok === false) throw new Error(r.error?.message || 'refused');
      setPlan(r?.data || null);
      setPlanOpen(true);
    } catch (err) {
      showError(err?.message || String(err));
    }
  }, [showError]);

  const keyChip = !ix.key_configured
    ? html`<${Badge} type="muted" label=${S('now.chipNoKey')} />`
    : ix.key_served === true ? html`<${Badge} type="healthy" label=${S('now.chipServed')} />`
    : ix.key_served === false ? html`<${Badge} type="danger" label=${S('instant.keyMissing')} />`
    : html`<${Badge} type="muted" label=${S('instant.keyUnchecked')} />`;
  const keyWhy = !ix.key_configured ? S('instant.keyFileWhyNoKey')
    : ix.key_served === true ? S('instant.keyFileWhyOk', { at: when(ix.key_checked_at) })
    : ix.key_served === false ? S('instant.keyFileWhyNo', { at: when(ix.key_checked_at) })
    : S('instant.keyFileWhyUnknown');
  const last = ix.last;
  const lastValue = last
    ? S('instant.lastVal', { n: last.urlCount, at: when(last.at), status: last.status ?? S('instant.noAnswer') })
    : S('now.instantNever');
  const wholeSent = !!everything.last_sent_at;

  return html`
    <section class="og-sec" id="adm-disc-03">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div class="og-sec-h"><h2>${S('instant.title')}<small>03</small></h2>
        <div class="og-doors">
          ${can ? html`<button type="button" class="og-door og-door--quiet" disabled=${!!sending} onClick=${() => announce('pages')}>${S('instant.onlyPages', { n: status.sitemap.page_count })}</button>` : null}
        </div></div>
      <p class="adm-disc-lead">${S('instant.lead')}</p>

      <div class="adm-disc-two">
        <div>
          ${Row({ title: S('instant.keyFile'), why: keyWhy, chip: keyChip,
            value: ix.key_url ? html`<a class="og-door og-door--quiet" href=${ix.key_url} target="_blank" rel="noopener">${shortKeyPath(ix.key_url)}</a>` : '—' })}
          ${Row({ title: S('instant.onPublish'), why: S('instant.onPublishWhy'),
            chip: html`<${Badge} type=${ix.auto ? 'healthy' : 'muted'} label=${ix.auto ? S('instant.on') : S('instant.off')} />`,
            value: 'AIMEAT_SEO_INDEXNOW_AUTO' })}
          ${Row({ title: S('instant.lastNotice'), why: S('instant.lastNoticeWhy'), chip: runChip(last), value: lastValue })}
          ${Row({ title: S('instant.whole'),
            why: wholeSent ? S('instant.wholeWhySent', { at: when(everything.last_sent_at) }) : S('instant.wholeWhyNever', { pages: status.sitemap.page_count, apps: status.apps.on }),
            chip: html`<${Badge} type=${wholeSent ? 'healthy' : 'watch'} label=${wholeSent ? S('instant.sent') : S('instant.neverSent')} />`,
            value: S('instant.wholeVal', { n: everything.url_count, hosts: everything.host_count }), last: true })}
        </div>
        <div>
          <div class="og-box">
            <span class="og-box-label">${S('instant.boxLabel')}</span>
            ${!ix.key_configured ? html`
              <div class="adm-disc-box-body">${S('instant.noKeyBox')}</div>
              <div class="adm-disc-box-acts"><a class="og-door og-door--quiet" href="https://www.bing.com/indexnow" target="_blank" rel="noopener">${S('instant.getKey')}</a></div>`
            : off ? html`<div class="adm-disc-box-body">${S('instant.offBox')}</div>`
            : html`
              <div class="adm-disc-box-body">${S('instant.boxBody', { n: everything.url_count, pages: status.sitemap.page_count })}</div>
              <div class="adm-disc-box-acts">
                <button type="button" class="og-slab" disabled=${!!sending || everything.url_count === 0} onClick=${() => announce('all')}>
                  ${sending === 'all' ? S('instant.sending') : S('instant.send', { n: everything.url_count })}
                </button>
                <button type="button" class="og-door og-door--quiet" onClick=${openPlan}>${S('instant.seeList')}</button>
              </div>
              <p class="adm-disc-note">${S('instant.boxNote')}</p>`}
          </div>
          ${ix.runs.length > 0 ? html`
            <div class="adm-disc-runs">
              <div class="adm-disc-lbl">${S('instant.runs')}</div>
              ${ix.runs.map((run) => html`<${RunLine} key=${run.at} run=${run} />`)}
            </div>` : null}
        </div>
      </div>

      <${Modal} open=${planOpen} onClose=${() => setPlanOpen(false)} title=${S('instant.planTitle')}>
        ${plan && html`
          <div class="adm-disc-plan-hosts">
            ${plan.hosts.map((h_) => html`<span key=${h_.host} class="adm-disc-fchip">${h_.host.replace(/^https?:\/\//, '')} · ${h_.url_count}</span>`)}
          </div>
          <div class="adm-disc-plan-urls">${plan.urls.map((u) => html`<div key=${u}>${u}</div>`)}</div>
          <div class="adm-disc-acts">
            <button type="button" class="og-slab" disabled=${!!sending || !can} onClick=${() => announce('all')}>${S('instant.planSend', { n: plan.url_count })}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => setPlanOpen(false)}>${S('instant.planClose')}</button>
          </div>`}
      <//>
    </section>`;
}
