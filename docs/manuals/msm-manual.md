# MSM Manual -- Market Service Manifest

*AIMEAT Protocol -- Developer & User Guide*

---

## 1. What is MSM?

A Market Service Manifest (MSM) is a YAML file that describes an external API so that AI can understand it, call it, and build automations around it. Think of it as an instruction card: it tells an AI agent what a service does, how to authenticate, what inputs it needs, and what outputs it returns. There is no SDK, no runtime library, no backend code. MSM is just a structured description.

The key insight is that AI reads the MSM once, builds the integration code, tests it, and then the automation runs on its own -- without AI in the loop. AI is the *builder*, not the runtime caller. It designs the pipeline, wires up the API calls, handles error paths, and deploys the result as a background job or webhook handler. AI only comes back if something breaks or the requirements change. This makes MSM fundamentally different from tool-calling frameworks where AI sits in the middle of every request. With MSM, you get a permanent automation that just works.

---

## 2. 60-Second Quickstart

Here is the simplest useful MSM -- a weather forecast service in 15 lines:

```yaml
msm: "1.0"
service:
  name: "Weather Forecast"
  description: "Get weather forecasts for dynamic pricing"
  category: "data"

auth:
  type: "query_param"
  param_name: "appid"
  env_var: "OPENWEATHER_API_KEY"

actions:
  - id: "get-forecast"
    display_name: "Get 5-Day Forecast"
    description: "Retrieve weather forecast for a location"
    endpoint:
      method: GET
      url: "https://api.openweathermap.org/data/2.5/forecast?lat={input.lat}&lon={input.lon}&units=metric"
    input:
      lat:
        type: number
        required: true
      lon:
        type: number
        required: true
    output:
      forecasts:
        type: array
        from: "list"
```

**What happens next:**

1. AI reads this MSM.
2. AI builds a scheduled job that fetches the weather every 6 hours.
3. The job feeds forecast data into a pricing function -- sunny weekend means +20% on your cabin rental.
4. The automation runs on its own. You never touch it again.
5. If the API changes or returns errors, AI gets alerted, reads the MSM again, and fixes the pipeline.

That is the entire workflow. MSM describes the external world; AI builds the bridge.

---

## 3. Creating MSM with AI

You do not need to write MSM files by hand. Describe what you want in natural language and AI generates the MSM for you. Here are real examples.

### Prompt: "Connect Stripe payments to my marketplace"

AI reasons through the problem:
- Stripe uses bearer token auth (`Authorization: Bearer sk_...`)
- The core action is creating a PaymentIntent via POST to `/v1/payment_intents`
- Stripe uses `application/x-www-form-urlencoded`, not JSON
- Marketplace transactions need `transfer_data[destination]` for direct seller payouts
- A status-check action is needed for polling

AI generates the full Stripe MSM with `create-payment-intent` and `check-payment-status` actions, form-encoded request mapping, and output fields mapped from Stripe's response (`id` -> `payment_id`, `client_secret`, `status`).

### Prompt: "Lisaa Postin seuranta markkinapaikkaani"

AI understands the Finnish context:
- Posti is Finland's national postal service
- SmartShip API uses OAuth2 with client credentials
- Two actions needed: `create-shipment` (POST with full sender/recipient JSON) and `track-shipment` (GET with tracking code)
- Finnish addresses use postcodes like "00100" and cities like "Helsinki"

AI generates the Posti MSM with OAuth2 auth (token URL, client ID, client secret), detailed input fields for sender and recipient addresses, and output mapping for tracking codes and label URLs.

### Prompt: "Dynamic pricing based on weather for my rental cabin"

AI designs the full pipeline:
- First, generate an OpenWeather MSM with forecast retrieval
- Map forecast data to pricing logic: temperature, precipitation, weekend/weekday
- Build a scheduled job: every 6 hours, fetch forecast, calculate multiplier, update listing price
- Sunny weekend in July? Multiply base price by 1.3. Rainy Tuesday in November? Drop to 0.85.

AI generates the weather MSM and explains the automation it will build: a cron job that reads the forecast, applies rules (configurable), and calls your listing update endpoint. The MSM itself just describes the weather API -- the pricing logic lives in the automation code AI writes.

### Prompt: "Accept MobilePay payments from Nordic customers"

AI reasons about the auth model:
- MobilePay uses OAuth2 with a token endpoint at `mobilepay.dk`
- Payments create a deep link that opens the MobilePay app on the buyer's phone
- Need `create-payment` and `check-payment` actions
- Currency options are EUR (Finland) and DKK (Denmark)

AI generates the MSM and notes that the `mobile_pay_deep_link` output should be sent to the buyer's device to trigger the payment approval flow.

---

## 4. YAML Reference

Every field in the MSM format, with types and descriptions.

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `msm` | string | Yes | Format version. Currently `"1.0"`. |
| `service` | object | Yes | Service metadata. |
| `auth` | object | Yes | Authentication configuration. |
| `actions` | array | Yes | List of API actions the service exposes. |
| `health` | object | No | Health check endpoint for monitoring. |

### `service` Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable service name. |
| `description` | string | Yes | What the service does and how agents use it. |
| `homepage` | string | No | URL to the service's documentation or homepage. |
| `category` | string | Yes | Service category: `"data"`, `"utility"`, `"image"`, `"communication"`, `"analytics"`. |
| `tags` | array of strings | No | Searchable tags for discovery. |

### `auth` Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Auth mechanism: `"bearer"`, `"query_param"`, `"oauth2"`, `"api_key"`. |
| `env_var` | string | Yes | Environment variable holding the credential. |
| `param_name` | string | For `query_param` | URL query parameter name (e.g., `"appid"`). |
| `header` | string | For `api_key` | HTTP header name (e.g., `"X-CDP-API-Key"`). |
| `token_url` | string | For `oauth2` | OAuth2 token endpoint URL. |
| `env_var_secret` | string | For `oauth2` | Environment variable for the client secret. |

