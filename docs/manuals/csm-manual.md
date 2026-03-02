# CSM Manual -- Community Service Manifest

*AIMEAT Protocol -- Guide for Humans and AI*

---

## 1. What is CSM?

A **Community Service Manifest** (CSM) is a small YAML file that describes the shape of a community service. Think of it as a recipe card: it tells an AI assistant what data a service collects, what the privacy rules are, how moderation works, and how things should look on screen. You write the recipe, AI does the cooking.

CSM requires no programming, no servers, and no technical background. You describe *what* your community service is -- a hobby directory, a marketplace, a dating board, a news feed -- and AI takes it from there: generating forms, validating input, building views, and enforcing the rules you set. If you can fill out a form, you can write a CSM.

---

## 2. 60-Second Quickstart

Here is the smallest useful CSM -- a hobby directory in ten lines:

```yaml
csm: "1.0"
service:
  name: "Harrastehakemisto"
  type: "directory"
  description: "Find hobbies and like-minded people near you"
  locale: "fi"

data_schema:
  required:
    interests:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
      required: [city]
```

That is a complete, working CSM. You give this file to your AI assistant, and it already knows to ask users for their interests and city, display results as a browsable list, and treat the data as a community directory. Everything not specified -- consent defaults, moderation thresholds, UI layout -- falls back to sensible protocol defaults.

You can stop here and have a working service. Or you can keep reading to learn every knob and dial available.

---

## 3. Creating CSM with AI

CSM is designed so that both humans and AI can author it. The most natural way to create a CSM is to describe what you want in plain language and let your AI assistant generate the YAML.

### Example 1: Finnish hobby club

**You say:**

> "Haluan perustaa harrastekerhon Tapiolaan. Ihmiset kertovat kiinnostuksen kohteistaan ja milloin heille sopii. Näytetään samalla alueella asuvat samanhenkiset ihmiset."

**AI generates:**

```yaml
csm: "1.0"
service:
  name: "Tapiolan Harrastekerho"
  type: "directory"
  description: "Löydä harrastuksia ja samanhenkisiä ihmisiä Tapiolasta"
  locale: "fi"

schema_mode: "open"

data_schema:
  required:
    interests:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string, default: "FI" }
      required: [city]
  optional:
    bio: { type: string, maxLength: 500 }
    availability:
      type: string
      enum: ["anytime", "mornings", "evenings", "weekends", "evenings-weekends"]
    seeking: { type: array, items: { type: string } }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "community-discovery"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false

ui_hints:
  list_view: ["displayName", "interests", "location.city"]
  detail_view: ["displayName", "bio", "interests", "location", "availability", "seeking"]
  search_fields: ["interests", "location.city", "location.area"]
```

**Why the AI chose these fields:** You mentioned interests, availability, and location. The AI added `bio` and `seeking` as optional fields because hobby groups benefit from self-description. It set `schema_mode: "open"` so users or other AI agents can add custom fields later (e.g., skill level, preferred language). Consent is set to `requires_consent: true` because the service stores personal data.

### Example 2: Vintage electronics marketplace

**You say:**

> "Create a marketplace for vintage electronics. Sellers list items with price, condition, and photos. Buyers can search by category. Use escrow for payments."

**AI generates:**

```yaml
csm: "1.0"
service:
  name: "Vintage Electronics Market"
  type: "marketplace"
  description: "Buy and sell vintage electronics with escrow protection"
  locale: "en"

schema_mode: "open"

data_schema:
  required:
    title:
      type: string
      minLength: 3
      maxLength: 200
    price:
      type: object
      properties:
        amount: { type: number, minimum: 0 }
        currency: { type: string, default: "EUR" }
      required: [amount]
    category:
      type: string
      enum: ["computers", "audio", "video", "gaming", "phones", "components", "other"]
    seller_gaii:
      type: string
  optional:
    description: { type: string, maxLength: 2000 }
    images: { type: array, items: { type: string }, maxItems: 10 }
    condition: { type: string, enum: ["new", "like_new", "good", "fair", "poor"] }
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string }
    shipping_options: { type: array, items: { type: string } }
    tags: { type: array, items: { type: string }, maxItems: 10 }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "marketplace-listing"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true

economy:
  listing_fee_morsels: 5
  escrow_enabled: true
  escrow_release_on: "buyer_confirmation"

ui_hints:
  list_view: ["title", "price.amount", "price.currency", "category", "condition"]
  detail_view: ["title", "description", "price", "category", "condition", "images", "location", "shipping_options", "seller_gaii"]
  search_fields: ["title", "category", "tags", "location.city"]
```

