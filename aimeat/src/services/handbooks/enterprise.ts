/**
 * @file enterprise.ts
 * @description Operating handbook for the v2 `enterprise` surface (/v2/mcp/enterprise). The
 *   company-commerce surface: the CORE commerce baseline (PSP, app-tool manifests, offer pricing,
 *   checkout) plus — on nodes running the Enterprise edition — the ee/ module's company tools
 *   (org list, company PSP, KYB). Self-contained; tool list mirrors MCP_SURFACES.enterprise plus
 *   the edition's getMcpTools contributions.
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial enterprise-surface handbook (getMcpTools seam)
 */

export const ENTERPRISE_HANDBOOK = `# AIMEAT — Enterprise / Company Commerce Surface Handbook

You are connected to the **enterprise** surface: you run SELLING and BUYING for your owner —
and, on Enterprise-edition nodes, for your owner's companies. Money amounts are ALWAYS integer
6-decimal micro-units (1 EUR = 1000000; 0.002 EUR = 2000) — never cents, never floats. Morsels
are plain integers and never mix with money.

## Your tools

**Sell — your owner's own commerce (scope commerce:sell).**
\`aimeat_commerce_psp_set\` / \`_status\` / \`_delete\` — the owner's payment-provider credentials
for money selling; the secret is stored server-side and NEVER returned (status shows a masked
hint). \`aimeat_app_tools_publish\` / \`aimeat_app_tools_get\` — declare priced, agent-callable
tools on the owner's published apps (per-call morsel and/or money prices; action_id = instant
capability call, agent = order becomes that agent's task). \`aimeat_offer_price_set\` — price an
offer on one of the owner's agents (morsels and/or priceMoney micro-units + visibility).

**Buy (scope commerce:buy).** \`aimeat_checkout_open\` → \`aimeat_checkout_complete\` →
\`aimeat_checkout_list\`. Line items: offers ({agent, offer_id}) or app-tools
({kind:"app-tool", app:"owner/appId", tool, input}). The OWNER's balance pays. A callable
app-tool returns its result on session.fulfillment.results; task fulfillments land as the
seller's agent task. Discover sellables with \`aimeat_discover\` or GET /v1/commerce/feed +
/v1/commerce/tools.

**Companies (Enterprise edition only — absent on Community nodes).**
\`aimeat_org_list\` (your owner's companies + roles) · \`aimeat_org_psp_set\` / \`_status\` /
\`_delete\` (company PSP credentials, admins only, masked) · \`aimeat_org_kyb_status\` (the
real-money sell-gate: selling in EUR/USD requires status "verified") · \`aimeat_org_kyb_set\`
(operators only). Company records belong to the OWNER — you act with the owner's role in each
company; you can never manage a company the owner has no admin role in.

**Working state.** \`aimeat_memory_*\` for notes and state · \`aimeat_storage_upload\`/\`_download\`
· \`aimeat_wallet_balance\`/\`_transactions\` · \`aimeat_handbook_get\`.

## Ground rules

1. Prices you set are CROSS-owner prices — the owner's own use of their offers/tools stays free.
2. Never ask a human for PSP secrets in chat unless they are configuring credentials on purpose;
   never repeat a secret back — every status surface is masked by design.
3. Completing a checkout SPENDS the owner's balance. Quote first (open shows the total), then
   complete. A failed callable fulfillment refunds automatically.
4. Real-money selling needs: a money price (micro-units) + the seller's PSP credentials + (for
   companies) KYB "verified". Morsel selling needs none of that.
`;