### `actions[]` -- Action Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique action identifier (kebab-case). |
| `display_name` | string | Yes | Human-readable name shown in UIs. |
| `description` | string | Yes | What the action does and when to use it. |
| `endpoint` | object | Yes | HTTP endpoint details. |
| `input` | object | Yes | Named input parameters. |
| `output` | object | Yes | Named output fields with JSON path mapping. |
| `request_mapping` | string | No | Template for the request body. |
| `pricing` | object | No | Morsel cost for this action. |
| `estimated_time_seconds` | number | No | Expected response time in seconds. |
| `examples` | array | No | Input/output examples for testing and documentation. |

### `actions[].endpoint` Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | HTTP method: `GET`, `POST`, `PUT`, `DELETE`. |
| `url` | string | Yes | Full URL with `{input.*}` placeholders for path/query params. |
| `content_type` | string | For POST/PUT | Request content type: `"application/json"`, `"application/x-www-form-urlencoded"`, `"multipart/form-data"`. |

### `actions[].input` -- Input Parameters

Each key under `input` is a named parameter:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Data type: `string`, `number`, `integer`, `boolean`, `array`, `object`. |
| `required` | boolean | Yes | Whether this input is mandatory. |
| `description` | string | Yes | What this parameter is for. |
| `enum` | array | No | Allowed values. |
| `default` | any | No | Default value if not provided. |
| `items` | object | For `array` | Schema for array items. |

### `actions[].output` -- Output Fields

Each key under `output` is a named output field:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Data type of the output. |
| `description` | string | Yes | What this value represents. |
| `from` | string | No | JSON path into the API response (see Section 7). |
| `items` | object | For `array` | Schema for array items, including nested `properties` and their own `from` paths. |

### `actions[].pricing` Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `base_morsels` | number | Yes | Base cost in morsels per call. |
| `per_unit` | number | No | Additional cost per unit (for variable pricing). |
| `unit` | string | No | What the per-unit cost applies to (e.g., `"variant"`). |

### `actions[].examples[]`

Each example has:

| Field | Type | Description |
|-------|------|-------------|
| `input` | object | Sample input values. |
| `output` | object | Expected output values. |

### `health` Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | Yes | Health check URL. May use `{env.*}` placeholders. |
| `method` | string | Yes | HTTP method (usually `GET`). |
| `interval_seconds` | number | No | How often to check (default varies). |
| `expected_status` | number | Yes | Expected HTTP status code (usually `200`). |

---

## 5. Auth Patterns

MSM supports four authentication types. Each tells AI how to attach credentials to API requests.

### `query_param` -- API Key in URL

Used by services like OpenWeather that pass the key as a URL parameter.

```yaml
auth:
  type: "query_param"
  param_name: "appid"
  env_var: "OPENWEATHER_API_KEY"
```

AI appends `?appid=YOUR_KEY` (or `&appid=YOUR_KEY`) to every request URL. The key is read from the `OPENWEATHER_API_KEY` environment variable.

### `bearer` -- Token in Authorization Header

Used by Stripe, OpenAI, and most modern APIs.

```yaml
auth:
  type: "bearer"
  env_var: "STRIPE_SECRET_KEY"
```

AI sends `Authorization: Bearer sk_live_...` as a header on every request. This is the most common pattern for SaaS APIs.

### `api_key` -- Custom Header

Used by services that put the API key in a custom HTTP header.

```yaml
auth:
  type: "api_key"
  header: "X-CDP-API-Key"
  env_var: "CDP_API_KEY"
```

AI sends `X-CDP-API-Key: your_key_here` as a header. This is used by Coinbase CDP and similar services that define their own header names.

### `oauth2` -- Client Credentials Flow

Used by Posti, MobilePay, and enterprise APIs that require token exchange.

```yaml
auth:
  type: "oauth2"
  token_url: "https://oauth.posti.com/token"
  env_var: "POSTI_CLIENT_ID"
  env_var_secret: "POSTI_CLIENT_SECRET"
```

AI handles the full OAuth2 client credentials flow:
1. POST to `token_url` with `client_id` and `client_secret`
2. Receive an access token (typically valid for 1 hour)
3. Send `Authorization: Bearer <access_token>` on API requests
4. Refresh the token before expiry

You never deal with token management -- AI builds that into the automation.

---

## 6. AI Builds the Automation

This is the core of how MSM works in practice. AI is not a middleware that sits between you and the API. AI is a builder that reads the MSM, designs a pipeline, tests it, deploys it, and walks away. The pipeline runs on its own.

### The Build Cycle

```
MSM file
  |
  v
AI reads it once
  |
  v
AI designs the pipeline:
  - Auth handling
  - Input validation
  - API calls
  - Output parsing
  - Error handling
  - Retry logic
  |
  v
AI tests the pipeline against the real API
  |
  v
AI deploys as a background job / webhook handler
  |
  v
Runs automatically, indefinitely
  |
  v
AI returns ONLY if:
  - API returns unexpected errors
  - Schema changes detected
  - Requirements change
```

### Scenario 1: Stripe Marketplace Payments

**Trigger:** Buyer clicks "Purchase" on a marketplace listing.

**Pipeline AI builds:**

1. On purchase event, read listing price and seller's Stripe account ID.
2. Call `create-payment-intent` with amount, currency, and seller destination.
3. Return `client_secret` to the frontend for Stripe.js confirmation.
4. Poll `check-payment-status` every 30 seconds until `status` is `succeeded`.
5. On success, update order status and notify seller.
6. On failure after 3 retries, cancel the order and notify buyer.

Once built, this pipeline handles every purchase automatically. AI does not participate in individual transactions.

### Scenario 2: Weather-Based Dynamic Pricing

**Trigger:** Scheduled cron job, every 6 hours.