**Why the AI chose these fields:** You asked for escrow, so the AI added the `economy` block with `escrow_enabled: true`. Categories were tailored to vintage electronics instead of the generic marketplace defaults. The `schema_mode: "open"` allows sellers to add custom fields like `year_manufactured` or `brand` without changing the CSM.

### Example 3: Dating with strict privacy

**You say:**

> "Add a dating feature with strict privacy. Age ranges only, no exact ages. Anonymous browsing. Profiles auto-expire after 90 days."

**AI generates:**

```yaml
csm: "1.0"
service:
  name: "Kohtaamispaikka"
  type: "directory"
  description: "Privacy-first dating directory with anonymous browsing"
  locale: "fi"

schema_mode: "strict"

data_schema:
  required:
    display_name:
      type: string
      minLength: 2
      maxLength: 50
    age_range:
      type: string
      enum: ["18-25", "26-35", "36-45", "46-55", "56+"]
    looking_for:
      type: array
      items: { type: string, enum: ["friendship", "dating", "relationship", "activity_partner"] }
      minItems: 1
    interests:
      type: array
      items: { type: string }
      minItems: 1
      maxItems: 15
  optional:
    bio: { type: string, maxLength: 500 }
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string }
    availability: { type: string, enum: ["anytime", "weekdays", "evenings", "weekends"] }
    languages: { type: array, items: { type: string }, maxItems: 5 }
    values: { type: array, items: { type: string }, maxItems: 10 }

consent_requirements:
  visibility_default: "dmz"
  requires_consent: true
  consent_purpose: "dating-discovery"
  data_retention: "90d"
  anonymous_browsing: true

moderation:
  flags_enabled: true
  auto_hide_threshold: 2
  appeals_enabled: true

ui_hints:
  list_view: ["display_name", "age_range", "interests", "location.city"]
  detail_view: ["display_name", "bio", "age_range", "looking_for", "interests", "location", "availability", "languages", "values"]
  search_fields: ["interests", "location.city", "looking_for", "age_range"]
```

**Why the AI chose these fields:** You said "strict privacy", so the AI used `schema_mode: "strict"` (no custom fields allowed), `visibility_default: "dmz"` (profiles only visible to verified community members, not the open federation), `anonymous_browsing: true`, and `data_retention: "90d"` for automatic expiry. Age is a range enum, never an exact number. The moderation threshold is set low (2 flags to auto-hide) because dating services need aggressive moderation.

### Example 4: Quick prompt, minimal output

**You say:**

> "Community news board."

**AI generates:**

```yaml
csm: "1.0"
service:
  name: "Community News"
  type: "feed"
  description: "Community news feed with topic categorization"
  locale: "en"

data_schema:
  required:
    title: { type: string, minLength: 5, maxLength: 300 }
    content: { type: string, minLength: 10, maxLength: 10000 }
    author_gaii: { type: string }
    category:
      type: string
      enum: ["news", "announcement", "discussion", "event", "update", "question"]
```

Even a two-word prompt produces a valid CSM. AI fills in the sensible structure; you refine from there.

---

## 4. YAML Reference

This section documents every field in the CSM format. All fields use standard YAML syntax.

### 4.1 `csm` (required)

The CSM format version. Currently always `"1.0"`.

```yaml
csm: "1.0"
```

### 4.2 `service` (required)

Top-level metadata about the community service.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable service name. Can be in any language. |
| `type` | string | yes | One of the eight service types (see below). |
| `description` | string | yes | One-line summary of what this service does. |
| `locale` | string | no | Primary language code (`"en"`, `"fi"`, `"sv"`, etc.). Defaults to `"en"`. |

**The eight service types:**

