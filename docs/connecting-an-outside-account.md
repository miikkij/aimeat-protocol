<!--
@file connecting-an-outside-account.md
@description Outbound connections: how a person attaches their own Gmail, Outlook, LinkedIn, X,
  Mastodon, Bluesky or YouTube account to this node, what the node can then do with it, and what it
  deliberately cannot. Covers the read direction, the send direction, bring-your-own application,
  the Google alias path, and Microsoft's three differences.
@version-history
  v1.0.0 — 2026-08-26 — Initial. The subsystem had shipped without a document, so the only way to
    learn it was to read providers.ts.
-->

# Connecting an outside account

A **connection** is one person's own account at an outside service, attached to this node so their
apps and their agents can use it in their name. Their Gmail. Their company LinkedIn page. Their
Mastodon server. The node holds the credential, sealed; the account stays theirs, and disconnecting
it stops everything at once.

Two directions, and they are separate on purpose.

**Reading** answers "what does my own account already know". Mail is the case that makes it obvious:
a person forwards themselves an invoice, a booking, a meter reading, and it sits in a mailbox no
tool of theirs can see.

**Sending** puts something out under their name — a post, a message, an email that leaves from their
own address, carries their domain's SPF and DKIM, and lands in their own Sent folder.

## Read and send are different consent

Gmail is two providers, `google-mail` and `google-mail-send`, and Outlook is two, `microsoft-mail`
and `microsoft-mail-send`. This is not tidiness. A permission that is never requested cannot be
misused, cannot leak, and does not have to be explained on a consent screen to somebody who only
wanted their invoices read. `google-mail` asks for `gmail.readonly` and nothing else: it cannot
send, cannot delete, cannot modify, because those scopes are not in the request.

A surface may group the pair as one card with two switches — what a person sees is one mailbox with
two permissions — but they are two authorisations, granted separately and revocable separately.

The full list, from `GET /v1/connections/providers`:

| id | what it does | capability |
|---|---|---|
| `google-mail` | reads Gmail, lists the verified send-as aliases | `read-mail` |
| `google-mail-send` | sends through that Gmail | `send-mail` |
| `microsoft-mail` | reads Outlook / Exchange Online | `read-mail` |
| `microsoft-mail-send` | sends through it | `send-mail` |
| `linkedin`, `x`, `mastodon`, `bluesky`, `youtube` | publishing | `publish` |

Every entry says whether **this node** holds an application for it. When it does not, somebody who
brings their own application can still use it, so a missing registration removes an option from
nobody.

## How a connection is made

```
POST /v1/connections/start   { provider, mode: 'personal', return_url? }   → { authorize_url }
```

The answer is an address for a **person** to open. They see at the provider exactly what is being
asked for and approve it there. Nothing on this node can approve it for them, and fetching the
address without handing it over does nothing.

PKCE throughout, with the `state` nonce held server-side rather than round-tripped. The provider
redirects to `GET /v1/connections/callback`, the node exchanges the code, seals the credential with
AES-256-GCM and asks the provider who the account belongs to, so the connection has a name and a
key to deduplicate on. Refresh is single-flight: ten calls arriving at once against an expired token
produce one refresh, not ten.

`DELETE /v1/connections/:id` revokes at the provider where the provider supports it, and deletes the
credential either way.

**A connection belongs to the exact principal that made it.** An account the owner connected in
their own browser does not appear to their agent, and one member of a team cannot send through
another's mailbox. A mailbox is the most private thing on this node, and inheriting one silently is
not a permission anybody knowingly grants.

## Bring your own application

A node operator does not have to register an application for every service, and one tenant's Entra
registration cannot be shared anyway.

```
PUT    /v1/connections/clients    { provider, client_id, client_secret, tenant? }
GET    /v1/connections/clients
DELETE /v1/connections/clients/:provider
```

The secret is sealed the same way a credential is. `tenant` is Microsoft-only: a single-tenant Entra
registration needs its own tenant id in the authorize and token URLs, and `common` is the default
for multi-tenant.

## Reading

```
POST /v1/connections/:id/read/:resource    { …parameters }
```

**The caller names a RESOURCE and supplies parameters; the node builds the URL.** That direction is
the security property. A provider declares an allowlist of resources — `messages`, `message`,
`attachment`, `profile`, `sendAs` — each with the scopes it needs and a function that constructs the
URL from validated parameters. Ids that go into a path are pattern-checked rather than trusted. A
caller cannot point a sealed credential at an address this node never meant to send it to, because
the caller never supplies an address.

Narrow the query before widening it. The `query` parameter is the provider's own search syntax
(`from:lasku@example.com has:attachment newer_than:90d`), and it is the difference between a useful
answer and forty thousand messages. Reading a whole mailbox to see what is in it is not a search.

Gmail hands back a message as a **tree of parts** with the text in base64url — which is not base64:
`-` for `+`, `_` for `/`, and the padding is usually missing. Prefer `text/plain` and fall back to
stripping the HTML. Attachments come by reference; fetching one is a real download on the person's
own allowance, and most of the time the answer is already in the text.

## Sending mail through your own mailbox

```
POST /v1/outbound/send   { contact_id, subject, body, connection_id?, from_alias?, ai_disclosure? }
```

**The outbound door stays the only sending path.** It owns the policy chain — a saved recipient
rather than a free address, suppression, opt-out on marketing, the rolling daily allowance, the
unsubscribe link — and passing `connection_id` changes only how the accepted message physically
leaves. Three ways, in order: the caller's own connected mailbox, the company's own SMTP, the node's
shared sender.