**Pipeline AI builds:**

1. Fetch 5-day forecast via `get-forecast` for the property location.
2. Analyze forecast data: temperature, precipitation, wind, weekend vs. weekday.
3. Apply pricing rules:
   - Sunny weekend in summer: multiply base price by 1.30
   - Rainy midweek: multiply by 0.85
   - Snow + holiday period: multiply by 1.50 (ski season)
   - Default: multiply by 1.00
4. Update listing price via the platform's pricing endpoint.
5. Log the adjustment with reasoning for the property owner to review.

The rules are configurable. AI writes them based on your initial description and you can adjust thresholds later. The cron job runs every 6 hours, checks the forecast, and adjusts prices -- no human in the loop.

### Scenario 3: Posti Shipping Automation

**Trigger:** Seller marks an order as "ready to ship."

**Pipeline AI builds:**

1. On shipping event, gather sender/recipient addresses from the order.
2. Call `create-shipment` with package details and service code.
3. Save the `tracking_code` and `label_url` to the order record.
4. Send `tracking_url` to the buyer via notification.
5. Start a polling loop: call `track-shipment` every 4 hours.
6. On status change (e.g., "in_transit" -> "delivered"), notify the buyer.
7. On `delivered` = true, trigger escrow release (if using Stripe) and close the order.

This end-to-end shipping automation runs for every order. AI built it once; it handles thousands of shipments.

---

## 7. Input/Output Mapping

MSM uses two mapping systems: `{input.*}` placeholders for requests and `from` JSON paths for responses.

### Input Placeholders in URLs

Use `{input.field_name}` in the endpoint URL to inject input values:

```yaml
endpoint:
  method: GET
  url: "https://api.posti.fi/shipment-tracking/v1/tracking/{input.tracking_code}"
```

For query parameters with `query_param` auth, the API key is automatically appended:

```yaml
url: "https://api.openweathermap.org/data/2.5/forecast?lat={input.lat}&lon={input.lon}&units=metric"
# Becomes: ...?lat=61.49&lon=23.76&units=metric&appid=YOUR_KEY
```

### `request_mapping` for POST Bodies

When the endpoint expects a request body, use `request_mapping` to define the template. Input values are injected via `{input.*}` placeholders.

**JSON body (Posti):**

```yaml
request_mapping: |
  {
    "shipments": [{
      "sender": {
        "name": "{input.sender_name}",
        "address": "{input.sender_address}",
        "postcode": "{input.sender_postcode}",
        "city": "{input.sender_city}"
      },
      "recipient": {
        "name": "{input.recipient_name}",
        "address": "{input.recipient_address}",
        "postcode": "{input.recipient_postcode}",
        "city": "{input.recipient_city}"
      },
      "parcels": [{
        "weight": {input.weight_kg}
      }],
      "serviceCode": "{input.service_code}"
    }]
  }
```

Note: string values use `"{input.field}"` (quoted), numeric values use `{input.field}` (unquoted).

**Form-encoded body (Stripe):**

```yaml
endpoint:
  content_type: "application/x-www-form-urlencoded"

request_mapping: |
  amount={input.amount_cents}&currency={input.currency}&transfer_data[destination]={input.seller_stripe_account}&description={input.description}
```

Stripe uses form encoding, not JSON. The `content_type` tells AI which format to use.

### `from` JSON Path for Output Mapping

The `from` field maps a value from the API's JSON response to your named output field. This flattens deeply nested responses into clean, simple output.

**Simple mapping:**

```yaml
output:
  payment_id:
    type: string
    from: "id"              # response.id
  status:
    type: string
    from: "status"          # response.status
```

**Nested mapping:**

```yaml
output:
  tracking_code:
    type: string
    from: "shipments[0].trackingCodes[0]"   # First tracking code from first shipment
  label_url:
    type: string
    from: "shipments[0].labelUrl"           # Label URL from first shipment
```

**Array element access:**

```yaml
output:
  paid:
    type: boolean
    from: "charges.data[0].paid"    # First charge's paid flag
  weather:
    type: string
    from: "weather[0].description"  # First weather condition description
```

**Nested array items with their own `from` paths:**

```yaml
output:
  forecasts:
    type: array
    from: "list"                    # The array lives at response.list
    items:
      type: object
      properties:
        temp_c:
          type: number
          from: "main.temp"         # Within each array item: item.main.temp
        weather:
          type: string
          from: "weather[0].description"  # item.weather[0].description
```

When `from` is on an array output, it locates the array in the response. When `from` is on properties inside `items`, it maps relative to each array element.

### When `from` is Omitted

If `from` is not specified, the output field name is used as the key directly. So `payment_id` without `from` looks for `response.payment_id`.

---

## 8. MSM + CSM Combo

The real power of the AIMEAT protocol comes from combining MSM and CSM files. CSM (Community Service Manifest) defines your data shapes -- what a listing looks like, what fields a profile has. MSM defines external connections -- how to charge payments, ship packages, fetch weather data. AI is the glue that wires them together.

### The Three Layers

| Layer | Format | Purpose | Example |
|-------|--------|---------|---------|
| Data Shape | CSM | What your data looks like | Listing with title, price, photos, location |
| External APIs | MSM | How to call outside services | Stripe payments, Posti shipping, weather data |
| Automation | AI-built code | Connecting data to services | On new listing -> validate -> publish -> notify |

### End-to-End Marketplace Example

Consider a peer-to-peer marketplace where users sell items to each other. Here is how the three layers work together:

**CSM defines the listing:**
- Title, description, price, photos, seller ID, location
- Status field: draft / active / sold / shipped / delivered

**Stripe MSM handles payment:**
- `create-payment-intent` when buyer purchases
- `check-payment-status` to confirm funds received

**Posti MSM handles shipping:**
- `create-shipment` when seller ships
- `track-shipment` to monitor delivery

