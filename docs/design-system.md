# Design system

The visual language both pages share: colour, type, geometry, motion.

Values are measured from a reference design kit, not chosen.

---

## Color

Three layers. Pick from the lowest layer that answers the question.

### Palette

Twelve hues and six greys. Each entry has a `-hi` partner, the increased-contrast value.

| Token | Dark | Dark `-hi` | Light | Light `-hi` |
| --- | --- | --- | --- | --- |
| `--sy-red` | ![](https://img.shields.io/badge/-%20-FF4245) `#FF4245` | ![](https://img.shields.io/badge/-%20-FF6165) `#FF6165` | ![](https://img.shields.io/badge/-%20-FF383C) `#FF383C` | ![](https://img.shields.io/badge/-%20-D70015) `#D70015` |
| `--sy-orange` | ![](https://img.shields.io/badge/-%20-FF9230) `#FF9230` | ![](https://img.shields.io/badge/-%20-FFA056) `#FFA056` | ![](https://img.shields.io/badge/-%20-FF8D28) `#FF8D28` | ![](https://img.shields.io/badge/-%20-C93400) `#C93400` |
| `--sy-yellow` | ![](https://img.shields.io/badge/-%20-FFD600) `#FFD600` | ![](https://img.shields.io/badge/-%20-FEDF43) `#FEDF43` | ![](https://img.shields.io/badge/-%20-FFCC00) `#FFCC00` | ![](https://img.shields.io/badge/-%20-B25000) `#B25000` |
| `--sy-green` | ![](https://img.shields.io/badge/-%20-30D158) `#30D158` | ![](https://img.shields.io/badge/-%20-4AD968) `#4AD968` | ![](https://img.shields.io/badge/-%20-34C759) `#34C759` | ![](https://img.shields.io/badge/-%20-248A3D) `#248A3D` |
| `--sy-mint` | ![](https://img.shields.io/badge/-%20-00DAC3) `#00DAC3` | ![](https://img.shields.io/badge/-%20-54DFCB) `#54DFCB` | ![](https://img.shields.io/badge/-%20-00C8B3) `#00C8B3` | ![](https://img.shields.io/badge/-%20-0C817B) `#0C817B` |
| `--sy-teal` | ![](https://img.shields.io/badge/-%20-00D2E0) `#00D2E0` | ![](https://img.shields.io/badge/-%20-3BDDEC) `#3BDDEC` | ![](https://img.shields.io/badge/-%20-00C3D0) `#00C3D0` | ![](https://img.shields.io/badge/-%20-0071A4) `#0071A4` |
| `--sy-cyan` | ![](https://img.shields.io/badge/-%20-3CD3FE) `#3CD3FE` | ![](https://img.shields.io/badge/-%20-6DD9FF) `#6DD9FF` | ![](https://img.shields.io/badge/-%20-00C0E8) `#00C0E8` | ![](https://img.shields.io/badge/-%20-007AA3) `#007AA3` |
| `--sy-blue` | ![](https://img.shields.io/badge/-%20-0091FF) `#0091FF` | ![](https://img.shields.io/badge/-%20-5CB8FF) `#5CB8FF` | ![](https://img.shields.io/badge/-%20-0088FF) `#0088FF` | ![](https://img.shields.io/badge/-%20-0040DD) `#0040DD` |
| `--sy-indigo` | ![](https://img.shields.io/badge/-%20-6D7CFF) `#6D7CFF` | ![](https://img.shields.io/badge/-%20-A7AAFF) `#A7AAFF` | ![](https://img.shields.io/badge/-%20-6155F5) `#6155F5` | ![](https://img.shields.io/badge/-%20-3634A3) `#3634A3` |
| `--sy-purple` | ![](https://img.shields.io/badge/-%20-DB34F2) `#DB34F2` | ![](https://img.shields.io/badge/-%20-EA8DFF) `#EA8DFF` | ![](https://img.shields.io/badge/-%20-CB30E0) `#CB30E0` | ![](https://img.shields.io/badge/-%20-8944AB) `#8944AB` |
| `--sy-pink` | ![](https://img.shields.io/badge/-%20-FF375F) `#FF375F` | ![](https://img.shields.io/badge/-%20-FF8AC4) `#FF8AC4` | ![](https://img.shields.io/badge/-%20-FF2D55) `#FF2D55` | ![](https://img.shields.io/badge/-%20-C9155A) `#C9155A` |
| `--sy-brown` | ![](https://img.shields.io/badge/-%20-B78A66) `#B78A66` | ![](https://img.shields.io/badge/-%20-DBA679) `#DBA679` | ![](https://img.shields.io/badge/-%20-AC7F5E) `#AC7F5E` | ![](https://img.shields.io/badge/-%20-7F6545) `#7F6545` |
| `--sy-gray` | ![](https://img.shields.io/badge/-%20-8E8E93) `#8E8E93` | ![](https://img.shields.io/badge/-%20-AEAEB2) `#AEAEB2` | ![](https://img.shields.io/badge/-%20-8E8E93) `#8E8E93` | ![](https://img.shields.io/badge/-%20-6C6C70) `#6C6C70` |
| `--sy-gray2` | ![](https://img.shields.io/badge/-%20-636366) `#636366` | ![](https://img.shields.io/badge/-%20-7C7C80) `#7C7C80` | ![](https://img.shields.io/badge/-%20-AEAEB2) `#AEAEB2` | ![](https://img.shields.io/badge/-%20-8E8E93) `#8E8E93` |
| `--sy-gray3` | ![](https://img.shields.io/badge/-%20-48484A) `#48484A` | ![](https://img.shields.io/badge/-%20-545456) `#545456` | ![](https://img.shields.io/badge/-%20-C7C7CC) `#C7C7CC` | ![](https://img.shields.io/badge/-%20-AEAEB2) `#AEAEB2` |
| `--sy-gray4` | ![](https://img.shields.io/badge/-%20-3A3A3C) `#3A3A3C` | ![](https://img.shields.io/badge/-%20-444446) `#444446` | ![](https://img.shields.io/badge/-%20-D1D1D6) `#D1D1D6` | ![](https://img.shields.io/badge/-%20-BCBCC0) `#BCBCC0` |
| `--sy-gray5` | ![](https://img.shields.io/badge/-%20-2C2C2E) `#2C2C2E` | ![](https://img.shields.io/badge/-%20-363638) `#363638` | ![](https://img.shields.io/badge/-%20-E5E5EA) `#E5E5EA` | ![](https://img.shields.io/badge/-%20-D8D8DC) `#D8D8DC` |
| `--sy-gray6` | ![](https://img.shields.io/badge/-%20-1C1C1E) `#1C1C1E` | ![](https://img.shields.io/badge/-%20-242426) `#242426` | ![](https://img.shields.io/badge/-%20-F2F2F7) `#F2F2F7` | ![](https://img.shields.io/badge/-%20-EBEBF0) `#EBEBF0` |

Grey order reverses between themes: `gray6` is darkest in dark, lightest in light.

Rules never name a palette entry. They name a role or a semantic token.

### Roles

What a colour is for. Each role resolves to a palette entry.

| Token | Dark | Light |
| --- | --- | --- |
| `--accent` | ![](https://img.shields.io/badge/-%20-00D2E0) `--sy-teal` `#00D2E0` | ![](https://img.shields.io/badge/-%20-0071A4) `--sy-teal-hi` `#0071A4` |
| `--accent-strong` | ![](https://img.shields.io/badge/-%20-3BDDEC) `--sy-teal-hi` `#3BDDEC` | ![](https://img.shields.io/badge/-%20-00587E) `#00587E` |
| `--danger` | ![](https://img.shields.io/badge/-%20-FF4245) `--sy-red` `#FF4245` | ![](https://img.shields.io/badge/-%20-D70015) `--sy-red-hi` `#D70015` |
| `--warning` | ![](https://img.shields.io/badge/-%20-FF9230) `--sy-orange` `#FF9230` | ![](https://img.shields.io/badge/-%20-C93400) `--sy-orange-hi` `#C93400` |
| `--success` | ![](https://img.shields.io/badge/-%20-30D158) `--sy-green` `#30D158` | ![](https://img.shields.io/badge/-%20-238539) `--sy-green-hi` `#238539` |
| `--info` | ![](https://img.shields.io/badge/-%20-0091FF) `--sy-blue` `#0091FF` | ![](https://img.shields.io/badge/-%20-0040DD) `--sy-blue-hi` `#0040DD` |
| `--on-fill` | ![](https://img.shields.io/badge/-%20-000000) `#000000` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--on-tint` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--on-tint-dark` | ![](https://img.shields.io/badge/-%20-000000) `#000000` | ![](https://img.shields.io/badge/-%20-000000) `#000000` |

Light hues are drawn for a fill, so a light role that becomes text or the edge of a control points at the `-hi` entry. Use `--accent-strong` wherever the accent has to be read as text.

`--on-fill` is the ink on a control filled with a role colour. It is dark in the dark theme and white in the light theme, because the fill moves the other way. It is not a label level. White on the dark hues fails 1.4.3: the accent measures 1.86, the success green 2.02, the danger red 3.43.

`--on-tint` is the ink on a fill this project does not choose, such as the colour a user picks for an app. The fill is unknown, so the ink is a pair rather than a value. The renderer measures the fill's luminance and takes whichever of `--on-tint` and `--on-tint-dark` gives the better ratio. Both are opaque. White alone fails 1.4.3 on seven of the eight colours the picker offers: the palette yellow measures 1.50 and the green 2.22.

### Semantic

What a colour is applied to.

| Token | Dark | Light |
| --- | --- | --- |
| `--label-primary` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` | ![](https://img.shields.io/badge/-%20-000000) `#000000` |
| `--label-secondary` | `rgba(235,235,245,.70)` | `rgba(60,60,67,.60)` |
| `--label-tertiary` | `rgba(235,235,245,.30)` | `rgba(60,60,67,.30)` |
| `--label-quaternary` | `rgba(235,235,245,.16)` | `rgba(60,60,67,.18)` |
| `--fill-primary` | `rgba(120,120,128,.36)` | `rgba(120,120,128,.20)` |
| `--fill-secondary` | `rgba(120,120,128,.32)` | `rgba(120,120,128,.16)` |
| `--fill-tertiary` | `rgba(118,118,128,.24)` | `rgba(118,118,128,.12)` |
| `--fill-quaternary` | `rgba(118,118,128,.18)` | `rgba(116,116,128,.08)` |
| `--separator` | `rgba(255,255,255,.17)` | `rgba(0,0,0,.12)` |
| `--separator-opaque` | ![](https://img.shields.io/badge/-%20-38383A) `#38383A` | ![](https://img.shields.io/badge/-%20-C6C6C8) `#C6C6C8` |
| `--bg-primary` | ![](https://img.shields.io/badge/-%20-000000) `#000000` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--bg-secondary` | ![](https://img.shields.io/badge/-%20-1C1C1E) `--sy-gray6` | ![](https://img.shields.io/badge/-%20-F2F2F7) `--sy-gray6` |
| `--bg-tertiary` | ![](https://img.shields.io/badge/-%20-2C2C2E) `--sy-gray5` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--bg-elevated-primary` | ![](https://img.shields.io/badge/-%20-1C1C1E) `--sy-gray6` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--bg-elevated-secondary` | ![](https://img.shields.io/badge/-%20-2C2C2E) `--sy-gray5` | ![](https://img.shields.io/badge/-%20-F2F2F7) `--sy-gray6` |
| `--bg-elevated-tertiary` | ![](https://img.shields.io/badge/-%20-3A3A3C) `--sy-gray4` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--sy-a11y-dim` | ![](https://img.shields.io/badge/-%20-A3A3A8) `#A3A3A8` | ![](https://img.shields.io/badge/-%20-6C6C70) `--sy-gray-hi` |
| `--sy-a11y-border` | ![](https://img.shields.io/badge/-%20-838387) `#838387` | ![](https://img.shields.io/badge/-%20-8E8E93) `--sy-gray` |
| `--bg-primary-light` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |
| `--control-knob` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` | ![](https://img.shields.io/badge/-%20-FFFFFF) `#FFFFFF` |

Labels are text in descending prominence. Fills are the tint behind a small control, not the dashboard's glass: the glass is white at low alpha over a wallpaper, a fill is grey-tinted and assumes an opaque surface. The elevated backgrounds are the same three surfaces drawn over a sheet. `--bg-primary-light` is the opt-in light widget card.

> [!WARNING]
> Label levels below primary do not clear WCAG on this project's cards. Use `--sy-a11y-dim` for text that has to be read on a card, and `--sy-a11y-border` for a control edge. Label levels carry hierarchy only.

### Themes

Dark is the default, declared on `:root`. Light redeclares the palette, roles and semantic sets under `html[data-theme="light"]`, set on `<html>`. Only the Settings page opts in.

`prefers-contrast: more` swaps every hue and grey to its `-hi` partner, in whichever theme is in force.

---

## Typography

One stack everywhere, held by `--font-ui`:

```css
-apple-system, BlinkMacSystemFont, system-ui, sans-serif
```

`monospace` is the exception, for code spans in admin hints. Do not name an optical cut; the stack picks the cut for the size it is drawn at, and naming one pins it.

Eleven styles, three tokens each: `--fs-<style>`, `--lh-<style>`, `--tr-<style>`. Sizes in px, leading unitless, tracking in `em`.

| Style | Default | Small step | Tracking |
| --- | --- | --- | --- |
| `large-title` | 34/41 | 32/39 | 0.40 |
| `title-1` | 28/34 | 26/32 | 0.38 |
| `title-2` | 22/28 | 20/24 | -0.26 |
| `title-3` | 20/25 | 18/23 | -0.45 |
| `headline` | 17/22 | 15/20 | -0.43 |
| `body` | 17/22 | 15/20 | -0.43 |
| `callout` | 16/21 | 14/19 | -0.31 |
| `subheadline` | 15/20 | 13/18 | -0.23 |
| `footnote` | 13/18 | 12/16 | -0.08 |
| `caption-1` | 12/16 | 11/13 | 0 |
| `caption-2` | 11/13 | 11/13 | 0.06 |

Set all three tokens of a style together. A size from the scale with leading from elsewhere is a style that looks applied and is not.

```css
.rl {
  font-size:      var(--fs-footnote);
  line-height:    var(--lh-footnote);
  letter-spacing: var(--tr-footnote);
}
```

Tracking is one absolute px value per style, republished per step as its own `em`. Headline is Body at semibold; `--fw-headline` carries the weight.

The small step is opt-in per page via a class on `<html>`, and never applies on a phone. The Settings page carries it, so a settings row is 15 on a desktop and 17 on a phone.

<details>
<summary>Style assignments on the Settings page</summary>

| Element | Style |
| --- | --- |
| Settings rows, sidebar items, inline inputs | `body` |
| Row subtitles, menu items, the toast, the login subtitle | `subheadline` |
| Group and dialog headers, group footers and hints | `footnote` |
| Segmented options, dialog body text, small glyph buttons | `footnote` |
| The version line and the mobile tab bar | `caption-2` |

A single character centred in a fixed box takes no text leading or tracking. An uppercase separator label keeps its own positive tracking.

</details>

---

## Layout

The Settings surface is a column of grouped rows. Everything aligns to the row label at 16.

| | |
| --- | --- |
| Row | 52 tall, 68 carrying two lines |
| Row padding | 16 each side |
| Separator | 1 tall, inset 16 leading, flush trailing |
| Group header and footer | text inset 16 |
| Group to the next heading | about 34 |
| Page margin | 16 on a phone, 20 otherwise |
| Sidebar | 320 wide, 44 items |

### Spacing

`--sp-2` `--sp-4` `--sp-6` `--sp-8` `--sp-10` `--sp-12` `--sp-16` `--sp-20` `--sp-24` `--sp-32` `--sp-44`, each naming its own value in px.

Use a step. A rule needing a value that is not one is either a step nobody has added or a number nobody chose deliberately; say which in the rule.

The stylesheets predate the scale and still hold spacing as literals. Rules move onto the scale as they are edited, not in a single pass: about a fifth of the existing values sit off any rhythm, and rounding them would move the layout everywhere for no gain a reader could name.

## Controls

| Control | Track | Handle |
| --- | --- | --- |
| Switch | 64 × 28 | 38 × 24 capsule, inset 2, travels 22 |
| Slider | 6 tall | 20 round, one design everywhere |
| Segmented | 32 tall, capsule | 28 segments |
| Alert button | 48 tall, capsule | |
| Sidebar selection | 44 tall, pill | |
| Tab bar selection | full tab, radius 16 | |

A capsule is a radius of half the height. The switch knob is a capsule too, not a circle.

On touch a control keeps its drawn size and gains a 44 hit area on top. A small button stays 30 and a slider stays 6.

> [!WARNING]
> Sizing the box itself to 44 turns every inline action into a slab and pushes it away from the text it belongs to. A slider padded out to 44 also needs its two radii set separately, or clipping the paint back to the track tapers the ends to a point.

## Corners

| Token | Value | Applies to |
| --- | --- | --- |
| `--sy-radius-group` | 26 | Grouped lists only |
| `--sy-radius-lg` | 14 | Panel, dialogs, toast |
| `--sy-radius-md` | 10 | Buttons, inputs, menus, popovers |

Anything whose size varies derives its corner instead of naming a token. An app icon rounds to 22.37% of its width, because the grid draws it at 72 with a label and 78 without. A widget tile is 28 at design size and scales with the tile.

---

## Motion

| Preference | Effect |
| --- | --- |
| Default transition | 0.15s ease |
| `prefers-reduced-motion: reduce` | Transitions and animations drop to 0.01ms, one iteration, instant scrolling |
| `prefers-reduced-transparency: reduce` | Backdrop blur is removed, motion is kept |

Reduced motion uses 0.01ms rather than 0, because a duration of exactly 0 skips the transition-end event that some interactions wait on.

---

## Widgets

A widget is a separate document in an iframe. It keeps its own stylesheet and cannot name a token, so it carries raw values.

| | |
| --- | --- |
| Colour | A palette value, or a registered bespoke colour with a stated source |
| Face | The same font stack, spelled the same way |
| Size | Off the type scale; the scale stops at 11 and the densest tiles reach 6.5 |

Bespoke colours are brand colours, third-party data scales and artwork. An entry is removed once nothing uses it.

<details>
<summary>Page-scoped tokens</summary>

A surface particular to one page is declared in that page's own `:root`, with light values under the same theme attribute. Not part of the system.

| Page | Tokens |
| --- | --- |
| Settings | `--pane`, `--cp` |
| Dashboard | `--glass-bg`, `--dock-bg` |

The Settings page scopes two more families.

| Family | Tokens | Use |
| --- | --- | --- |
| Overlays | `--ov-soft`, `--ov`, `--ov-strong`, `--field-fill`, `--track-off` | A tint over whatever surface a control sits on. White over dark, black over light |
| Elevation | `--shadow-pop`, `--shadow-dlg`, `--shadow-login`, `--shadow-ghost`, `--shadow-bar`, `--shadow-knob`, `--shadow-tog`, `--shadow-sunken` | A shadow over a dark surface reads as depth; the same shadow over a light one reads as dirt |

</details>

---

## Rules

1. Never write a colour literal outside the token file.
2. Never name a palette accent in a rule. Name a role or a semantic token. The greys, the radii and the accessibility tokens are addressed directly on purpose: they have no role layer above them.
3. Set a text style's three tokens together.
4. `--on-tint` is the ink on a user-chosen coloured fill, where no token can describe what is underneath. Take it from the fill's measured luminance, never as a fixed value, and never with alpha.
5. A control filled with a role colour takes `--on-fill`. `ui/test/contrast.test.mjs` measures every such pair in both themes.
