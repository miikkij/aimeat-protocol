# Service Owner Manual

*How to extend an AIMEAT node: manifests, extensions and hooks.*

Rewritten 3 September 2026 against the running code. The previous version described a three-level
`.plugin.yaml` system that was never built; if you are looking for it, see [what changed](#9-what-this-manual-used-to-say) at the end.

---

## 1. What a service owner attaches to a node

A **service owner** is anyone who runs an AIMEAT node: a community marketplace, a hobby directory, a
company's internal hub, a federation relay. The core handles identity, memory, consent, federation
and the morsel pacing. You attach behaviour on top of it, and there are four ways to do that.

| You want to | Attach | It runs | Who installs |
|---|---|---|---|
| Fix the **shape** of your service's data, so bad records are refused | **CSM** manifest | Nothing. It becomes a schema lock the memory API enforces | Owner |
| Describe an **outside API** so an AI can build against it | **MSM** manifest | Nothing. It is a description an AI reads | Owner, or operator if the node says so |
| Run **code on the node**: an outbound call with a credential, work that outlives a browser tab, a capability you sell | **Extension** | In a QuickJS-WASM sandbox, in the owner's name | Owner, or a principal holding `ext:write` |
| Be **asked before** something happens on the node: a registration, a work request, a board post, a peering | **Hook** | Your own webhook, anywhere, in any language | Operator |

Three things you do **not** attach here, because they have their own paths: **apps** (single HTML
files, published with `aimeat_app_publish`), **cortex libraries** (browser-side code, see
`/v1/prompts/build-cortex`), and **skills** (how an agent is told to operate something, see
`docs/skills-registry.md`).

---

## 2. CSM: the shape of your service's data

A **Community Service Manifest** is a YAML document that says what a record in your service looks
like, who may see it, and how it is moderated. Registering one is not decoration: the node compiles
`data_schema` into JSON Schema and installs it as a **schema lock** on the memory key prefix
`csm.<service-name>`. From then on, every write to that prefix is validated by the generic memory
API, and a record that does not fit is refused. There are no per-service endpoints and no per-service
code.

### What registering does, step by step

1. `POST /v1/csm` with the YAML (`Content-Type: text/yaml`) or with JSON carrying a `yaml` field.
2. The parser reads six blocks and ignores everything else: `service`, `schema_mode`, `data_schema`,
   `consent_requirements`, `moderation`, `ui_hints`.
3. Validation. A failure answers `400 VALIDATION_ERROR` and names what is wrong.
4. A name already in use answers `409 CSM_NAME_TAKEN`. Names are node-wide.
5. `data_schema` becomes JSON Schema, stored as a schema lock on `csm.<name>` with `applyTo: prefix`
   and this manifest's `schema_mode`.
6. The CSM record is stored, with `service.semantic` carried into the schema lock as its semantic
   context, and `federate: true` (if you asked for it) distributing the manifest to peers.

`schema_mode: "open"` accepts extra fields beyond the schema; `"strict"` refuses them. Open is the
right default for a service other people will extend; strict is right when a downstream reader must
be able to assume the shape.

### The endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/v1/csm` | Owner |
| GET | `/v1/csm` | Anyone (`?type=` filters by service type) |
| GET | `/v1/csm/templates` | Anyone. Eight built-in templates: marketplace, auction, hobby-directory, dating-directory, news-feed, opinion-board, video-directory, organism |
| GET | `/v1/csm/templates/{type}` | Anyone. The template's raw YAML, to start from |
| GET | `/v1/csm/{name}` | Anyone |
| DELETE | `/v1/csm/{name}` | Owner |

### A worked example

A Finnish flea market. Ten lines decide what a listing is, and the node enforces it from then on.

```yaml
csm: "1.0"
service:
  name: "kirpputori"
  type: "marketplace"
  description: "Espoon alueen kirpputori"
  locale: "fi"

schema_mode: "open"

data_schema:
  required:
    title:      { type: string, minLength: 3, maxLength: 200 }
    price:
      type: object
      properties:
        amount:   { type: number, minimum: 0 }
        currency: { type: string, default: "EUR" }
      required: [amount]
    category:   { type: string, enum: ["elektroniikka", "vaatteet", "koti", "ajoneuvot", "palvelut", "muu"] }
    seller_gaii: { type: string }
  optional:
    description: { type: string, maxLength: 2000 }
    images:      { type: array, items: { type: string }, maxItems: 10 }
    condition:   { type: string, enum: ["uusi", "erinomainen", "hyva", "kohtalainen", "heikko"] }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "kirpputori-listing"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: true

ui_hints:
  list_view: ["title", "price.amount", "category", "condition"]
  detail_view: ["title", "description", "price", "category", "condition", "images"]
  search_fields: ["title", "category", "location.city"]
```

Register it, then write a listing through the ordinary memory API:

```bash
curl -X POST https://your-node/v1/csm \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/yaml" \
  --data-binary @kirpputori.csm.yaml

curl -X POST https://your-node/v1/memory \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"csm.kirpputori.item-001","value":{"title":"Vanha Nokia 3310","price":{"amount":15},"category":"elektroniikka","seller_gaii":"alice@node"},"visibility":"public"}'
```

Leave out `category` and the write is refused. That is the whole point of the manifest.

### Where CSM is used today

Beyond standalone services, CSM is how an **organism workspace** gets its object types: the manifest
at `organism.{id}.meta.manifest` orchestrates, and it references one CSM per object kind, which is
what validates every record written into that workspace. The node ships a prompt that interviews the
owner and generates both (the **Manifest Architect**, in the admin System Prompts list under
`builders`). The vocabulary is open: a Finnish research study using *tavoite* and *löydös* runs on
the same engine as a project using *goal* and *deliverable*.

Fuller reference: **[CSM Manual](./csm-manual.md)** for authoring, **[csm-spec.md](../csm-spec.md)** for the specification.

---

## 3. MSM: how an outside API is described

A **Machine Service Manifest** describes an external API so an AI can understand it, call it, and
build an integration around it: base URL, authentication, each action's inputs and outputs, rate
limits, and what a call should cost.

**The node does not call the API for you.** Registering an MSM validates it and stores it, and that
is all it does. The value is the description: an AI reads it once, builds the integration, and the
integration runs afterwards without the AI in the loop. In practice that integration usually lands as
an **extension** (§4), which is where the credential can live safely.

| Method | Path | Who |
|---|---|---|
| POST | `/v1/msm` | The role in `msm.install_role` (`AIMEAT_MSM_INSTALL_ROLE`, default `owner`) |
| GET | `/v1/msm` | Anyone (`?category=` filters) |
| GET | `/v1/msm/templates` | Anyone. Ten built-in examples: MobilePay payment, Stripe marketplace, Coinbase transfer, Posti shipping, Wolt restaurant, Nuki smartlock, weather pricing, price estimation, product image analysis, AI logo design |
| GET | `/v1/msm/templates/{type}` | Anyone. Raw YAML |
| GET | `/v1/msm/{name}` | Anyone |
| DELETE | `/v1/msm/{name}` | Owner |

A trimmed manifest, enough to see the shape:

```yaml
msm: "1.0"
service:
  name: "MobilePay Maksut"
  description: "MobilePay payments for the flea market"
  category: "utility"
  tags: ["payment", "mobilepay", "finland"]

auth:
  type: "oauth2"
  token_url: "https://api.mobilepay.dk/merchant-authentication-openidconnect/connect/token"
  env_var: "MOBILEPAY_CLIENT_ID"
  env_var_secret: "MOBILEPAY_CLIENT_SECRET"

actions:
  - id: "create-payment"
    display_name: "Luo MobilePay-maksu"
    endpoint:
      method: POST
      url: "https://api.mobilepay.dk/v1/payments"
      content_type: "application/json"
    input:
      amount:      { type: number, required: true }
      description: { type: string, required: true }
      reference:   { type: string, required: true }
    output:
      payment_id: { type: string, from: "paymentId" }
      state:      { type: string, from: "state" }
    pricing:
      base_morsels: 3
```

`pricing` is carried with the manifest and enforced by nothing on its own. What actually charges is
the extension or EXCHANGE listing built from it.

Fuller reference: **[MSM Manual](./msm-manual.md)**.

---

## 4. Extensions: code that runs on the node

An extension is the answer whenever something cannot live in a browser: an outbound call that needs a
credential, work that must survive the tab closing, a rule that must be *enforced* rather than
displayed, or a capability you intend to sell. An app calls an extension; it never becomes one.

Extension code runs in a **QuickJS-WASM sandbox** (`quickjs-emscripten`), which replaced the earlier
V8 `isolated-vm` runtime on 29 April 2026 so that running a node needs no C++ build tools. The
sandbox has no Node globals, no timers, no `eval`, and no network except through `ctx`.

### What an extension is made of

A YAML manifest plus one script per action. The manifest names the actions, their HTTP paths, their
input and output schemas, the config the extension needs, its resource limits, and (optionally) its
price. Each action script exports a default function that receives `ctx`:

| `ctx` | What it gives |
|---|---|
| `ctx.memory.get / set / delete / search / getVersioned` | The extension's own `ext:{name}` namespace |
| `ctx.memory.getPublic(gaii, key)` | A public record in someone else's namespace, the caller's included |
| `ctx.fetch(url, opts)` | Outbound HTTP, SSRF-guarded. Returns text and a status; it does not parse JSON for you |
| `ctx.config` | The manifest's config, with `type: secret` fields decrypted only here |
| `ctx.caller` | Who is calling: GAII, owner, roles. Absent on a scheduled run |
| `ctx.instance` | This instance's id and per-instance config, when the extension supports instances |
| `ctx.wallet.getBalance / consume` | Read and spend the caller's morsels |
| `ctx.consent.check / require` | Whether the caller granted what this action needs |
| `ctx.trust.getScore` | The caller's trust score |
| `ctx.files` | Read and write stored files |
| `ctx.notify`, `ctx.email` | Tell a person something happened. Check they exist first |
| `ctx.buy`, `ctx.datapackage` | Buy a capability from EXCHANGE; publish a data package |
| `ctx.hash(s)`, `ctx.now()` | FNV-1a 64-bit hash (there is no `crypto.subtle` in QuickJS) and the run's fixed start time |
| `ctx.log.info / warn / error` | The node's log |

### Lifecycle

| Method | Path | What it does |
|---|---|---|
| POST | `/v1/extensions` | Install. MCP: `aimeat_extension_install` |
| PUT | `/v1/extensions/{name}` | Redeploy in place, keeping `ext:{name}` memory and instances |
| PATCH | `/v1/extensions/{name}/actions/{actionId}` | Replace one action's script |
| POST | `/v1/extensions/{name}/activate` / `/deactivate` | An installed extension that was never activated runs nothing |
| GET | `/v1/extensions`, `/v1/extensions/{name}`, `/{name}/versions` | Inspect |
| DELETE | `/v1/extensions/{name}` | Uninstall |
| POST | `/v1/ext/{name}/{actionId}` | Call an action |
| POST | `/v1/ext/{name}/{instanceId}/{actionId}` | Call an action on one instance |

**Instances** let one extension serve several communities: `instances.supported: true` in the
manifest plus a `config_per_instance` schema, then `POST /v1/extensions/{name}/instances` per
community, each with its own config, visibility (public, password, invite) and memory.

**Secrets.** A config field marked `type: secret` is encrypted at rest with the node key, decrypted
only on its way into the sandbox, and masked in every API response. A credential belongs nowhere
else: not in the script, not in a return value. A buyer gets your action's result and never your key.

**Limits**, all operator-configurable: 64 MB memory, 5000 ms CPU, 500 API calls per action, 256 kB of
script per action, 20 extensions installed. A manifest may ask for less, never more.

**Who may install:** the owner role, or a principal holding `ext:write`. An app running under an app
grant cannot: `ext:write` is deliberately outside the grantable scope vocabulary, because an
extension outlives the grant that created it and can charge money in the owner's name. An app may
*write* a manifest and hand it over; a human or an authorised agent installs it.

**Selling it.** An action's `commercial` block prices it (`payMorsels`, and `payMoney` in six-decimal
micro-units, so `50000` is 0.05 EUR) and `exchange: true` lists it. The manifest is the listing;
there is no separate call. Both input and output schemas are required, or the listing is skipped.

