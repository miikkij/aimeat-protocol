/**
 * @file public/views/appcat/detail-state.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The state of the app the detail view shows, and the acts on its working copy
 *   (features F299–F305, F309–F311, F313). One app at a time: its bytes (the published ones, replaced
 *   by the saved working copy when the listing says there is one, F301), whether a working copy is
 *   saved and when, the AI proposal waiting to be saved, the checkpoints, whether the person has an AI
 *   key, the version number the page holds (adopted from the server's newest, F313), and the About
 *   editor's open state. Nothing is kept in the browser's own storage: the working copy is the app's
 *   draft slot on the node and the checkpoints are the owner's private memory (workcopy.js).
 *
 *   Two counters keep late answers out: `seq` changes when another app opens (a late byte load is
 *   dropped), `wcEpoch` when a publish or a discard changes the working copy underneath (a late draft
 *   load cannot bring a working copy back to life, F301).
 *
 *   What About saves stays for the page session (F316): the name and the descriptions went to the
 *   node, the icon and the tags only to this page, as the old catalogue kept them in its working set.
 * @structure useDetailState() · detailState() · openApp(row, me) · serverOwner(stored, me) ·
 *   sessionEdit(ref) · setSessionEdit(ref, patch) · whenBytes() · currentText() · setVersion(n) ·
 *   bumpVersions() · setAboutEditing(on) · setProposal(b64, note) · discardProposal() · saveWork(b64, note) ·
 *   keepProposal() · stageAndPreview(b64) · publishBytes(b64) · openStagingPreview(owner, file) ·
 *   workTry() · workPublish() · workDiscard() · checkpointPreview(id, name) · checkpointRestore(id) ·
 *   checkpointDelete(id)
 * @usage const st = useDetailState(); if (st.hasWork) …
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's detail.js working-copy acts (detailAiKeep,
 *     detailWorkTry/Publish/Discard, detailCheckpoint*, stageDraftAndPreview, publishDraftBytes,
 *     openStagingPreview, detailLoadWorkingCopy) around one state object.
 */
import { useEffect, useState } from 'preact/hooks';
import { getSession } from '/js/services/auth.js';
import { x } from '/views/appcat/i18n.js';
import { notice, reloadCatalog, closeDetail } from '/views/appcat/store.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { sameOwner } from '/views/appcat/dialogs/app-io.js';
import { hasAiKey } from '/views/appcat/ai-calls.js';
import { openViewer, previewTarget } from '/views/appcat/viewer.js';
import * as wc from '/views/appcat/workcopy.js';

/**
 * @typedef {{ seq: number, wcEpoch: number, ref: string, owner: string, rowOwner: string, filename: string,
 *   me: string|null, isOwn: boolean, version: number, b64: string|null, bytes: 'idle'|'loading'|'ready'|'failed',
 *   hasWork: boolean, savedAt: string|null, proposal: string|null, proposalNote: string, checkpoints: any[]|null,
 *   ckBusy: boolean, ai: boolean|null, aboutEditing: boolean, versionsTick: number, shotAt: number }} DetailState
 */
/** @type {DetailState} */
const st = {
  seq: 0, wcEpoch: 0, ref: '', owner: '', rowOwner: '', filename: '', me: null, isOwn: false, version: 0,
  b64: null, bytes: 'idle', hasWork: false, savedAt: null, proposal: null, proposalNote: '',
  checkpoints: null, ckBusy: false, ai: null, aboutEditing: false, versionsTick: 0, shotAt: 0,
};
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
const set = (patch) => { Object.assign(st, patch); emit(); };
let bytesWait = Promise.resolve(null);

/** The state, re-rendering the caller on every change. */
export function useDetailState() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return st;
}

/** The state as it is now (for an act outside a render). */
export function detailState() { return st; }

/** ref → what About saved for this page session: { name, description, descriptions, icon, tags }. */
const sessionEdits = {};
export function sessionEdit(ref) { return sessionEdits[ref] || null; }
export function setSessionEdit(ref, patch) { sessionEdits[ref] = { ...(sessionEdits[ref] || {}), ...patch }; emit(); }

/**
 * The owner to use for the node's calls on this app (F352): the signed-in owner when the stored one
 * is empty, the same, or the legacy "anonymous" bucket, so an app re-owned from there does not 404.
 */
export function serverOwner(stored, me) {
  if (me && (!stored || stored === 'anonymous' || stored === me)) return me;
  return stored || '';
}

const signedIn = () => !!getSession();