| Type | Purpose | Example |
|------|---------|---------|
| `directory` | People or things listed for discovery | Hobby directory, dating profiles, video library |
| `marketplace` | Items for sale with prices | Flea market, vintage shop |
| `forum` | Threaded discussions | Opinion board, Q&A |
| `feed` | Chronological content stream | News feed, announcements |
| `dating` | Relationship-oriented directory | (Also works as `directory` with privacy flags) |
| `auction` | Time-limited bidding | Art auctions, estate sales |
| `opinion` | Polls and sentiment | Community polls, feedback boards |
| `media` | Video, audio, or image collections | Video directory, podcast library |

```yaml
service:
  name: "Kirpputori"
  type: "marketplace"
  description: "Osta ja myy tavaroita turvallisesti"
  locale: "fi"
```

### 4.3 `schema_mode` (optional)

Controls whether AI and users can add fields beyond what `data_schema` defines.

| Value | Meaning |
|-------|---------|
| `"open"` | Custom fields are allowed. AI can add fields like `year_manufactured` or `brand` while keeping the base schema intact. **This is the default.** |
| `"strict"` | Only the fields defined in `data_schema` are accepted. Use this for privacy-sensitive services like dating, where you want tight control over what data exists. |

```yaml
schema_mode: "strict"
```

### 4.4 `data_schema` (required)

The heart of the CSM. Defines what data each listing or profile contains.

**Structure:**

```yaml
data_schema:
  required:
    field_name:
      type: <type>
      # ...validation rules
  optional:
    field_name:
      type: <type>
      # ...validation rules
```

**Supported types:**

| Type | Description | Validation options |
|------|-------------|-------------------|
| `string` | Text value | `minLength`, `maxLength`, `enum`, `format` |
| `number` | Numeric value | `minimum`, `maximum` |
| `boolean` | True/false | `default` |
| `array` | List of values | `items` (with nested type), `minItems`, `maxItems` |
| `object` | Nested structure | `properties`, `required` |

**String formats:** `uri`, `date-time`, `email`

**Examples of each type:**

```yaml
# Simple string with length limits
title:
  type: string
  minLength: 3
  maxLength: 200

# String with allowed values (enum)
condition:
  type: string
  enum: ["new", "like_new", "good", "fair", "poor"]

# Number with range
amount:
  type: number
  minimum: 0

# Boolean with default
anonymous:
  type: boolean
  default: false

# Array of strings
tags:
  type: array
  items: { type: string }
  maxItems: 10

# Array with enum items
looking_for:
  type: array
  items: { type: string, enum: ["friendship", "dating", "relationship"] }
  minItems: 1

# Nested object
price:
  type: object
  properties:
    amount: { type: number, minimum: 0 }
    currency: { type: string, default: "EUR" }
  required: [amount]

# Nested object with deeper structure (chapters in a video)
chapters:
  type: array
  items:
    type: object
    properties:
      title: { type: string }
      start_seconds: { type: number }
```

### 4.5 `consent_requirements` (optional)

Controls privacy and data governance. These fields tell AI how to handle user data.

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `visibility_default` | string | `"federation"`, `"dmz"`, `"local"` | Who can see listings. `federation` = all connected nodes. `dmz` = verified community members only. `local` = this node only. |
| `requires_consent` | boolean | `true` / `false` | Whether users must explicitly agree before their data is stored. Should be `true` for any service holding personal data. |
| `consent_purpose` | string | free text | Human-readable label for what the data is used for. Shown to users during consent. |
| `data_retention` | string | `"until_revoked"`, `"90d"`, `"365d"`, etc. | How long data is kept. `until_revoked` means forever until the user deletes it. Time-limited values auto-expire. |
| `anonymous_browsing` | boolean | `true` / `false` | Whether users can browse listings without revealing their identity. Important for dating and sensitive directories. |
| `anonymous_option` | boolean | `true` / `false` | Whether users can post content anonymously. Used in forums and opinion boards. |

```yaml
consent_requirements:
  visibility_default: "dmz"
  requires_consent: true
  consent_purpose: "dating-discovery"
  data_retention: "90d"
  anonymous_browsing: true
```

### 4.6 `moderation` (optional)

Controls community safety. Every service with user-generated content should have moderation.

