/**
 * @file src/data/builtin-skills.bookkeeping.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-bookkeeping` built-in skill: how an AI helps a person run the books of a
 *   small business on their node. Invoices from draft to paid, the voucher journal, VAT and profit
 *   reports, exports for an accountant, the company the invoices are sent as, and the open data
 *   feeds (data packages and their OData address).
 *
 *   WHY IT EXISTS. Invoices, the voucher journal and the OData feed appeared in no document, prompt or
 *   skill at all (docs audit 2026-10-11, gap 4: group 15 of the feature list, MISSING). An AI that
 *   read the feature list knew the feature existed and had nothing to act on.
 *
 *   WHAT IS TRUE TODAY, AND SAID SO. The finance routes have no MCP tool, so an AI over MCP cannot
 *   reach them; only an agent holding a token with finance:read or finance:write and an HTTP client
 *   can (wish-bookkeeping-has-no-mcp-tool-a-person-s-ai-over-mcp-cannot-cr). The company tools and
 *   the data package tools are MCP tools. The skill says which is which. Currency is euro only and
 *   the VAT codes are Finland's, both from the code.
 *
 *   WHAT IT MUST AGREE WITH. routes/finance.ts and services/finance/invoice-service.ts (invoice body,
 *   statuses, numbering, sending, mark paid, credit note), routes/finance-ledger.ts and
 *   services/finance/vouchers.ts (vouchers, reversal, fiscal years, reports, exports, accountants),
 *   services/finance/vat-codes.ts (the VAT codes), services/finance/finvoice-operator.ts (e-invoice
 *   delivery), routes/outbound.ts (emailing an invoice), routes/commerce-webhooks.ts (Stripe marks an
 *   invoice paid), tool-catalog/definitions/companies.ts, routes/odata.ts and
 *   services/datapackage/odata.ts (the feed and its query options).
 * @structure BOOKKEEPING_SKILL_ENTRY
 * @usage import { BOOKKEEPING_SKILL_ENTRY } from './builtin-skills.bookkeeping.js';
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (docs audit phase 5a).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const BOOKKEEPING_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-bookkeeping',
  visibility: 'public',
  skillMd: `---
name: aimeat-bookkeeping
description: How to help a person keep the books of a small business on their AIMEAT node. Invoices from draft to sent to paid (numbering, the payment reference, e-invoice, PDF, email, credit notes), the voucher journal (receipts, corrections by reversal, fiscal years and locking), the VAT report and profit and loss, exports for an accountant and giving an accountant read access, the company an invoice is sent as, Stripe payments marking an invoice paid, and publishing open data as a data package with an OData feed. Says what an AI over MCP can and cannot reach today. Use when a person says "send an invoice", "book this receipt", "what is my VAT for the quarter", "give my accountant access", "export the books", or "publish this data so Excel can read it".
license: MIT
metadata:
  audience: agent
---

# Keeping the books on the node

**What the person gets.** Their invoices, receipts and reports live next to the rest of their work,
owned by them: an invoice is numbered and its totals computed by the node, every booking is kept and
corrected only by a counter-booking, their accountant reads the books with their own account, and the
exports are files any bookkeeping program reads.

## Before you start: can you reach it?

- **Invoices, vouchers, VAT, profit and loss, exports and accountants are REST routes under
  \`/v1/finance/\` and have no MCP tool today.** An agent that holds a token with \`finance:read\` (read
  the books) or \`finance:write\` (create, send and book) and can make HTTP calls uses them as below. An
  AI connected only over MCP cannot: say so plainly, and offer what it can do (the company record, a
  data package, drafting the invoice text for the person to enter).
- **Companies** (\`aimeat_company_*\`) and **data packages** (\`aimeat_datapackage_*\`) are MCP tools.
- The books belong to the person behind the session: the person, their agents and their apps with a
  finance grant see the same books, and nobody else does. An invoice that is not theirs answers 404.
- **Euro only.** Another currency is refused (422 \`UNSUPPORTED_CURRENCY\`). The VAT codes are
  Finland's: read them with \`GET /v1/finance/vat-codes\` (\`?date=\` gives the codes valid that day).

## 1. The company an invoice is sent as

A person who sends invoices as a company registers it once: \`aimeat_company_create\` with \`name\` and
the legal identity (\`business_id\`, \`vat_id\`, address, \`email\`, \`iban\`, \`bic\`,
\`einvoice_address\`, \`einvoice_operator\`). \`aimeat_company_update\` changes it,
\`aimeat_company_list\` lists them. An invoice drafted with \`company_id\` takes the seller's details
from that record; a \`seller\` block in the draft wins over it.

## 2. An invoice, from draft to paid

1. **Draft:** \`POST /v1/finance/invoices\` with \`buyer\` (name, and the identity and address fields
   the buyer needs), \`lines\` (each: \`description\`, \`quantityMilli\` in thousandths, \`unit\`,
   \`unitPriceMinor\` in cents, \`vatCodeId\`), \`company_id\` or \`seller\`, and optionally
   \`payment_terms_days\` and \`notes\`. **The node computes every amount**; never send totals. A draft
   can be changed (\`PUT\`) or deleted; nothing after it can.
2. **Show the draft to the person** with the totals the node computed, and wait for their yes.
3. **Send:** \`POST /v1/finance/invoices/{id}/send\` with \`delivery_method\`:
   - \`finvoice\`: delivered as an e-invoice through the node's e-invoice operator. A node without one
     answers 503 \`FINVOICE_OPERATOR_NOT_CONFIGURED\`; that is the operator's setting. A failed
     delivery is retried with \`POST .../deliver-finvoice\`, and \`POST .../refresh-delivery\` asks the
     operator for its status.
   - \`email\`: records the method; the mail itself is sent with \`POST /v1/outbound/send\` and the
     \`invoice_id\` (needs \`outbound:send\`), which attaches the PDF and the e-invoice file.
   - \`manual\`: the person delivers it themselves (\`GET .../pdf\` gives the PDF).
   Sending gives the invoice its number and payment reference (\`reference_style\`: \`fi\`, the
   default, or \`rf\` for the international form), takes the VAT rates valid on the invoice date, and
   fixes the due date from the payment terms. A sent invoice never changes.
4. **Paid:** \`POST /v1/finance/invoices/{id}/mark-paid\` (optionally \`paid_at\`). It books the income
   voucher, and a second call changes nothing. When the person takes payment with their own Stripe
   account and the payment carries the invoice's reference, the node marks it paid by itself.
5. **Correct a sent invoice** with a credit note: \`POST /v1/finance/invoices/{id}/credit-note\`, then
   send the credit note like an invoice. The original then reads \`credited\`.

\`GET /v1/finance/invoices\` lists them (filters \`status\`, \`type\`, \`from\`, \`to\`, \`company\`). An
unpaid invoice past its due date reads \`overdue\`: say those first when the person asks how things
stand.

## 3. The voucher journal

Every booking is a voucher: one gross amount, \`income\` or \`expense\`, with its VAT broken down by
code. Paid invoices and Stripe payments book their own vouchers. The person's receipts are booked with
\`POST /v1/finance/vouchers\` (\`source: "receipt"\` or \`"manual"\`, \`date\`, \`description\`,
\`direction\`, \`amount_minor\`, \`vat_breakdown\`, \`counterparty\`); attach the receipt file with
\`POST .../attachments\` and the stored file's key.

- **A voucher is never edited or deleted.** A mistake is corrected with
  \`POST /v1/finance/vouchers/{id}/reverse\` and a \`reason\`, which books the counter-voucher, and then
  the right voucher is booked.
- **Fiscal years.** One for the calendar year is created when the first invoice needs it; others with
  \`POST /v1/finance/fiscal-years\`. When the accounts for a year are closed, the person locks it
  (\`POST /v1/finance/fiscal-years/{id}/lock\`, the person in their own session): after that nothing
  is booked or sent into it (409 \`FISCAL_YEAR_LOCKED\`). This is how the books stop changing.
- There is no chart of accounts and no double-entry journal here. An accountant who keeps one imports
  the export.

## 4. Reports and the accountant

- \`GET /v1/finance/vat-report?from=YYYY-MM&to=YYYY-MM\`: VAT for the period, by code.
- \`GET /v1/finance/pnl?from=YYYY-MM&to=YYYY-MM\`: profit and loss. The person sees it on the profile's
  P&L tab (\`/v1/profile?tab=pnl\`).
- Exports: \`GET /v1/finance/export/vouchers.csv\`, \`/export/invoices.csv\` and \`/export/finvoice.zip\`.
- **An accountant reads the books with their own account** on the same node:
  \`POST /v1/finance/accountants\` (the person in their own session) gives read access, and
  \`DELETE /v1/finance/accountants/{name}\` takes it away. The accountant sees the clients who gave
  them access with \`GET /v1/finance/clients\` and reads each one's books with \`?owner=\`.

## 5. Open data: a data package and its OData feed

When the person wants to publish a table (a price list, opening hours, open statistics) so that other
programs read it:

- \`aimeat_datapackage_publish\` with a \`name\` and \`resources\` (each a table: \`name\`, \`rows\`,
  optionally \`schema\`), plus \`title\`, \`description\`, \`license\` and \`sources\`. Each publish is a
  new version with a permanent address; an ODPS description of the product goes with it.
- \`aimeat_datapackage_export\` reads a package back as CSV, JSON or an address.
- **The OData feed** is \`/v1/odata/{owner}/{name}\`: one entity set per table, with \`$metadata\`, and
  \`$select\`, \`$top\`, \`$skip\`, \`$filter\`, \`$orderby\`, \`$count\` and \`$format\`. Excel, Power BI
  and other OData clients read it directly. **It needs no sign-in**: it is as open as the package.
  Never publish anything private there, and tell the person that before you publish.

## How it goes stale

The books are meant to stay: vouchers are kept, corrected by reversal, and closed by locking the
year. What goes stale is the work around them: drafts never sent, invoices overdue, a year left
unlocked after the accounts were closed. When the person asks how the business is doing, name those.
`,
};