Before writing any of it, fetch the canonical spec, which is always current and does change:

```
GET /v1/prompts/build-extension
```

Fuller reference: **[Service Extensions Manual](./service-extensions-manual.md)**, the layering rules
in **[extension-memory-architecture.md](../coding-guidelines/extension-memory-architecture.md)**, and
the agent-facing skill `node:aimeat-extension-builder`.

---

## 5. Hooks: being asked before something happens

A hook is the node stopping to ask an outside service whether an action is allowed, or telling it
that one happened. This is where "your own backend, in any language" belongs.

There are eleven hook points, and they divide into two kinds:

**Blocking.** The node waits for the answer and abandons the operation if any attached action says no.

| Hook | Fires when | Context it sends |
|---|---|---|
| `pre_owner_registration` | Somebody tries to create an account | `name`, `display_name` |
| `pre_agent_registration` | An agent tries to register, including through device authorization | `name`, `owner`, `display_name` |
| `pre_work_request` | Work is about to be posted | The work request |
| `pre_board_post` | A post is about to be written | `board_id`, `author_gaii` |
| `pre_federation_peer` | This node is about to peer with another | `target_url`, `target_node_id` |

**Fire and forget.** The node tells you and carries on; a failure is logged, never propagated.

`post_owner_registration` · `post_agent_registration` · `owner_recovery` · `agent_rekey` ·
`post_work_delivery` · `post_settlement`

