/**
 * @file public/views/admin/push-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Push page in the poster face (design canvas "AIMEAT Admin Push"). Sections in
 *   the order an operator asks: is it on, how do I switch it on when it is not, can I test it here,
 *   what sends a push, what does it say, and who receives it. The four writes go through the same
 *   routes as before. Two things the page could not say before it can now: whether the VAPID keys
 *   are set, and which of the four trigger types AIMEAT_PUSH_NOTIFY_TYPES actually lists.
 *
 * @structure
 *   - PushTab({ data, reload }) — the sections, the strip and the actions
 *   - TRIGGERS: the four mailbox event types the code can send, checked against the live setting
 *   - Templates: one row per message, opened in place, edits held in state until Save
 *   - subscribe / test / unsubscribe / saveTemplate / resetTemplates: call admin service
 *
 * @version-history
 *   v3.0.0 — 2026-09-22 — Composed from the shared component set (components/poster-parts.js):
 *     shared sections, the numeral band for the strip (now inside section 01), shared steps with
 *     code surfaces, one list row per message that opens in place, shared fields, and the shared
 *     table for the subscribers (the endpoint keeps to one line, whole in its tooltip). The page's own sheet (admin-push.css) is gone.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v2.0.0 — 2026-09-12 — The poster face: three cards and an accordion become five numbered
 *     sections. The page says whether the VAPID keys are set instead of a sentence saying they are
 *     required, shows the trigger types that are actually in AIMEAT_PUSH_NOTIFY_TYPES rather than
 *     four that look alike, shows last_used_at (the response has always carried it) and marks a
 *     subscription unused for 30 days, and answers "is this browser subscribed" by asking the
 *     service worker. When the keys are missing the page shows the three steps to set them and
 *     disables Subscribe instead of letting it fail. The templates section drops the sentence
 *     saying they are hardcoded, which they have not been for as long as this editor has existed.
 *   v1.1.0 — 2026-06-02 — Admin design unification: reset button inline danger style →
 *     adm-btn-danger, template body textarea → adm-textarea (dynamic min-height kept).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, ListRow, Steps, Table, NumeralBand, Field, Surface, Chip, Action, Text } from '/components/poster-parts.js';
import * as api from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';

const P = (key, vars) => t('dashboard.pushPage.' + key, vars);

/** The mailbox event types the code can push. Whether one is LIVE is a separate question, answered
 *  by AIMEAT_PUSH_NOTIFY_TYPES; before this page read that setting it listed all four as if they
 *  were, and the default has always been the first two. */
const TRIGGERS = ['work_assignment', 'action_request', 'board_notification', 'federation_sync'];

/** A subscription nobody has sent to in this long is probably a browser that dropped it. */
const STALE_DAYS = 30;

const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

/** First and last few characters, which is enough to tell one deployed key pair from another. */
const keyEnds = (k) => (k && k.length > 16 ? `${k.slice(0, 6)}…${k.slice(-4)}` : (k || ''));

