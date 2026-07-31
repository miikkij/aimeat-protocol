# EU icons for labelling AI-generated content

Official icon set published by the **European Commission / AI Office on 10 June 2026** as an
integral part of **Section 2 of the Code of Practice on Transparency of AI-generated Content**.
They support disclosure under **Article 50(4) of the EU AI Act**, which applies from 2 August 2026.

- **Retrieved:** 2026-08-01
- **Source page:** https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content
- **Original downloads:** SVG `https://ec.europa.eu/newsroom/dae/redirection/document/129546`
  (`LABEL_AI_GENERATED_SVG_…_129546.zip`) · PNG
  `https://ec.europa.eu/newsroom/dae/redirection/document/129547`
  (`LABEL_AI_GENERATED_PNG_…_129547.zip`)

## Licence — verbatim from the source page

> **Licence**
>
> These icons are made publicly available for everyone to use freely, without the need for
> attribution to the Commission or the AI Office. However, signatories of the code of practice
> should use the icon in accordance with its placement specifications. Usage of these icons by
> non-signatories of the code should not be construed as signaling of their adherence to the code.

And, on what the icons do and do not achieve:

> The use of these EU icons is optional, but the labelling requirements under Article 50 AI Act are
> not. The use of these icons does not establish legal compliance by itself. Deployers remain
> responsible for ensuring that any disclosure meets the requirements of Article 50 AI Act.
> Signatories of the Code of Practice on marking and labelling of AI-generated content must duly
> implement the measures it contains.

**Two consequences for us.** Using the icons is free and needs no attribution, so there is no
dependency or licensing question. But using them says nothing about being a Code of Practice
signatory, and must never be presented as if it did.

## What is here

Twelve SVG files: three icons in four variations each.

| Icon | Files | Aspect | Use it when |
|------|-------|--------|-------------|
| **Basic** | `ai-basic_*.svg` | **1:1** (square) | AI was involved in a deepfake or published text, and a custom text label or an interactive second layer carries the detail |
| **Fully AI-Generated** | `ai-generated_*.svg` | **≈3.16:1** (wide lockup) | The whole item is AI-generated with no human-created elements and no editorial control beyond prompting |
| **Partially AI-Modified** | `ai-modified_*.svg` | **3:1** (wide lockup) | Pre-existing human-made content was partially modified with AI |

Variations: `_black`, `_white`, `_black-transparent`, `_white-transparent` (the transparent variants
are the 50%-opacity versions, meant for placement over imagery).

**These are lockups, not glyphs.** Only the basic icon is square; the other two are wide badges
containing the words. Any CSS that assumes a square icon box will distort them — size them by
width with `aspect-ratio` or `height: auto`.

## Filenames

Renamed from the official ones to lower-case, space-free names so they are usable in URLs without
escaping. The official archives are kept unmodified in `docs/internal/EUAct/reference/`.

Original → here:

```
LABEL_AI_black.svg                      → ai-basic_black.svg
LABEL_AI GENERATED_black.svg            → ai-generated_black.svg
LABEL_AI MOFIFIED_black.svg             → ai-modified_black.svg     ← note: typo in the official file name
```

The official SVG archive ships `LABEL_AI MOFIFIED_black.svg` (`MOFIFIED`). Anything matching
official filenames by pattern has to allow for it; our renamed copies do not.

## PNG

Not kept here. The official PNGs are 7,000+ pixels wide (~1.3 MB for the set) and the web surfaces
use SVG. If a raster is needed later (email, where SVG support is unreliable), generate it at the
size actually used from these SVGs, or take it from the archive in
`docs/internal/EUAct/reference/`.

## Placement rules that come with the icons

From the source page (summary, not the complete rules — Section 2 of the Code has the full
placement specifications):

- Clearly perceivable and distinguishable **at the latest at first exposure** to the deepfake or
  published text.
- Placed **where no intervening overlay elements exist**.
- **Directly embedded** into the content (except for creative works), unless an equivalent
  alternative such as a user-interface overlay is available, and **visible when the content is
  reshared or downloaded**.
- Clearly visible size; accompanying label in plain language, avoiding jargon and abbreviations
  other than "AI".
- Readable by assistive technology via **alt text or ARIA labels** stating that the content is
  AI-generated or manipulated.
- If shown for a limited time, visible long enough to be read by users with cognitive or processing
  difficulties.
- If a second interactive layer carries more information, the icon indicates that it exists, and
  that layer is navigable with assistive technology.

User testing behind the design found that **the basic icon performed better on every measure when
it was accompanied by a text label**. Our components pair icon and text for that reason, not only
for accessibility.

## Related

- Integration design: `docs/internal/EUAct/15-eu-label-icons.md`
- Code of Practice measures: `docs/internal/EUAct/14-code-of-practice-measures.md`
