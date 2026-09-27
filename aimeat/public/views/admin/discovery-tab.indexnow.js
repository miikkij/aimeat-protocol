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
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure DiscoveryInstant({ status, onChanged }) — the four rows, the box, the last notices,
 *   the plan dialog
 * @usage <${DiscoveryInstant} status=${status} onChanged=${load} />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): Section, Readings, Beside,
 *     SettingBox for the send box, the List (cut when-words) for the last notices, Mark tags and a
 *     Code block in the plan dialog, Loud and Action for the buttons.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.1 — 2026-09-13 — The plan dialog is the large size and its actions sit in its footer.
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face).
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, useToast, Toast, when } from './shared.js';
import { Modal } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { List, Row, When, Desc } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Beside, Space } from '/components/Layout.js';
import * as adminService from '/js/services/admin.js';
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
    <${Row}>
      <${When}>${when(run.at)}<//>
      <${Desc}>
        <b>${S('instant.runCount', { n: run.urlCount, hosts: run.hosts })}</b>
        ${' · '}${run.status ?? S('instant.noAnswer')}${run.failed.length ? ` · ${S('instant.runFailed', { n: run.failed.length })}` : ''}
        ${' · '}${S('now.scope_' + (run.scope || 'app'))}
        ${' · '}${who}
      <//>
    <//>`;
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

  const box = html`
    <${SettingBox} label=${S('instant.boxLabel')}>
      ${!ix.key_configured ? html`
        ${S('instant.noKeyBox')}
        <${Space} above="large"><${Actions}><${Action} small soft href="https://www.bing.com/indexnow" newTab>${S('instant.getKey')}<//><//><//>`
      : off ? S('instant.offBox')
      : html`
        ${S('instant.boxBody', { n: everything.url_count, pages: status.sitemap.page_count })}
        <${Space} above="large">
          <${Actions}>
            <${Loud} control disabled=${!!sending || everything.url_count === 0} onClick=${() => announce('all')}>
              ${sending === 'all' ? S('instant.sending') : S('instant.send', { n: everything.url_count })}
            <//>
            <${Action} small soft onClick=${openPlan}>${S('instant.seeList')}<//>
          <//>
        <//>
        <${Note} kind="hint">${S('instant.boxNote')}<//>`}
    <//>
    ${ix.runs.length > 0 ? html`
      <${Space} above="large">
        <${Label} block>${S('instant.runs')}<//>
        <${List} cols="when-words" dense>
          ${ix.runs.map((run) => html`<${RunLine} key=${run.at} run=${run} />`)}
        <//>
      <//>` : null}`;

  return html`
    <${Section} id="adm-disc-03" num="03" title=${S('instant.title')}
      doors=${can ? html`<${Action} small soft disabled=${!!sending} onClick=${() => announce('pages')}>${S('instant.onlyPages', { n: status.sitemap.page_count })}<//>` : null}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="lead">${S('instant.lead')}<//>

      <${Beside} wide side=${box}>
        <${Readings} rows=${[
          { key: 'key', name: S('instant.keyFile'), why: keyWhy, mark: keyChip,
            value: ix.key_url ? html`<${Action} small soft href=${ix.key_url} newTab>${shortKeyPath(ix.key_url)}<//>` : '—' },
          { key: 'publish', name: S('instant.onPublish'), why: S('instant.onPublishWhy'),
            mark: html`<${Badge} type=${ix.auto ? 'healthy' : 'muted'} label=${ix.auto ? S('instant.on') : S('instant.off')} />`,
            value: 'AIMEAT_SEO_INDEXNOW_AUTO' },
          { key: 'last', name: S('instant.lastNotice'), why: S('instant.lastNoticeWhy'), mark: runChip(last), value: lastValue },
          { key: 'whole', name: S('instant.whole'),
            why: wholeSent ? S('instant.wholeWhySent', { at: when(everything.last_sent_at) }) : S('instant.wholeWhyNever', { pages: status.sitemap.page_count, apps: status.apps.on }),
            mark: html`<${Badge} type=${wholeSent ? 'healthy' : 'watch'} label=${wholeSent ? S('instant.sent') : S('instant.neverSent')} />`,
            value: S('instant.wholeVal', { n: everything.url_count, hosts: everything.host_count }), last: true },
        ]} />
      <//>

      <${Modal} open=${planOpen} onClose=${() => setPlanOpen(false)} title=${S('instant.planTitle')} size="lg"
        footer=${plan && html`
          <${Action} onClick=${() => setPlanOpen(false)}>${S('instant.planClose')}<//>
          <${Loud} control disabled=${!!sending || !can} onClick=${() => announce('all')}>${S('instant.planSend', { n: plan.url_count })}<//>`}>
        ${plan && html`
          <${Marks}>
            ${plan.hosts.map((h_) => html`<${Mark} key=${h_.host}>${h_.host.replace(/^https?:\/\//, '')} · ${h_.url_count}<//>`)}
          <//>
          <${Code} block scroll="large">${plan.urls.join('\n')}<//>`}
      <//>
    <//>`;
}