| Field | Type | Description |
|-------|------|-------------|
| `flags_enabled` | boolean | Whether community members can flag inappropriate content. |
| `auto_hide_threshold` | integer | Number of flags before a listing is automatically hidden pending review. Lower = stricter. Dating services typically use 2; general directories use 5. |
| `appeals_enabled` | boolean | Whether users can appeal moderation decisions. |

```yaml
moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true
```

### 4.7 `economy` (optional)

Marketplace and auction economics. Only relevant for `type: "marketplace"` or auction-type services. For connecting external payment providers (Stripe, MobilePay) to your marketplace, see the [MSM Manual](./msm-manual.md).

| Field | Type | Description |
|-------|------|-------------|
| `listing_fee_morsels` | integer | Cost in morsels (the AIMEAT microcurrency) to create a listing. |
| `escrow_enabled` | boolean | Whether payments go through escrow. |
| `escrow_release_on` | string | When escrow releases funds. Typically `"buyer_confirmation"`. |
| `bid_increment_minimum` | number | Minimum bid increment for auctions. |

```yaml
economy:
  listing_fee_morsels: 10
  escrow_enabled: true
  escrow_release_on: "buyer_confirmation"
  bid_increment_minimum: 1
```

### 4.8 `scoring` (optional)

Content ranking rules for feeds and news services.

| Field | Type | Description |
|-------|------|-------------|
| `freshness_weight` | number (0-1) | How much recency matters in ranking. |
| `engagement_weight` | number (0-1) | How much interaction (views, replies) matters. |
| `relevance_weight` | number (0-1) | How much topic match matters. |
| `decay_half_life_hours` | number | How quickly old content drops in ranking. |

```yaml
scoring:
  freshness_weight: 0.6
  engagement_weight: 0.3
  relevance_weight: 0.1
  decay_half_life_hours: 24
```

### 4.9 `limits` (optional)

File and upload constraints for media services.

| Field | Type | Description |
|-------|------|-------------|
| `max_file_size_mb` | number | Maximum upload size in megabytes. |
| `allowed_formats` | array | List of accepted file extensions. |

```yaml
limits:
  max_file_size_mb: 5000
  allowed_formats: ["mp4", "webm", "mov", "avi"]
```

### 4.10 `ui_hints` (optional)

Suggestions for how AI should render the service. These are hints, not commands -- AI uses them as guidance when building views.

| Field | Type | Description |
|-------|------|-------------|
| `list_view` | array | Fields to show in the browse/list view (the card or row). |
| `detail_view` | array | Fields to show on the full detail page. |
| `search_fields` | array | Fields that should be searchable/filterable. |
| `sort_fields` | array | Fields available for sorting. |
| `card_image` | string | Field name to use as the card thumbnail. |

Use dot notation for nested fields: `"price.amount"`, `"location.city"`.

```yaml
ui_hints:
  list_view: ["title", "price.amount", "price.currency", "category"]
  detail_view: ["title", "description", "price", "images", "location"]
  search_fields: ["title", "category", "tags"]
  card_image: "thumbnail_url"
```

---

## 5. Service Types Gallery

This section shows complete, real-world CSM files for each major service type. These are taken directly from the AIMEAT example library.

### 5.1 Directory -- Harrastehakemisto (Hobby Directory)

A Finnish hobby directory where people list their interests and find others nearby.

```yaml
csm: "1.0"
service:
  name: "Harrastehakemisto"
  type: "directory"
  description: "Löydä harrastuksia ja samanhenkisiä ihmisiä läheltäsi"
  locale: "fi"

schema_mode: "open"

data_schema:
  required:
    interests:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string, default: "FI" }
      required: [city]
  optional:
    bio: { type: string, maxLength: 500 }
    availability:
      type: string
      enum: ["anytime", "mornings", "evenings", "weekends", "evenings-weekends"]
    seeking: { type: array, items: { type: string } }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "community-discovery"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false

ui_hints:
  list_view: ["displayName", "interests", "location.city"]
  detail_view: ["displayName", "bio", "interests", "location", "availability", "seeking"]
  search_fields: ["interests", "location.city", "location.area"]
```

