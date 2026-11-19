/**
 * @file public/views/profile/kyc-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: customer due diligence (knowing the customer, KYC; EU AMLR 2024/1624) for
 *   a person who works in an obliged organism, and the person's own verification for everyone. This
 *   file holds the organisms the person reaches (GET /v1/kyc/organisms), the one picked (kept in this
 *   browser tab's sessionStorage), and the parts' state: the customers (kyc/customers.js), the open
 *   card (kyc/card.js), the suspicions (kyc/suspicions.js), the settings (kyc/settings.js) and the
 *   person's own (kyc/mine.js). Every part reads again on the `aimeat-live-update` window event. The
 *   render is kyc/page.js.
 * @structure KycTab() — state + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'kyc'
 * @version-history
 *   v1.0.1 — 2026-11-19 — Suspicions and settings stay unread while the cards answer KYC_NOT_STAFF.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { renderPage } from './kyc/page.js';
import { kycApi, errWords, ORG_ROLES } from './kyc/frame.js';
import { useCustomers } from './kyc/customers.js';
import { useCard } from './kyc/card.js';
import { useSuspicions } from './kyc/suspicions.js';
import { useSettings } from './kyc/settings.js';
import { useMine } from './kyc/mine.js';

const PICKED = 'aimeat.kyc.organism';

/** The organism picked last in this browser tab, or ''. */
function readPicked() {
  try { return sessionStorage.getItem(PICKED) || ''; } catch (e) { swallowed('kyc: read picked organism', e); return ''; }
}

export default function KycTab({ showToast }) {
  const [orgs, setOrgs] = useState(null);
  const [orgsErr, setOrgsErr] = useState('');
  const [org, setOrgState] = useState(readPicked);
  const toast = (m, isErr) => showToast?.(m, !!isErr);

  const loadOrgs = useCallback(async () => {
    try {
      const r = await kycApi.organisms();
      setOrgs(r); setOrgsErr('');
      const list = r?.organisms || [];
      setOrgState((cur) => (list.some((o) => o.id === cur) ? cur : (list.find((o) => ORG_ROLES.includes(o.role)) || list[0])?.id || ''));
    } catch (e) { setOrgsErr(errWords(e)); }
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const picked = (orgs?.organisms || []).find((o) => o.id === org);
  const role = picked?.role || 'none';
  const active = !!picked && ORG_ROLES.includes(role);

  const card = useCard({ org, role, toast, onChanged: () => cuRef.current?.load() });
  const cu = useCustomers({ org, active, onOpened: (id) => card.open(id) });
  const cuRef = useRef(cu);
  cuRef.current = cu;
  const enabled = active && cu.code !== 'KYC_NOT_ENABLED' && cu.code !== 'KYC_NOT_STAFF';
  const su = useSuspicions({ org, role, active: enabled });
  const st = useSettings({ org, role: enabled ? role : 'none' });
  const me = useMine();

  const setOrg = (id) => {
    try { sessionStorage.setItem(PICKED, id); } catch (e) { swallowed('kyc: keep picked organism', e); }
    card.close();
    setOrgState(id);
  };

  // Every part reads again when the server says something changed (frontend.md: no polling).
  const reload = useRef(null);
  reload.current = () => { loadOrgs(); cu.load(); card.load(); su.load(); st.load(); me.load(); };
  // Only the domains this page shows: the server's `kyc` notice (a card, a suspicion or the lists
  // changed, sent to the organism's KYC people), organisms and the bell's own.
  useEffect(() => onLiveUpdate(['kyc', 'organisms', 'notifications'], () => reload.current?.()), []);

  return renderPage({ orgs, orgsErr, org, setOrg, cu, card, su, st, me });
}