/** Open the state for a listing row. The same app again only picks up a new signed-in person. */
export function openApp(row, me) {
  const ref = row ? row.owner + '/' + row.filename : '';
  if (ref === st.ref && me === st.me) return;
  const isOwn = !!row && sameOwner(row.owner, me);
  const owner = serverOwner(row ? row.owner : '', me);
  st.seq++;
  st.wcEpoch++;
  Object.assign(st, {
    ref, owner, rowOwner: row ? row.owner : '', filename: row ? row.filename : '', me: me || null, isOwn,
    version: (row && row.version_number) || 1, b64: null, bytes: row ? 'loading' : 'idle',
    hasWork: !!(isOwn && row && row.has_draft), savedAt: null, proposal: null, proposalNote: '',
    checkpoints: null, ckBusy: false, ai: null, aboutEditing: false, versionsTick: 0, shotAt: Date.now(),
  });
  emit();
  if (!row) { bytesWait = Promise.resolve(null); return; }
  const seq = st.seq;
  const epoch = st.wcEpoch;
  // The bytes the old page materialised for the detail (F115): the published ones, fetched with the
  // session when there is one; then the saved working copy over them (F301).
  bytesWait = wc.fetchAppBytes(row.owner, row.filename).then(
    async (b64) => {
      if (seq !== st.seq) return null;
      set({ b64, bytes: 'ready' });
      if (st.hasWork && signedIn()) {
        const d = await wc.getDraft(st.owner, st.filename);
        if (d && d.content && seq === st.seq && epoch === st.wcEpoch) set({ b64: d.content, savedAt: d.updated_at || st.savedAt });
      }
      return st.b64;
    },
    (err) => {
      if (seq !== st.seq) return null;
      set({ bytes: 'failed' });
      notice(x('detail.loadFailed', { msg: err.message || String(err) }), 'error');
      closeDetail();
      return null;
    });
  if (me) {
    wc.loadCheckpoints(st.owner, st.filename).then((items) => { if (seq === st.seq) set({ checkpoints: items }); });
  }
  hasAiKey().then((on) => { if (seq === st.seq) set({ ai: on }); });
}

/** The app's bytes (base64) once they are here: the working copy when one is saved, else the published. */
export function whenBytes() { return bytesWait.then(() => st.b64); }

/** The bytes as text, '' until they are here. */
export function currentText() { return st.b64 ? wc.b64ToText(st.b64) : ''; }

/** Adopt the server's newest version number (F313), so "Publish as v{n+1}" is right. */
export function setVersion(n) { if (n && n !== st.version) set({ version: n }); }

/** The versions list reads the node again (after a publish or a restore). */
export function bumpVersions() { set({ versionsTick: st.versionsTick + 1 }); }

/** Open or close the About editor (the toolbar's pencil opens it too, F124). */
export function setAboutEditing(on) { set({ aboutEditing: !!on }); }

/** The AI proposal (base64) and the change request behind it (the checkpoint's note, F311). */
export function setProposal(b64, note) { set({ proposal: b64, proposalNote: String(note || '') }); }
export function discardProposal() { set({ proposal: null, proposalNote: '' }); }

/**
 * Save bytes as the working copy (F303): the replaced bytes become a checkpoint, the new ones go to
 * the draft slot. Signed out, the bytes stay in this tab only (F305). Resolves { persisted }; rejects
 * with the node's refusal.
 */
export async function saveWork(nextB64, note) {
  if (!signedIn() || !st.filename) {
    set({ b64: nextB64 });
    return { persisted: false };
  }
  const seq = st.seq;
  await wc.saveWorkingCopy({ owner: st.owner, filename: st.filename, previousB64: st.b64, nextB64, note });
  if (seq !== st.seq) return { persisted: true };
  set({ b64: nextB64, hasWork: true, savedAt: new Date().toISOString(), checkpoints: wc.getCheckpoints(st.owner, st.filename) });
  return { persisted: true };
}

/** Save the AI proposal into the working copy; the proposal stays when the save fails. */
export async function keepProposal() {
  if (!st.proposal) return { persisted: false };
  const res = await saveWork(st.proposal, st.proposalNote);
  set({ proposal: null, proposalNote: '' });
  return res;
}

/** Why staging cannot happen here ('' when it can): it needs a published app and a session. */
function stageRefusal() {
  if (!st.filename) return x('detail.draftNeedsPublished');
  if (!signedIn()) return x('detail.draftNeedsSignin');
  return '';
}

/**
 * Put these bytes in the draft slot and open them on their real address in a new tab (F310 "Try it
 * safely"); the live app is untouched. Resolves { ok } or { error }.
 */
export async function stageAndPreview(b64) {
  const refused = stageRefusal();
  if (refused) return { error: refused };
  try {
    await wc.putDraft(st.owner, st.filename, b64);
    const data = await wc.draftCall(st.owner, st.filename, 'draft/preview-token');
    window.open(data.preview_url, '_blank', 'noopener');
    return { ok: true };
  } catch (err) {
    return { error: err.message || x('detail.draftPreviewFailed') };
  }
}

/**
 * Put these bytes in the draft slot and publish that draft as the next version, after asking
 * (F310 "Publish as v{n+1}"): exactly these bytes, never an older staged copy. `onStart` runs once
 * the person said yes. Resolves { data }, { declined: true } or { error }.
 */
