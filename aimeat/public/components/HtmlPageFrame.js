/**
 * @file public/components/HtmlPageFrame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An HTML page of a workspace, shown in its frame: the page itself, served from the
 *   node's page host into a sandboxed frame (src/routes/page-host.ts), and the strip above it that the
 *   page cannot reach or draw over: the line saying a user made it, Full screen, and Report where the
 *   viewer may report. A link inside the page that leaves it arrives here as a message, and the strip
 *   shows the address and opens it only when the person presses Open; the page itself can open
 *   nothing. Without a frame address (the node has no page host) the page is shown as its text.
 *   The frame here holds the page host's holder, a fixed document of the node that frames the page
 *   itself; the holder keeps its own origin (allow-same-origin), so the page's frame-ancestors can
 *   name it, while the page inside runs in an opaque origin by its own sandbox.
 *   The strip carries the AI label the page's record says it owes (components/ai-label.js, which
 *   draws nothing when none is owed), and for the workspace's members the name of who made it.
 *   A page passes the parts; it never writes a class. The look is css/components/html-page-frame.css.
 * @structure HtmlPageFrame({ src, title, text, onReport, reportHint, loading, error, provenance, author })
 * @usage html`<${HtmlPageFrame} src=${doc.frame_url} title=${doc.title} text=${doc.markdown} onReport=${report} provenance=${{ record, recordUrl }} />`
 * @version-history
 *   v1.1.0 — 2026-10-16 — `provenance`: the AI label in the strip and above the text fallback.
 *     `author`: a member reads who made the page (Jouni, 2026-10-16: members only).
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Markdown } from '/components/Markdown.js';
import { AiLabel } from '/components/ai-label.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** Only web and mail addresses are ever opened, whatever the page sent. */
const openable = (u) => typeof u === 'string' && u.length <= 4096 && /^(https?:|mailto:)/i.test(u);

export function HtmlPageFrame({ src, title, text, onReport, reportHint, loading, error, provenance, author }) {
  const wrap = useRef(null);
  const frame = useRef(null);
  const [asked, setAsked] = useState(null);       // the address the page asked to open
  const [reported, setReported] = useState(null); // null | 'sent' | 'failed' | 'signin'

  // A message counts only when it comes from this frame's own window and says what the page shim sends.
  useEffect(() => {
    const onMessage = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data;
      if (d && d.type === 'aimeat_page_open' && openable(d.url)) setAsked(d.url);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const open = () => {
    if (asked) window.open(asked, '_blank', 'noopener,noreferrer');
    setAsked(null);
  };
  const fullScreen = () => {
    const el = wrap.current;
    if (el && el.requestFullscreen) el.requestFullscreen().catch(err => swallowed('HtmlPageFrame: full screen', err));
  };
  const report = async () => {
    if (!onReport) return;
    const r = await onReport();
    setReported(r === true ? 'sent' : r === 'signin' ? 'signin' : 'failed');
  };

  if (loading) return html`<${Note} kind="loading">${t('pageFrame.loading')}<//>`;
  if (error) return html`<${Note} error>${t('pageFrame.loadFailed')}<//>`;
  // The AI label the page's record says it owes; the component draws nothing when none is owed.
  const label = provenance ? html`<${AiLabel} record=${provenance.record} recordUrl=${provenance.recordUrl} />` : null;
  if (!src) {
    return html`
      <div class="html-page-frame">
        <${Note} kind="quiet">${t('pageFrame.noHost')}<//>
        ${label}
        <${Markdown} text=${text || ''} />
      </div>`;
  }
  // Who made the page is shown to the workspace's members only (Jouni, 2026-10-16); a visitor reads that a user made it.
  const madeBy = author ? (t('pageFrame.madeBy') || '{name} made this page. It runs apart and cannot reach your account.').replace('{name}', author) : t('pageFrame.madeByUser');
  return html`
    <div class="html-page-frame" ref=${wrap}>
      <div class="html-page-frame-strip">
        <span class="html-page-frame-note">${madeBy}</span>
        ${label}
        <${Action} small onClick=${fullScreen}>${t('pageFrame.fullScreen')}<//>
        ${onReport ? html`<${Action} small tone="text" onClick=${report}>${t('pageFrame.report')}<//>` : null}
      </div>
      ${reported ? html`<div class="html-page-frame-strip">
        <${Note} kind="message" error=${reported === 'failed'}>${reported === 'sent' ? t('pageFrame.reported') : reported === 'signin' ? (reportHint || t('pageFrame.reportSignIn')) : t('pageFrame.reportFailed')}<//>
      </div>` : null}
      ${asked ? html`<div class="html-page-frame-strip html-page-frame-ask" role="alertdialog" aria-label=${t('pageFrame.openAsk')}>
        <span class="html-page-frame-note">${t('pageFrame.openAsk')}</span>
        <code class="html-page-frame-url">${asked}</code>
        <${Loud} control onClick=${open}>${t('pageFrame.openYes')}<//>
        <${Action} small onClick=${() => setAsked(null)}>${t('pageFrame.openNo')}<//>
      </div>` : null}
      <iframe class="html-page-frame-frame" ref=${frame} src=${src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals" referrerpolicy="no-referrer"
        title=${(t('pageFrame.frameTitle') || '{title}').replace('{title}', title || '')}></iframe>
    </div>`;
}

export default HtmlPageFrame;