**What makes it tick:** Minimal required fields (interests + city) keep the barrier to entry low. Open schema lets users organically add fields like skill level or group size. Visibility is `federation` so hobbyists from neighboring nodes can discover each other.

### 5.2 Marketplace -- Kirpputori (Flea Market)

A general buy-and-sell marketplace with listing fees and escrow protection.

```yaml
csm: "1.0"
service:
  name: "marketplace"
  type: "marketplace"
  description: "Buy and sell items with listing fees and escrow protection"
  locale: "en"

schema_mode: "open"

data_schema:
  required:
    title:
      type: string
      minLength: 3
      maxLength: 200
    price:
      type: object
      properties:
        amount: { type: number, minimum: 0 }
        currency: { type: string, default: "EUR" }
      required: [amount]
    category:
      type: string
      enum: ["electronics", "clothing", "home", "vehicles", "services", "other"]
    seller_gaii:
      type: string
  optional:
    description: { type: string, maxLength: 2000 }
    images: { type: array, items: { type: string }, maxItems: 10 }
    condition: { type: string, enum: ["new", "like_new", "good", "fair", "poor"] }
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string }
    shipping_options: { type: array, items: { type: string } }
    tags: { type: array, items: { type: string }, maxItems: 10 }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "marketplace-listing"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true

economy:
  listing_fee_morsels: 5
  escrow_enabled: true
  escrow_release_on: "buyer_confirmation"

ui_hints:
  list_view: ["title", "price.amount", "price.currency", "category", "condition"]
  detail_view: ["title", "description", "price", "category", "condition", "images", "location", "shipping_options", "seller_gaii"]
  search_fields: ["title", "category", "tags", "location.city"]
```

**What makes it tick:** The `economy` block introduces morsel-based listing fees (5 morsels per listing) and escrow that releases on buyer confirmation. This creates trust: sellers pay a small cost to list (preventing spam), and buyers know their payment is held safely until they confirm receipt. Moderation threshold is tighter (3 flags) because financial transactions demand higher trust. Appeals are enabled so legitimate sellers can contest flags.

### 5.3 Dating -- Kohtaamispaikka (Meeting Place)

A privacy-first dating directory with anonymous browsing and auto-expiring profiles.

```yaml
csm: "1.0"
service:
  name: "dating-directory"
  type: "directory"
  description: "Privacy-first dating profile directory with DMZ visibility and anonymous browsing"
  locale: "en"

schema_mode: "strict"

data_schema:
  required:
    display_name:
      type: string
      minLength: 2
      maxLength: 50
    age_range:
      type: string
      enum: ["18-25", "26-35", "36-45", "46-55", "56+"]
    looking_for:
      type: array
      items: { type: string, enum: ["friendship", "dating", "relationship", "activity_partner"] }
      minItems: 1
    interests:
      type: array
      items: { type: string }
      minItems: 1
      maxItems: 15
  optional:
    bio: { type: string, maxLength: 500 }
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string }
    availability: { type: string, enum: ["anytime", "weekdays", "evenings", "weekends"] }
    languages: { type: array, items: { type: string }, maxItems: 5 }
    values: { type: array, items: { type: string }, maxItems: 10 }

consent_requirements:
  visibility_default: "dmz"
  requires_consent: true
  consent_purpose: "dating-discovery"
  data_retention: "90d"
  anonymous_browsing: true

moderation:
  flags_enabled: true
  auto_hide_threshold: 2
  appeals_enabled: true

ui_hints:
  list_view: ["display_name", "age_range", "interests", "location.city"]
  detail_view: ["display_name", "bio", "age_range", "looking_for", "interests", "location", "availability", "languages", "values"]
  search_fields: ["interests", "location.city", "looking_for", "age_range"]
```

**What makes it tick:** Three privacy mechanisms work together. First, `schema_mode: "strict"` prevents any unexpected fields from creeping in -- only the defined fields exist, period. Second, `visibility_default: "dmz"` keeps profiles within the verified community rather than broadcasting them across the federation. Third, `anonymous_browsing: true` lets people look before they reveal themselves. The 90-day retention auto-cleans stale profiles. And the lowest moderation threshold (2 flags) means inappropriate behavior is caught fast.

