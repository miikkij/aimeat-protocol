/**
 * @file public/views/admin/push-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Push page in the poster face (design canvas "AIMEAT Admin Push"). Sections in
 *   the order an operator asks: is it on, how do I switch it on when it is not, can I test it here,
 *   what sends a push, what does it say, and who receives it. The four writes go through the same
 *   routes as before. Two things the page could not say before it can now: whether the VAPID keys
 *   are set, and which of the four trigger types AIMEAT_PUSH_NOTIFY_TYPES actually lists. The page
 *   draws library components and passes them data; it writes no class.
 *
 * @structure
 *   - PushTab({ data, reload, switchPage }) — the sections, the strip and the actions
 *   - TRIGGERS: the four mailbox event types the code can send, checked against the live setting
 *   - Templates: one List row per message, opened in place, edits held in state until Save
 *   - subscribe / test / unsubscribe / saveTemplate / resetTemplates: call admin service
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — The page draws library components (Section, Verdict, Readings,
 *     FigureStrip, StepList, Tabs, List, TextField, TextArea, Loud, Action, Note, Code) and writes no
 *     class; admin-push.css goes. A template is a List row that opens its fields in the raised box
 *     under it, the language chips are filter tabs, and a subscription row says each column's name
 *     on a phone. A subscription unused for 30 days keeps its coral date.
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
import { num, when, Badge, Empty, useToast, Toast } from './shared.js';
import * as api from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { StepList } from '/components/StepList.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row as ListRow, Name, Cell, When } from '/components/List.js';
import { TextField, TextArea } from '/components/TextField.js';
import { FormActions } from '/components/Field.js';
import { Loud, Action } from '/components/Action.js';
import { Stack, Row } from '/components/Layout.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';

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

/** The keys to set, as the lines to copy into the node's environment. */
const VAPID_LINES = 'AIMEAT_VAPID_PUBLIC_KEY="…"\nAIMEAT_VAPID_PRIVATE_KEY="…"\nAIMEAT_VAPID_SUBJECT="mailto:operator@example.com"';

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

  /** One template, opened: its placeholders, its two fields, and Save. */
  const editor = (tpl, isWebPush) => {
    const key = `${tpl.id}::${tpl.locale}`;
    const titleField = isWebPush ? 'title' : 'subject';
    return html`
      <${Stack} gap="medium">
        ${tpl.placeholders?.length ? html`
          <${Row} wrap align="baseline">
            <${Note} kind="meta" inline>${P('placeholders')}<//>
            ${tpl.placeholders.map((p) => html`<${Code} key=${p}>${p}<//>`)}
          <//>` : null}
        <${TextField} label=${isWebPush ? P('fieldTitle') : P('fieldSubject')} value=${fieldOf(tpl, titleField)}
          onInput=${(v) => setField(tpl, titleField, v)} />
        <${TextArea} label=${P('fieldBody')} rows=${isWebPush ? 2 : 5} value=${fieldOf(tpl, 'body')}
          onInput=${(v) => setField(tpl, 'body', v)} />
        <${FormActions}>
          <${Loud} control disabled=${saving === key || !isDirty(tpl)} onClick=${() => saveTemplate(tpl)}>
            ${saving === key ? t('dashboard.saving') : t('dashboard.save')}<//>
          ${!isDirty(tpl) && html`<${Note} slab>${P('nothingToSave')}<//>`}
        <//>
      <//>`;
  };

  const languages = html`<${Tabs} tone="filter" value=${tplLocale} onSelect=${setTplLocale} label=${P('messages')}
    items=${locales.map((l) => ({ value: l, label: l.toUpperCase() }))} />`;

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${Section} num=${no.now} title=${P('now')} first
      doors=${html`<${Action} small soft onClick=${() => switchPage('email')}>${P('toEmail')}<//>`}>
      <${Verdict} word=${statusWord} tone=${serviceOn ? undefined : 'danger'} line=${statusLine}
        stamp=${(data.dash || {}).node_id || ''}>
        <${Readings} rows=${[
          { key: 'service', name: P('rowService'), why: P('rowServiceWhy'),
            mark: html`<${Badge} type=${switchOn ? 'healthy' : 'critical'} label=${switchOn ? P('on') : P('off')} />`,
            value: 'AIMEAT_PUSH_ENABLED=' + (switchOn ? 'true' : 'false') },
          { key: 'keys', name: P('rowKeys'), why: P('rowKeysWhy'),
            mark: html`<${Badge} type=${vapidOk ? 'healthy' : 'critical'} label=${vapidOk ? P('set') : P('missing')} />`,
            value: vapidOk ? keyEnds(push.vapid_public_key) : P('notSet') },
          { key: 'subs', name: P('rowSubs'), why: P('rowSubsWhy'),
            mark: html`<${Badge} type="muted" label=${num(subCount)} />`,
            value: owners.size === 1 ? P('nOwnersOne') : P('nOwners', { n: num(owners.size) }) },
          { key: 'this', name: P('rowThis'), why: P('rowThisWhy'), last: true,
            mark: html`<${Badge} type=${thisBrowser ? 'healthy' : 'muted'}
              label=${thisBrowser === null ? P('checking') : (thisBrowser ? P('subscribed') : P('no'))} />`,
            value: thisBrowser ? P('viaServiceWorker') : '–' },
        ]} />
      <//>
    <//>

    <${FigureStrip} wrap items=${[
      { key: 'subs', n: num(subCount), label: P('stripSubs'), sub: P('stripSubsSub') },
      { key: 'owners', n: num(owners.size), label: P('stripOwners'), sub: P('stripOwnersSub') },
      { key: 'stale', n: num(stale), tone: stale ? 'notice' : undefined, label: P('stripStale'), sub: P('stripStaleSub', { d: STALE_DAYS }) },
      { key: 'edited', n: num(edited), label: P('stripEdited', { all: num(templates.length) }), sub: P('stripEditedSub') },
    ]} />

    ${showSetup && html`
    <${Section} num=${no.setup} title=${P('setup')}>
      <${Note} kind="lead">${P('setupLead')}<//>
      <${StepList} steps=${[
        html`<${Stack} gap="tight">${P('step1')}<${Code} block>npx web-push generate-vapid-keys<//><//>`,
        html`<${Stack} gap="tight">${P('step2')}<${Code} block>${VAPID_LINES}<//><//>`,
        P('step3'),
      ]} />
      <${Note}>${P('setupNote')}<//>
    <//>`}

    <${Section} num=${no.browser} title=${P('browser')}>
      <${Note} kind="lead">${P('browserLead')}<//>
      <${FormActions}>
        ${thisBrowser
    ? html`<${Action} small soft disabled=${busy === 'test' || !subs.length} onClick=${sendTest}>
        ${busy === 'test' ? P('testSending') : P('testBtn')}<//>`
    : html`<${Loud} control disabled=${!vapidOk || busy === 'subscribe'} onClick=${subscribe}>
        ${busy === 'subscribe' ? P('subscribing') : P('subscribeBtn')}<//>`}
        ${thisBrowser && html`<${Action} small soft tone="danger" disabled=${busy === 'unsubscribe'} onClick=${unsubscribe}>
          ${busy === 'unsubscribe' ? P('unsubscribing') : P('unsubscribeBtn')}<//>`}
        ${!vapidOk && html`<${Note} slab>${P('waitingForKeys')}<//>`}
      <//>
      ${said && html`<${Note} kind="message" error=${!said.ok}>${said.msg}<//>`}
      <${Note}>${P('browserNote')}<//>
    <//>

    <${Section} num=${no.triggers} title=${P('triggers')}>
      <${Note} kind="lead">${P('triggersLead')}<//>
      <${Readings} rows=${TRIGGERS.map((type, i) => {
    const live = liveTypes.includes(type);
    return {
      key: type,
      name: html`<${Code}>${type}<//>`,
      why: P('trigger_' + type),
      mark: html`<${Badge} type=${live ? 'healthy' : 'critical'} label=${live ? P('sends') : P('off')} />`,
      value: live ? P('inTheList') : P('notInTheList'),
      last: i === TRIGGERS.length - 1,
    };
  })} />
      <${Note}>${P('triggersNote')} <${Code}>${liveTypes.join(',') || P('emptyList')}<//><//>
    <//>

    <${Section} num=${no.messages} title=${P('messages')}
      doors=${html`${languages}<${Action} small soft tone="danger" onClick=${askReset}>${P('resetBtn')}<//>`}>
      <${Note} kind="lead">${P('messagesLead')}<//>
      <${List} cols="name-tags-doors" keepCols>
        ${localeTpls.map((tpl) => {
    const isWebPush = String(tpl.id).startsWith('web_push');
    const open = openTpl === tpl.id;
    return html`
          <${ListRow} key=${tpl.id} open=${open} onToggle=${() => setOpenTpl(open ? null : tpl.id)}
            panel=${open ? editor(tpl, isWebPush) : null}>
            <${Name} desc=${isWebPush ? P('tplWebPushWhy') : P('tplEmailWhy')}>${isWebPush ? P('tplWebPush') : P('tplEmail')}<//>
            <${Cell}><${Badge} type=${tpl.is_default ? 'muted' : 'watch'} label=${tpl.is_default ? P('default') : P('edited')} /><//>
            <${Cell} sign>${open ? '↑' : '↓'}<//>
          <//>`;
  })}
      <//>
    <//>

    <${Section} num=${no.subs} title=${P('subs')}>
      <${List} cols="name-code-when-when" labels empty=${t('dashboard.noSubscriptions')}
        head=${[P('colOwner'), P('colEndpoint'), P('colCreated'), P('colUsed')]}>
        ${subs.map((s, i) => {
    const age = daysSince(s.last_used_at);
    return html`
          <${ListRow} key=${s.endpoint || i}>
            <${Name}>${s.owner_name || '–'}<//>
            <${Cell} meta>${s.endpoint || '–'}<//>
            <${When}>${when(s.created_at)}<//>
            <${When} warn=${age !== null && age >= STALE_DAYS}>${s.last_used_at ? when(s.last_used_at) : P('never')}<//>
          <//>`;
  })}
      <//>
      <${Note}>${P('subsNote')}<//>
    <//>

    <${ConfirmUI} />`;
}
