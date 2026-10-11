# MSM Manual: Machine Service Manifest

*AIMEAT Protocol: a guide for people and for the AI that writes the manifest*

Checked against the node's code on 2026-10-11: the parser and validator in
`aimeat/src/services/msm-parser.ts`, the routes in `aimeat/src/routes/msm.ts`, and the ten shipped
examples in [`docs/msm-examples/`](../msm-examples/).

---

## 1. What an MSM is, and what the node does with it

A Machine Service Manifest (MSM) is a YAML file that describes an outside API: where it is, how to
sign in to it, what each action takes and what it returns. An AI reads the description and builds
the integration from it. The integration then runs without the AI in the loop, and the AI comes back
only when something breaks or the requirements change.

**On an AIMEAT node, an MSM is a registered description and nothing more.** When you register one,
the node parses it, validates it and stores it. It does not call the API, it does not hold the
credential, and it never runs the health check. Everything that happens at run time happens in the
integration an AI builds from the manifest, and on a node that integration is an **extension**
(section 7).

Two things follow from that:

- The value of a manifest is the description. Write it so an AI that has never seen the API can
  build a working integration from it.
- A field the node does not read (section 4 lists them) is still useful as an instruction to the
  builder, but nothing enforces it.

---

## 2. A first manifest

A weather forecast in twenty lines:

```yaml
msm: "1.0"
service:
  name: "Weather Forecast"
  description: "Five-day weather forecast for a place, used to adjust a nightly rate"
  category: "data"

auth:
  type: "query_param"
  param_name: "appid"
  env_var: "OPENWEATHER_API_KEY"

actions:
  - id: "get-forecast"
    display_name: "Get 5-Day Forecast"
    description: "Weather forecast for a location, in three-hour steps"
    endpoint:
      method: GET
      url: "https://api.openweathermap.org/data/2.5/forecast?lat={input.lat}&lon={input.lon}&units=metric"
    input:
      lat: { type: number, required: true, description: "Latitude" }
      lon: { type: number, required: true, description: "Longitude" }
    output:
      forecasts:
        type: array
        from: "list"
```

What happens next on a node:

1. You register it (`POST /v1/msm`, section 3).
2. An AI reads it and writes an extension whose action calls the forecast URL with `ctx.fetch`, adds
   the key, and reads `list` out of the answer.
3. A schedule in the extension's manifest runs that action every six hours and stores the result.
4. Nobody touches it again until the API changes.

---

## 3. Registering a manifest on the node

| Method | Path | Who | What it does |
|---|---|---|---|
| POST | `/v1/msm` | The role in `AIMEAT_MSM_INSTALL_ROLE` (default `owner`) | Parses, validates and stores a manifest. Body: raw YAML with `Content-Type: text/yaml`, or JSON `{ "yaml": "<the YAML>" }`. Answers 201, 400 `PARSE_ERROR` or `VALIDATION_ERROR` naming every problem, or 409 `MSM_NAME_TAKEN` when `service.name` is already registered |
| GET | `/v1/msm` | Anyone | Every registered manifest. `?category=` filters |
| GET | `/v1/msm/{name}` | Anyone | One manifest. The names of the environment variables in `auth` are taken out of this public answer |
| DELETE | `/v1/msm/{name}` | The owner who registered it | Removes it (403 for anyone else) |
| GET | `/v1/msm/templates` | Anyone | The ten shipped examples: type, name, description, category |
| GET | `/v1/msm/templates/{type}` | Anyone | One example as raw YAML, to start from |
| GET | `/v1/admin/msm` | The operator | The operator's view, arranged by the hosts the manifests call and their action ids |

```bash
curl -X POST https://your-node/v1/msm \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/yaml" \
  --data-binary @weather.msm.yaml
```

There is no MCP tool for MSM yet. An AI connected over MCP registers a manifest through the REST
route above, with the owner's token.

---

## 4. Format reference

The tables say, for each field, what the parser keeps and what the validator refuses without.
"Kept" means it is stored and returned; nothing on the node acts on it.

### Top level

| Field | Validator | Notes |
|---|---|---|
| `msm` | Required | Format version, `"1.0"` |
| `service` | Required | See below |
| `auth` | Defaults to `type: none` | See below |
| `actions` | At least one | See below |
| `health` | Optional | Kept. Nothing runs it |

### `service`

