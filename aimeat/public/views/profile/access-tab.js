/**
 * @file access-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: Access in the poster face. Who holds a key to this account and how far
 *   it reaches: how you sign in (password, passkeys, two-step, the open sessions grouped, the servers
 *   allowed to verify you, the recovery key), the apps and tokens that act in your name with their
 *   rights in words, your accounts at other services, the sharing groups, your addresses for an AI,
 *   and how your AI reads the same page. This file holds the reads and the handlers: the one
 *   composite mount (GET /v1/access/overview), revoking a key, taking one right away from an app,
 *   the spending ceiling, minting a token, signing every other device out, the servers list, the
 *   passkey slab. The render is access/page.js and access/rows.js; the words are access/frame.js.
 *
 *   TWO-STEP AND PASSKEYS ARE THE SECURITY TAB'S PANELS, mounted here. The Security tab sits in the
 *   operator-only group, so until 2026-09-05 a member could not reach either; the panels moved with
 *   the person, and the ceremony stayed in one place.
 *
 *   THE SECRETS SECTION READS ITS OWN ROUTE, not the composite. A secret's list is a different
 *   store with a different refusal — a server that does not keep secrets answers 404 — and folding
 *   it into GET /v1/access/overview would have made the whole page fail on a capability the page
 *   can live without. So it is a second read, with its own "could not be read" line, and the rest
 *   of the page never notices.
 * @structure AccessTab() — state + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'access'
 * @version-history
 *   v2.1.0 — 2026-09-06 — SECRETS, section 04. The owner's vault said in the page's own register:
 *     the list with what each secret is used by, one write-only field to add a secret and the same
 *     field on a row to replace it, and a delete behind the confirm. A value is written once and
 *     never read back — this page cannot show one, because nothing outside the server can.
 *   v2.0.0 — 2026-09-05 — The poster face (design canvas "AIMEAT Pääsy-sivu", direction A): the
 *     sign-in state and sessions on this page, keys in one list said in words with the base package
 *     said once, a right taken away without revoking the key, the token form as a fold with a 30-day
 *     default, agent defaults moved to Your agents. The composite read is v2.
 *   v1.7.0 — 2026-08-08 — Copy labels resolve from the shared common.copy keys.
 *   v1.6.0 — 2026-07-16 — Mount folds the 6-request fan-out into ONE GET /v1/access/overview.
 *   v1.0.0 — 2026-03-16 — Initial access tab.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from '/js/api.js';
import { getNodeUrl, passkeySupported, addPasskey } from '/js/services/auth.js';
import { renderPage } from './access/page.js';
import { x, keyRows, filterRows } from './access/frame.js';

const FIRST_KEYS = 12;
/** What the vault accepts as a name, and how much value it carries. Both are the route's own. */
const SECRET_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET_MAX_BYTES = 4096;
const EMPTY_SECRET = { open: false, name: '', value: '' };
/** The value's size as the server counts it: bytes, not characters. */
const byteLength = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : String(s).length);
/** The rights a scoped token may be given, in the order the form lists them. */
const TOKEN_SCOPES = ['memory:read', 'memory:write', 'memory:delete', 'work:request', 'work:read', 'work:accept', 'work:publish', 'social:read', 'social:write', 'wallet:read', 'consent:manage', 'catalogue:read', 'task:read', 'task:write', 'task:manage', 'cortex:write', 'ext:write'];
const EMPTY_FORM = { open: false, label: '', level: 'scoped', scopes: {}, expiry: '2592000' };
const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 7000); };
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error');

/**
 * The prompt a person hands their AI with a fresh token. English, like every prompt string on the
 * node: it is read by a model, not by the person, and it says what the token opens.
 */
