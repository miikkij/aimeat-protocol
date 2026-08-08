/**
 * @file companies-prompts.js
 * @description The three copy-paste prompts the Companies tab hands to an AI chat: fill in the
 *   company's details, build its public page, and build it an app. Each one names the exact
 *   AIMEAT MCP tools to call, so a chat with the connector does the work directly instead of
 *   handing back text the founder then retypes into a form.
 *
 *   Every prompt carries a NO-MCP fallback, because the same person may paste it into a chat
 *   without the connector — there it produces something to paste back, which is still a working
 *   loop rather than a dead end.
 *
 *   Two rules these prompts hold, both learned the expensive way:
 *   1. The app prompt does NOT restate how to build an AIMEAT app. It tells the chat to fetch
 *      GET /v1/prompts/build-app first, because that spec is node-served and canonical; a copy
 *      here would drift the moment the real one improves.
 *   2. The details prompt forbids inventing values. A business id or IBAN that "looks right"
 *      ends up on a real invoice and in a real e-invoice, so an unknown field stays empty.
 *
 *   Prompts are written in English regardless of UI language: the chat on the other end is not
 *   necessarily running in Finnish, and the tool names and field names are English anyway.
 *
 * @structure buildSettingsPrompt · buildPortfolioPrompt · buildAppPrompt
 * @usage import { buildSettingsPrompt } from './companies-prompts.js';
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial: settings, portfolio and app prompts for an MCP-capable chat.
 */

/** The fields an invoice reads, in the order a person naturally states them. */
const DETAIL_FIELDS = [
  ['business_id', 'businessId', 'company registration number (Finnish Y-tunnus)'],
  ['vat_id', 'vatId', 'VAT number'],
  ['street_address', 'streetAddress', 'street address'],
  ['postal_code', 'postalCode', 'postal code'],
  ['city', 'city', 'city'],
  ['country', 'country', 'country code, two letters'],
  ['email', 'email', 'contact email'],
  ['phone', 'phone', 'contact phone'],
  ['iban', 'iban', 'bank account (IBAN)'],
  ['bic', 'bic', 'bank BIC'],
  ['einvoice_address', 'einvoiceAddress', 'e-invoice address (OVT)'],
  ['einvoice_operator', 'einvoiceOperator', 'e-invoice operator id'],
];

function nodeOrigin() {
  return typeof location !== 'undefined' ? location.origin : '';
}

/** "name — address" line every prompt opens with, so the chat knows what it is working on. */
function companyHeader(company) {
  const address = company.address ? `\nPublic address: ${company.address}` : '';
  return `Company: ${company.name}\nCompany id: ${company.id}${address}\nAIMEAT node: ${nodeOrigin()}`;
}

/** What is already filled in vs still missing — the chat should only ask about the gaps. */
function detailState(company) {
  const filled = [];
  const missing = [];
  for (const [wire, rec, label] of DETAIL_FIELDS) {
    const v = company[rec];
    if (v) filled.push(`  ${wire} = ${v}`);
    else missing.push(`  ${wire} (${label})`);
  }
  return { filled, missing };
}

/**
 * Prompt 1 — fill in the company's legal identity.
 * The value of doing this in a chat rather than the form is that a conversation can ask one
 * question at a time and check the answers against each other; the value of doing it over MCP
 * is that the answers land in the record without a retyping step.
 */
export function buildSettingsPrompt(company) {
  const { filled, missing } = detailState(company);
  return `You are helping me set up my company on AIMEAT, an open protocol node for AI agents.

${companyHeader(company)}

WHAT I NEED
Fill in this company's registered details. They become the seller party on every invoice I
send and the supplier block in the Finvoice e-invoice, so they have to be the real registered
values.

ALREADY FILLED IN
${filled.length ? filled.join('\n') : '  (nothing yet)'}

STILL MISSING
${missing.length ? missing.join('\n') : '  (nothing — everything is filled in; check the values above with me instead)'}

HOW TO DO IT
1. Call aimeat_company_list and find the company with id ${company.id}, so you are working from
   the current record rather than from this message.
2. Ask me for the missing values. Ask in small batches — a few related fields at a time, not a
   wall of twelve questions. If I give you a company registration number, you may look up what
   is publicly known about it and offer the rest for me to confirm.
3. Write what I confirm with aimeat_company_update, passing ONLY the fields I have given you.
   Fields you leave out keep their current value, so it is safe to call it several times as we go.
4. When we are done, call aimeat_company_list once more and show me the finished record.

ONE RULE THAT MATTERS
Never invent or guess a value. A registration number, VAT number, IBAN or BIC that merely looks
plausible ends up on a real invoice sent to a real customer. If I do not know a value, leave that
field out and tell me it is still missing.

IF YOU DO NOT HAVE THE AIMEAT TOOLS
You will not see aimeat_company_* in your tool list if this chat has no AIMEAT connector. In that
case ask me the same questions and finish by giving me the values as a plain list I can paste into
the Companies tab myself.`;
}