**AI builds the full pipeline:**

1. Buyer finds listing (CSM data) and clicks "Buy."
2. AI-built automation calls Stripe `create-payment-intent` (MSM action) with the listing price.
3. Buyer confirms payment on frontend.
4. Automation polls Stripe until `status: succeeded`.
5. Seller gets notified, packages the item, clicks "Ship."
6. Automation calls Posti `create-shipment` (MSM action) with addresses from CSM data.
7. Buyer gets tracking URL.
8. Automation polls Posti until `delivered: true`.
9. Automation releases escrow to seller.
10. Listing status updated to "delivered" in CSM.

Neither the CSM nor the MSM files contain any of this logic. They just describe shapes and APIs. AI reads both, understands the flow, and builds the automation that ties them together.

For details on CSM format and how to define your data shapes, see the [CSM Manual](csm-manual.md).

---

## 9. Real-World Gallery

Complete MSM files from the AIMEAT ecosystem, with commentary.

### 9.1 Stripe Marketplace Payment

Stripe Connect enables direct payments from buyer to seller without a middleman. This MSM covers creating payment intents and checking their status.

Key design decisions:
- Uses `bearer` auth because Stripe expects `Authorization: Bearer sk_...`
- Content type is `application/x-www-form-urlencoded` (not JSON) because that is what Stripe's API requires
- `transfer_data[destination]` routes funds directly to the seller's connected account
- `metadata_tracking_code` enables reconciliation with AIMEAT's internal tracking
- The `check-payment-status` action costs 0 morsels because it is a read-only polling operation

```yaml
msm: "1.0"
service:
  name: "Stripe Marketplace Payment"
  description: "Create and manage marketplace payments between buyers and sellers via Stripe Connect"
  homepage: "https://stripe.com/connect"
  category: "utility"
  tags: ["payment", "stripe", "marketplace", "fiat", "credit-card", "escrow"]

auth:
  type: "bearer"
  env_var: "STRIPE_SECRET_KEY"

actions:
  - id: "create-payment-intent"
    display_name: "Create Marketplace Payment"
    description: >
      Create a Stripe PaymentIntent for a marketplace transaction. Funds go directly
      to the seller's connected Stripe account. Supports EUR, USD, GBP, SEK.
      Optional application_fee for platform costs.

    endpoint:
      method: POST
      url: "https://api.stripe.com/v1/payment_intents"
      content_type: "application/x-www-form-urlencoded"

    input:
      amount_cents:
        type: integer
        required: true
        description: "Amount in cents (e.g., 68000 = 680.00 EUR)"
      currency:
        type: string
        required: true
        description: "ISO 4217 currency code"
        enum: ["eur", "usd", "gbp", "sek", "nok", "dkk"]
      seller_stripe_account:
        type: string
        required: true
        description: "Seller's Stripe Connect account ID (acct_...)"
      description:
        type: string
        required: true
        description: "Payment description (e.g., 'iPhone 15 Pro - Marketplace Purchase')"
      buyer_email:
        type: string
        required: false
        description: "Buyer's email for receipt"
      metadata_tracking_code:
        type: string
        required: false
        description: "AIMEAT tracking code for reconciliation"

    request_mapping: |
      amount={input.amount_cents}&currency={input.currency}&transfer_data[destination]={input.seller_stripe_account}&description={input.description}&receipt_email={input.buyer_email}&metadata[aimeat_tc]={input.metadata_tracking_code}

    output:
      payment_id:
        type: string
        description: "Stripe PaymentIntent ID"
        from: "id"
      client_secret:
        type: string
        description: "Client secret for frontend confirmation"
        from: "client_secret"
      status:
        type: string
        description: "Payment status (requires_payment_method, succeeded, etc.)"
        from: "status"
      amount:
        type: integer
        description: "Confirmed amount in cents"
        from: "amount"

    pricing:
      base_morsels: 5

    estimated_time_seconds: 3

    examples:
      - input:
          amount_cents: 68000
          currency: "eur"
          seller_stripe_account: "acct_1MqVnGLk..."
          description: "iPhone 15 Pro - AIMEAT Marketplace"
          metadata_tracking_code: "tc-1709145600000-a1b2c3d4"
        output:
          payment_id: "pi_3OqV..."
          client_secret: "pi_3OqV..._secret_..."
          status: "requires_payment_method"
          amount: 68000

  - id: "check-payment-status"
    display_name: "Check Payment Status"
    description: "Check the status of an existing payment"

    endpoint:
      method: GET
      url: "https://api.stripe.com/v1/payment_intents/{input.payment_id}"

    input:
      payment_id:
        type: string
        required: true
        description: "Stripe PaymentIntent ID (pi_...)"

    output:
      status:
        type: string
        from: "status"
      amount:
        type: integer
        from: "amount"
      currency:
        type: string
        from: "currency"
      paid:
        type: boolean
        description: "Whether payment has been received"
        from: "charges.data[0].paid"

    pricing:
      base_morsels: 0

    estimated_time_seconds: 1

health:
  endpoint: "https://api.stripe.com/v1/balance"
  method: GET
  expected_status: 200
```

---

### 9.2 OpenWeather Dynamic Pricing

Weather data drives pricing decisions for accommodation, outdoor events, and tourism. This MSM provides forecast retrieval and a pricing recommendation action.

Key design decisions:
- Uses `query_param` auth because OpenWeather appends the key to the URL
- Forecast output maps nested JSON (`main.temp`, `weather[0].description`) into flat fields
- Finnish language weather descriptions via `lang=fi` in the URL
- The `pricing-recommendation` action shows how MSM can describe hypothetical/internal APIs too -- not every endpoint needs to be a public SaaS

