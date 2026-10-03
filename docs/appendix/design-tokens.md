---
title: Design tokens
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: P1 (source deck)
---

# Design tokens

Extracted from `Declarative Smart Batching Executor (1).pptx` by inspecting the Open XML directly.
Slide geometry is in inches on a 13.333 x 7.5 canvas. Colour values are the literal `srgbClr` fills
in the slide XML, not theme references.

These tokens describe the deck as it exists. They are recorded so that any rebuilt slide or new
asset is consistent, and so that the known defects in `00-deck-analysis.md` have a reference point.

## Canvas

| Property | Value |
|---|---|
| Slide size | 13.333 x 7.5 in (12192000 x 6858000 EMU) |
| Aspect | 16:9 |
| Layout in use | `Blank` on all seven slides |
| Safe margin | 0.83 in left, 0.62 in top |

## Palette

| Role | Hex | Used for |
|---|---|---|
| Background | `#090D16` | Slide base |
| Card surface | `#1E293B` | Rounded-rectangle containers |
| Card header fill | `#0F2332` | Title chip on slide 1 |
| Border | `#334155` | Card outlines |
| Accent | `#38BDF8` | Team chip, step arrows, highlights |
| Body text | `#CBD5E1` | Bullet copy |
| Muted text | `#94A3B8` | Chip text |
| Primary text | `#F8FAFC` | Titles, headers |

The theme part declares the stock Office palette (`4F81BD`, `C0504D`, `9BBB59`, `8064A2`, `4BACC6`,
`F79646`) but no slide references it. Every visible colour is an explicit literal, so re-theming the
deck requires editing each shape, not the theme.

## Typography

| Level | Size | Weight | Use |
|---|---|---|---|
| Display | 42 pt | Bold | Slide 1 title |
| Section title | 31.5 pt | Bold | Slides 2, 3, 5, 6, 7 headline |
| Slide 4 headline | 30 pt | Bold | Slightly smaller, for the longer string |
| Card heading | 22.5 pt | Bold | Two-column and card headings |
| Bullet lead | 19.5 pt | Bold | Lead phrase before the em dash |
| Body | 18.75 pt | Regular | Bullet body |
| Sub-head | 16.5 pt | Bold | Eyebrow labels, track line |
| Body small | 15.75 pt | Regular | Slide 4 mechanics bullets |
| Step heading | 16.5 pt | Bold | Pipeline step names |
| Step body | 13.5 pt | Regular | Pipeline step descriptions |
| Micro | 12 pt | Bold | `STEP n` labels |
| Mono | inherited | Bold | Formula and enum chips |

### Font risk

Every text run overrides to **Rajdhani**, while the theme's major and minor fonts are **Calibri**.
Rajdhani is a display face with unusually tight ascenders and a tall x-height; at 13.5 pt step body
text it is close to illegible on a projector. The embedded font data in the package is a single
`.fntdata` blob, so it is not clear that Rajdhani is embedded at all.

Mitigations, in order of preference: raise step body to 15 pt, keep Rajdhani for headings only, and
move body copy to Calibri or Inter. Recorded as a rebuild task in `00-deck-analysis.md`.

## Spacing and geometry

| Element | Value |
|---|---|
| Standard gutter | 0.45 in between adjacent cards |
| Full-width card | x 0.83, w 11.67 |
| Two-column card | w 5.67, at x 0.83 and x 6.83 |
| Four-step card | w 2.58, pitch 3.03 |
| Card corner radius | rounded rectangle, visually ~0.15 in |
| Bullet indent | marker at x 1.34, text at x 1.58 |
| Bullet vertical pitch | 0.91 in |
| Eyebrow baseline | y 0.62 in |
| Headline baseline | y 0.98 in |
| Card top | y 1.58 to 1.84 in |

## Step pipeline geometry (slide 4)

Four cards at pitch 3.03 in, connected by three 0.20 x 0.23 in arrow images centred at y 2.67.
Card internals are laid out as three stacked text boxes: label, heading, description.

## Reuse guidance

When rebuilding or extending the deck, hold these constants:

1. All colours as literals, or migrate everything to theme references in one pass. Do not mix.
2. Body copy never below 15 pt.
3. Bullets at 0.91 in pitch; seven bullets fit between y 2.06 and y 7.35.
4. Card tops aligned within a slide. Slide 4 currently violates this.
5. Eyebrow, headline, card top as a fixed three-row header for every content slide.