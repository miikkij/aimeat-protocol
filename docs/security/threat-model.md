# Security threat model

Use this map with [Security Development DNA](../coding-guidelines/security-development-dna.md)
and the [verification matrix](verification-matrix.md). The implementation and
executable checks determine which controls apply to a route.

## Assets and boundaries

| Asset | Boundary |
|---|---|
| Owner, agent and node credentials | Authentication, revocation and private-key storage |
| Memory, files and workspace records | Identity, ownership, membership, consent and scopes |
| Hosted apps | Separate origin and owner-approved app grant |
| Extension data and secrets | Extension namespace, caller authority and sandbox bridge |
| Morsel balance | One owner balance, atomic changes and transaction attribution |
| AI budget and payment credentials | Owner budget, separate monetary accounting and credential controls |
| Federation messages and identities | Trusted peer keys, signatures, replay checks and home-node identity |
| Audit and provenance | Attribution that ordinary writes cannot forge |

## Threats to test

| Caller or input | Required checks |
|---|---|
| Unauthenticated request | Public/private boundary, bounded work and rate limits |
| Another owner | Cross-owner reads and writes refused, including lists and exports |
| Scoped agent or ecosystem app | Scope and data-area checks on REST, MCP and CLI |
| Hosted app | Grant restrictions, origin isolation, no owner-token exposure |
| Federated owner with a local namesake | Resolve to the home-node GHII |
| Extension code | QuickJS-WASM sandbox, scoped memory and bounded host calls |
| Outbound URL | Shared safe-fetch path, DNS/address validation and redirect checks |
| Concurrent balance or version update | Atomic operations and conflict handling |
| Disabled account or revoked credential | Existing sessions and work paths refuse further access |

An operator role and unrestricted database or machine access are different trust
boundaries. Application permissions cannot protect against unrestricted host access.
An operator role also does not imply that every route permits access to another
owner's records.

## Current limitations

EUDIW verification is blocked at startup until holder binding and replay defenses
are implemented. See [its status](../aimeat-eudiw-integration.md).

[Known gaps](../known_gaps.md) records developer-approved deferred work.
Historical measurements in the verification matrix apply to their stated date and
commit. Run current checks before making a new security claim.