export default function PushTab({ data, reload, switchPage }) {
  const push = data.push;

  // Every hook runs before the early return below (Rules of Hooks).
  const [tplLocale, setTplLocale] = useState((push?.locales || ['en'])[0] || 'en');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(null);
  const [openTpl, setOpenTpl] = useState(null);
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState(null);
  const [thisBrowser, setThisBrowser] = useState(null);
  const { confirm, ConfirmUI } = useConfirm();
  const [toast, showErr, showOk, clearToast] = useToast();

  const subCount = push?.subscriptions?.length ?? 0;

  // "Is the browser I am reading this in one of the subscribers?" The page used to offer Subscribe
  // and Unsubscribe side by side without knowing which one applied.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          if (alive) setThisBrowser(false);
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (alive) setThisBrowser(!!sub);
      } catch (err) {
        swallowed('push-tab: read this browser’s subscription', err);
        if (alive) setThisBrowser(false);
      }
    })();
    return () => { alive = false; };
  }, [subCount]);

  if (!push) return html`<${Empty} text=${t('dashboard.pushNotConfigured')} />`;

  const subs = push.subscriptions || [];
  const templates = push.templates || [];
  const locales = push.locales || ['en'];
  const liveTypes = push.push_notify_types || [];
  const vapidOk = !!push.vapid_configured;
  // The switch and the effective state are different facts. With the switch on and no keys the
  // service is off, and a row that printed the effective state as the switch's value said
  // AIMEAT_PUSH_ENABLED=false to an operator whose config said true.
  const switchOn = push.push_enabled !== false;
  const serviceOn = !!push.enabled;
  const localeTpls = templates.filter((tpl) => tpl.locale === tplLocale);

  const owners = new Set(subs.map((s) => s.owner_name).filter(Boolean));
  const stale = subs.filter((s) => (daysSince(s.last_used_at) ?? 0) >= STALE_DAYS).length;
  const edited = templates.filter((tpl) => !tpl.is_default).length;

  // Sections are numbered in the order they render, and the setup section only exists while the
  // keys are missing, so the numbers are counted rather than written down.
  const showSetup = !vapidOk;
  const no = {};
  let n = 0;
  for (const key of ['now', ...(showSetup ? ['setup'] : []), 'browser', 'triggers', 'messages', 'subs']) {
    no[key] = String(++n).padStart(2, '0');
  }

  const fieldOf = (tpl, name) => {
    const k = `${tpl.id}::${tpl.locale}::${name}`;
    return k in edits ? edits[k] : (tpl.fields?.[name] ?? '');
  };
  const setField = (tpl, name, value) => {
    setEdits((prev) => ({ ...prev, [`${tpl.id}::${tpl.locale}::${name}`]: value }));
  };
  const isDirty = (tpl) => Object.keys(edits).some((k) => k.startsWith(`${tpl.id}::${tpl.locale}::`));

  async function saveTemplate(tpl) {
    const key = `${tpl.id}::${tpl.locale}`;
    setSaving(key);
    try {
      const fields = { ...tpl.fields };
      for (const name of Object.keys(fields)) fields[name] = fieldOf(tpl, name);
      await api.savePushTemplate(tpl.id, tpl.locale, fields);
      setEdits((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (k.startsWith(`${key}::`)) delete next[k];
        return next;
      });
      setSaving(null);
      showOk(P('saved'));
      reload();
    } catch (err) {
      swallowed('push-tab: saveTemplate', err);
      setSaving(null);
      showErr(t('dashboard.saveFailed'));
    }
  }

  function askReset() {
    confirm(t('dashboard.pushResetConfirm'), async () => {
      try { await api.resetPushTemplates(); setEdits({}); showOk(P('resetDone')); reload(); }
      catch (err) { swallowed('push-tab: reset', err); showErr(t('dashboard.saveFailed')); }
    }, { danger: true });
  }

  /** The browser's own subscribe: register the service worker, get the VAPID public key, hand the
   *  resulting endpoint to the node. Unchanged from the card-face page. */
  async function subscribe() {
    setBusy('subscribe');
    setSaid(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setSaid({ ok: false, msg: P('noBrowserSupport') });
        setBusy(null);
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const vapidRes = await api.getVapidKey();
      const vapidKey = vapidRes.data.vapidPublicKey;
      const urlBase64 = vapidKey.replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(urlBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      const json = subscription.toJSON();
      await api.subscribePush(json.endpoint, { p256dh: json.keys.p256dh, auth: json.keys.auth });
      setBusy(null);
      setSaid({ ok: true, msg: P('subscribedNow') });
      reload();
    } catch (err) {
      swallowed('push-tab: subscribe', err);
      setBusy(null);
      setSaid({ ok: false, msg: P('subscribeFailed') });
    }
  }

  async function sendTest() {
    setBusy('test');
    setSaid(null);
    try {
      await api.testPush();
      setBusy(null);
      setSaid({ ok: true, msg: P('testSent') });
    } catch (err) {
      swallowed('push-tab: test', err);
      setBusy(null);
      setSaid({ ok: false, msg: P('testFailed') });
    }
  }

  async function unsubscribe() {
    setBusy('unsubscribe');
    setSaid(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      await api.unsubscribePush();
      setBusy(null);
      setSaid({ ok: true, msg: P('unsubscribedNow') });
      reload();
    } catch (err) {
      swallowed('push-tab: unsubscribe', err);
      setBusy(null);
      setSaid({ ok: false, msg: P('unsubscribeFailed') });
    }
  }

  const statusWord = serviceOn ? P('statusOn') : P('statusOff');
  const statusLine = serviceOn
    ? (subCount === 0 ? P('lineOnNoSubs') : (subCount === 1 ? P('lineOnOne') : P('lineOn', { n: num(subCount) })))
    : (vapidOk ? P('lineOffSwitch') : P('lineOffKeys'));

  return html`
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${P('now')} count=${no.now}
        actions=${html`<${Action} onClick=${() => switchPage('email')}>${P('toEmail')}<//>`}>
        <${Columns} layout="trailing" collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="number" tone=${serviceOn ? 'plain' : 'danger'}>${statusWord}<//>
            <${Text}>${statusLine}<//>
            <${Text} kind="mono" tone="muted">${(data.dash || {}).node_id || ''}<//>
          <//>
          <div>
            <${Row} title=${P('rowService')} why=${P('rowServiceWhy')}
              chip=${html`<${Badge} type=${switchOn ? 'healthy' : 'critical'} label=${switchOn ? P('on') : P('off')} />`}
              value=${'AIMEAT_PUSH_ENABLED=' + (switchOn ? 'true' : 'false')} />
            <${Row} title=${P('rowKeys')} why=${P('rowKeysWhy')}
              chip=${html`<${Badge} type=${vapidOk ? 'healthy' : 'critical'} label=${vapidOk ? P('set') : P('missing')} />`}
              value=${vapidOk ? keyEnds(push.vapid_public_key) : P('notSet')} />
            <${Row} title=${P('rowSubs')} why=${P('rowSubsWhy')}
              chip=${html`<${Badge} type="muted" label=${num(subCount)} />`}
              value=${owners.size === 1 ? P('nOwnersOne') : P('nOwners', { n: num(owners.size) })} />
            <${Row} title=${P('rowThis')} why=${P('rowThisWhy')}
              chip=${html`<${Badge} type=${thisBrowser ? 'healthy' : 'muted'}
                label=${thisBrowser === null ? P('checking') : (thisBrowser ? P('subscribed') : P('no'))} />`}
              value=${thisBrowser ? P('viaServiceWorker') : '–'} />
          </div>
        <//>
        <${NumeralBand} tone="plain" items=${[
          { label: P('stripSubs'), value: num(subCount), note: P('stripSubsSub') },
          { label: P('stripOwners'), value: num(owners.size), note: P('stripOwnersSub') },
          { label: P('stripStale'), value: num(stale), note: P('stripStaleSub', { d: STALE_DAYS }), tone: stale ? 'coral' : undefined },
          { label: P('stripEdited', { all: num(templates.length) }), value: num(edited), note: P('stripEditedSub') },
        ]} />
      <//>

      ${showSetup && html`
      <${Section} title=${P('setup')} count=${no.setup} description=${P('setupLead')}>
        <${Stack}>
          <${Steps} items=${[
            html`<${Stack} density="compact"><${Text}>${P('step1')}<//><${Surface} kind="code">npx web-push generate-vapid-keys<//><//>`,
            html`<${Stack} density="compact"><${Text}>${P('step2')}<//><${Surface} kind="code">${'AIMEAT_VAPID_PUBLIC_KEY="…"\nAIMEAT_VAPID_PRIVATE_KEY="…"\nAIMEAT_VAPID_SUBJECT="mailto:operator@example.com"'}<//><//>`,
            html`<${Text}>${P('step3')}<//>`,
          ]} />
          <${Text} kind="caption" tone="muted">${P('setupNote')}<//>
        <//>
      <//>`}

      <${Section} title=${P('browser')} count=${no.browser} description=${P('browserLead')}>
        <${Stack}>
          <${Stack} direction="wrap" align="center">
            ${thisBrowser
    ? html`<${Action} disabled=${busy === 'test' || !subs.length} onClick=${sendTest}>
        ${busy === 'test' ? P('testSending') : P('testBtn')}<//>`
    : html`<${Action} kind="primary" disabled=${!vapidOk || busy === 'subscribe'} onClick=${subscribe}>
        ${busy === 'subscribe' ? P('subscribing') : P('subscribeBtn')}<//>`}
            ${thisBrowser && html`<${Action} tone="danger" disabled=${busy === 'unsubscribe'} onClick=${unsubscribe}>
              ${busy === 'unsubscribe' ? P('unsubscribing') : P('unsubscribeBtn')}<//>`}
            ${!vapidOk && html`<${Text} kind="caption" tone="muted">${P('waitingForKeys')}<//>`}
          <//>
          ${said && html`<${Text} tone=${said.ok ? 'success' : 'danger'}>${said.msg}<//>`}
          <${Text} kind="caption" tone="muted">${P('browserNote')}<//>
        <//>
      <//>

      <${Section} title=${P('triggers')} count=${no.triggers} description=${P('triggersLead')}>
        ${TRIGGERS.map((type) => {
    const live = liveTypes.includes(type);
    return html`<${Row}
            title=${html`<${Text} kind="mono">${type}<//>`}
            why=${P('trigger_' + type)}
            chip=${html`<${Badge} type=${live ? 'healthy' : 'critical'} label=${live ? P('sends') : P('off')} />`}
            value=${live ? P('inTheList') : P('notInTheList')} />`;
  })}
        <${Text} kind="caption" tone="muted">${P('triggersNote')} <${Text} kind="mono">${liveTypes.join(',') || P('emptyList')}<//><//>
      <//>

      <${Section} title=${P('messages')} count=${no.messages} description=${P('messagesLead')}
        actions=${html`
          ${locales.map((l) => html`<${Action} key=${l} kind="tab" selected=${tplLocale === l} onClick=${() => setTplLocale(l)}>${l.toUpperCase()}<//>`)}
          <${Action} tone="danger" onClick=${askReset}>${P('resetBtn')}<//>`}>
        ${localeTpls.map((tpl) => {
    const isWebPush = String(tpl.id).startsWith('web_push');
    const open = openTpl === tpl.id;
    const key = `${tpl.id}::${tpl.locale}`;
    return html`
          <${ListRow} key=${key} name=${isWebPush ? P('tplWebPush') : P('tplEmail')}
            detail=${isWebPush ? P('tplWebPushWhy') : P('tplEmailWhy')} detailKind="text"
            value=${html`<${Badge} type=${tpl.is_default ? 'muted' : 'watch'} label=${tpl.is_default ? P('default') : P('edited')} />`}
            onOpen=${() => setOpenTpl(open ? null : tpl.id)} open=${open} arrow=${true}>
            ${open && html`
            <${Stack}>
              ${tpl.placeholders?.length ? html`
              <${Stack} direction="wrap" align="center" density="compact">
                <${Text} kind="label">${P('placeholders')}<//>
                ${tpl.placeholders.map((p) => html`<${Chip} key=${p}>${p}<//>`)}
              <//>` : null}
              <${Field} label=${isWebPush ? P('fieldTitle') : P('fieldSubject')} value=${fieldOf(tpl, isWebPush ? 'title' : 'subject')}
                onInput=${(e) => setField(tpl, isWebPush ? 'title' : 'subject', e.target.value)} />
              <${Field} type="textarea" rows=${isWebPush ? 2 : 5} label=${P('fieldBody')} value=${fieldOf(tpl, 'body')}
                onInput=${(e) => setField(tpl, 'body', e.target.value)} />
              <${Stack} direction="wrap" align="center">
                <${Action} disabled=${saving === key || !isDirty(tpl)} onClick=${() => saveTemplate(tpl)}>
                  ${saving === key ? t('dashboard.saving') : t('dashboard.save')}<//>
                ${!isDirty(tpl) && html`<${Text} kind="caption" tone="muted">${P('nothingToSave')}<//>`}
              <//>
            <//>`}
          <//>`;
  })}
      <//>

      <${Section} title=${P('subs')} count=${no.subs}>
        <${Stack}>
          ${!subs.length
    ? html`<${Text} tone="muted">${t('dashboard.noSubscriptions')}<//>`
    : html`<${Table} collapse=${640}
            headers=${[P('colOwner'), P('colEndpoint'), P('colCreated'), P('colUsed')]}
            rows=${subs.map((s) => {
    const age = daysSince(s.last_used_at);
    const stale = age !== null && age >= STALE_DAYS;
    return [
      html`<strong>${s.owner_name || '–'}</strong>`,
      { text: s.endpoint || '–', mono: true, clamp: true, title: s.endpoint || '' },
      { text: when(s.created_at), mono: true },
      stale
        ? html`<${Text} kind="mono" tone="coral">${s.last_used_at ? when(s.last_used_at) : P('never')}<//>`
        : { text: s.last_used_at ? when(s.last_used_at) : P('never'), mono: true },
    ];
  })} />`}
          <${Text} kind="caption" tone="muted">${P('subsNote')}<//>
        <//>
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