The connection is resolved and authorised **before the first gate**, so a refused send is logged
with the sender who attempted it. It must be the caller's own and must carry `send-mail`; otherwise
the refusal names the repair. Scopes: `outbound:send` and `connections:use`, both.

A successful answer is **not a delivery**. It means the provider accepted the message; a bounce
shows up on the contact afterwards.

### The Google alias, which is the button people mean

An address verified once at Google appears in the From picker here, and a message sent as it really
leaves through that Gmail. No DNS work, no second mailbox licence, and SPF and DKIM already come
from the company's own domain.

Three steps, and the first two happen at Google:

1. Define the alias in the Workspace admin console or in Gmail's own settings, and verify it.
2. Connect the mailbox here, once.
3. The alias is in the From picker.

`GET`ting the alias list is `POST /v1/connections/:id/read/sendAs`, and it needs only
`gmail.readonly` — the read connection already has it, so the picker costs nothing. **Only verified
addresses are listed**, because an unverified one is refused at send time for a reason the message
does not carry. An alias added at Google after the mailbox was connected can take a day to appear;
read the list live rather than caching it, so the delay is Google's and not ours.

Microsoft has no equivalent that a delegated permission can read, so the same call returns nothing
there rather than guessing. Sending as an alias on Microsoft is an Exchange SendAs right rather than
a Graph permission, and it is not promised here until it has been proven against a real tenant.

### Microsoft's three differences

Each one is silent if it is missed.

- **The tenant is in the URL**: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
  and `/token`, defaulting to `common`.
- **`offline_access` is a SCOPE, not a parameter.** Google wants `access_type=offline&prompt=consent`
  on the authorize URL, which is what the provider's `offlineAccess: true` produces. Microsoft wants
  the words in the scope list and the flag `false`. This is YouTube's trap exactly inverted, and it
  shows up the next day when the first refresh fails.
- **Identity comes from Graph** `/me` → `mail ?? userPrincipalName`, which needs `User.Read`. Without
  it the connection has no name and no key to deduplicate on, and identity failure is fatal.

`/me/sendMail` needs only `Mail.Send`, takes the MIME as a base64 string, and leaves the message in
the person's own Sent Items. A custom header on Graph must begin with `x-`; that is why the AI
disclosure header is `X-AI-Disclosure` and not something tidier.

## Saying a machine wrote it

Optional, off by default, and a header rather than a line in the body:

```
ai_disclosure: 'none' | 'ai-assisted' | 'ai-generated' | 'autonomous'
```

`X-AI-Disclosure` carries the word, and `X-AI-Disclosure-Record` carries a resolvable address when a
provenance id is supplied. `none` adds no header at all: a recipient's filter reading
`X-AI-Disclosure: none` would be reading a claim nobody made about a message nobody generated. A
word outside the four is refused rather than coerced.

It is optional because the EU AI Act does not oblige it here. Article 50(4) — the deployer
obligation — is scoped to text published to inform **the public** on matters of **public interest**,
and exempts even that where a person reviewed the content and holds editorial responsibility. A
message to one customer is neither, and the person pressing send is that editorial control. Article
50(2) is the **provider's** obligation about its own system's outputs, and this node already mints a
provenance record for every completion it runs.

An app or an agent cannot declare a level and then ask for the header to be left off. What cannot be
promised is that nobody downstream strips it: a DKIM signature makes removal detectable rather than
impossible, and only where we hold the key — sending through somebody's own Gmail, that provider
decides what it signs.

## From chat

Seven tools, on all three MCP surfaces:

`aimeat_connection_providers` · `aimeat_connection_list` · `aimeat_connection_start` ·
`aimeat_mail_search` · `aimeat_mail_read` · `aimeat_mail_aliases` · `aimeat_mail_send`

`aimeat_mail_send` is registered only when the agent holds **both** `outbound:send` and
`connections:use`. An agent without them does not see a tool that would refuse; it sees no tool.

## Configuration

Off by default. `AIMEAT_CONNECTIONS_ENABLED=true` turns the subsystem on; a provider with no client
credentials is simply not offered, and says so in `disabledReason`.

```
AIMEAT_CONNECTIONS_ENABLED=false
AIMEAT_CONNECT_GOOGLE_CLIENT_ID=            # Google Cloud → Clients → Web application
AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET=        # NOT the sign-in client
AIMEAT_CONNECT_MICROSOFT_CLIENT_ID=
AIMEAT_CONNECT_MICROSOFT_CLIENT_SECRET=
AIMEAT_CONNECT_MICROSOFT_TENANT=common
AIMEAT_CONNECT_LINKEDIN_CLIENT_ID=
AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET=
AIMEAT_CONNECT_X_CLIENT_ID=
AIMEAT_CONNECT_X_CLIENT_SECRET=
AIMEAT_CONNECT_REDIRECT_URI=                # default: <baseUrl>/v1/connections/callback
```

Every one of these is also visible and adjustable in the admin dashboard's Config tab, so an
operator sets them in one place rather than two.

**One thing to check at Google before promising the send button in production.** `gmail.send` is a
restricted scope, which means the application is either verified or in testing mode with a user cap.
`gmail.readonly` is restricted too, so an existing Gmail read connection already answers this — but
check the console rather than assuming. Microsoft has no equivalent review, so the Outlook path can
be in production first.
