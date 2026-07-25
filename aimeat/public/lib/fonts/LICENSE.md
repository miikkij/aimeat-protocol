# Vendored font licenses

All families are licensed under the **SIL Open Font License 1.1** (OFL),
full text: https://openfontlicense.org/open-font-license-official-text/

| Family | Version | Files | Copyright | Source |
|---|---|---|---|---|
| Baloo 2 | v23 (variable wght 400–800) | `baloo2-latin.woff2`, `baloo2-latin-ext.woff2` | © Ek Type (https://ektype.in) | https://fonts.google.com/specimen/Baloo+2 |
| Bangers | v25 | `bangers-latin.woff2`, `bangers-latin-ext.woff2` | © Vernon Adams | https://fonts.google.com/specimen/Bangers |
| Inter | v20 (variable wght 100–900) | `inter-var-latin.woff2`, `inter-var-latin-ext.woff2` | © The Inter Project Authors (https://github.com/rsms/inter) | https://fonts.google.com/specimen/Inter |
| Space Grotesk | v22 (variable wght 300–700) | `space-grotesk-var-latin.woff2`, `space-grotesk-var-latin-ext.woff2` | © Florian Karsten (https://floriankarsten.com) | https://fonts.google.com/specimen/Space+Grotesk |
| Fraunces | v38 (variable opsz 9–144, wght 100–900) | `fraunces-var-latin.woff2`, `fraunces-var-latin-ext.woff2` | © The Fraunces Project Authors (https://github.com/undercasetype/fraunces) | https://fonts.google.com/specimen/Fraunces |
| JetBrains Mono | v24 (variable wght 100–800) | `jetbrains-mono-var-latin.woff2`, `jetbrains-mono-var-latin-ext.woff2` | © The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | https://fonts.google.com/specimen/JetBrains+Mono |

Baloo 2 + Bangers vendored 2026-07-19 for the self-hosted `fonts` capability pack
(game/display faces, loaded via `/lib/fonts.css`). Inter, Space Grotesk, Fraunces and
JetBrains Mono vendored 2026-07-25 for the AIMEAT theme system — `/lib/aimeat-theme.css`
declares their `@font-face` rules and each palette names its display/body/mono faces, so
apps load them implicitly and never from an external CDN (the app CSP forbids
cross-origin font loads). All subsets are latin + latin-ext, so Finnish ä/ö render.
