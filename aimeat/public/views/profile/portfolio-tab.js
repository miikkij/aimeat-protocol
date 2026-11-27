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
 *   v3.2.0 — 2026-11-27 — Who may open the page (`access`: anyone, signed-in, one organism) is read from GET
 *     /v1/portfolio/config and changed with PUT /v1/portfolio/config; the organisms come from
 *     js/organism-names.js. Every refusal (the switches, the access, the welcome-mat request, a pasted
 *     page's publish) is said in the page's words by its code (js/refusal-words.js, pfpage.refusal.*).
 *   v3.1.0 — 2026-11-27 — The open state of the two rows that open in place (changeOpen, aiOpen) and their toggles
 *     are in the ctx bag for portfolio/page.js.
 *   v3.0.1 — 2026-10-17 — The preview reads the stored page with the owner's session (apiGetText):
 *     the file is the owner's now, not public (plan doc-mvcn6c7e4e5q, V0.3).
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
import { getLocale } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { copyToClipboard } from '/js/utils.js';
import { apiGet, apiGetText, apiPut } from '/js/api.js';
import { stampCspNonce } from '/views/portfolio/shared.js';
import { organismNames } from '/js/organism-names.js';
import { signedInOnly } from '/js/site.js';
import { refusalText } from '/js/refusal-words.js';
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
  // The two rows that open in place: the ways to change the page, and the AI's rule.
  const [changeOpen, setChangeOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Who may open the page: the three choices open in place; the organisms the person is a member of
  // are read when a choice needs their names (null until read).
  const [accessOpen, setAccessOpen] = useState(false);
  const [organisms, setOrganisms] = useState(null);
  const [orgPick, setOrgPick] = useState('');

  const toast = (msg, isErr) => showToast?.(msg, !!isErr);
  // A refusal in the page's words by its code (js/refusal-words.js), the action's own words first,
  // with the action's own sentence when the code has none; the server's sentence is English for an AI.
  /** @type {(e: any, fallbackKey: string, prefix?: string|string[]) => void} */
  const fail = (e, fallbackKey, prefix = 'pfpage.refusal.') => toast(refusalText(e, prefix, fallbackKey), true);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/portfolio/config');
      const d = r?.data || { config: null, standalone_url: null, html: null };
      setData(d);
      // The page's own words: the title comes from the file, and the preview shows the same bytes.
      if (d.html?.url) {
        try {
          // The file is the owner's (not public), so it is read with the owner's session.
          setPageHtml(await apiGetText(d.html.url));
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

  // The organisms' names, read once the choices open or the page is open to one organism
  // (js/organism-names.js reads them once per page and again only on the live stream's word).
  const access = data?.access || 'anyone';
  const needsOrganisms = accessOpen || access.startsWith('organism:');
  useEffect(() => {
    if (!needsOrganisms || organisms) return;
    organismNames().then((m) => setOrganisms([...m].map(([id, name]) => ({ id, name }))));
  }, [needsOrganisms, organisms]);

  const cfg = data?.config || {};
  const maxKb = DEFAULT_MAX_KB;

  /** One field changed, the rest left where it was: the PUT merges onto the stored record. */
  const patch = async (fields, key, onDone) => {
    setBusy(key);
    try {
      await apiPut('/v1/portfolio/config', { ...fields, tags: ['portfolio'] });
      setData((d) => ({ ...d, config: { ...(d?.config || {}), ...fields } }));
      onDone?.();
    } catch (e) { fail(e, 'pfpage.refusal.saveFailed'); } finally { setBusy(false); }
  };

  const setEnabled = (on) => {
    if (on) { patch({ enabled: true }, 'enable', () => toast(x('republishedToast'))); return; }
    confirm(x('confirmUnpublish'), () => patch({ enabled: false, unpublishedAt: new Date().toISOString() }, 'enable', () => toast(x('unpublishedToast'))), { danger: true });
  };
  const setSeo = (on) => patch({ seoIndex: on }, 'seo', () => toast(on ? x('searchOnToast') : x('searchOffToast')));

  /**
   * Who may open the page: 'anyone', 'signed-in' or 'organism:<id>' (PUT /v1/portfolio/config
   * `access`, services/page/access.ts). The server stores anyone as no value and answers the word in
   * GET's top-level `access`; an organism the account is not an active member of is refused
   * (NOT_ORGANISM_MEMBER), said in the page's words (js/refusal-words.js).
   */
  const setAccess = async (value) => {
    setBusy('access');
    try {
      await apiPut('/v1/portfolio/config', { access: value, tags: ['portfolio'] });
      setData((d) => ({ ...d, access: value, config: { ...(d?.config || {}), access: value === 'anyone' ? null : value } }));
      setAccessOpen(false);
      const org = value.startsWith('organism:') ? (organisms || []).find((o) => o.id === value.slice(9))?.name : '';
      toast(value === 'anyone' ? x('access.savedAnyone') : value === 'signed-in' ? x('access.savedSignedIn') : x('access.savedOrganism', { org: org || x('access.organismUnknown') }));
    } catch (e) { fail(e, 'pfpage.refusal.accessFailed', ['pfpage.refusal.access.', 'pfpage.refusal.']); } finally { setBusy(false); }
  };
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
      if (!p) { toast(x('refusal.matFailed'), true); return; }
      await copyToClipboard(p);
      toast(x('copiedMat'));
    } catch (e) { fail(e, 'pfpage.refusal.matFailed'); } finally { setBusy(false); }
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
    } catch (e) { fail(e, 'pfpage.refusal.publishFailed', ['pfpage.refusal.publish.', 'pfpage.refusal.']); } finally { setBusy(false); }
  };

  const ctx = {
    data, members, ai, pageHtml, previewOpen, paste, matPrompt, busy, maxKb, ownerName,
    changeOpen, aiOpen, toggleChange: () => setChangeOpen((v) => !v), toggleAi: () => setAiOpen((v) => !v),
    access, accessOpen, toggleAccess: () => setAccessOpen((v) => !v), organisms, setAccess, nodeSignedInOnly: signedInOnly(),
    // The organism the choice names: the one picked, else the one the page is open to, else the first.
    orgPick: orgPick || (access.startsWith('organism:') ? access.slice(9) : (organisms?.[0]?.id || '')), setOrgPick,
    standaloneUrl: data?.standalone_url || null,
    title: titleOf(pageHtml),
    navigate, toast, fileRef, ConfirmUI,
    setEnabled, setSeo, setBadge, togglePreview, previewDoc,
    aiRequestText, copyAiRequest, copyRule, copyMatPrompt,
    setPaste, pickFile, readFile, publishPaste,
  };
  return renderPage(ctx);
}