| Field | Validator | Notes |
|---|---|---|
| `name` | Required | Unique on the node; the registration key |
| `description` | Required | What the service does and how an agent uses it |
| `category` | Required, one of `data`, `utility`, `image`, `communication`, `analytics`, `analysis` | Defaults to `utility` when left out |
| `homepage` | Optional | Kept |
| `tags` | Optional list | Kept |

### `auth`

| Field | Validator | Notes |
|---|---|---|
| `type` | One of `none`, `bearer`, `query_param`, `api_key`, `oauth2` | Defaults to `none` |
| `param_name` | Required for `query_param` | The query parameter that carries the key |
| `token_url` | Required for `oauth2` | The token endpoint |
| `header` | For `api_key`, one of `header`, `param_name` or `env_var` is required | The header that carries the key |
| `env_var`, `env_var_secret` | Optional | A name for the credential, so the builder knows what to ask for. The public read leaves both out. On a node the value lives in the extension (section 7), never in an environment variable |

### `actions[]`

| Field | Validator | Notes |
|---|---|---|
| `id` | Required | Kebab-case, unique within the manifest |
| `display_name` | Required | |
| `description` | Required | When to use the action |
| `endpoint.method` | Required | `GET`, `POST`, `PUT`, `DELETE` |
| `endpoint.url` | Required | `{input.<name>}` placeholders for path and query values |
| `endpoint.content_type` | Optional | `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data` |
| `input` | Optional map | Each field: `type`, `required`, `description`, `enum`, `items`, `properties`. Kept, not checked. A `default` is dropped by the parser |
| `output` | At least one field | Each field: `type`, `description`, `from`, `items`, `properties` |
| `request_mapping` | Optional | A body template (section 6) |
| `pricing` | Optional | `toll_morsels` only (section 8) |
| `estimated_time_seconds` | Optional | Kept |
| `examples` | Optional list of `{ input, output }` | Kept, not checked |

### `health`

| Field | Validator | Notes |
|---|---|---|
| `endpoint` | Required when `health` is present | Kept |
| `method` | Required when `health` is present | Kept |
| `interval_seconds`, `expected_status` | Optional | Kept |

Nothing on the node runs a health check. If the integration should watch the service, the extension
does it on a schedule.

---

## 5. Authentication types

| `type` | Where the credential goes | Example |
|---|---|---|
| `none` | Nowhere: an open API | A public RSS feed |
| `query_param` | In the URL, as `param_name` | OpenWeather `appid` |
| `bearer` | `Authorization: Bearer <key>` | Stripe, OpenAI |
| `api_key` | A header of the service's own, named in `header` | Coinbase CDP `X-CDP-API-Key` |
| `oauth2` | A token fetched from `token_url` with a client id and secret, then sent as a bearer token | Posti, MobilePay |

The manifest names the credential; it never holds it. On a node the credential is one of two things
(section 7): a `type: secret` config field of the extension, set once by whoever installs it, or a
secret in the caller's own vault that the node fills into a header written as `{{secret:NAME}}`.

---

## 6. Mapping inputs and outputs

These are instructions for the integration you build. The node does not apply them.

**Placeholders.** `{input.name}` in `endpoint.url` or `request_mapping` stands for the value of that
input. A string goes in quotes in a JSON template (`"{input.city}"`), a number without them
(`{input.weight_kg}`).

**A request body** goes in `request_mapping`:

```yaml
endpoint:
  method: POST
  url: "https://api.stripe.com/v1/payment_intents"
  content_type: "application/x-www-form-urlencoded"
request_mapping: |
  amount={input.amount_cents}&currency={input.currency}&transfer_data[destination]={input.seller_stripe_account}
```

**Outputs** name a path into the answer with `from`. Without `from`, the output's own name is the
key.

```yaml
output:
  payment_id: { type: string, from: "id" }
  tracking_code: { type: string, from: "shipments[0].trackingCodes[0]" }
  forecasts:
    type: array
    from: "list"
    items:
      type: object
      properties:
        temp_c: { type: number, from: "main.temp" }
```

On an array output, `from` finds the array; inside `items`, each `from` is relative to one element.

---

## 7. Where the integration runs: an extension

An extension is code that runs on the node in a sandbox, one script per action. It is where an MSM
becomes something that works. The full build guide is the node's own: `GET /v1/prompts/build-extension`,
and the built-in skill `aimeat-extension-builder` (`aimeat_skill_get { name: "aimeat-extension-builder" }`).
The parts an MSM maps onto:

