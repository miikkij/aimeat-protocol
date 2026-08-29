# Vendored font licenses

All families are licensed under the **SIL Open Font License 1.1** (OFL),
full text: https://openfontlicense.org/open-font-license-official-text/

| Family | Version | Files | Copyright | Source |
|---|---|---|---|---|
| Baloo 2 | v23 (variable wght 400–800) | `baloo2-latin.woff2`, `baloo2-latin-ext.woff2` | © Ek Type (https://ektype.in) | https://fonts.google.com/specimen/Baloo+2 |
| Bangers | v25 | `bangers-latin.woff2`, `bangers-latin-ext.woff2` | © Vernon Adams | https://fonts.google.com/specimen/Bangers |
| Inter | v20 (variable wght 100–900) | `inter-var-latin.woff2`, `inter-var-latin-ext.woff2` | © The Inter Project Authors (https://github.com/rsms/inter) | https://fonts.google.com/specimen/Inter |
| Archivo Black | v23 (400, the only cut) | `archivo-black-latin.woff2`, `archivo-black-latin-ext.woff2` | © Omnibus-Type (https://www.omnibus-type.com) | https://fonts.google.com/specimen/Archivo+Black |
| Archivo | v23 (variable wght 400–700) | `archivo-var-latin.woff2`, `archivo-var-latin-ext.woff2` | © Omnibus-Type (https://www.omnibus-type.com) | https://fonts.google.com/specimen/Archivo |
| Space Grotesk | v22 (variable wght 300–700) | `space-grotesk-var-latin.woff2`, `space-grotesk-var-latin-ext.woff2` | © Florian Karsten (https://floriankarsten.com) | https://fonts.google.com/specimen/Space+Grotesk |
| Fraunces | v38 (variable opsz 9–144, wght 100–900) | `fraunces-var-latin.woff2`, `fraunces-var-latin-ext.woff2` | © The Fraunces Project Authors (https://github.com/undercasetype/fraunces) | https://fonts.google.com/specimen/Fraunces |
| JetBrains Mono | v24 (variable wght 100–800) | `jetbrains-mono-var-latin.woff2`, `jetbrains-mono-var-latin-ext.woff2` | © The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | https://fonts.google.com/specimen/JetBrains+Mono |
| Fjalla One | v16 (400, the only cut) | `fjalla-one-latin.woff2`, `fjalla-one-latin-ext.woff2` | © Sorkin Type (https://www.sorkintype.com) | https://fonts.google.com/specimen/Fjalla+One |
| DM Sans | v17 (variable opsz 9–40, wght 100–1000) | `dm-sans-var-latin.woff2`, `dm-sans-var-latin-ext.woff2` | © Colophon Foundry (https://www.colophon-foundry.org), Indian Type Foundry | https://fonts.google.com/specimen/DM+Sans |
| VT323 | v18 (400) | `vt323-latin.woff2`, `vt323-latin-ext.woff2` | © Peter Hull | https://fonts.google.com/specimen/VT323 |

Baloo 2 + Bangers vendored 2026-07-19 for the self-hosted `fonts` capability pack
(game/display faces, loaded via `/lib/fonts.css`). Inter, Space Grotesk, Fraunces and
JetBrains Mono vendored 2026-07-25 for the AIMEAT theme system, Archivo and Archivo Black on
2026-08-29 as the house faces, and on the same day Fjalla One (the headline face,
`--font-headline` in theme.css), DM Sans (the body fallback and the older static pages) and
VT323 (the OS front page): the last three had still been fetched from fonts.googleapis.com by
sixteen HTML files. Every `@font-face` lives in `/lib/aimeat-fonts.css`, which
`/lib/aimeat-theme.css` imports and the standalone pages link, so nothing on the node reaches
an external CDN and the CSP no longer allows one. All subsets are latin + latin-ext, so
Finnish ä/ö render.