```yaml
msm: "1.0"
service:
  name: "OpenWeather Pricing Intelligence"
  description: "Weather data for dynamic pricing -- accommodation agents adjust rates based on forecasts and conditions"
  homepage: "https://openweathermap.org/api"
  category: "data"
  tags: ["weather", "forecast", "pricing", "dynamic", "accommodation", "tourism", "analytics"]

auth:
  type: "query_param"
  param_name: "appid"
  env_var: "OPENWEATHER_API_KEY"

actions:
  - id: "get-forecast"
    display_name: "Get 5-Day Weather Forecast"
    description: >
      Retrieve a 5-day weather forecast for a location. Accommodation
      and event agents use this to predict demand and adjust pricing.
      Sunny weekends -> higher prices, rainy midweek -> discounts.

    endpoint:
      method: GET
      url: "https://api.openweathermap.org/data/2.5/forecast?lat={input.lat}&lon={input.lon}&units=metric&lang=fi"

    input:
      lat:
        type: number
        required: true
        description: "Latitude of the property location"
      lon:
        type: number
        required: true
        description: "Longitude of the property location"

    output:
      city:
        type: string
        description: "City name"
        from: "city.name"
      forecasts:
        type: array
        description: "3-hour interval forecasts for 5 days"
        from: "list"
        items:
          type: object
          properties:
            datetime:
              type: string
              from: "dt_txt"
            temp_c:
              type: number
              from: "main.temp"
            feels_like_c:
              type: number
              from: "main.feels_like"
            weather:
              type: string
              from: "weather[0].description"
            wind_speed:
              type: number
              from: "wind.speed"
            rain_mm:
              type: number
              from: "rain.3h"
            snow_mm:
              type: number
              from: "snow.3h"

    pricing:
      base_morsels: 1

    estimated_time_seconds: 2

    examples:
      - input:
          lat: 61.4978
          lon: 23.7610
        output:
          city: "Tampere"
          forecasts:
            - datetime: "2025-01-20 12:00:00"
              temp_c: -5.2
              feels_like_c: -10.1
              weather: "pilvista"
              wind_speed: 4.2
              rain_mm: 0
              snow_mm: 1.5
            - datetime: "2025-01-20 15:00:00"
              temp_c: -6.8
              feels_like_c: -12.3
              weather: "lumisadetta"
              wind_speed: 5.1
              rain_mm: 0
              snow_mm: 3.2

  - id: "pricing-recommendation"
    display_name: "Weather-Based Pricing Recommendation"
    description: >
      Analyze weather forecast and local events to recommend
      dynamic pricing adjustments. Returns a price multiplier
      based on expected demand from weather conditions.

    endpoint:
      method: POST
      url: "https://api.restaurant.example/v1/pricing/weather-adjust"
      content_type: "application/json"

    input:
      lat:
        type: number
        required: true
        description: "Property latitude"
      lon:
        type: number
        required: true
        description: "Property longitude"
      base_price_eur:
        type: number
        required: true
        description: "Normal nightly rate in EUR"
      check_in:
        type: string
        required: true
        description: "Check-in date (YYYY-MM-DD)"
      check_out:
        type: string
        required: true
        description: "Check-out date (YYYY-MM-DD)"
      property_type:
        type: string
        required: false
        description: "Type of property for context"
        enum: ["cabin", "apartment", "cottage", "hotel_room", "villa"]

    request_mapping: |
      {
        "location": {"lat": {input.lat}, "lon": {input.lon}},
        "base_price": {input.base_price_eur},
        "dates": {
          "check_in": "{input.check_in}",
          "check_out": "{input.check_out}"
        },
        "property_type": "{input.property_type}"
      }

    output:
      recommended_price_eur:
        type: number
        description: "Recommended nightly rate after weather adjustment"
      multiplier:
        type: number
        description: "Price multiplier (e.g., 1.25 = +25%)"
      reasoning:
        type: string
        description: "Explanation of the pricing adjustment"
      weather_summary:
        type: string
        description: "Brief weather outlook for the booking period"
      confidence:
        type: number
        description: "Confidence in the recommendation (0-1)"

    pricing:
      base_morsels: 2

    estimated_time_seconds: 5

    examples:
      - input:
          lat: 61.4978
          lon: 23.7610
          base_price_eur: 120.00
          check_in: "2025-07-18"
          check_out: "2025-07-20"
          property_type: "cottage"
        output:
          recommended_price_eur: 156.00
          multiplier: 1.30
          reasoning: "Weekend + sunny 25 C forecast + peak summer season in Tampere region"
          weather_summary: "Aurinkoinen viikonloppu, 23-26 C, heikko tuuli"
          confidence: 0.85

health:
  endpoint: "https://api.openweathermap.org/data/2.5/weather?q=Helsinki&appid={env.OPENWEATHER_API_KEY}"
  method: GET
  interval_seconds: 600
  expected_status: 200
```

---

### 9.3 Posti SmartShip -- Finnish Parcel Shipping

Posti is Finland's national postal service. This MSM covers creating shipments (with full address handling) and tracking packages.

Key design decisions:
- Uses `oauth2` auth because Posti's SmartShip API requires client credentials token exchange
- Extensive input fields for sender/recipient because shipping needs complete addresses
- Service codes (`2103` = Postal Parcel, `2104` = Express, `2017` = Pickup Point) let agents choose delivery speed
- Output maps tracking codes from a nested array: `shipments[0].trackingCodes[0]`
- Finnish example data (Matti Meikalainen, Mannerheimintie, Helsinki -> Tampere)