/**
 * Prompt 2 — build the company's public page.
 * The page is a standalone document served on an isolated origin, so the prompt has to say what
 * is available there (nothing but this node) and what makes it look right (theme variables).
 */
export function buildPortfolioPrompt(company) {
  const { filled } = detailState(company);
  const about = company.description ? `\nWhat the company does: ${company.description}` : '';
  return `You are building the public front page for my company on AIMEAT, an open protocol node.

${companyHeader(company)}${about}

WHAT I NEED
One complete, self-contained HTML document to serve at my company's public address. It is the
page a customer lands on, so it should say what the company does, who it is for, and how to get
in touch — not a template with placeholder text.

WHAT I KNOW ABOUT THE COMPANY
${filled.length ? filled.join('\n') : '  (the details are not filled in yet — ask me about the company before you write the page)'}

HOW TO DO IT
1. Ask me what the company actually does and who its customers are, unless the details above
   already answer that. A page written from guesses reads like a template, which is worse than
   no page.
2. Write ONE HTML file: doctype through </html>, all CSS and JS inline. It is served standalone
   on an isolated origin, so anything it loads must come from this node (${nodeOrigin()}) or be
   embedded in the file.
3. Publish it with aimeat_company_portfolio_publish, passing company_id "${company.id}" and the
   whole document as html. That serves it AND points the address at it in one call.
4. Tell me the address so I can open it${company.address ? ` (${company.address})` : ''}.

HOW IT SHOULD LOOK
- Follow light and dark mode. Set your colours from CSS custom properties with fallbacks and a
  prefers-color-scheme block, rather than hardcoding one palette that breaks in the other mode.
- Responsive: relative units, flexbox or grid, images capped at max-width 100%. Check that the
  page does not scroll horizontally at 390px wide.
- No decorative emoji as UI furniture, and no stock-photo placeholders. If it needs an image and
  we do not have one, use type and layout instead.
- Keep the whole file under 512KB.

IF YOU DO NOT HAVE THE AIMEAT TOOLS
You will not see aimeat_company_portfolio_publish in your tool list if this chat has no AIMEAT
connector. In that case give me the finished HTML in one code block and I will paste it into the
Companies tab myself.`;
}

/**
 * Prompt 3 — build the company an app.
 * Deliberately thin: the canonical app-building spec is node-served and improving, so this
 * prompt's job is to send the chat there and then wire the result to the company address.
 */
export function buildAppPrompt(company) {
  const { filled } = detailState(company);
  const about = company.description ? `\nWhat the company does: ${company.description}` : '';
  return `You are building an app for my company on AIMEAT, an open protocol node for AI agents.

${companyHeader(company)}${about}

WHAT I NEED
A single-file AIMEAT app that does something useful for this company or its customers, published
to my node and served at my company's public address.

WHAT I KNOW ABOUT THE COMPANY
${filled.length ? filled.join('\n') : '  (the details are not filled in yet)'}

HOW TO DO IT
1. Fetch ${nodeOrigin()}/v1/prompts/build-app and follow it. That is the canonical, node-served
   spec for building an AIMEAT app — theme variables, the aimeat-scopes meta tag, which libraries
   load from where, and what "done" means. Read it before you write any code; do not work from
   your own recollection of how AIMEAT apps are built.
2. Before building anything, call aimeat_appdev_overview and check whether an app or capability
   that already does this exists on the node. Reusing one beats publishing a near-duplicate.
3. Ask me what the app should DO. "An app for my company" is not a brief — a booking form, a
   price calculator, a customer portal and a product catalogue are different products.
4. Publish it with aimeat_app_publish.
5. Point my company's address at it: call aimeat_company_front_page with company_id
   "${company.id}", kind "app", and target "<my-owner-name>/<the-published-filename>". The app
   has to be one I published — someone else's is refused.
6. Tell me the address so I can open it${company.address ? ` (${company.address})` : ''}.

IF YOU DO NOT HAVE THE AIMEAT TOOLS
You will not see aimeat_app_publish or aimeat_company_front_page in your tool list if this chat
has no AIMEAT connector. In that case still fetch and follow the build-app spec above, then give
me the finished HTML file and I will publish it myself from the Apps tab.`;
}
