# Gating a node to approved organisations

*How to run one AIMEAT node for your company and the partner companies you approve, with Microsoft
Entra ID as the way in.*

**Version:** 1.3 — Section 6a: a welcome page and a company front page take the same access as an app
**Date:** 2026-10-18
**License:** MIT

---

## 1. Two gates, and why one is not enough

A node shared by a few named organisations needs two questions answered separately.

**Who may sign in?** For Entra, the answer is the tenant allowlist: the node compares the `tid`
claim of the verified ID token against a list of Directory (tenant) GUIDs and refuses everything
else, including personal Microsoft accounts.

**Who may get an account here?** That is the registration mode. It is a different question, because
the node also has doors that never touch Entra: the API registration endpoint, the web registration
form, the self-service invitation request, and member-minted invitations.

Setting only the first leaves those doors open to the public internet. Setting only the second
leaves the front door open to every Microsoft account in the world. The combination below is what an
organisation node wants.

| `AIMEAT_REGISTRATION_MODE` | Password registration | First sign-in through a provider | Invitation |
|---|---|---|---|
| `open` (default) | yes | yes | yes |
| `oauth` | no | yes | yes |
| `invite` | no | no | yes |
| `closed` | no | no | no |

Existing accounts sign in under every mode. The mode decides account CREATION only.

For "our staff and the partners we approved, nobody else", use `oauth` plus the tenant allowlist.
Use `invite` when you want to name every person yourself and Entra to be only the way they
authenticate.

## 2. Register the app in Entra