export async function publishBytes(b64, onStart) {
  const refused = stageRefusal();
  if (refused) return { error: refused };
  if (!(await confirmAsk(x('detail.draftPublishConfirm')))) return { declined: true };
  onStart?.();
  try {
    await wc.putDraft(st.owner, st.filename, b64);
    const data = await wc.draftCall(st.owner, st.filename, 'publish-draft');
    st.wcEpoch++;
    set({ b64, proposal: null, proposalNote: '', hasWork: false, savedAt: null, version: data.version_number || st.version });
    bumpVersions();
    reloadCatalog();
    return { data };
  } catch (err) {
    return { error: err.message || x('detail.publishFailed') };
  }
}

/** Open the saved draft of an app on its real address in a new tab (F114). */
export async function openStagingPreview(owner, filename) {
  if (!signedIn()) { notice(x('detail.draftNeedsSignin'), 'error'); return; }
  if (!owner || !filename) { notice(x('detail.draftNeedsPublished'), 'error'); return; }
  try {
    const data = await wc.draftCall(owner, filename, 'draft/preview-token');
    window.open(data.preview_url, '_blank', 'noopener');
  } catch (err) {
    notice(err.message || x('detail.draftPreviewFailed'), 'error');
  }
}

/** "Try it safely" on the saved working copy (F300): the draft slot as it is, nothing re-uploaded. */
export function workTry() { return openStagingPreview(st.owner, st.filename); }

/**
 * Publish the saved working copy (F300). The draft slot is the truth, so nothing is uploaded first:
 * the bytes held here may be the published ones after a reload.
 */
export async function workPublish() {
  if (!st.filename) return;
  if (!signedIn()) { notice(x('wc.loginNeeded'), 'error'); return; }
  if (!(await confirmAsk(x('detail.draftPublishConfirm')))) return;
  try {
    const data = await wc.draftCall(st.owner, st.filename, 'publish-draft');
    st.wcEpoch++;
    set({ hasWork: false, savedAt: null, version: data.version_number || st.version });
    notice(x('detail.draftPublished', { v: data.version_number }), 'success');
    bumpVersions();
    reloadCatalog();
  } catch (err) {
    notice('✘ ' + (err.message || x('detail.publishFailed')), 'error');
  }
}

/** Throw the working copy away and read the live bytes back (F300). */
export async function workDiscard() {
  if (!st.filename) return;
  if (!(await confirmAsk(x('wc.confirmDiscardWork')))) return;
  const seq = st.seq;
  await wc.discardWorkingCopy(st.owner, st.filename);
  let b64 = st.b64;
  try { b64 = await wc.fetchAppBytes(st.rowOwner || st.owner, st.filename); } catch (err) { void err; /* keep what is held when the re-read fails */ }
  if (seq !== st.seq) return;
  st.wcEpoch++;
  set({ b64, hasWork: false, savedAt: null });
  reloadCatalog();
  notice(x('wc.discardedWork'), 'success');
}

/** Show a stored checkpoint in the sandboxed viewer, leaving the working copy as it is (F304). */
export async function checkpointPreview(id, name) {
  const b64 = await wc.readCheckpoint(st.owner, st.filename, id);
  if (!b64) { notice(x('wc.gone'), 'error'); return; }
  openViewer({ title: (name || x('detail.untitled')) + ' — ' + x('wc.previewTitle'), html: wc.b64ToText(b64), target: previewTarget(st.owner, st.filename) });
}

/**
 * Restore a checkpoint into the working copy (F304). Restoring is itself a save, so the state it
 * replaces is checkpointed first; the published app is untouched.
 */
export async function checkpointRestore(id) {
  if (st.ckBusy) return;
  if (!signedIn()) { notice(x('wc.loginNeeded'), 'error'); return; }
  if (!(await confirmAsk(x('wc.confirmRestore')))) return;
  set({ ckBusy: true });
  try {
    const b64 = await wc.readCheckpoint(st.owner, st.filename, id);
    if (!b64) throw new Error(x('wc.gone'));
    await saveWork(b64, x('wc.noteRestore'));
    set({ ckBusy: false });
    notice(x('wc.restored'), 'success');
  } catch (err) {
    set({ ckBusy: false });
    notice(err.message || x('wc.saveFailed'), 'error');
  }
}

/** Delete a checkpoint for good, after asking (F304). */
export async function checkpointDelete(id) {
  if (st.ckBusy) return;
  if (!(await confirmAsk(x('wc.confirmDelete')))) return;
  set({ ckBusy: true });
  try { await wc.deleteCheckpoint(st.owner, st.filename, id); } catch (err) { void err; /* the index here is already without it */ }
  set({ ckBusy: false, checkpoints: wc.getCheckpoints(st.owner, st.filename) });
}
