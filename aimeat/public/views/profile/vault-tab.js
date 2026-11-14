/**
 * @file public/views/profile/vault-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: Vault (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen,
 *   design canvas "Holvi"). Secret shares a person gives and receives: keys, passwords,
 *   configurations and files that nobody sees after they are stored except the people the maker
 *   allowed. This file is the state and the handlers over the routes of src/routes/secret-shares.ts:
 *   the four lists, one share opened with its events, the Share and Ask forms, revoke, and this
 *   browser's device key for end-to-end shares (public/js/vault-crypto.js). The render is
 *   vault/cover.js and vault/dialogs.js.
 *
 *   AN END-TO-END SHARE IS SEALED HERE. The page reads the named people's registered device keys
 *   (GET /v1/vault/device-keys/of/:who) and the maker's own, makes the pickup code itself when one is
 *   asked for, seals the content in this browser and sends only what the node cannot open.
 *
 *   LIVE: the node announces every change as the `secret-shares` domain on the SSE stream; the page
 *   reads the lists again (and the opened share) on that event, never on a timer.
 * @structure VaultTab() — state + handlers → renderVaultView(ctx)
 * @usage registered in profile.js TABS as id 'vault'.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { useConfirm } from '/components/Modal.js';
import { getSession, getNodeId } from '/js/services/auth.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { newPickupCode, newDeviceKeyPair, saveDeviceKey, loadDeviceKey, forgetDeviceKey, deviceLabel } from '/js/vault-crypto.js';
import { renderVaultView } from './vault/cover.js';
import { x, api, errWords, accountOf } from './vault/frame.js';
import { emptyForm, formErrors, bodyOf } from './vault/dialogs.js';
import { plainBody, e2eBody } from './vault/content.js';

/** An account name or GHII as the node resolves it (services/secret-shares/service.ts resolvePeople). */
const ghiiOf = (who, nodeId) => {
  const w = String(who || '').trim().toLowerCase();
  return w.includes('@') ? w : `${w}@${nodeId}`;
};