At [entra.microsoft.com](https://entra.microsoft.com) → App registrations → New registration:

- **Supported account types:** *Accounts in any organizational directory (multitenant)*. A
  single-tenant registration cannot sign anyone in from a partner's directory, whatever the
  allowlist says.
- **Redirect URI:** platform *Web*, value `https://<your-node>/v1/ghii/login/entra/callback`.
- **Certificates & secrets** → New client secret. Copy the *value*, not the secret ID.

Note the **Application (client) ID** and your own **Directory (tenant) ID** from the Overview page.

Each partner organisation gives you their Directory (tenant) ID. It is a GUID, visible on any
Entra Overview page in their tenant, and it is not a secret. Do not accept an email domain instead:
a domain is whatever a tenant admin added to a directory, while `tid` is which directory issued the
token.

## 3. Each organisation approves the app once

A multi-tenant app does not work in an organisation until an administrator of THAT organisation has
approved it. Most companies switch off a user's ability to consent to apps themselves, so the first
person to try signing in sees "Approval required" and gets no further. This is Entra working as
designed, and it is the partner organisation's half of the agreement: they approve the app, you add
their tenant GUID to the allowlist. Neither half admits anyone on its own.

An administrator grants it either way:

- Sign in to the node with an administrator account. The consent screen then offers *Consent on
  behalf of your organization*.
- Or in Entra: Enterprise applications → the app → Permissions → Grant admin consent.

What they are approving is `openid`, `profile` and `email`: the name and address needed to sign in.
No Microsoft Graph permissions, no mailbox, no offline tokens, and nothing that reads anything in
their tenant. Say so when you ask, because the consent screen also says the publisher is unverified
and that is what an administrator reacts to.

Publisher verification removes that warning. It needs a Microsoft Partner Network account with the
app registration linked to it. Sign-in works without it, but some tenants are configured to refuse
unverified publishers outright, and then verification is the only way in.

## 4. Configure the node

```bash
AIMEAT_ENTRA_OAUTH_ENABLED=true
AIMEAT_ENTRA_OAUTH_TENANT=organizations
AIMEAT_ENTRA_ALLOWED_TENANTS=<your-tenant-guid>,<partner-1-guid>,<partner-2-guid>
AIMEAT_ENTRA_OAUTH_CLIENT_ID=<application-client-id>
AIMEAT_ENTRA_OAUTH_CLIENT_SECRET=<client-secret-value>
AIMEAT_REGISTRATION_MODE=oauth
```

The allowlist is the gate. Leaving it empty falls back to `AIMEAT_ENTRA_OAUTH_TENANT` alone: a GUID
there admits that one tenant (single-tenant app registration, the older setup), and
`common` / `organizations` / `consumers` admit anyone.

Restart the node after changing any of these. The allowlist is deliberately environment-only: the
admin Config tab shows the value and marks it as not editable, and a PUT naming its path is refused,
because widening who may sign in should take a deploy rather than one call from an operator session.

`AIMEAT_REGISTRATION_MODE` is the exception. It is live-editable by an operator through
`PUT /v1/admin/config` with `registration.mode`, which is how you open a node for an afternoon and
close it again.

## 5. Check that it works

Boot the node and read the log. Two misconfigurations are silent at runtime, so they are named at
startup: a value in the allowlist that is not a GUID, and a pinned tenant GUID that contradicts the
list. Both produce a node where every sign-in is refused and nothing explains why.

Then:

- `GET /v1/auth/providers` lists `entra` once it is enabled and the client id and secret are set.
- `GET /` reports the current `registration_mode`.
- Sign in with an account from an allowed tenant. It should reach the username-choice step and
  create an account.
- Sign in with a personal Microsoft account. The browser lands back on the node with
  `?auth_error=ENTRA_WRONG_TENANT` and no account is created.
- `POST /v1/owners` and `POST /v1/ghii` answer `403 REGISTRATION_CLOSED` under mode `oauth`.

A gated sign-in also lets the node vouch for the email address, which is what makes an invited
account link to its Entra identity on the first sign-in instead of dead-ending at "username taken".
Ungated Entra sign-in (`common` or `organizations` with no allowlist) does not vouch for it.

## 6. What the gate does not cover

- **Other sign-in providers.** The tenant allowlist gates Entra only. If Google or Casdoor is also
  enabled, that is a second front door with its own answer to "who may sign in", and under mode
  `oauth` it creates accounts too. Turn them off on an organisation node.
- **Guest accounts in your own directory.** A guest invited into your tenant carries YOUR `tid`, so
  they pass the gate. Anyone your Entra admins invite as a guest can sign in here. That is often
  what you want, and it should be a decision rather than a surprise.
- **Invitations.** Under `oauth` and `invite`, any member of the node can mint an invitation and the
  invited person gets an account with a password, from any tenant or none. Members who should not be
  handing out accounts are an organism-role question, not a sign-in question.
- **The sign-in modal.** It still shows the registration form under every mode; the door behind it
  answers 403. The modes have always behaved this way, and the SPA does not read the mode yet.
- **Removing a tenant from the list locks out its people.** The `tid` check runs on every sign-in,
  not only the first, so people from a removed tenant can no longer get in. Their accounts, memory
  and workspace access all remain. Removing an organisation is therefore reversible, and it is not
  the same thing as deleting anyone.
- **What a stranger can READ.** The two gates above decide who gets in. They do not decide what the
  node shows to someone who is not in: published apps, public files and shared pages are still
  served to anyone. Section 6a closes that.

## 6a. Show the content to signed-in accounts only

`AIMEAT_CONTENT_ACCESS=signed-in` (also on the admin Config tab, visibility.content_access) makes
the node serve nothing to anyone who is not signed in to one of its own accounts:

- Every route outside a short list answers 401 `SIGN_IN_REQUIRED`. The list is what signing in,
  registering, invitations, MCP and OAuth, device authorization and the app-grant steps need, plus
  routes that carry a credential of their own (download tokens, unsubscribe links, signed
  federation messages) and the node's own description for machines. It is `OPEN_ROUTES` in
  `aimeat/src/middleware/content-access-gate.ts`, each entry with its reason, and
  `test/e2e-content-access-gate.ts` calls every route the code declares to prove the rest refuse.
- The pages still load (a browser keeps its session in its own storage, so a page load carries no
  credential), but they carry no content: the shell drops the node's apps, members and portfolios,
  and the API calls behind the page are refused until the person signs in.
- Apps open only after a sign-in. A browser that opens an app without a session is sent to
  `/v1/app-open`, signs in there, and comes back to the app. An owner can narrow an app further to
  one organism's members (`open_to` on the app's settings).
- A person's welcome page and a company's front page take the same three choices as an app, on any
  node: anyone, signed-in, or one organism's members (`access` on `PUT /v1/portfolio/config` and
  `PUT /v1/companies/:id/front-page`, or `aimeat_portfolio_publish` and `aimeat_company_front_page`).
  A browser without a sign-in goes through the same `/v1/app-open` page and comes back to the page.
- Portfolio and company addresses answer 404, robots.txt disallows everything, the sitemaps and
  the public feeds answer 401, and an anonymous visitor to a realtime room is refused.
