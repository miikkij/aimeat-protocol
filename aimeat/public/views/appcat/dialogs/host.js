/**
 * @file public/views/appcat/dialogs/host.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's dialogs: one host the shell draws once, and openDialog(name, props) any part
 *   calls to open one. Each dialog is its own file, /views/appcat/dialogs/<name>.js, exporting
 *   `default function <Name>Dialog(props)`; the host loads it by a lazy import the first time it is
 *   opened, so a dialog file can arrive later than the page. A name whose file is not there yet opens
 *   nothing and says so in the console.
 *
 *   Every dialog draws its frame with `Dialog` from this file: the site's one dialog
 *   (components/Modal.js over js/dialog.js and css/components/dialog.css, the same two files the old
 *   catalogue built into its page), so the header slab, the X, the body that alone scrolls, the footer
 *   and the phone sheet are the old catalogue's. The closing rules are the old catalogue's (features
 *   F176): the X always closes; Escape and a press on the page behind close only until something has
 *   been typed in the dialog, except in the dialogs that the old page left unguarded (help, confirm,
 *   source, versions, lineage, agents, consents), which Escape closes whatever was typed. A dialog's
 *   own closer (`onClose` on Dialog) runs for every way out, so a form resets, a question answers no,
 *   the source editor asks about unsaved edits. The guard starts clean each time a dialog opens,
 *   because each opening mounts a fresh dialog.
 *
 *   Focus (features §5) is the browser's own <dialog>: showModal() moves the focus into the dialog
 *   (to an element marked autofocus, else the first one that takes focus) and hands it back to where
 *   it was when the dialog closes. anyDialogOpen() lets the page's own keys stand aside while a dialog
 *   is open (F173).
 *
 *   One dialog is open at a time: opening another replaces it (the Add dialog's "generated" word
 *   closes Add and opens Generate, as the old page did). A question (confirmAsk in ./confirm.js) is a
 *   layer of its own over whatever is open, as the old page's confirm opened over the source editor.
 *
 *   Every dialog receives its props plus `close` (the host's closeDialog), and `dialog` (its own name;
 *   a prop called `name` is the caller's: an app's or an extension's name).
 * @structure DialogHost() · openDialog(name, props) · closeDialog() · currentDialog() · anyDialogOpen() ·
 *   Dialog({ title, titleRef, size, footer, footerStart, showClose, guard, onClose, children }) · UNGUARDED
 * @usage openDialog('add'); html`<${DialogHost} />`
 *   In a dialog file: html`<${Dialog} title=${x('publish.title')} size="md" footer=${…} onClose=${close}>…<//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: every dialog reads at the browser's own line spacing (Modal
 *     leading="normal"), as the old catalogue's dialogs did. Fix: the dialog's own name reaches it as
 *     `dialog`; it had been passed as `name` and overwrote the app's or extension's name the caller
 *     gave (the Consents target line said "consents", the Share prompt title "share-prompt").
 *   v1.0.0 — 2026-09-27 — The host: the lazy name → file map, the Dialog frame with the old
 *     catalogue's closing rules and their exempt dialogs, the question layer, anyDialogOpen.
 *   v0.1.0 — 2026-09-27 — The contract (the dialogs' builders fill it in).
 */
import { h, createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Modal } from '/components/Modal.js';
import { ConfirmLayer, confirmPending, subscribeConfirm } from '/views/appcat/dialogs/confirm.js';

const html = htm.bind(h);

/**
 * The dialogs by name, each a lazy import of its own file. A name that is not listed is still tried
 * as ./<name>.js, so a builder's new dialog works before it is listed here.
 */
const LOADERS = {
  add: () => import('/views/appcat/dialogs/add.js'),
  publish: () => import('/views/appcat/dialogs/publish.js'),
  backup: () => import('/views/appcat/dialogs/backup.js'),
  'backup-import': () => import('/views/appcat/dialogs/backup-import.js'),
  settings: () => import('/views/appcat/dialogs/settings.js'),
  help: () => import('/views/appcat/dialogs/help.js'),
  confirm: () => import('/views/appcat/dialogs/confirm.js'),
  generate: () => import('/views/appcat/dialogs/generate.js'),
  cortex: () => import('/views/appcat/dialogs/cortex.js'),
  'cortex-editor': () => import('/views/appcat/dialogs/cortex-editor.js'),
  lineage: () => import('/views/appcat/dialogs/lineage.js'),
  fork: () => import('/views/appcat/dialogs/fork.js'),
  subdomain: () => import('/views/appcat/dialogs/subdomain.js'),
  consents: () => import('/views/appcat/dialogs/consents.js'),
  protect: () => import('/views/appcat/dialogs/protect.js'),
  versions: () => import('/views/appcat/dialogs/versions.js'),
  agents: () => import('/views/appcat/dialogs/agents.js'),
  source: () => import('/views/appcat/dialogs/source.js'),
  'share-prompt': () => import('/views/appcat/dialogs/share-prompt.js'),
};