```yaml
msm: "1.0"
service:
  name: "Posti SmartShip"
  description: "Create parcel shipments within Finland and to/from EU via Posti SmartShip API"
  homepage: "https://www.posti.fi/en/for-businesses/parcel-and-logistics-services"
  category: "utility"
  tags: ["shipping", "logistics", "posti", "finland", "parcel", "tracking", "delivery"]

auth:
  type: "oauth2"
  token_url: "https://oauth.posti.com/token"
  env_var: "POSTI_CLIENT_ID"
  env_var_secret: "POSTI_CLIENT_SECRET"

actions:
  - id: "create-shipment"
    display_name: "Create Parcel Shipment"
    description: >
      Create a domestic or international parcel shipment. Returns tracking code
      and shipping label URL. Supports Posti Economy, Express, and Pickup Point deliveries.

    endpoint:
      method: POST
      url: "https://api.posti.fi/shipment/v3/shipments"
      content_type: "application/json"

    input:
      sender_name:
        type: string
        required: true
        description: "Sender's full name"
      sender_address:
        type: string
        required: true
        description: "Sender's street address"
      sender_postcode:
        type: string
        required: true
        description: "Sender's postal code"
      sender_city:
        type: string
        required: true
        description: "Sender's city"
      sender_country:
        type: string
        required: false
        description: "Sender's country code (default: FI)"
        enum: ["FI", "SE", "EE", "DE", "FR", "NL"]
      recipient_name:
        type: string
        required: true
        description: "Recipient's full name"
      recipient_address:
        type: string
        required: true
        description: "Recipient's street address"
      recipient_postcode:
        type: string
        required: true
        description: "Recipient's postal code"
      recipient_city:
        type: string
        required: true
        description: "Recipient's city"
      recipient_country:
        type: string
        required: false
        description: "Recipient's country code (default: FI)"
      recipient_phone:
        type: string
        required: false
        description: "Recipient's phone for SMS notification"
      recipient_email:
        type: string
        required: false
        description: "Recipient's email for tracking updates"
      weight_kg:
        type: number
        required: true
        description: "Package weight in kilograms"
      length_cm:
        type: integer
        required: false
        description: "Package length in cm"
      width_cm:
        type: integer
        required: false
        description: "Package width in cm"
      height_cm:
        type: integer
        required: false
        description: "Package height in cm"
      service_code:
        type: string
        required: false
        description: "Delivery service type"
        enum: ["2103", "2104", "2017"]
        # 2103 = Postal Parcel, 2104 = Express, 2017 = Pickup Point
      contents_description:
        type: string
        required: false
        description: "Package contents for customs (international)"

    request_mapping: |
      {
        "shipments": [{
          "sender": {
            "name": "{input.sender_name}",
            "address": "{input.sender_address}",
            "postcode": "{input.sender_postcode}",
            "city": "{input.sender_city}",
            "country": "{input.sender_country}"
          },
          "recipient": {
            "name": "{input.recipient_name}",
            "address": "{input.recipient_address}",
            "postcode": "{input.recipient_postcode}",
            "city": "{input.recipient_city}",
            "country": "{input.recipient_country}",
            "phone": "{input.recipient_phone}",
            "email": "{input.recipient_email}"
          },
          "parcels": [{
            "weight": {input.weight_kg},
            "length": {input.length_cm},
            "width": {input.width_cm},
            "height": {input.height_cm},
            "contents": "{input.contents_description}"
          }],
          "serviceCode": "{input.service_code}"
        }]
      }

    output:
      tracking_code:
        type: string
        description: "Posti tracking code (e.g., JJFI12345678901234)"
        from: "shipments[0].trackingCodes[0]"
      label_url:
        type: string
        description: "URL to download the shipping label PDF"
        from: "shipments[0].labelUrl"
      tracking_url:
        type: string
        description: "Public tracking page URL"
        from: "shipments[0].trackingUrl"
      estimated_delivery:
        type: string
        description: "Estimated delivery date"
        from: "shipments[0].estimatedDelivery"

    pricing:
      base_morsels: 3

    estimated_time_seconds: 5

    examples:
      - input:
          sender_name: "Matti Meikalainen"
          sender_address: "Mannerheimintie 1"
          sender_postcode: "00100"
          sender_city: "Helsinki"
          recipient_name: "Liisa Virtanen"
          recipient_address: "Hameenkatu 10"
          recipient_postcode: "33100"
          recipient_city: "Tampere"
          weight_kg: 0.5
          service_code: "2103"
          contents_description: "iPhone 15 Pro"
        output:
          tracking_code: "JJFI64574900001234567"
          label_url: "https://api.posti.fi/labels/JJFI64574900001234567.pdf"
          tracking_url: "https://www.posti.fi/en/tracking?code=JJFI64574900001234567"
          estimated_delivery: "2026-03-02"

  - id: "track-shipment"
    display_name: "Track Shipment"
    description: "Get current status and location of a shipment"

    endpoint:
      method: GET
      url: "https://api.posti.fi/shipment-tracking/v1/tracking/{input.tracking_code}"

    input:
      tracking_code:
        type: string
        required: true
        description: "Posti tracking code"

    output:
      status:
        type: string
        description: "Current shipment status"
        from: "shipments[0].events[0].status"
      location:
        type: string
        description: "Current/last known location"
        from: "shipments[0].events[0].location"
      timestamp:
        type: string
        description: "Last event timestamp"
        from: "shipments[0].events[0].timestamp"
      delivered:
        type: boolean
        description: "Whether package has been delivered"
        from: "shipments[0].delivered"

    pricing:
      base_morsels: 0

    estimated_time_seconds: 2

health:
  endpoint: "https://api.posti.fi/shipment/v3/health"
  method: GET
  expected_status: 200
```

---

### 9.4 AI Logo Generator

This MSM wraps OpenAI's image generation API for logo design. It shows how MSM can describe AI-to-AI service calls -- one agent hiring another for creative work.

Key design decisions:
- Uses `bearer` auth (OpenAI API key)
- Variable pricing: `base_morsels: 15` plus `per_unit: 5` per variant, so generating 3 logos costs 30 morsels
- The `request_mapping` constructs a DALL-E prompt from structured business inputs
- `refine-logo` action enables iterative design based on feedback
- `estimated_time_seconds: 30` -- AI image generation is slower than data APIs