### 5.4 Auction -- Huutokauppa

Time-limited auctions with bidding, reserve prices, and escrow.

```yaml
csm: "1.0"
service:
  name: "auction"
  type: "marketplace"
  description: "Time-limited auction listings with escrow and bidding system"
  locale: "en"

schema_mode: "strict"

data_schema:
  required:
    title:
      type: string
      minLength: 5
      maxLength: 200
    description:
      type: string
      minLength: 10
      maxLength: 3000
    starting_price:
      type: object
      properties:
        amount: { type: number, minimum: 0 }
        currency: { type: string, default: "EUR" }
      required: [amount]
    category:
      type: string
      enum: ["art", "collectibles", "electronics", "antiques", "vehicles", "real_estate", "other"]
    seller_gaii:
      type: string
    ends_at:
      type: string
      format: date-time
  optional:
    reserve_price:
      type: object
      properties:
        amount: { type: number, minimum: 0 }
        currency: { type: string }
    buy_now_price:
      type: object
      properties:
        amount: { type: number, minimum: 0 }
        currency: { type: string }
    images: { type: array, items: { type: string }, maxItems: 20 }
    condition: { type: string, enum: ["new", "like_new", "good", "fair", "poor"] }
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string }
    shipping_options: { type: array, items: { type: string } }
    provenance: { type: string, maxLength: 1000 }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "auction-listing"
  data_retention: "365d"

moderation:
  flags_enabled: true
  auto_hide_threshold: 2
  appeals_enabled: true

economy:
  listing_fee_morsels: 10
  escrow_enabled: true
  escrow_release_on: "buyer_confirmation"
  bid_increment_minimum: 1

ui_hints:
  list_view: ["title", "starting_price.amount", "starting_price.currency", "category", "ends_at"]
  detail_view: ["title", "description", "starting_price", "reserve_price", "buy_now_price", "category", "condition", "images", "location", "ends_at", "provenance"]
  search_fields: ["title", "category", "location.city"]
```

**What makes it tick:** Auctions require `ends_at` (a datetime) as a required field -- every auction has a deadline. The `economy` block adds `bid_increment_minimum` to prevent penny-bidding wars. `reserve_price` is optional so sellers can set a hidden floor. `provenance` lets art and antique sellers document item history. Higher listing fee (10 morsels) and strict schema reflect the higher-stakes nature of auctions.

### 5.5 News Feed

A community news feed with content scoring and topic categories.

```yaml
csm: "1.0"
service:
  name: "news-feed"
  type: "feed"
  description: "Community news feed with freshness scoring and topic categorization"
  locale: "en"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, minLength: 5, maxLength: 300 }
    content: { type: string, minLength: 10, maxLength: 10000 }
    author_gaii: { type: string }
    category:
      type: string
      enum: ["news", "announcement", "discussion", "event", "update", "question"]
  optional:
    summary: { type: string, maxLength: 500 }
    source_url: { type: string, format: uri }
    tags: { type: array, items: { type: string }, maxItems: 10 }
    images: { type: array, items: { type: string }, maxItems: 5 }
    location:
      type: object
      properties:
        city: { type: string }
        region: { type: string }
        country: { type: string }
    priority: { type: string, enum: ["normal", "important", "urgent"] }
    expires_at: { type: string, format: date-time }

consent_requirements:
  visibility_default: "federation"
  requires_consent: false
  consent_purpose: "news-distribution"
  data_retention: "365d"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: true

scoring:
  freshness_weight: 0.6
  engagement_weight: 0.3
  relevance_weight: 0.1
  decay_half_life_hours: 24

ui_hints:
  list_view: ["title", "category", "author_gaii", "summary"]
  detail_view: ["title", "content", "category", "author_gaii", "tags", "source_url", "images", "location"]
  search_fields: ["title", "content", "tags", "category", "location.city"]
```

**What makes it tick:** The `scoring` block gives AI a formula for ranking content. Freshness dominates at 60%, so new posts appear first. The 24-hour decay half-life means yesterday's news drops to half relevance. `requires_consent: false` because news is public content, not personal data. The `expires_at` optional field lets announcements auto-remove after their relevance window.