### How a hook runs

Each hook holds a list of **action references**, and each action carries a webhook URL. For every
attached action, in order, the node POSTs JSON to that URL:

```json
{
  "hook": "pre_owner_registration",
  "action_ref": "spam-check",
  "context": { "name": "alice", "display_name": "Alice" },
  "node_id": "aimeat-finland-001-genesis",
  "timestamp": "2026-09-03T18:00:00.000Z"
}
```

Two ways to refuse: answer with a non-2xx status, or answer `200` with `{"allowed": false, "reason":
"..."}`. Anything else lets the flow continue. Outbound calls are SSRF-guarded (a webhook pointing at
a private address is skipped with a log line) and time out after 10 seconds. An action reference that
does not resolve is skipped with a warning, so a deleted action fails open rather than locking
registration.

### Attaching one

From the admin dashboard's **Hooks** tab, or directly:

```bash
curl -X PUT https://your-node/v1/admin/hooks/pre_owner_registration \
  -H "Authorization: Bearer $OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"actions": ["spam-check"]}'

curl https://your-node/v1/admin/hooks -H "Authorization: Bearer $OPERATOR_TOKEN"
```

An action reference is either the action's id, or `id#providerGaii` when two providers publish the
same id.

### A worked example: refuse throwaway domains

```python
# spam_check.py: the webhook behind a pre_owner_registration hook
from flask import Flask, request, jsonify

BLOCKED = {"mailinator.com", "guerrillamail.com"}
app = Flask(__name__)

@app.post("/hook")
def hook():
    body = request.get_json(force=True)
    if body.get("hook") != "pre_owner_registration":
        return jsonify(allowed=True)

    name = (body.get("context") or {}).get("name", "")
    domain = name.split("@")[-1].lower() if "@" in name else ""
    if domain in BLOCKED:
        return jsonify(allowed=False, reason="Throwaway email domains are not accepted here.")
    return jsonify(allowed=True)
```