```yaml
msm: "1.0"
service:
  name: "AI Logo Generator"
  description: "Generate professional logos and brand designs using AI image generation"
  homepage: "https://platform.openai.com/docs/guides/images"
  category: "image"
  tags: ["logo", "design", "branding", "ai-generation", "dall-e", "freelance", "gig"]

auth:
  type: "bearer"
  env_var: "OPENAI_API_KEY"

actions:
  - id: "generate-logo"
    display_name: "Generate Logo Concepts"
    description: >
      Generate logo design concepts based on a text description.
      Returns multiple logo variants in different styles.
      Replaces hiring a freelance designer for initial concepts.

    endpoint:
      method: POST
      url: "https://api.openai.com/v1/images/generations"
      content_type: "application/json"

    input:
      business_name:
        type: string
        required: true
        description: "Name of the business or brand"
      industry:
        type: string
        required: true
        description: "Industry or business category (e.g., 'tech startup', 'bakery')"
      style:
        type: string
        required: false
        description: "Visual style preference"
        enum: ["minimalist", "modern", "vintage", "playful", "corporate", "handdrawn"]
      colors:
        type: array
        items:
          type: string
        required: false
        description: "Preferred colors (e.g., ['blue', 'white'])"
      variants:
        type: integer
        required: false
        description: "Number of logo variants to generate (1-4, default: 3)"

    request_mapping: |
      {
        "model": "dall-e-3",
        "prompt": "Professional logo design for '{input.business_name}', a {input.industry} company. Style: {input.style}. Colors: {input.colors}. Clean vector-style logo on white background, suitable for business use.",
        "n": {input.variants},
        "size": "1024x1024",
        "quality": "hd"
      }

    output:
      images:
        type: array
        items:
          type: object
          properties:
            url:
              type: string
              description: "URL to the generated logo image"
            revised_prompt:
              type: string
              description: "Refined prompt used for generation"
        from: "data"
      model:
        type: string
        from: "model"

    pricing:
      base_morsels: 15
      per_unit: 5
      unit: "variant"

    estimated_time_seconds: 30

    examples:
      - input:
          business_name: "NordTech Oy"
          industry: "technology consulting"
          style: "minimalist"
          colors: ["#0066CC", "#FFFFFF"]
          variants: 3
        output:
          images:
            - url: "https://oaidalleapi..."
              revised_prompt: "A minimalist professional logo for NordTech Oy..."
            - url: "https://oaidalleapi..."
              revised_prompt: "Clean geometric logo design..."
            - url: "https://oaidalleapi..."
              revised_prompt: "Nordic-inspired tech logo..."
          model: "dall-e-3"

  - id: "refine-logo"
    display_name: "Refine Logo Design"
    description: >
      Take an existing logo concept and generate refined variations
      based on feedback. Uses image editing to modify specific aspects.

    endpoint:
      method: POST
      url: "https://api.openai.com/v1/images/edits"
      content_type: "multipart/form-data"

    input:
      image_url:
        type: string
        required: true
        description: "URL of the logo to refine"
      feedback:
        type: string
        required: true
        description: "Refinement instructions (e.g., 'make the font bolder, add more blue')"

    request_mapping: |
      {
        "model": "dall-e-2",
        "image": "{input.image_url}",
        "prompt": "Refine this logo: {input.feedback}. Maintain professional quality.",
        "n": 2,
        "size": "1024x1024"
      }

    output:
      refined_images:
        type: array
        items:
          type: object
          properties:
            url:
              type: string
        from: "data"

    pricing:
      base_morsels: 10

    estimated_time_seconds: 20

health:
  endpoint: "https://api.openai.com/v1/models"
  method: GET
  interval_seconds: 300
  expected_status: 200
```

---

### 9.5 MobilePay Nordic Payments

MobilePay (now merged with Vipps) is the dominant mobile payment app in Finland and Denmark. This MSM shows how to create phone-based payment flows.

Key design decisions:
- Uses `oauth2` auth with MobilePay's merchant authentication endpoint
- The `mobile_pay_deep_link` output is critical -- it opens the MobilePay app on the buyer's phone
- Only EUR and DKK currencies (Nordic focus)
- Payment flow is asynchronous: create payment, send deep link to buyer, poll for completion