### 5.6 Opinion Board / Forum

A discussion forum with anonymous posting and embedded polls.

```yaml
csm: "1.0"
service:
  name: "opinion-board"
  type: "forum"
  description: "Public opinion board with optional anonymous posting and structured discussions"
  locale: "en"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, minLength: 3, maxLength: 200 }
    body: { type: string, minLength: 10, maxLength: 5000 }
    topic:
      type: string
      enum: ["general", "politics", "technology", "environment", "culture", "economy", "health", "education"]
  optional:
    author_display_name: { type: string, maxLength: 50 }
    anonymous: { type: boolean, default: false }
    tags: { type: array, items: { type: string }, maxItems: 5 }
    poll:
      type: object
      properties:
        question: { type: string }
        options: { type: array, items: { type: string }, minItems: 2, maxItems: 10 }
        expires_at: { type: string, format: date-time }
    reply_to: { type: string }
    sentiment: { type: string, enum: ["positive", "negative", "neutral", "mixed"] }

consent_requirements:
  visibility_default: "federation"
  requires_consent: false
  consent_purpose: "public-discussion"
  data_retention: "until_revoked"
  anonymous_option: true

moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true

ui_hints:
  list_view: ["title", "topic", "author_display_name", "anonymous"]
  detail_view: ["title", "body", "topic", "author_display_name", "tags", "poll", "sentiment"]
  search_fields: ["title", "body", "tags", "topic"]
```

**What makes it tick:** The `anonymous_option: true` in consent and the `anonymous` boolean field work together -- when someone posts anonymously, their identity is not stored or displayed. The `poll` object lets any post include an embedded poll with multiple options and an expiry. The `reply_to` field enables threading: a post can reference another post's ID to create discussion chains. `sentiment` lets AI or users tag the emotional tone of contributions.

### 5.7 Video Directory

A community media library with chapters, transcripts, and format limits.

```yaml
csm: "1.0"
service:
  name: "video-directory"
  type: "directory"
  description: "Community video directory with categorization and size limits"
  locale: "en"

schema_mode: "open"

data_schema:
  required:
    title: { type: string, minLength: 3, maxLength: 200 }
    video_url: { type: string, format: uri }
    creator_gaii: { type: string }
    category:
      type: string
      enum: ["tutorial", "entertainment", "documentary", "music", "news", "sports", "education", "other"]
  optional:
    description: { type: string, maxLength: 2000 }
    thumbnail_url: { type: string, format: uri }
    duration_seconds: { type: number, minimum: 1 }
    tags: { type: array, items: { type: string }, maxItems: 15 }
    language: { type: string }
    resolution: { type: string, enum: ["360p", "480p", "720p", "1080p", "4k"] }
    file_size_mb: { type: number, minimum: 0, maximum: 5000 }
    transcript: { type: string, maxLength: 50000 }
    chapters:
      type: array
      items:
        type: object
        properties:
          title: { type: string }
          start_seconds: { type: number }
    license: { type: string, enum: ["cc-by", "cc-by-sa", "cc-by-nc", "cc0", "all-rights-reserved"] }

consent_requirements:
  visibility_default: "federation"
  requires_consent: false
  consent_purpose: "video-sharing"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 3
  appeals_enabled: true

limits:
  max_file_size_mb: 5000
  allowed_formats: ["mp4", "webm", "mov", "avi"]

ui_hints:
  list_view: ["title", "category", "creator_gaii", "duration_seconds", "thumbnail_url"]
  detail_view: ["title", "description", "video_url", "category", "creator_gaii", "tags", "duration_seconds", "resolution", "language", "chapters", "license"]
  search_fields: ["title", "description", "tags", "category", "language"]
```

**What makes it tick:** The `limits` block enforces upload constraints (5 GB max, specific formats). `chapters` let creators mark sections with timestamps, and `transcript` enables full-text search across spoken content. The `license` field makes content rights explicit -- AI can use this to filter reusable content or warn about restricted material.

---

## 6. How AI Uses Your CSM

When you hand a CSM file to an AI assistant, here is what happens:

**Step 1: AI reads the schema.** It looks at `data_schema` to understand what information the service needs. Required fields become mandatory questions; optional fields become follow-up prompts.