- A visitor signed in on another node is not an account here and gets the same 401.
- Something made public from now on is saved for the signed-in accounts instead. A memory record,
  a stored file, a user skill, a package, a knowledge package or one of its entries and a data
  package are saved at `members`, and a workspace link at `account`. The answer carries one
  warning, `PUBLIC_IS_SIGNED_IN_HERE`, in `warnings` (on MCP in the result text, not as an error).
  This also applies to a starting level of public (`AIMEAT_DEFAULT_APP_UPLOAD_VISIBILITY`,
  `AIMEAT_DEFAULT_SHARE_ACCESS`, `AIMEAT_DEFAULT_DATAPACKAGE_VISIBILITY`). No publish request is
  filed for it, because nothing became public. The stored value then says what the node really
  serves, apps that read at that level keep working, and opening the node later exposes nothing new
  by accident.
- An organism, a board, an app's listing, a cortex library, a welcome page and a company front page
  have no signed-in level of their own and keep the value they are given. The gate above hides them
  from everyone without an account.
- Content that was public before the node was closed keeps its own setting underneath, so switching
  back to `open` restores what was public.

For a company node, use it together with `AIMEAT_REGISTRATION_MODE=oauth` (or `invite`) and the
tenant allowlist: then the people who can sign in are your staff and the partners you approved,
and only they see anything.

Two settings shape how a new app starts on any node: `AIMEAT_APP_DEFAULT_LISTING` (listed,
community or unlisted) and `AIMEAT_APP_DEFAULT_ACCESS` (anyone or signed-in), with
`AIMEAT_APP_DEFAULT_ACCESS_CODE=true` giving each new app a code the publisher is told.

## 6b. A company node, step by step

The whole recipe for a node that one company and its approved partners use, and nobody else. Every
setting below is also on the admin Config tab, so an operator can change it without a restart.

**1. Run a version that has all of it.** The content gate, the publish gate and the starting levels
arrived on 2026-10-17 and 2026-10-18 (plan doc-mvcn6c7e4e5q). `curl https://<node>/v1/build` gives
the commit that runs.

**2. Who can sign in** (sections 2 to 4): `AIMEAT_REGISTRATION_MODE=oauth` (or `invite`) and
`AIMEAT_ENTRA_ALLOWED_TENANTS=<company tenant>,<partner tenant>,...`.

**3. Who sees anything:** `AIMEAT_CONTENT_ACCESS=signed-in` (section 6a). On this node "signed-in"
means the company's people and the approved partners.

**4. Nothing becomes public without the owner:** `AIMEAT_PUBLISH_GATE=agents-and-apps`. An agent
needs the `publish:public` permission, which the owner ticks separately and "Full access" does not
include; an app needs it on its consent screen. Without it, the change is saved at the level it had
and the owner gets a notification with Approve and Decline (`/v1/publish-requests`,
`aimeat_publish_requests`). On a closed node this matters when the node is opened later.

**5. Where new things start** when nobody names a level:

```
AIMEAT_APP_DEFAULT_ACCESS=signed-in          # a new app opens for signed-in accounts only
AIMEAT_APP_DEFAULT_LISTING=community         # and is listed for signed-in accounts only
AIMEAT_DEFAULT_ORGANISM_VISIBILITY=private
AIMEAT_DEFAULT_BOARD_VISIBILITY=private
AIMEAT_DEFAULT_SHARE_ACCESS=organism         # a first workspace share: the organism's members
AIMEAT_DEFAULT_DATAPACKAGE_VISIBILITY=private
AIMEAT_DEFAULT_APP_UPLOAD_VISIBILITY=members # what an app's upload gets when it names no level
AIMEAT_DEFAULT_AGENT_LISTED=false            # a new agent is not in the agent directory
```

Memory records and stored files start private on every node. `aimeat init` writes the board,
organism, share, data package and agent values above for a new node; a running node keeps the old
behaviour until the operator sets them.

**6. Two levels inside the company.** "Signed-in" is everyone who can sign in, partners included.
For what only the company's own staff may read, make one organism for the company (for example
"Innokas Medical") with the staff as members, and use its level: `organism:<id>` on records, files,
boards, skills and packages, `open_to: organism:<id>` on an app, `access: organism:<id>` on a
welcome page or company page, and access `organism` on a workspace share. A team app whose people
share one data set keeps that data in the organism's workspace, not in each person's own memory;
the app-building interview asks this before it builds (its data map step).