export default function VaultTab({ session, showToast }) {
  const sess = session || getSession();
  const nodeId = getNodeId();
  const ownerGhii = sess?.ghii || '';
  const { confirm, ConfirmUI } = useConfirm();
  const toast = (msg, isError) => showToast?.(msg, isError);
  const cryptoReady = typeof globalThis.crypto?.subtle !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';

  const [lists, setLists] = useState(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orgs, setOrgs] = useState(null);
  const [keys, setKeys] = useState(null);
  const [localKey, setLocalKey] = useState(null);

  const load = useCallback(async () => {
    try { setLists(await api.list()); setFailed(false); }
    catch (e) { swallowed('vault-tab: list', e); setFailed(true); }
  }, []);
  const loadKeys = useCallback(async () => {
    try { setKeys(await api.deviceKeys()); } catch (e) { swallowed('vault-tab: device keys', e); setKeys([]); }
    try { setLocalKey(await loadDeviceKey(ownerGhii)); } catch (e) { swallowed('vault-tab: local key', e); setLocalKey(null); }
  }, [ownerGhii]);
  const loadDetail = useCallback(async (id) => {
    try { setDetail(await api.get(id)); setDetailFailed(false); }
    catch (e) { swallowed('vault-tab: one share', e); setDetailFailed(true); }
  }, []);
  const loadOrgs = useCallback(async () => {
    try {
      const tab = await getOrganismsTab();
      setOrgs((tab?.mine || []).map((o) => ({ id: o.id, name: o.name })));
    } catch (e) { swallowed('vault-tab: organisms', e); setOrgs([]); }
  }, []);

  useEffect(() => { load(); loadKeys(); loadOrgs(); }, [load, loadKeys, loadOrgs]);
  useEffect(() => { if (openId) loadDetail(openId); }, [openId, loadDetail]);
  const liveRef = useRef(null);
  liveRef.current = () => { load(); loadKeys(); if (openId) loadDetail(openId); };
  useEffect(() => onLiveUpdate(['secret-shares'], () => liveRef.current()), []);

  const orgName = (id) => (id ? (orgs || []).find((o) => o.id === id)?.name || id : '');
  const toggleOpen = (id) => { setDetail(null); setDetailFailed(false); setOpenId((cur) => (cur === id ? null : id)); };

  /* ── The forms ────────────────────────────────────────────────────────────────────────────── */
  const openShare = () => setDialog({ kind: 'share', form: emptyForm('share', ownerGhii), tried: false, error: '' });
  const openAsk = () => setDialog({ kind: 'ask', form: emptyForm('ask', ownerGhii), tried: false, error: '' });
  const setForm = (patch) => setDialog((d) => {
    if (!d || !d.form) return d;
    const f = { ...d.form, ...patch };
    // End-to-end opens only on a named person's device: agents and an organism's members cannot be
    // recipients of one, and a request filled end-to-end cannot also open with a code.
    if (patch.protection === 'e2e') { f.agents = false; f.organism = false; if (f.kind === 'ask') f.code = false; }
    return { ...d, form: f, error: '' };
  });
  const addPerson = (field, draftField) => setDialog((d) => {
    if (!d || !d.form) return d;
    const raw = d.form[draftField].trim();
    if (!raw) return d;
    const g = ghiiOf(raw, nodeId);
    const list = d.form[field].includes(g) ? d.form[field] : [...d.form[field], g];
    return { ...d, form: { ...d.form, [field]: list, [draftField]: '' }, error: '' };
  });
  const removePerson = (field, g) => setDialog((d) => (d && d.form ? { ...d, form: { ...d.form, [field]: d.form[field].filter((p) => p !== g) } } : d));

  /** Every registered device of the named people and of the maker, for an end-to-end share. */
  const devicesFor = async (people) => {
    const out = [];
    const seen = new Set();
    for (const who of [...people, ownerGhii]) {
      const got = await api.keysOf(who);
      const list = got?.keys || [];
      if (!list.length && who !== ownerGhii) {
        const err = new Error(x('err.noDeviceFor', { who: accountOf(who, nodeId) }));
        err.code = 'LOCAL';
        throw err;
      }
      for (const k of list) {
        const id = `${got.ghii}|${k.key_id}`;
        if (!seen.has(id)) { seen.add(id); out.push({ ghii: got.ghii, key_id: k.key_id, public_key: k.public_key }); }
      }
    }
    return out;
  };

  const submit = async () => {
    const d = dialog;
    if (!d || !d.form) return;
    // A name typed but not added yet is added, as a person would expect.
    const f = { ...d.form };
    for (const [field, draft] of [['people', 'personDraft'], ['depositors', 'depositorDraft']]) {
      if (f[draft].trim()) { const g = ghiiOf(f[draft], nodeId); if (!f[field].includes(g)) f[field] = [...f[field], g]; f[draft] = ''; }
    }
    if (Object.keys(formErrors(f)).length) { setDialog({ ...d, form: f, tried: true }); return; }
    setDialog({ ...d, form: f });
    setBusy(true);
    try {
      const terms = bodyOf(f);
      let body = terms;
      let code = null;
      if (f.kind === 'share') {
        if (f.protection === 'e2e') {
          if (!cryptoReady) { const err = new Error(x('device.noCrypto')); err.code = 'LOCAL'; throw err; }
          code = terms.recipients.code ? newPickupCode() : null;
          body = { ...terms, ...(await e2eBody(f.content, await devicesFor(f.people), code)) };
        } else {
          body = { ...terms, ...plainBody(f.content) };
        }
      }
      const out = await api.create(body);
      setDialog({
        kind: 'once', request: f.kind === 'ask', name: out.share.name,
        code: out.code || code || '', pickupUrl: out.pickup_url || '', depositUrl: out.deposit_url || '',
      });
      toast(f.kind === 'ask' ? x('asked', { name: out.share.name }) : x('shared', { name: out.share.name }));
      load();
    } catch (e) {
      swallowed('vault-tab: create', e);
      setDialog((cur) => (cur && cur.form ? { ...cur, error: errWords(e) } : cur));
    } finally { setBusy(false); }
  };

  /* ── Revoke ───────────────────────────────────────────────────────────────────────────────── */
  const revoke = (s) => confirm(x('revokeConfirm', { name: s.name }), async () => {
    setBusy(true);
    try { await api.revoke(s.id); toast(x('revoked', { name: s.name })); await load(); if (openId === s.id) await loadDetail(s.id); }
    catch (e) { toast(errWords(e), true); }
    finally { setBusy(false); }
  }, { danger: true, title: x('revokeTitle'), confirmLabel: x('revoke') });

  /* ── This browser's device key ────────────────────────────────────────────────────────────── */
  const registerKey = async () => {
    setBusy(true);
    try {
      // A key this browser already holds is registered again as it is; otherwise a new pair is made.
      let rec = await loadDeviceKey(ownerGhii);
      let publicJwk = rec?.publicJwk;
      let privateKey = rec?.privateKey;
      if (!rec) { const pair = await newDeviceKeyPair(); publicJwk = pair.publicJwk; privateKey = pair.privateKey; }
      const label = rec?.label || deviceLabel();
      const out = await api.registerKey({ public_key: publicJwk, label });
      rec = { privateKey, publicJwk, keyId: out.key_id, label: out.label || label, createdAt: out.created_at || new Date().toISOString() };
      await saveDeviceKey(ownerGhii, rec);
      toast(x('device.registered'));
      await loadKeys();
    } catch (e) { swallowed('vault-tab: register key', e); toast(errWords(e), true); }
    finally { setBusy(false); }
  };
  const removeKey = (k) => {
    const mine = localKey && localKey.keyId === k.key_id;
    confirm(mine ? x('device.removeThisConfirm') : x('device.removeConfirm', { label: k.label || k.key_id }), async () => {
      setBusy(true);
      try {
        await api.removeKey(k.key_id);
        if (mine) await forgetDeviceKey(ownerGhii);
        toast(x('device.removed'));
        await loadKeys();
      } catch (e) { toast(errWords(e), true); }
      finally { setBusy(false); }
    }, { danger: true, title: x('device.removeTitle'), confirmLabel: x('device.remove') });
  };

  const ctx = {
    nodeId, ownerGhii, lists, failed, reload: load, openId, toggleOpen, detail, detailFailed, orgs, orgName,
    dialog, closeDialog: () => setDialog(null), busy, ConfirmUI, openShare, openAsk, setForm, addPerson, removePerson,
    submit, revoke, keys, localKey, cryptoReady, registerKey, removeKey,
  };
  return renderVaultView(ctx);
}
