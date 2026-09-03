/**
 * @file portfolio-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the person's own page at their address. One read (GET
 *   /v1/portfolio/config: the switches, the standalone address and where the stored page is), the
 *   member showcase count and, best effort, the home's record of which AI wrote the welcome mat;
 *   the page's own HTML is fetched from its public-file address for the title and the preview. This
 *   file is the state and the handlers (publish and unpublish, the search-engine and badge switches,
 *   the preview, a pasted or chosen HTML file published from here, the request copied for the
 *   person's AI, the welcome-mat prompt, the agent's rule); the render is portfolio/page.js.
 * @structure PortfolioTab() — state (data, members, ai, pageHtml, previewOpen, paste, matPrompt, busy) + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'portfolio'
 * @version-history
 *   v3.0.0 — 2026-09-03 — Poster face (design canvas "AIMEAT Portfolio-sivu", direction A): one page
 *     that says where the page is, who can see it and who wrote it, previews it, and offers the three
 *     roads to change it, the AI first. The tab no longer forwards to the builder when nothing is
 *     published: the empty state is a page with the three roads to a first one. A page taken off
 *     the web keeps its preview and the way back. The standalone address and its badge switch, which
 *     lived only in the builder, are here; a finished HTML can be pasted or chosen and published
 *     from here.
 *   v2.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied keys.
 *   v2.0.0 — 2026-06-10 — Replace the two-button landing: auto-forward to the builder when
 *     nothing is published; published state shows URL + last updated + Visit/Edit/Unpublish.
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.0.0 — 2026-03-16 — Initial portfolio tab
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t, getLocale } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { copyToClipboard } from '/js/utils.js';
import { apiGet, apiPut } from '/js/api.js';
import { stampCspNonce } from '/views/portfolio/shared.js';
import { renderPage } from './portfolio/page.js';
import { x, titleOf, aiRequest, agentRule } from './portfolio/frame.js';

const DEFAULT_MAX_KB = 512;

export default function PortfolioTab({ session, navigate, showToast }) {
  const sess = session || getSession();
  const ownerName = sess?.owner || '';
  const { confirm, ConfirmUI } = useConfirm();
  const fileRef = useRef(null);
  const [data, setData] = useState(null);
  const [members, setMembers] = useState(null);
  const [ai, setAi] = useState(null);
  const [pageHtml, setPageHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [matPrompt, setMatPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const toast = (msg, isErr) => showToast?.(msg, !!isErr);
  const fail = (e, fallback) => toast(e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error'), true);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/portfolio/config');
      const d = r?.data || { config: null, standalone_url: null, html: null };
      setData(d);
      // The page's own words: the title comes from the file, and the preview shows the same bytes.
      if (d.html?.url) {
        try {
          const res = await fetch(d.html.url, { cache: 'no-store' });
          setPageHtml(res.ok ? await res.text() : '');
        } catch (e) { swallowed('portfolio: page html', e); setPageHtml(''); }
      } else setPageHtml('');
    } catch (e) { swallowed('portfolio: config', e); setData({ config: null, standalone_url: null, html: null }); }
    // The showcase count and the home's record of the mat's author: neither is on the critical path.
    try {
      const m = await apiGet('/v1/portfolio/members');
      setMembers(typeof m?.data?.total === 'number' ? m.data.total : (m?.data?.members || []).length);
    } catch (e) { swallowed('portfolio: members', e); }
    try {
      const h = await apiGet('/v1/home/state');
      setAi(h?.data?.state?.ai || null);
    } catch (e) { swallowed('portfolio: home state', e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['portfolio'], load), [load]);

  // The welcome-mat request is shown on the empty page, so it is fetched only there.
  useEffect(() => {
    if (!data || data.html) return;
    apiGet(`/v1/prompts/welcome-mat?lang=${encodeURIComponent(getLocale())}`)
      .then((r) => setMatPrompt(r?.data?.prompt || ''))
      .catch((e) => swallowed('portfolio: mat prompt', e));
  }, [data]);

  const cfg = data?.config || {};
  const maxKb = DEFAULT_MAX_KB;

  /** One field changed, the rest left where it was: the PUT merges onto the stored record. */
  const patch = async (fields, key, onDone) => {
    setBusy(key);
    try {
      await apiPut('/v1/portfolio/config', { ...fields, tags: ['portfolio'] });
      setData((d) => ({ ...d, config: { ...(d?.config || {}), ...fields } }));
      onDone?.();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const setEnabled = (on) => {
    if (on) { patch({ enabled: true }, 'enable', () => toast(x('republishedToast'))); return; }
    confirm(x('confirmUnpublish'), () => patch({ enabled: false, unpublishedAt: new Date().toISOString() }, 'enable', () => toast(x('unpublishedToast'))), { danger: true });
  };
  const setSeo = (on) => patch({ seoIndex: on }, 'seo', () => toast(on ? x('searchOnToast') : x('searchOffToast')));
  const setBadge = (on) => patch({ showBadge: on }, 'badge', () => toast(on ? x('badgeOnToast') : x('badgeOffToast')));

  const togglePreview = () => setPreviewOpen((v) => !v);
  const previewDoc = () => stampCspNonce(pageHtml);

  const aiRequestText = () => aiRequest(ownerName, !!data?.html);
  const copyAiRequest = async () => { await copyToClipboard(aiRequestText()); toast(x('copiedRequest')); };
  const copyRule = async () => { await copyToClipboard(agentRule(ownerName, getNodeUrl())); toast(x('copiedRule')); };
  const copyMatPrompt = async () => {
    setBusy('mat');
    try {
      let p = matPrompt;
      if (!p) {
        const r = await apiGet(`/v1/prompts/welcome-mat?lang=${encodeURIComponent(getLocale())}`);
        p = r?.data?.prompt || '';
        setMatPrompt(p);
      }
      if (!p) { toast(t('profile.error'), true); return; }
      await copyToClipboard(p);
      toast(x('copiedMat'));
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const pickFile = () => fileRef.current?.click();
  const readFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPaste(String(reader.result || ''));
    reader.readAsText(f);
    e.target.value = '';
  };
  const publishPaste = async () => {
    const html = (paste || '').trim();
    if (!html) return;
    if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) { toast(x('pasteNotWhole'), true); return; }
    setBusy('publish');
    try {
      const up = await apiPut('/v1/portfolio/upload', { html });
      if (up?.ok === false) throw up;
      // Bringing a page here means publishing it: a page nobody can open is not published.
      if (!cfg.enabled) await apiPut('/v1/portfolio/config', { enabled: true, tags: ['portfolio'] });
      setPaste('');
      setPreviewOpen(false);
      toast(x('publishedToast', { n: Math.max(1, up?.data?.sizeKb ?? Math.ceil(html.length / 1024)) }));
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const ctx = {
    data, members, ai, pageHtml, previewOpen, paste, matPrompt, busy, maxKb, ownerName,
    standaloneUrl: data?.standalone_url || null,
    title: titleOf(pageHtml),
    navigate, toast, fileRef, ConfirmUI,
    setEnabled, setSeo, setBadge, togglePreview, previewDoc,
    aiRequestText, copyAiRequest, copyRule, copyMatPrompt,
    setPaste, pickFile, readFile, publishPaste,
  };
  return renderPage(ctx);
}
