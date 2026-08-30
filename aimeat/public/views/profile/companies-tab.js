/**
 * @file companies-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Companies: every company as a row whose condition is written out, and a
 *   page per company — the registered details with what each gap costs, the front page, who may
 *   act in the company's name (the organism link), what has happened in its name (invoices and
 *   mail), the sending identity and the chat prompts. Holds the state, the loads and the
 *   handlers; renders the poster face (companies/cover.js, companies/company.js).
 *   Live: re-fetches on the aimeat-live-update event when the companies domain ticks.
 * @structure CompaniesTab — state, loads, handlers, the ctx bag, render
 * @usage Registered in views/profile.js TABS as id 'companies'.
 * @version-history
 *   v2.0.0 — 2026-08-31 — The poster face (design canvas "AIMEAT Yritysten sivu", direction A).
 *     A row per company and a page behind it; the organism link reaches the page for the first
 *     time; the invoice and send counts come from the company-scoped finance and outbound reads.
 *     Absorbs companies-front-page.js.
 *   v1.2.0 — 2026-08-08 — Front page extracted to companies-front-page.js (adds the
 *     portfolio kind); the identity section gained its AI hand-off prompt.
 *   v1.1.0 — 2026-08-07 — SmtpSection: the company's own sending identity (write-only password).
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { copyToClipboard } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import * as api from '/js/services/companies.js';
import { listApps } from '/js/services/apps.js';
import { swallowed } from '/js/swallowed.js';
import { buildSettingsPrompt, buildPortfolioPrompt, buildAppPrompt, buildCompaniesPrompt } from './companies-prompts.js';
import { c, FIELDS } from './companies/frame.js';
import { renderCover } from './companies/cover.js';
import { renderCompany } from './companies/company.js';

const EMPTY_SMTP = { host: '', port: '587', secure: false, username: '', password: '', from_address: '', from_name: '', reply_to: '' };

export default function CompaniesTab({ showToast, session }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [companies, setCompanies] = useState([]);
  const [apps, setApps] = useState([]);
  const [organisms, setOrganisms] = useState([]);
  const [extras, setExtras] = useState({});
  const [addr, setAddr] = useState({});
  const [selected, setSelected] = useState(null);
  const [create, setCreate] = useState({ name: '', slug: '', availability: null });
  const [busy, setBusy] = useState(false);
  const [folds, setFolds] = useState({ smtp: false, chat: false });
  const [editingFacts, setEditingFacts] = useState(false);
  const [factValues, setFactValues] = useState({});
  const [front, setFront] = useState({ kind: 'none', target: '', html: '' });
  const [portfolio, setPortfolio] = useState(null);
  const [smtp, setSmtp] = useState(null);
  const [smtpForm, setSmtpForm] = useState(EMPTY_SMTP);
  const [orgPick, setOrgPick] = useState('');

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), 'error');

  /* ── loads ── */

  const load = useCallback(async () => {
    try {
      const rows = await api.listCompanies();
      setCompanies(rows);
      // The counts and the sending identity, one company at a time. An owner has a handful of
      // companies, not a page of them, so the fan-out stays small; each read fails soft.
      const ex = {};
      await Promise.all(rows.map(async (co) => {
        const [inv, sent, smtpRec] = await Promise.all([
          api.invoiceCount(co.id).catch((err) => { swallowed('companies-tab: invoices', err); return 0; }),
          api.sentCount(co.id).catch((err) => { swallowed('companies-tab: sent', err); return 0; }),
          api.getSmtp(co.id).catch((err) => { swallowed('companies-tab: smtp', err); return null; }),
        ]);
        ex[co.id] = { inv, sent, smtpRec, smtpSet: !!smtpRec };
      }));
      setExtras(ex);
      // Does the address answer: probed by the node (the redirect's target for a redirect, the
      // company's own address for anything it serves itself). Fire-and-forget per company.
      rows.forEach(async (co) => {
        if ((co.frontPage?.kind || 'none') === 'none') return;
        const ok = await api.addressAnswers(co.id).catch((err) => { swallowed('companies-tab: address', err); return null; });
        if (ok !== null) setAddr((prev) => ({ ...prev, [co.id]: ok }));
      });
    } catch (err) { swallowed('companies-tab', err); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const owner = session?.owner;
    listApps().then(
      (list) => setApps((Array.isArray(list) ? list : []).filter((a) => !owner || a.owner === owner)),
      () => setApps([]));
    if (owner) api.myOrganisms(owner).then(setOrganisms, () => setOrganisms([]));
  }, [session]);

  const liveRef = useRef(null);
  liveRef.current = () => load();
  useEffect(() => onLiveUpdate(['companies', 'outbound'], () => liveRef.current()), []);

  /* ── the availability preview while a name is typed ── */
  useEffect(() => {
    const slug = create.slug;
    if (slug.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.checkAvailable(slug);
        if (!cancelled) setCreate((prev) => (prev.slug === slug ? { ...prev, availability: res } : prev));
        // eslint-disable-next-line aimeat/no-silent-catch -- advisory while typing (the create call arbitrates); an unreachable check shows no badge rather than an error mid-keystroke
      } catch { if (!cancelled) setCreate((prev) => ({ ...prev, availability: null })); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [create.slug]);

  /* ── open a company / go back ── */

  const company = selected ? companies.find((x) => x.id === selected) || null : null;

  const open = useCallback((id) => {
    const co = companies.find((x) => x.id === id);
    if (!co) return;
    setSelected(id);
    setEditingFacts(false);
    setFolds({ smtp: false, chat: false });
    setOrgPick('');
    setFront({ kind: co.frontPage?.kind || 'none', target: co.frontPage?.target || '', html: '' });
    const rec = extras[id]?.smtpRec || null;
    setSmtp(rec);
    setSmtpForm(rec ? { host: rec.host ?? '', port: String(rec.port ?? 587), secure: !!rec.secure, username: rec.username ?? '', password: '', from_address: rec.fromAddress ?? '', from_name: rec.fromName ?? '', reply_to: rec.replyTo ?? '' } : EMPTY_SMTP);
    setPortfolio(null);
    if ((co.frontPage?.kind || 'none') === 'portfolio') {
      api.getPortfolio(id).then(setPortfolio, (err) => swallowed('companies-tab: portfolio', err));
    }
  }, [companies, extras]);

  const back = useCallback(() => { setSelected(null); setEditingFacts(false); }, []);

  /* ── register ── */

  const setCreateName = (name) => setCreate({ name, slug: api.slugify(name), availability: null });
  async function doCreate() {
    setBusy(true);
    try {
      const co = await api.createCompany(create.name.trim());
      setCreate({ name: '', slug: '', availability: null });
      showToast?.(c('createdToast'));
      await load();
      if (co?.id) setSelected(co.id);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  /* ── the registered details ── */

  const startFacts = () => {
    const init = {};
    for (const [wire, rec] of FIELDS) init[wire] = company?.[rec] ?? '';
    setFactValues(init);
    setEditingFacts(true);
  };
  const cancelFacts = () => setEditingFacts(false);
  const setFact = (wire, v) => setFactValues((prev) => ({ ...prev, [wire]: v }));
  async function saveFacts() {
    setBusy(true);
    try {
      const body = {};
      for (const [wire] of FIELDS) body[wire] = String(factValues[wire] ?? '').trim() || null;
      await api.updateCompany(company.id, body);
      showToast?.(t('profile.companies.saved'));
      setEditingFacts(false);
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  /* ── the front page ── */

  async function saveFront() {
    setBusy(true);
    try {
      await api.setFrontPage(company.id, front.kind, front.target);
      showToast?.(t('profile.companies.frontSaved'));
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function publishPortfolio() {
    setBusy(true);
    try {
      const res = await api.publishPortfolio(company.id, front.html.trim());
      setPortfolio(res?.portfolio ?? null);
      setFront((prev) => ({ ...prev, html: '' }));
      showToast?.(t('profile.companies.portfolioPublished'));
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  function removePortfolio() {
    confirm(t('profile.companies.portfolioConfirmRemove'), async () => {
      setBusy(true);
      try {
        await api.removePortfolio(company.id);
        setPortfolio({ published: false, sizeBytes: 0, updatedAt: null });
        showToast?.(t('profile.companies.portfolioRemoved'));
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(false); }
    }, { danger: true });
  }
  async function pickPortfolioFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFront((prev) => ({ ...prev, html: text }));
    e.target.value = '';
  }

  /* ── who acts in its name ── */

  async function linkOrganism() {
    setBusy(true);
    try {
      await api.updateCompany(company.id, { organism_id: orgPick });
      showToast?.(c('linkedToast'));
      setOrgPick('');
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  function unlinkOrganism() {
    // Detaching changes who may send and where the books close, so it is confirmed in words.
    confirm(c('unlinkConfirm'), async () => {
      setBusy(true);
      try {
        await api.updateCompany(company.id, { organism_id: null });
        showToast?.(c('unlinkedToast'));
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(false); }
    }, { danger: true });
  }
  const organismName = (id) => organisms.find((o) => o.id === id)?.name || id;

  /* ── the sending identity ── */

  const setSmtpField = (key, v) => setSmtpForm((prev) => ({ ...prev, [key]: v }));
  async function saveSmtp() {
    setBusy(true);
    try {
      const f = smtpForm;
      const body = {
        host: f.host.trim(), port: parseInt(f.port, 10) || 587, secure: !!f.secure,
        username: f.username.trim() || null,
        from_address: f.from_address.trim(),
        from_name: f.from_name.trim() || null,
        reply_to: f.reply_to.trim() || null,
      };
      if (f.password) body.password = f.password;
      const rec = await api.saveSmtp(company.id, body);
      setSmtp(rec);
      setSmtpForm((prev) => ({ ...prev, password: '' }));
      showToast?.(t('profile.companies.smtpSaved'));
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  function removeSmtp() {
    confirm(t('profile.companies.smtpConfirmRemove'), async () => {
      setBusy(true);
      try {
        await api.removeSmtp(company.id);
        setSmtp(null);
        setSmtpForm(EMPTY_SMTP);
        showToast?.(t('profile.companies.smtpRemoved'));
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(false); }
    }, { danger: true });
  }

  /* ── delete ── */

  function removeCompany() {
    // Deleting a company frees its public address, so the confirm is the point, not friction.
    confirm(t('profile.companies.confirmDelete').replace('{name}', company.name), async () => {
      setBusy(true);
      try {
        await api.deleteCompany(company.id);
        showToast?.(t('profile.companies.deleted'));
        back();
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(false); }
    }, { danger: true });
  }

  /* ── the prompts ── */

  function copyPrompt(kind) {
    const text = kind === 'list' ? buildCompaniesPrompt(companies)
      : kind === 'portfolio' ? buildPortfolioPrompt(company)
        : kind === 'app' ? buildAppPrompt(company)
          : buildSettingsPrompt(company);
    copyToClipboard(text);
    showToast?.(t('profile.companies.promptCopied'));
  }

  const setFold = (k, open_) => setFolds((f) => ({ ...f, [k]: open_ }));

  const ctx = {
    companies, apps, organisms, extras, addr, session, company,
    create, busy, folds, editingFacts, factValues, front, portfolio, smtp, smtpForm, orgPick, ConfirmUI,
    setCreateName, doCreate, open, back, setFold,
    startFacts, cancelFacts, setFact, saveFacts,
    setFrontState: setFront, saveFront, publishPortfolio, removePortfolio, pickPortfolioFile,
    setOrgPick, linkOrganism, unlinkOrganism, organismName,
    setSmtpField, saveSmtp, removeSmtp,
    removeCompany, copyPrompt,
  };
  return company ? renderCompany(ctx) : renderCover(ctx);
}

/** The old named export, kept so views/profile.js's import keeps resolving. */
export { CompaniesTab };
