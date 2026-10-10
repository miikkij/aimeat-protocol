# Document signing: settings and setup

How an operator configures document signing on an AIMEAT node: AIMEAT signatures (passkey, key or session, sealed by the node), checks of signatures made elsewhere (PDF and CMS against the EU trusted lists), and signing a PDF with an EU Digital Identity Wallet. What each feature does for a person is in [AIMEAT-Feature-List.md](AIMEAT-Feature-List.md) (Document signing, Signature checks, Signing with an EU Digital Identity Wallet); the API is in [openapi.yaml](../openapi.yaml), tag "Document signing".

**Do not confuse this with `AIMEAT_EUDIW_*`.** Those settings belong to identity verification with a wallet ([aimeat-eudiw-integration.md](aimeat-eudiw-integration.md)), which is blocked at startup: `AIMEAT_EUDIW_ENABLED=true` stops the node from starting. Signing with a wallet is a different feature with its own settings, all named `docsign.*` / `AIMEAT_DOCSIGN_*`, and it does not touch `AIMEAT_EUDIW_*`.

## Where the settings are

Every setting below is in Admin › Config, domain Identity, group **docsign**, and in `GET /v1/admin/config` (an operator's AI reads it with `aimeat_admin_config`). A setting marked "start" is read from the environment when the node starts and is shown there read-only; change it in the node's `.env` and restart. The others can be changed in Admin › Config or with `PUT /v1/admin/config` and take effect at once. The defaults and the one-line meaning of each are also in [aimeat/.env.example](../aimeat/.env.example) and in the schema, [config-schema-docsign.ts](../aimeat/src/services/config-schema-docsign.ts).

| Setting | Environment variable | Default | Changed | What it does |
|---|---|---|---|---|
| `docsign.enabled` | `AIMEAT_DOCSIGN_ENABLED` | true | live | All signing and checking routes and tools. Off answers 404. |
| `docsign.online_checks` | `AIMEAT_DOCSIGN_ONLINE_CHECKS` | true | live | A check may fetch the EU trusted lists, OCSP, CRLs and a missing issuer. Off on a node without internet: trust and revocation are reported as not checked. |
| `docsign.lotl_url` | `AIMEAT_DOCSIGN_LOTL_URL` | the Commission's address | live | Where the EU list of trusted lists is fetched from. |
| `docsign.lotl_signer_sha256` | `AIMEAT_DOCSIGN_LOTL_SIGNER_SHA256` | empty | live | Pins the certificates allowed to sign the EU list (comma-separated SHA-256). |
| `docsign.trust_anchors` | `AIMEAT_DOCSIGN_TRUST_ANCHORS` | empty | start | A PEM file of extra root certificates (a company CA, a non-EU scheme). |
| `docsign.max_mb` | `AIMEAT_DOCSIGN_MAX_MB` | 25 | live | The largest file a check reads, 1 to 100 MB. Also the largest PDF a wallet signs. |
| `docsign.app_url` | `AIMEAT_DOCSIGN_APP_URL` | empty | live | The signing app. A signing request's notification and the AI's answers link to it (`?request=<id>`). |
| `docsign.eudi_enabled` | `AIMEAT_DOCSIGN_EUDI_ENABLED` | false | live | Signing a PDF with an EU Digital Identity Wallet. |
| `docsign.eudi_rp_credential` | `AIMEAT_DOCSIGN_EUDI_RP_CREDENTIAL` | empty | start | The PEM file with the wallet access certificate (below). A secret: the file holds a private key. |
| `docsign.eudi_test_roots` | `AIMEAT_DOCSIGN_EUDI_TEST_ROOTS` | true | live | Trust the EU reference wallet's test CAs when checking a signature. Such a signature is always reported as a test (`TEST_TRUST_ANCHOR`), never as qualified. Turn off once national wallets are in use. |

## Signing with an EU Digital Identity Wallet

The node is the relying party. The wallet makes the PAdES signature through its own trust service provider, so the node needs no account at a signature provider. Today this works with the EU reference wallet on Android; its certificates are test certificates. The protocol and its limits are in [eudi.ts](../aimeat/src/services/docsign/eudi.ts) and in Platform Development Notes, "Signing a PDF with an EU Digital Identity Wallet" (`doc-mv1k1f0750lq`).

### 1. Get the access certificate

A wallet accepts a request only from a relying party whose access certificate it trusts. For the EU reference wallet the registrar is https://registry.serviceproviders.eudiw.dev/:

1. Install the reference wallet on an Android phone (https://github.com/eu-digital-identity-wallet/eudi-app-android-wallet-ui/releases) and add a test PID to it (https://issuer.eudiw.dev/). The iOS reference wallet cannot do this signing flow.
2. Sign in to the registrar with the wallet, register the organisation and the relying party with the node's address, and download the access certificate as a `.p12` with its password.
3. Convert it to PEM on a trusted machine: `openssl pkcs12 -in access.p12 -nodes -out eudi-rp.pem`. The result holds the private key unencrypted.

The certificate must name the node's host, the host of `AIMEAT_BASE_URL`:

- **`URI:https://<host>`** (what the EU test registrar issues). The node uses `client_id_scheme` `x509_san_uri`, and the wallet then posts the signed PDF to exactly that address. The node answers `POST /` for that reason, and only for a wallet: a form whose `state` belongs to an open signing session. If a proxy sits in front of the node, it must pass `POST /` to the node.
- **`DNS:<host>`**. The node uses `x509_san_dns`, and each signing session gets its own response address under `/v1/docsign/wallet/`.

A certificate naming another host is refused, and the status says what it names.

### 2. Install it

1. Copy `eudi-rp.pem` to the server, outside the web root, readable only by the node's user (`chmod 600`).
2. In the node's `.env`: `AIMEAT_DOCSIGN_EUDI_RP_CREDENTIAL=<path>` and `AIMEAT_DOCSIGN_EUDI_ENABLED=true`.
3. Restart the node.

### 3. Check it

`GET /v1/docsign/wallet` (public) answers `enabled`, `ready`, `reason`, `client_id` and `client_id_scheme`. Ready looks like `"ready": true, "client_id": "https://<host>", "client_id_scheme": "x509_san_uri"`. When `ready` is false, `reason` says why: no file configured, the file cannot be read, the key does not belong to the certificate, or the certificate names another host.

### 4. Try it

Create a signing request for a PDF in the signing app (`docsign.app_url`), open it as a party and press "Sign with your EU wallet". On a computer the page shows a QR code the wallet scans; on the phone it opens the wallet. A person's AI does the same with `aimeat_docsign_wallet_start { id, storage_key }` and `aimeat_docsign_wallet_status`. The signed PDF lands in the signer's files and every party can download it (`GET /v1/docsign/requests/{id}/signed-document`).

### What to expect from a test signature

- The check reports the signature as a test (`TEST_TRUST_ANCHOR`, trust source `eudi-test-anchor`, level unknown).
- The node refuses a returned PDF that does not begin with the exact bytes it sent, because then it cannot be shown to be the same document.
- If the test CA publishes no revocation information the node can reach, the verdict is "could not be confirmed" rather than valid.