```yaml
msm: "1.0"
service:
  name: "MobilePay App Payments"
  description: "Accept and initiate MobilePay payments for Nordic marketplace transactions"
  homepage: "https://developer.mobilepay.dk"
  category: "utility"
  tags: ["payment", "mobilepay", "vipps", "nordic", "mobile", "finland", "denmark"]

auth:
  type: "oauth2"
  token_url: "https://api.mobilepay.dk/merchant-authentication-openidconnect/connect/token"
  env_var: "MOBILEPAY_CLIENT_ID"
  env_var_secret: "MOBILEPAY_CLIENT_SECRET"

actions:
  - id: "create-payment"
    display_name: "Create MobilePay Payment"
    description: >
      Create a MobilePay payment request. The buyer receives a push notification
      on their phone to approve the payment. Funds go to the merchant's settlement account.

    endpoint:
      method: POST
      url: "https://api.mobilepay.dk/v1/payments"
      content_type: "application/json"

    input:
      amount:
        type: number
        required: true
        description: "Payment amount (e.g., 680.00)"
      currency:
        type: string
        required: false
        description: "Currency code (default: EUR)"
        enum: ["EUR", "DKK"]
      description:
        type: string
        required: true
        description: "Payment description shown to buyer"
      reference:
        type: string
        required: true
        description: "Unique payment reference (e.g., AIMEAT tracking code)"
      redirect_uri:
        type: string
        required: false
        description: "URL to redirect after payment"

    request_mapping: |
      {
        "amount": {input.amount},
        "currency": "{input.currency}",
        "description": "{input.description}",
        "reference": "{input.reference}",
        "redirectUri": "{input.redirect_uri}"
      }

    output:
      payment_id:
        type: string
        description: "MobilePay payment ID"
        from: "paymentId"
      mobile_pay_deep_link:
        type: string
        description: "Deep link to open MobilePay app on user's phone"
        from: "mobilePayAppRedirectUri"
      state:
        type: string
        description: "Payment state (initiated, reserved, captured)"
        from: "state"

    pricing:
      base_morsels: 3

    estimated_time_seconds: 2

    examples:
      - input:
          amount: 680.00
          currency: "EUR"
          description: "iPhone 15 Pro - AIMEAT Marketplace"
          reference: "tc-1709145600000-a1b2c3d4"
        output:
          payment_id: "186d2b31-ff25-4414-9fd1-bdbf6aec0bc5"
          mobile_pay_deep_link: "mobilepay://payment?id=186d2b31..."
          state: "initiated"

  - id: "check-payment"
    display_name: "Check MobilePay Payment Status"
    description: "Check whether a MobilePay payment has been approved by the buyer"

    endpoint:
      method: GET
      url: "https://api.mobilepay.dk/v1/payments/{input.payment_id}"

    input:
      payment_id:
        type: string
        required: true
        description: "MobilePay payment ID"

    output:
      state:
        type: string
        description: "Payment state"
        from: "state"
      amount:
        type: number
        from: "amount"
      paid_at:
        type: string
        description: "Timestamp when payment was approved"
        from: "paidAt"

    pricing:
      base_morsels: 0

    estimated_time_seconds: 1
```

---

### 9.6 Coinbase CDP Crypto Transfer

Coinbase Developer Platform enables AI agents to hold and transfer cryptocurrency. This MSM shows how agents can make blockchain payments autonomously.

Key design decisions:
- Uses `api_key` auth with a custom header (`X-CDP-API-Key`) because Coinbase CDP has its own auth scheme
- `wallet_id` in the URL path means each agent has its own wallet
- Network selection matters: Base network has the lowest fees, Ethereum has the highest
- USDC is recommended for marketplace payments because it is price-stable
- `gasless: true` in the request mapping means Coinbase covers gas fees on supported networks

```yaml
msm: "1.0"
service:
  name: "Coinbase CDP Crypto Transfer"
  description: "Send cryptocurrency payments (USDC, ETH, BTC) via Coinbase AgentKit wallet"
  homepage: "https://docs.cdp.coinbase.com/agent-kit"
  category: "utility"
  tags: ["crypto", "payment", "coinbase", "usdc", "ethereum", "bitcoin", "agentkit", "blockchain"]

auth:
  type: "api_key"
  header: "X-CDP-API-Key"
  env_var: "CDP_API_KEY"

actions:
  - id: "send-crypto"
    display_name: "Send Crypto Payment"
    description: >
      Send cryptocurrency from agent's wallet to a recipient address.
      Supports USDC (recommended for marketplace -- stable price), ETH, BTC, SOL.
      Transactions on Base network are fast and low-fee.

    endpoint:
      method: POST
      url: "https://api.cdp.coinbase.com/platform/v1/wallets/{input.wallet_id}/transfers"
      content_type: "application/json"

    input:
      wallet_id:
        type: string
        required: true
        description: "Agent's CDP wallet ID"
      amount:
        type: string
        required: true
        description: "Amount to send (e.g., '50.00' for 50 USDC)"
      currency:
        type: string
        required: true
        description: "Cryptocurrency to send"
        enum: ["USDC", "ETH", "BTC", "SOL", "EURC"]
      to_address:
        type: string
        required: true
        description: "Recipient wallet address (0x... for EVM, or SOL address)"
      network:
        type: string
        required: false
        description: "Blockchain network (default: base for lowest fees)"
        enum: ["base", "ethereum", "polygon", "solana", "arbitrum"]
      memo:
        type: string
        required: false
        description: "Transaction memo (e.g., AIMEAT tracking code)"

    request_mapping: |
      {
        "amount": "{input.amount}",
        "asset_id": "{input.currency}",
        "destination": "{input.to_address}",
        "network_id": "{input.network}",
        "gasless": true
      }

    output:
      transfer_id:
        type: string
        description: "CDP transfer ID"
        from: "id"
      tx_hash:
        type: string
        description: "On-chain transaction hash"
        from: "transaction_hash"
      status:
        type: string
        description: "Transfer status (pending, completed, failed)"
        from: "status"
      network:
        type: string
        description: "Network used"
        from: "network_id"

    pricing:
      base_morsels: 8

    estimated_time_seconds: 15

    examples:
      - input:
          wallet_id: "wal_abc123"
          amount: "680.00"
          currency: "USDC"
          to_address: "0x742d35Cc6634C0532925a3b844Bc9..."
          network: "base"
          memo: "tc-1709145600000-a1b2c3d4"
        output:
          transfer_id: "xfer_xyz789"
          tx_hash: "0x8f4b2a1c3d5e6f7..."
          status: "completed"
          network: "base"

  - id: "check-balance"
    display_name: "Check Wallet Balance"
    description: "Check the agent wallet's cryptocurrency balances"

    endpoint:
      method: GET
      url: "https://api.cdp.coinbase.com/platform/v1/wallets/{input.wallet_id}/balances"

    input:
      wallet_id:
        type: string
        required: true
        description: "CDP wallet ID"

    output:
      balances:
        type: array
        description: "Array of {currency, amount} for each asset"
        from: "data"

    pricing:
      base_morsels: 0

    estimated_time_seconds: 2

health:
  endpoint: "https://api.cdp.coinbase.com/platform/v1/networks"
  method: GET
  expected_status: 200
```

---

*MSM v1.0 -- AIMEAT Protocol*