| In the MSM | In the extension |
|---|---|
| `endpoint.url`, `method`, `request_mapping` | `ctx.fetch(url, { method, headers, body })` in the action script. The manifest declares `capabilities: [network]`, and `network: { hosts: [api.example.com] }` limits the calls to that host |
| `auth` with `env_var` | A `config:` field with `type: secret` (encrypted at rest, `undefined` in `ctx.config` until someone sets it), or a header written as `{{secret:NAME}}` that the node fills from the caller's vault. The script never holds a vault value |
| `output` with `from` | The script reads the answer (`res.text` is the body as a string, so `JSON.parse(res.text)`) and returns the fields |
| `health`, or "every six hours" | A `schedules:` entry in the extension manifest: `id`, `action`, `cron`, optional `input` and `timezone` |
| An action other people may use | The action's money price and pacing amount (section 8) |

Install it with `aimeat_extension_install` over MCP or `POST /v1/extensions` over REST, then
activate it. An AI connected over MCP can do the whole path without a screen.

---

## 8. Pacing and money

A morsel paces how much a person's agents do. It is never a price, a fee or a currency.

- An action's `pricing` block holds one field, `toll_morsels`: the pacing amount in morsels for one
  use, from 0 to 100. It has the same name and range as the node's action catalogue
  (`POST /v1/actions`), so an AI that publishes an MSM action there copies it as it is. In an MSM the
  node does not read it.
- When the service costs money, the money is a **money price** on what is built from the manifest
  (an extension action, an offer or an app tool), and it is paid through the node's checkout with a
  payment provider the seller connects.
- Each use of such an item also takes its pacing amount from the user's morsels. Part of that burns
  (the operator's burn rate), the operator may keep a share, and the rest goes to the provider.

The 3.x field `base_morsels` meant a morsel price. The action catalogue reads it as the pacing amount
until node 4.0.0 and refuses it from 4.0.0, so a manifest uses `toll_morsels`.

```yaml
pricing:
  toll_morsels: 3
```

---

## 9. MSM with CSM

A CSM (Community Service Manifest) describes the shape of data on the node: what a listing or a
profile holds, with the node enforcing it on every write. An MSM describes an outside service. An AI
joins the two in an extension.

A marketplace, for example:

| Layer | Written as | Example |
|---|---|---|
| The listing | CSM | Title, money price, photos, seller, status |
| The payment and the parcel | MSM | Stripe payment intent, Posti shipment |
| What happens on "buy" and "ship" | Extension actions | Create the payment, poll it, create the shipment, store the tracking code in the listing |

The buyer pays the listing's money price; nothing in this flow is priced in morsels. See the
[CSM Manual](./csm-manual.md) for the data side and the
[Service Owner Manual](./service-owner-manual.md) for running a node.

---

## 10. The shipped examples

Ten complete manifests ship with every node, in [`docs/msm-examples/`](../msm-examples/) and at
`GET /v1/msm/templates/{type}`:

| Type | Service | What it shows |
|---|---|---|
| `product-image-analysis` | OpenAI Vision / Google Vision | A product and its condition from a photo |
| `price-estimation` | An AI model | A fair price range for a used product |
| `stripe-marketplace` | Stripe Connect | A payment straight to the seller, form-encoded body |
| `coinbase-transfer` | Coinbase CDP | A crypto payment from an agent's wallet, custom header auth |
| `mobilepay-payment` | MobilePay | A Nordic mobile payment, OAuth2 |
| `posti-shipping` | Posti SmartShip | A shipment and its tracking code, OAuth2, nested JSON body |
| `nuki-smartlock` | Nuki | A guest's door access and taking it back |
| `weather-pricing` | OpenWeather | Forecast data for a nightly rate, query-parameter auth |
| `wolt-restaurant` | A restaurant ordering system | An order and its delivery |
| `ai-logo-design` | AI image generation | Design as an action another AI calls |

The addresses and authentication were right when the examples were written and are not re-checked.
Check them against the provider's current documentation before use; MobilePay, for example, has since
merged into Vipps MobilePay.

---

## 11. Asking an AI to write one

You do not need to write an MSM by hand. Tell your AI what you want connected, and give it the
service's API documentation. Ask for three things in this order: the manifest, its registration with
`POST /v1/msm`, and the extension that runs it.

> "Connect Posti parcel tracking to my flea market. Write the MSM from Posti's SmartShip API
> documentation, register it on my node, and build an extension that creates the shipment when I
> mark an order shipped and checks the tracking every four hours."

A good manifest from that request names the OAuth2 token URL, gives every input a description, maps
the tracking code with `from`, and sets `toll_morsels` on each action.

---

*MSM version 1.0, AIMEAT Protocol*
