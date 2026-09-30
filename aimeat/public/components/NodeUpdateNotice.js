/**
 * @file public/components/NodeUpdateNotice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The header's new-version notice, for an operator only: a sun tag that says a newer
 *   AIMEAT is out, and the dialog it opens: which version, when it was released, what is new in it,
 *   the prompt that updates the node for Claude Code or Codex, and where the notice is switched off.
 *
 *   One read of GET /v1/admin/node-update when an operator's header mounts. The node keeps the
 *   answer for six hours, so a page load costs nothing more. No update, the check switched off or
 *   the check failing all render nothing: a notice that can only say "nothing to see" is noise.
 *
 *   The prompt is the node's (services/node-update-prompt.ts), not written here, so the dialog and
 *   the aimeat_admin_node_update MCP tool hand out the same words.
 *
 *   `/v1/admin?nodeUpdate=1` opens the dialog on load: the served header library
 *   (/v1/libs/aimeat-header.js) links there, because it has no dialog of its own.
 * @structure NodeUpdateNotice({ session, onNavigate, onShown }) · entryText(value)
 * @usage html`<${NodeUpdateNotice} session=${session} onNavigate=${(p) => navigate(p)} onShown=${setShown} />`
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { date } from '/js/format.js';
import { getNodeUpdate } from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import { Modal } from '/components/Modal.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { ChangeLog } from '/components/ChangeLog.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';

const html = htm.bind(h);

/** The setting that switches the check off, as the Config tab's search finds it. */
const CONFIG_PATH = '/v1/admin?tab=config&q=node.update_check';

/** A change-log title or body: a plain string, or one string per language. */
export function entryText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[getLocale()] || value.en || Object.values(value)[0] || '';
}

const isOperator = (session) => !!(session && Array.isArray(session.roles) && session.roles.includes('operator'));

export function NodeUpdateNotice({ session, onNavigate, onShown }) {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const operator = isOperator(session);
  const shown = !!(operator && status && status.enabled && status.updateAvailable);

  // The header measures whether its bar overflows into the burger menu; the tag appearing after the
  // read changes that, so the header is told.
  useEffect(() => { onShown?.(shown); }, [shown, onShown]);

  const load = useCallback(async (refresh = false) => {
    try { setStatus((await getNodeUpdate(refresh)).data || null); }
    catch (e) { swallowed('NodeUpdateNotice: check', e); }
  }, []);

  useEffect(() => {
    if (!operator) { setStatus(null); return; }
    load();
    // The served header library links here with ?nodeUpdate=1 to open the dialog.
    if (new URLSearchParams(location.search).get('nodeUpdate') === '1') setOpen(true);
  }, [operator, load]);

  if (!shown) return null;

  const again = async () => { setChecking(true); await load(true); setChecking(false); };
  const go = (e, path) => { e?.preventDefault?.(); setOpen(false); onNavigate?.(path); };
  const news = Array.isArray(status.whatsNew) ? status.whatsNew : null;

  const footer = html`
    <${Action} onClick=${() => setOpen(false)}>${t('common.close')}<//>
    <${Loud} control copy=${status.prompt} copiedLabel=${t('nodeUpdate.copied')}>${t('nodeUpdate.copy')}<//>`;

  return html`
    <${Mark} tone="sun" title=${t('nodeUpdate.pillTitle')} onClick=${() => setOpen(true)}>${t('nodeUpdate.pill', { version: status.latest })}<//>
    <${Modal} open=${open} onClose=${() => setOpen(false)} size="lg" title=${t('nodeUpdate.title', { version: status.latest })} footer=${footer}>
      <${Facts} rows=${[
        { k: t('nodeUpdate.running'), v: status.current, mono: true },
        { k: t('nodeUpdate.newest'), v: status.latest, mono: true },
        { k: t('nodeUpdate.released'), v: status.releasedAt ? date(status.releasedAt) : t('nodeUpdate.releasedUnknown') },
        { k: t('nodeUpdate.installed'), v: t(`nodeUpdate.method.${status.install?.method || 'unknown'}`) },
      ]} />

      <${Label} ruled>${t('nodeUpdate.whatsNew')}<//>
      ${news === null
        ? html`<${Note} kind="quiet">${t('nodeUpdate.whatsNewUnknown', { version: status.latest })}<//>`
        : news.length === 0
          ? html`<${Note} kind="quiet">${t('nodeUpdate.whatsNewNone', { version: status.latest })}<//>`
          : html`<${ChangeLog} entries=${news.map((e, i) => ({
              key: i,
              version: e.version || '',
              date: e.date,
              summary: html`<strong>${entryText(e.title)}</strong>${e.body ? html`<br />${entryText(e.body)}` : null}`,
            }))} />`}

      <${Label} ruled>${t('nodeUpdate.howTo')}<//>
      <${Note} kind="caption" size="body">${t('nodeUpdate.howToText')}<//>
      <${Code} block scroll="medium">${status.prompt}<//>

      <${Note} kind="aside" size="small">
        ${t('nodeUpdate.stopText')}${' '}
        <${Action} tone="link" href=${CONFIG_PATH} onClick=${(e) => go(e, CONFIG_PATH)}>${t('nodeUpdate.openConfig')}<//>
      <//>
      <${Action} small disabled=${checking} onClick=${again}>${checking ? t('nodeUpdate.checking') : t('nodeUpdate.checkAgain')}<//>
    <//>`;
}

export default NodeUpdateNotice;