Run it anywhere reachable over HTTPS, register it as an action with that webhook URL, and attach the
action to the hook. The reason string reaches the person who tried to register, so write it for them.

---

## 6. Node configuration

Every setting has a dot path (`morsel_policy.daily_allowance`) and an environment variable
(`AIMEAT_DAILY_ALLOWANCE`). There are about 300 of them, `aimeat/.env.example` documents them all
with safe defaults, and `aimeat config` prints what your node is actually running with.

The ones a service owner changes first:

| Setting | Environment variable | Default |
|---|---|---|
| Storage backend | `AIMEAT_STORAGE` | `memory`. Use `sqlite` or `postgres-kysely` for anything real |
| Public address | `AIMEAT_BASE_URL` | `http://localhost:$PORT` |
| Who may register | `AIMEAT_REGISTRATION_MODE` | `open`, or `oauth` / `invite` / `closed` |
| Welcome morsels | `AIMEAT_WELCOME_BONUS` | `100` |
| Daily accrual, and its ceiling | `AIMEAT_DAILY_ALLOWANCE`, `AIMEAT_DAILY_ALLOWANCE_CAP` | `50`, `500` |
| Memory per owner, keys per principal | `AIMEAT_MEMORY_QUOTA_MB`, `AIMEAT_MEMORY_MAX_KEYS` | `10`, `1000` |
| Files per owner, largest file | `AIMEAT_STORAGE_QUOTA_MB`, `AIMEAT_STORAGE_MAX_FILE_SIZE_MB` | `100`, `10` |
| Who may install an MSM | `AIMEAT_MSM_INSTALL_ROLE` | `owner` |
| Who may install an extension | `AIMEAT_EXT_INSTALL_ROLE` | `operator` |
| Extension sandbox limits | `AIMEAT_EXT_MAX_MEMORY_MB`, `AIMEAT_EXT_TIMEOUT_MS`, `AIMEAT_EXT_MAX_API_CALLS` | `64`, `5000`, `500` |

