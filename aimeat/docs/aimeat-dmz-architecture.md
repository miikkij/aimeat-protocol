# Memory visibility and the DMZ model

The maintained reference is
[docs/aimeat-dmz-architecture.md](../../docs/aimeat-dmz-architecture.md).

The DMZ is a model for describing data visibility across personal, local and federated
contexts. Access decisions use the current memory visibility, ownership and consent
checks. Read the [Core specification](../../docs/AIMEAT-RFC-v4.0-Core-full.md) and
[security development guide](../../docs/coding-guidelines/security-development-dna.md)
before implementing a new access path.

This package-local entry point replaces an older second copy of the architecture.
