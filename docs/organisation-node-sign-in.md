# Gating a node to approved organisations

*How to run one AIMEAT node for your company and the partner companies you approve, with Microsoft
Entra ID as the way in.*

**Version:** 1.0
**Date:** 2026-08-21
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

## 7. Where this lives in the code

| What | Where |
|---|---|
| Tenant gate, claim mapping, provider registry | `aimeat/src/services/oidc-providers.ts` |
| Sign-in callback and the account-mapping decisions | `aimeat/src/routes/oauth-login.ts` |
| Registration-mode rule table | `aimeat/src/services/owner-provisioning.ts` |
| Config keys and defaults | `aimeat/src/config.ts`, `aimeat/src/config-types-social-login.ts` |
| Tests | `aimeat/test/unit/registration-gate.test.ts`, `aimeat/test/e2e-registration-mode.ts` |

One implementation detail worth recording, because it looks like it should be a problem. A
multi-tenant Entra app discovers its metadata at the `organizations` authority, whose discovery
document carries the literal issuer `https://login.microsoftonline.com/{tenantid}/v2.0`. The token's
own `iss` names the real tenant, so a strict OIDC client would reject every sign-in. openid-client
v6 recognises the Entra origin and substitutes the token's `tid` when it validates `iss`, which is
why the generic OIDC client here needs no Entra special case.