**Step 2: AI asks users the right questions.** For a hobby directory, AI asks about interests and location. For a marketplace, it asks about the item title, price, and condition. The field types guide how AI asks: an `enum` becomes a multiple-choice selector, an `array` becomes a list where users can add items, a `number` with `minimum: 0` tells AI to reject negative values.

**Step 3: AI validates input.** Before storing anything, AI checks every validation rule: `minLength`, `maxLength`, `minItems`, `maxItems`, `minimum`, `maximum`, `enum` values, `format` patterns. If a listing title is too short or a price is negative, AI asks the user to fix it.

**Step 4: AI checks consent.** If `requires_consent: true`, AI presents a consent screen explaining the `consent_purpose` and `data_retention` before storing any data. Users see exactly what they are agreeing to.

**Step 5: AI builds the interface.** The `ui_hints` guide layout: `list_view` fields appear in browse mode, `detail_view` fields appear when you click into an item, and `search_fields` become filter options. AI adapts these hints to whatever platform it is running on -- a chat interface, a web app, a mobile screen.

**Step 6: AI layers smart features on top.** Beyond the basic schema, AI adds intelligence that the CSM does not need to specify:
- **Marketplace:** Price trend analysis, similar item suggestions, seller reputation display.
- **Directory:** Compatibility scoring, location-based recommendations, activity suggestions.
- **Dating:** Match percentage based on shared interests and values, conversation starters.
- **News feed:** Personalized ranking using the `scoring` weights, duplicate detection, summarization.
- **Auction:** Bid timing advice, price history, sniping alerts.

The CSM defines *what* data exists. AI decides *how* to make it useful.

---

## 7. Extending Beyond the Spec

When `schema_mode` is `"open"` (the default), AI and users can add custom fields that go beyond the base schema. The base fields remain standardized and interoperable across the federation, while custom fields add domain-specific richness.

**Example: Vintage electronics marketplace**

The base marketplace CSM defines `title`, `price`, `category`, and `condition`. A vintage electronics community might add:

```yaml
# These custom fields coexist with the base schema
year_manufactured: 1987
brand: "Commodore"
model: "Amiga 500"
working_condition: "boots but no video output"
original_packaging: true
manual_included: false
```

AI recognizes these as custom extensions. It can display them, search them, and even use them for smart features (e.g., grouping items by decade), all while the base `title`, `price`, and `category` fields keep the listing compatible with any other marketplace node in the federation.

**When to use strict mode instead:**

Set `schema_mode: "strict"` when you need tight control over what data exists. This is important for:
- **Dating services** -- you do not want unexpected fields leaking personal information.
- **Auctions** -- the bidding logic depends on a predictable schema.
- **Compliance-sensitive services** -- where every field must be documented and approved.

In strict mode, any field not defined in `data_schema` is rejected.

---

## 8. Sharing CSMs

A CSM file is just a `.yaml` file. You can share it the same way you share any document:

- **Give it to another community.** They save it, point their AI at it, and they have the same service running in their node. A Finnish `Harrastehakemisto` CSM works identically when deployed by a Swedish node or a Japanese node -- the schema is universal, only the content language changes.

- **Federation interoperability.** When two nodes run marketplace CSMs with the same base schema, their listings can appear in each other's search results (if `visibility_default` is `"federation"`). Custom fields travel along for the ride; the receiving node may not display them all, but the base fields always work.

- **Forking and customizing.** Copy a CSM, change the `service.name`, adjust the categories or fields, and you have a new service. The video directory CSM becomes a podcast library by swapping `video_url` for `audio_url` and adjusting the `allowed_formats`.

- **Community libraries.** Collections of CSM files can be published and shared. An aimeat node operator might maintain a gallery of CSMs that community members can browse and activate with a single prompt to their AI assistant.

For details on operating a node, managing multiple services, and federation configuration, see the [Service Owner Manual](./service-owner-manual.md). To package a CSM together with external API integrations as a plugin, see the [Service Owner Manual](./service-owner-manual.md) section on YAML plugins.

---

*CSM version 1.0 -- AIMEAT Protocol*