**7. Check what is open.** After the settings, the operator reads `GET /v1/admin/exposure` (the
node-wide numbers) and each person reads their own "What others can see" list
(`GET /v1/exposure/mine`, `aimeat_exposure_report`). Close what was not meant for everyone who can
sign in.

**8. Classification: how sensitive content is, and who may see it.** A classification says how
sensitive a piece of content is. On a company node it also limits who may see the content.

1. *Switch it on for everyone.* `AIMEAT_CLASSIFICATION=all` (Config tab: `classification.mode`).
   With `all`, every owner's content is classified and no owner can switch it off. `owner` lets each
   owner decide, and `off` (the default) changes nothing.
2. *Know the four classifications.* Public (`julkinen`), Internal (`sisainen`), Confidential
   (`luottamuksellinen`) and Highly confidential (`erittain-luottamuksellinen`). Content that nobody
   classified is Internal. Detection rules raise a record that holds a personal identity code, a key,
   a password, an IBAN or an e-mail address. You change the classifications and the rules on the
   admin Security page, with `GET` and `PUT /v1/classification/policy` and `level: "node"`, or with
   `aimeat_classification` (`policy_get`, `policy_set`).
3. *Classify the containers.* An organism, a workspace, a board and an app can carry a
   classification, and everything inside it is classified at least that high. The organism's creator
   or an admin sets it on an organism or a workspace, and the owner sets it on a board or an app:
   `PUT /v1/classification/label` with `kind` `organism`, `workspace`, `board` or `app` (and
   `organism_id`, `ws`, `board_id` or `app`), or `aimeat_classification`. For example, classify the
   company organism Confidential, and every document in its workspaces is Confidential or higher.
4. *Know what the limits refuse.* Each classification has a limit, `maxAudience`: the widest
   audience its content may be given (`public`, `link`, `signed-in`, `organism` or `private`). A new
   node starts with these limits: Public none, Internal `signed-in`, Confidential and Highly
   confidential `organism`. A change that would show content wider than its limit is refused with
   409 `LABEL_CAPS_AUDIENCE`, and nothing is stored: a record or a file made public, a workspace
   shared by link (each published page of a space shared whole is checked too), a board made public,
   an app listed or opened to anyone, an organism made public. When the classification of content
   rises, content already shown wider is narrowed at once, and the owner gets a notification.
   Content that was already wider when a limit was first set is not changed: each person's "What
   others can see" list shows it, and the owner narrows it.
5. *A node that ran before.* It keeps its classifications as they were. When classification is on
   (or the moment you switch it on; nothing is offered while it is off), its Security page holds one
   incident, type `classification_default_caps`, that offers each limit. Press Apply or Keep as it
   is beside each classification on that page, or decide each one with
   `POST /v1/admin/security/incidents/{id}/resolve` and `{ "name": "<classification id>",
   "resolution": "apply" }` (or `"keep"`), or with `aimeat_admin_incident_resolve`. A decision
   changes the policy only; no content changes.
6. *The owner's written exception.* The owner, signed in themselves, may allow a wider audience for
   one item, with a written reason: `POST /v1/classification/exceptions` with `action: "audience"`,
   or Make an exception in the Data Wallet. An agent or an app cannot make it. The exception is on
   the exceptions list and in the audit log.
7. *Agents' clearance.* `AIMEAT_AGENT_CLEARANCE_DEFAULT=sisainen` (Config tab:
   `classification.agent_clearance_default`) gives each new agent a clearance: the highest
   classification it may read. Content classified higher is hidden from the agent and counted.
   Agents that exist keep what they have. The owner changes it on the agent's card ("May read at
   most") or with `PATCH /v1/agents/{name}/clearance`; another agent may only lower it
   (`aimeat_operator_agent_configure` with `clearance`). Empty means no limit.

## 7. SAML and SCIM: the organisation's own identity provider (BR-04)

Entra OIDC above answers "our staff sign in with Microsoft". SAML and SCIM answer the two questions
an enterprise buyer asks next: *can our people sign in through whatever identity provider we run*,
and *when someone leaves, does their access end without anyone remembering to click*. Both arrive
as an **SSO connection** — a record an operator manages at runtime, in the admin dashboard's
Organisation sign-in tab, over `/v1/admin/sso/connections`, or through the `aimeat_admin_sso_*`
tools from a chat.