function agentPrompt(data) {
  const url = typeof window !== 'undefined' ? window.location.origin : '';
  const level = data.grant_operator ? 'operator (full node control)'
    : data.grant_owner ? 'owner (acts as me)'
    : `scoped agent (${(data.scopes || []).join(', ') || 'no scopes'})`;
  const until = data.expires_at ? `It expires on ${data.expires_at.slice(0, 10)}.` : 'It does not expire; I will revoke it by hand.';
  return `I'm giving you an AIMEAT access token so you can log in to my node (${url}) as ${level} and act for me within those limits. ${until}

Use it by adding this HTTP header to your requests (and, for browser testing, set it as an extra header in your browser automation so every request the page makes carries it):

  Authorization: Bearer ${data.token}

The server recognizes the token and treats every request as if I'm logged in at that level. Do what I ask within the token's limits and tell me what you find.`;
}

export default function AccessTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [ov, setOv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilterState] = useState('all');
  const [openKey, setOpenKey] = useState(null);
  const [shownKeys, setShownKeys] = useState(FIRST_KEYS);
  const [form, setFormState] = useState(EMPTY_FORM);
  const [created, setCreated] = useState(null);
  const [formMsg, setFormMsg] = useState(null);
  const [spendDraft, setSpendDraftState] = useState({});
  const [fedInput, setFedInput] = useState('');
  const [keyShown, setKeyShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState(null);
  const [secretsFailed, setSecretsFailed] = useState(false);
  const [secretForm, setSecretFormState] = useState(EMPTY_SECRET);
  const [secretMsg, setSecretMsg] = useState(null);
  const [replaceName, setReplaceName] = useState(null);
  const [replaceValue, setReplaceValue] = useState('');

  const toast = (m, isErr) => showToast?.(m, !!isErr);
  const isOperator = (session?.roles || []).includes('operator');
  const nodeUrl = getNodeUrl();
  const ghii = session?.ghii || '';
  const nodeId = ghii.includes('@') ? ghii.slice(ghii.indexOf('@') + 1) : '';
  const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;

  /* ── Reads ─────────────────────────────────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/access/overview');
      // The shape, not only the presence: a reply without the sign-in block (a node restarting,
      // an older node behind a proxy) crashed the page on `sign_in.two_factor` on 2026-09-05.
      if (!r?.data?.sign_in) throw new Error('no overview');
      setOv(r.data);
      setFailed(false);
    } catch (e) { swallowed('access-tab: overview', e); setFailed(true); }
  }, []);
  /**
   * The vault's names — never a value; the route does not carry one and this page could not show
   * it if it did. A server without the route answers 404, which is a page with no secrets on it
   * rather than a page that failed.
   */
  const loadSecrets = useCallback(async () => {
    try {
      const r = await apiGet('/v1/secrets');
      const list = r?.data?.secrets;
      if (!Array.isArray(list)) throw new Error('no secrets');
      setSecrets(list);
      setSecretsFailed(false);
    } catch (e) { swallowed('access-tab: secrets', e); setSecrets([]); setSecretsFailed(true); }
  }, []);

  const loadAll = useCallback(async () => { await Promise.all([load(), loadSecrets()]); }, [load, loadSecrets]);
  useEffect(() => { loadAll(); }, [loadAll]);
  const loadRef = useRef(loadAll);
  loadRef.current = loadAll;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  /* ── What the page reads off the state ─────────────────────────────────────────────────────── */

  const rows = useMemo(() => keyRows(ov), [ov]);
  const basePackage = ov?.base_package || [];
  const baseHolders = useMemo(() => rows.filter((r) => r.kind === 'app' && r.base).length, [rows]);
  const fed = useMemo(() => {
    const auth = (ov?.consent?.consents || []).filter((c) => c.scope === 'auth' && c.status === 'active');
    return { all: auth.some((c) => c.recipient === '*'), wildcard: auth.find((c) => c.recipient === '*') || null, nodes: auth.filter((c) => c.recipient !== '*') };
  }, [ov]);

  /* ── Handlers ──────────────────────────────────────────────────────────────────────────────── */

  const setFilter = (f) => { setFilterState(f); setOpenKey(null); setShownKeys(FIRST_KEYS); };
  const toggleKey = (id) => setOpenKey((cur) => (cur === id ? null : id));
  const showMoreKeys = () => setShownKeys((k) => k + 20);
  const setSpendDraft = (id, v) => setSpendDraftState((s) => ({ ...s, [id]: v }));

  const revokeKey = (row) => {
    const q = row.kind === 'app' ? x('confirmRevokeApp', { name: row.name }) : x('confirmRevokeToken', { name: row.name });
    confirm(q, async () => {
      setBusy(row.id);
      try {
        const r = row.kind === 'app' ? await apiDelete('/v1/app-grants/' + encodeURIComponent(row.id)) : await apiDelete('/v1/access/tokens/' + encodeURIComponent(row.id));
        if (r?.ok === false) throw r;
        toast(row.kind === 'app' ? x('revokedApp', { name: row.name }) : x('revokedToken', { name: row.name }));
        if (openKey === row.id) setOpenKey(null);
        await load();
      } catch (e) { toast(errText(e, x('revokeFailed')), true); }
      setBusy(false);
    }, { danger: true });
  };

  /** Take one right (a group of scope words) away from an app's key; the rest stays. */
  const takeAway = (row, group) => {
    const keep = row.scopes.filter((s) => !group.scopes.includes(s));
    if (!keep.length) { toast(x('open.lastRight'), true); return; }
    confirm(x('open.takeAwayConfirm', { name: row.name, right: group.text }), async () => {
      setBusy(row.id);
      try {
        const r = await apiPatch(`/v1/app-grants/${encodeURIComponent(row.id)}`, { scopes: keep });
        if (r?.ok === false) throw r;
        const minutes = Math.max(1, Math.round((r?.data?.applies_within_seconds || ov?.access_ttl_seconds || 900) / 60));
        toast(x('open.narrowed', { right: group.text, min: minutes }));
        await load();
      } catch (e) { toast(errText(e, x('open.narrowFailed')), true); }
      setBusy(false);
    }, { danger: true });
  };

  const setSpendCap = async (row, value, reset = false) => {
    setBusy(row.id);
    try {
      const body = reset ? { reset: true } : { cap_morsels: String(value ?? '').trim() === '' ? null : Math.max(0, Math.floor(Number(value))) };
      const r = await apiPatch(`/v1/app-grants/${encodeURIComponent(row.id)}/spend-cap`, body);
      if (r?.ok === false) throw r;
      toast(reset ? x('spend.resetDone') : x('spend.saved'));
      await load();
    } catch (e) { toast(errText(e, x('spend.failed')), true); }
    setBusy(false);
  };

  /** Every key not used for 30 days, in one go: apps and tokens alike, one delete each, the count told. */
  const revokeUnused = () => {
    const stale = filterRows(rows, 'unused');
    if (!stale.length) return;
    confirm(x('confirmRevokeUnused', { n: stale.length, days: 30, names: stale.slice(0, 5).map((r) => r.name).join(', ') + (stale.length > 5 ? ` +${stale.length - 5}` : '') }), async () => {
      setBusy('unused');
      let done = 0, failedN = 0;
      for (const row of stale) {
        try {
          const r = row.kind === 'app' ? await apiDelete('/v1/app-grants/' + encodeURIComponent(row.id)) : await apiDelete('/v1/access/tokens/' + encodeURIComponent(row.id));
          if (r?.ok === false) throw r;
          done++;
        } catch (e) { swallowed('access-tab: revoke unused', e); failedN++; }
      }
      toast(failedN ? x('revokedSome', { done, failed: failedN }) : x('revokedN', { n: done }), failedN > 0);
      setOpenKey(null);
      await load();
      setBusy(false);
    }, { danger: true });
  };

  const signOutOthers = () => {
    const others = Math.max(0, (ov?.sign_in?.sessions?.mine?.total || 1) - 1);
    confirm(x('signOutOthersConfirm', { n: others }), async () => {
      setBusy('sessions');
      try {
        const r = await apiDelete('/v1/auth/sessions/others');
        if (r?.ok === false) throw r;
        toast(x('signOutOthersDone', { n: r?.data?.revoked_sessions ?? others }));
        await load();
      } catch (e) { toast(errText(e, x('signOutOthersFailed')), true); }
      setBusy(false);
    }, { danger: true });
  };

  const addPasskeyNow = async () => {
    setBusy('passkey');
    try {
      await addPasskey(t('profile.security.passkeys.defaultLabel'));
      toast(t('profile.security.passkeys.added'));
      await load();
    } catch (e) {
      // Closing the device prompt is the person changing their mind, not a failure.
      if (e?.code !== 'PASSKEY_CANCELLED') toast(e?.message || t('profile.error'), true);
    }
    setBusy(false);
  };

  // The servers allowed to verify this identity for a remote sign-in: one consent per server, or
  // one wildcard for all of them. Same records the Data Wallet lists under "sign-in".
  const toggleFedAll = async () => {
    setBusy('fed');
    try {
      if (fed.wildcard) {
        const r = await apiDelete('/v1/consent/' + encodeURIComponent(fed.wildcard.id));
        if (r?.ok === false) throw r;
        toast(x('fed.restricted'));
      } else {
        const r = await apiPost('/v1/consent', { data_pattern: '_identity', recipient: '*', scope: 'auth', purpose: 'federation_login_all' });
        if (r?.ok === false) throw r;
        toast(x('fed.allowedAll'));
      }
      await load();
    } catch (e) { toast(errText(e, x('fed.failed')), true); }
    setBusy(false);
  };
  const addFedNode = async () => {
    const id = fedInput.trim();
    if (!id) return;
    setBusy('fed');
    try {
      const r = await apiPost('/v1/consent', { data_pattern: '_identity', recipient: 'node:' + id, scope: 'auth', purpose: 'federation_login' });
      if (r?.ok === false) throw r;
      setFedInput('');
      toast(x('fed.added', { node: id }));
      await load();
    } catch (e) { toast(errText(e, x('fed.failed')), true); }
    setBusy(false);
  };
  const removeFedNode = async (c) => {
    setBusy(c.id);
    try {
      const r = await apiDelete('/v1/consent/' + encodeURIComponent(c.id));
      if (r?.ok === false) throw r;
      toast(x('fed.removed', { node: c.recipient.replace('node:', '') }));
      await load();
    } catch (e) { toast(errText(e, x('fed.failed')), true); }
    setBusy(false);
  };

  // The token form: a fold in section 02. Thirty days is the default; "never" is a choice.
  const setForm = (patch) => setFormState((f) => ({ ...f, ...patch }));
  const toggleForm = (open) => {
    const next = typeof open === 'boolean' ? open : !form.open;
    setForm({ open: next });
    setFormMsg(null);
    if (next) window.setTimeout(() => document.getElementById('ac-token')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const toggleScope = (s) => setFormState((f) => ({ ...f, scopes: { ...f.scopes, [s]: !f.scopes[s] } }));
  const clearCreated = () => { setCreated(null); setFormState({ ...EMPTY_FORM, open: false }); };
  const createToken = async () => {
    const flash = flashFor(setFormMsg);
    const label = form.label.trim();
    if (!label) { flash(x('form.needName'), true); return; }
    const scopes = Object.keys(form.scopes).filter((s) => form.scopes[s]);
    if (form.level === 'scoped' && !scopes.length) { flash(x('form.needScopes'), true); return; }
    setBusy('token');
    try {
      const body = { label, grant_owner: form.level === 'owner', grant_operator: form.level === 'operator', scopes: form.level === 'scoped' ? scopes : [] };
      if (form.expiry) body.expires_in = Number(form.expiry);
      const r = await apiPost('/v1/access/tokens', body);
      if (r?.ok === false || !r?.data?.token) throw r;
      setCreated({ token: r.data.token, prompt: agentPrompt(r.data) });
      setFormState((f) => ({ ...EMPTY_FORM, open: true, expiry: f.expiry }));
      toast(x('created.toast', { name: label }));
      await load();
    } catch (e) { flash(errText(e, x('createFailed')), true); }
    setBusy(false);
  };

  /* ── The vault ─────────────────────────────────────────────────────────────────────────────── */

  const setSecretForm = (patch) => setSecretFormState((f) => ({ ...f, ...patch }));
  const toggleSecretForm = (open) => {
    const next = typeof open === 'boolean' ? open : !secretForm.open;
    // A half-typed value is not carried anywhere: closing the form forgets it.
    setSecretFormState(next ? { ...EMPTY_SECRET, open: true } : EMPTY_SECRET);
    setSecretMsg(null);
    if (next) setReplaceName(null);
  };
  const openReplace = (name) => {
    setReplaceName((cur) => (cur === name ? null : name));
    setReplaceValue('');
    setSecretMsg(null);
  };

  /** The name and the value as the route reads them, or the words saying which one is wrong. */
  const secretRefusal = (name, value, checkName) => {
    if (checkName && !name) return x('secrets.needName');
    if (checkName && !SECRET_NAME.test(name)) return x('secrets.badName');
    if (!value) return x('secrets.needValue');
    if (byteLength(value) > SECRET_MAX_BYTES) return x('secrets.tooLong');
    return null;
  };

  /** Add or replace: one call either way, because replacing a secret is writing it again. */
  const writeSecret = async (name, value, replacing) => {
    const flash = flashFor(setSecretMsg);
    const bad = secretRefusal(name, value, !replacing);
    if (bad) { flash(bad, true); return; }
    setBusy('secret:' + name);
    try {
      const r = await apiPut('/v1/secrets/' + encodeURIComponent(name), { value });
      if (r?.ok === false) throw r;
      // The value leaves this browser and is forgotten here as well: nothing holds it after this.
      if (replacing) { setReplaceName(null); setReplaceValue(''); } else setSecretFormState(EMPTY_SECRET);
      toast(x(replacing ? 'secrets.replaced' : 'secrets.added', { name }));
      await loadSecrets();
    } catch (e) { flash(errText(e, x('secrets.failed')), true); }
    setBusy(false);
  };

  const deleteSecret = (row) => {
    confirm(x('secrets.confirmDelete', { name: row.name }), async () => {
      setBusy('secret:' + row.name);
      try {
        const r = await apiDelete('/v1/secrets/' + encodeURIComponent(row.name));
        if (r?.ok === false) throw r;
        if (replaceName === row.name) setReplaceName(null);
        toast(x('secrets.deleted', { name: row.name }));
        await loadSecrets();
      } catch (e) { toast(errText(e, x('secrets.deleteFailed')), true); }
      setBusy(false);
    }, { danger: true });
  };

  const ctx = {
    session, ov, failed, rows, basePackage, baseHolders, fed, filter, openKey, shownKeys, form, created, formMsg, spendDraft, fedInput, keyShown, busy,
    secrets, secretsFailed, secretForm, secretMsg, replaceName, replaceValue,
    setSecretForm, toggleSecretForm, openReplace, setReplaceValue, writeSecret, deleteSecret,
    isOperator, nodeUrl, nodeId, ghii, ownerKey, tokenScopes: TOKEN_SCOPES, passkeysSupported: passkeySupported(), showToast: toast, ConfirmUI,
    load, setFilter, toggleKey, showMoreKeys, setSpendDraft, revokeKey, takeAway, setSpendCap, revokeUnused, signOutOthers, addPasskeyNow,
    toggleFedAll, addFedNode, removeFedNode, setFedInput, setKeyShown, setForm, toggleForm, toggleScope, clearCreated, createToken,
  };
  return renderPage(ctx);
}
