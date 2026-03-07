# matching-behaviors

V8 sandbox extension for interest-based matching with geographic proximity scoring. Migrated from the built-in matching service (`src/services/matching.ts`).

## Overview

This extension pairs users based on shared interests, geographic proximity, recent activity, and compatibility preferences. It supports multiple instances, allowing operators to run separate matching pools (e.g., by community, topic, or region).

## Multi-Instance Support

Each instance runs an independent matching pool with its own configuration. Create instances via the extension management API with per-instance config:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | "Matching" | Display name for the instance |
| `visibility` | string | public | Access control: `public`, `password`, or `invite` |
| `password` | string | — | Required when visibility is `password` |
| `allowed_users` | array | — | GAII allowlist when visibility is `invite` |
| `max_distance_km` | number | 100 | Maximum distance for proximity scoring |
| `match_threshold` | number | 0.3 | Minimum score to create a suggestion |
| `max_suggestions` | integer | 10 | Max suggestions per profile per round |
| `cooldown_days` | integer | 7 | Days before a dismissed match can reappear |

## Actions

| Action | Auth | Description |
|--------|------|-------------|
| `create-profile` | required | Register a matching profile with display name, interests, location |
| `update-profile` | required | Update fields on an existing profile |
| `get-suggestions` | required | Retrieve current match suggestions sorted by score |
| `respond` | required | Accept or dismiss a suggestion |
| `run-matching` | operator | Execute a matching algorithm round across all profiles |

## Scoring Formula

```
match_score = 0.40 * shared_interests_score
            + 0.25 * distance_score
            + 0.20 * activity_score
            + 0.15 * compatibility_score
```

- **Shared interests** (40%): `min(shared_count / 3, 1.0)` — case-insensitive comparison
- **Distance** (25%): `max(1.0 - distance_km / max_distance_km, 0)` — haversine formula; defaults to 0.5 when location is unknown
- **Activity** (20%): `max(1.0 - days_since_active / 90, 0)` — rewards recently active profiles
- **Compatibility** (15%): ratio of seeking terms matched against the other profile's interests, city, area, or country

## Scheduled Matching

The `matching-round` schedule runs `run-matching` every 6 hours via cron (`0 */6 * * *`). Operators can also trigger rounds manually.

## Memory Key Patterns

| Pattern | Content |
|---------|---------|
| `profile.{gaii}` | User matching profile |
| `suggestion.{gaii}.{otherGaii}` | Match suggestion for a user |
| `accepted.{gaii}.{otherGaii}` | Accepted match record |

## Required APIs

- **memory** — profile and suggestion storage
- **consent** — matching consent verification
- **trust** — trust score lookups