/**
 * The dialogs the old catalogue left unguarded (features F176): Escape and the page behind close them
 * even after something was typed. The source editor asks about unsaved edits itself.
 */
export const UNGUARDED = new Set(['help', 'confirm', 'source', 'versions', 'lineage', 'agents', 'consents']);

/** @type {{ name: string, props: object, seq: number } | null} */
let current = null;
let seq = 0;
const listeners = new Set();
/** @type {Record<string, any>} */
const loaded = {};
function emit() { for (const fn of listeners) fn(); }

/** Open a dialog by name with its props. An open one is replaced. */
export function openDialog(name, props = {}) {
  current = { name: String(name), props: props || {}, seq: ++seq };
  emit();
}

/** Close the open dialog (the question layer stays as it is). */
export function closeDialog() {
  if (!current) return;
  current = null;
  emit();
}

/** The name of the open dialog, or null. */
export function currentDialog() { return current ? current.name : null; }

/**
 * Whether any dialog is open: one of appcat's, a question, or any other <dialog> the site opened (the
 * sign-in dialog). The page's own keys stand aside while one is (F173).
 */
export function anyDialogOpen() {
  if (current || confirmPending()) return true;
  return typeof document !== 'undefined' && !!document.querySelector('dialog[open]');
}

/** What the open dialog is: its name and the host's closer, for the Dialog frame inside it. */
const DialogContext = createContext({ name: '', close: closeDialog });

/**
 * The frame every appcat dialog draws: the site's one dialog, with the old catalogue's guard for this
 * dialog's name. `onClose` is the dialog's own closer (default: close); `guard` overrides the name's rule.
 * `titleRef`: the thing the dialog is about after its title, in the typewriter face (a filename).
 * @param {{ title?: any, titleRef?: any, size?: ''|'sm'|'md'|'lg'|'xl', footer?: any, footerStart?: any, showClose?: boolean,
 *   guard?: boolean, onClose?: () => void, children?: any }} props
 */
export function Dialog({ title, titleRef, size = 'md', footer, footerStart, showClose = true, guard, onClose, children }) {
  const ctx = useContext(DialogContext);
  const guarded = guard !== undefined ? guard : !UNGUARDED.has(ctx.name);
  // leading="normal": the old catalogue's page set no line height on its body, so its dialogs read
  // at the browser's own; the SPA's body says 1.6 (parity with the old page).
  return html`<${Modal} open=${true} onClose=${onClose || ctx.close} title=${title} titleRef=${titleRef} size=${size} leading="normal"
    footer=${footer} footerStart=${footerStart} showClose=${showClose} guard=${guarded}>${children}<//>`;
}

/** Load a dialog's file once; resolves to its default export, or null when the file is not there. */
function load(name) {
  if (loaded[name]) return Promise.resolve(loaded[name]);
  const loader = LOADERS[name] || (/^[a-z][a-z0-9-]*$/.test(name) ? () => import(`/views/appcat/dialogs/${name}.js`) : null);
  if (!loader) return Promise.resolve(null);
  return loader().then(
    (mod) => { const C = mod.default || null; if (C) loaded[name] = C; return C; },
    (err) => {
      // A dialog whose file has not arrived yet: nothing opens, and the console says which one.
      console.warn(`[appcat] dialog "${name}" could not be loaded`, err);
      return null;
    },
  );
}

/** Where the open dialog and the question layer are drawn. The shell draws this once. */
export function DialogHost() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    const off = subscribeConfirm(fn);
    return () => { listeners.delete(fn); off(); };
  }, []);

  const open = current;
  const Comp = open ? loaded[open.name] : null;
  const openName = open ? open.name : null;
  const openSeq = open ? open.seq : 0;
  useEffect(() => {
    if (!openName || loaded[openName]) return;
    load(openName).then((C) => {
      if (!current || current.seq !== openSeq) return;
      if (C) tick((n) => n + 1);
      else closeDialog();
    });
  }, [openName, openSeq]);

  return html`
    ${open && Comp ? html`<${DialogContext.Provider} key=${open.seq} value=${{ name: open.name, close: closeDialog }}>
      <${Comp} ...${open.props} dialog=${open.name} close=${closeDialog} />
    <//>` : null}
    <${ConfirmLayer} />`;
}

export default DialogHost;