One connection carries one organisation: its email domains, an optional organism its people join
on arrival, the SAML half (read from the IdP's metadata, by URL or pasted XML) and the SCIM half
(a provisioning token shown once, hash stored). A node for one company creates one connection;
a shared node creates one per customer, and marks them `hidden` so the public sign-in modal does
not publish the customer list.

The setup itself is a five-step playbook in the admin tab, and every step shows what the node has
actually SEEN — metadata read, a real sign-in through, the directory calling the SCIM endpoint —
rather than what was configured. The tab also carries Entra and Okta walkthroughs and a copyable
brief for the operator's own AI. Two runtime switches govern the doors:

- `sso.enabled` (`AIMEAT_SSO_ENABLED`, default false) — the public doors (SAML login, ACS, SCIM,
  SP metadata) answer 503 until it is on. Management works either way: configure first, enable second.
- `sso.connections_locked` (`AIMEAT_SSO_CONNECTIONS_LOCKED`, default false) — freezes every
  connection write with 403. A host who wants "who may sign in" to take a deploy SEALS this key
  (`AIMEAT_SEALED_CONFIG_KEYS=sso.enabled,sso.connections_locked`) — the same mechanism as every
  other sealed setting, deliberately not a new immutable flag.

What deprovisioning actually does: `active: false` (or DELETE) **deactivates** the account. The
person's knowledge, memberships and history remain; every credential acting in their name —
sessions, their agents' 90-day tokens, personal access tokens, app grants, live connect tunnels —
ends within the request, and nothing new can be minted. Reactivation lets the person back in
without resurrecting the old credentials. The same state is behind the operator's manual
Deactivate button on the Owners tab. A connection may only touch accounts it manages
(`managedBy`), it can never deactivate an operator-role account, and it may ADOPT an existing
account only when that account's locally verified email is in the connection's own domains. The
same fence holds for an account the connection creates, by SCIM or at a first SAML sign-in: its
address is recorded as verified only when it is in the connection's domains. A guest whose address
is elsewhere gets an account without a verified address, and confirms the address later the way any
member does.

Entra specifics worth knowing before the console: the SAML app is an *Enterprise application*
(Identifier and Reply URL come from the connection's SP details), and the provisioning Tenant URL
must end with `?aadOptscim062020` — without it Entra's SCIM client departs from RFC 7644 (the node
tolerates its capitalised op verbs and string booleans either way). Okta: a SAML 2.0 app
integration, same two values, metadata address from the Sign On tab.

## 8. Where this lives in the code

| What | Where |
|---|---|
| Tenant gate, claim mapping, provider registry | `aimeat/src/services/oidc-providers.ts` |
| Sign-in callback and the account-mapping decisions | `aimeat/src/routes/oauth-login.ts` |
| Registration-mode rule table | `aimeat/src/services/owner-provisioning.ts` |
| Config keys and defaults | `aimeat/src/config.ts`, `aimeat/src/config-types-social-login.ts` |
| Tests | `aimeat/test/unit/registration-gate.test.ts`, `aimeat/test/e2e-registration-mode.ts` |
| Shared account-mapping tree (OIDC + SAML) | `aimeat/src/services/external-login.ts` |
| SAML SP wrapper + IdP metadata parsing | `aimeat/src/services/saml-sp.ts` |
| SAML login routes (authorize/ACS/finalize) | `aimeat/src/routes/saml-login.ts` |
| SSO connection management (one implementation) | `aimeat/src/services/sso-connections.ts`, routes `aimeat/src/routes/admin-sso.ts`, MCP `aimeat/src/mcp/admin-sso.ts` |
| SCIM door + resource handlers | `aimeat/src/routes/scim.ts`, `aimeat/src/services/scim-users.ts` |
| Account deactivation (one implementation) | `aimeat/src/services/owner-lifecycle.ts` |
| BR-04 tests | `aimeat/test/unit/saml-assertion.test.ts`, `aimeat/test/unit/scim-entra-compat.test.ts`, `aimeat/test/e2e-owner-deactivation.ts`, `aimeat/test/e2e-saml-login.ts`, `aimeat/test/e2e-scim-users.ts` |

One implementation detail worth recording, because it looks like it should be a problem. A
multi-tenant Entra app discovers its metadata at the `organizations` authority, whose discovery
document carries the literal issuer `https://login.microsoftonline.com/{tenantid}/v2.0`. The token's
own `iss` names the real tenant, so a strict OIDC client would reject every sign-in. openid-client
v6 recognises the Entra origin and substitutes the token's `tid` when it validates `iss`, which is
why the generic OIDC client here needs no Entra special case.