The operator block (`operator.*`) has no default on purpose: a node that has not said who runs it
answers 503 on `/v1/privacy` rather than naming somebody else as the data controller.

Full reference, including where a value comes from and what a running node will let you change:
**[b-config.md](../b-config.md)**.

---

## 7. Choosing between the four

| The thing you want | Use |
|---|---|
| "A listing must always have a price and a category" | CSM |
| "Records in this workspace must all look the same" | CSM, referenced from the organism manifest |
| "Here is how our shipping provider's API works" | MSM |
| "Call that shipping API with our key when a sale completes" | Extension |
| "This pricing formula is the product; nobody may copy it" | Extension |
| "Sell this capability to other people's agents" | Extension with a `commercial` block |
| "Check every new account against our CRM before it exists" | Hook (`pre_owner_registration`) |
| "Tell our Slack when work settles" | Hook (`post_settlement`) |
| "A page people can use" | An app, not any of these. `aimeat_app_publish` |

A rule of thumb: a **manifest** describes, an **extension** does, and a **hook** is somebody else
being asked. If your answer needs a secret, it is an extension. If it needs to say no, it is a hook or
a schema.

---

## 8. Sharing what you built

- **A CSM or MSM** is one YAML file. Send it, publish it, or set `federate: true` on a CSM and let
  peers pick it up.
- **An extension** exports as a manifest plus scripts and installs on any node with one call.
- **Everything together** goes into a package: apps, extensions, cortex, translations and manifests
  in one installable unit, published to the template gallery. See
  **[local-first-package-workflow.md](../guides/local-first-package-workflow.md)** for the
  local-directory-as-source-of-truth pattern.

---

## 9. What this manual used to say

Until 3 September 2026 this manual described a three-level plugin system built around a
`.plugin.yaml` manifest that you unzipped into a `plugins/` directory and restarted into. **Level 1
never existed**: nothing in the node reads that manifest, and there is no `plugins/` directory.
Level 2 existed but on a different engine and in a different shape (actions in a QuickJS-WASM
sandbox, not hook functions in a V8 isolate). Level 3, webhooks, was real all along, and it is §5
above.

The parts of the idea that survived are CSM and MSM, which do exactly what the YAML level promised:
declare a service without writing code. They install through the API rather than through the
filesystem.
