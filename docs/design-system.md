# Design system

The visual system both pages share. It lives in `ui/css/tokens.css`.

Values are measured from a reference design kit, not chosen.

## The three colour layers

Pick from the lowest layer that answers the question.

**Palette.** Twelve hues and six greys, named by hue: `--sy-teal`, `--sy-red`, `--sy-gray4`. Each has a `-hi` partner holding an increased-contrast value. The `prefers-contrast: more` block swaps the palette to the `-hi` set.

Do not name a palette entry in a rule.

**Roles.** What a colour is for: `--accent`, `--danger`, `--warning`, `--success`. Each points at a hue.

`--on-accent` is the ink on a filled control. It is white in both themes. It is not a label level.

**Semantic.** What a colour is applied to.

| Set | Tokens | Use |
| --- | --- | --- |
| Labels | `--label-primary`, `--label-secondary`, `--label-tertiary`, `--label-quaternary` | Text, in descending prominence |
| Fills | `--fill-primary` through `--fill-quaternary` | The tint behind a small control |
| Separators | `--separator`, `--separator-opaque` | Dividing content |
| Backgrounds | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` | The three layered surfaces |
| Backgrounds, elevated | `--bg-elevated-primary`, `--bg-elevated-secondary`, `--bg-elevated-tertiary` | The same three, over a sheet |

`--bg-primary-light` is the opt-in light widget card. `--control-knob` is a slider or switch knob, full white in both themes.

## Themes

The dark theme is declared on `:root`. The light theme redeclares the palette, the roles and the semantic sets under `html[data-theme="light"]`. A page opts in by carrying the attribute. Only the Settings page does.

No stylesheet declares a `prefers-color-scheme` rule. `ui/js/admin-theme.js` writes the attribute before the first paint, from `localStorage` under `sy-theme`: `system`, `light` or `dark`. `system` is resolved in script. `ui/js/theme.js` holds the same logic for the running page and `ui/test/theme.test.mjs` holds the two together.

The choice is per device. It is never written to the config.

Light hues are drawn for a fill. A role that ends up as text or as the edge of a control points at the `-hi` entry, the accessible variant of the same hue. `--accent` is one of them.

`prefers-contrast: more` raises whichever theme is in force. `ui/test/contrast.test.mjs` measures every required pair in four combinations: each theme, raised and not.

## Two limits on the semantic layer

**Label levels below primary do not clear WCAG on this project's cards.** Use `--sy-a11y-dim` for text that has to be read on a card. Use a label level for hierarchy.

**The dashboard's glass is not built from Fills.** The glass is white at low alpha over a wallpaper. Fills are grey-tinted and assume an opaque surface.

## The face

One stack, everywhere:

```css
-apple-system, BlinkMacSystemFont, system-ui, sans-serif
```

`--font-ui` holds it. `ui/test/font-stack.test.mjs` fails on any other spelling, including in the widget guide and the widget template.

Do not name an optical cut. The stack picks the cut for the size it is drawn at. Naming a cut pins one.

`monospace` is the exception, for code spans in the admin hints.

## Type

Eleven styles at the default step. Three tokens each: `--fs-<style>`, `--lh-<style>`, `--tr-<style>`.

| Style | Size | Leading | Tracking |
| --- | --- | --- | --- |
| `large-title` | 34 | 41 | 0.40 |
| `title-1` | 28 | 34 | 0.38 |
| `title-2` | 22 | 28 | -0.26 |
| `title-3` | 20 | 25 | -0.45 |
| `headline` | 17 | 22 | -0.43 |
| `body` | 17 | 22 | -0.43 |
| `callout` | 16 | 21 | -0.31 |
| `subheadline` | 15 | 20 | -0.23 |
| `footnote` | 13 | 18 | -0.08 |
| `caption-1` | 12 | 16 | 0 |
| `caption-2` | 11 | 13 | 0.06 |

Headline is Body at semibold. `--fw-headline` carries the weight.

Set all three tokens together. `ui/test/type-scale.test.mjs` fails on a size without its leading and tracking.

```css
.rl {
  font-size:      var(--fs-footnote);
  line-height:    var(--lh-footnote);
  letter-spacing: var(--tr-footnote);
}
```

Leading is unitless and tracking is in `em`, never pixels. Sizes are multiplied by `var(--sc)` and a reader can zoom, so both have to follow the size in use.

On the admin page:

| Element | Style |
| --- | --- |
| Settings rows, sidebar items, inline inputs | `body` |
| Row subtitles, menu items, the toast, the login subtitle | `subheadline` |
| Group and dialog headers, group footers and hints | `footnote` |
| Segmented options, dialog body text, small glyph buttons | `footnote` |
| The version line and the mobile tab bar | `caption-2` |

### Steps

The same eleven styles at smaller sizes, never a size chosen outside the scale. A page opts in with a class on `<html>`, and the step applies only where the layout is not a phone. The admin page carries `type-small`, so a settings row is 15 on a desktop and 17 on a phone.

| Style | Default | Small |
| --- | --- | --- |
| `title-3` | 20/25 | 18/23 |
| `body`, `headline` | 17/22 | 15/20 |
| `callout` | 16/21 | 14/19 |
| `subheadline` | 15/20 | 13/18 |
| `footnote` | 13/18 | 12/16 |
| `caption-1` | 12/16 | 11/13 |

Tracking is republished per step. There is one absolute tracking per style, so the em that reproduces -0.43 at 17 does not reproduce it at 15.

Adding a step is eleven declarations and an entry in `ui/test/type-scale.test.mjs`.

### Off the scale

Six rules do not use it, on purpose.

- `.rico`, `.icon-prev`, `.fp-ic`, `.ipv`, `.kv-box::after` centre a single character in a fixed box. A text leading and tracking would push it off centre.
- `.bsep` is an uppercase separator label. Uppercase needs positive tracking. `.dlg-sec` and `.sr-section` keep their own tracking and take their size from the scale.

## Control geometry

`ui/test/control-geometry.test.mjs` holds these.

| | |
| --- | --- |
| Settings row | 52 tall |
| Row carrying two lines | 68 tall |
| Row side padding | 16 |
| Separator | 1 tall, inset 16 leading, flush trailing |
| Grouped list radius | 26, as `--sy-radius-group` |
| Switch | 64 × 28, knob 38 × 24 inset 2, travel 22 |
| Slider | track 6, knob 20, one design for all |
| Outer margin | 16 on a phone, 20 otherwise |
| Group header and footer | text inset 16 |
| Sidebar | 320 wide, items 44 tall, selection a full pill |
| Tab bar selection | covers the whole tab, radius 16 |
| Segmented control | 32 track, 28 segments, capsule |
| Alert buttons | 48 tall, capsule |
| App icon corner | 22.37% of the icon's width |
| Widget tile corner | 28 at design size, scaled with the tile |
| Between a group and the next heading | about 34 |
| Small button on touch | drawn at 30, hit area extended to 44 |

The switch knob is a capsule, not a circle.

On touch a slider is padded out to a 44 target and the paint is clipped back to the track. Clipping to the content box shrinks each corner by the padding on that axis. The padding is vertical only, so set the two radii separately. A single radius draws ends that taper to a point.

Only the grouped list is rounded to `--sy-radius-group`. The panel, the dialogs and the toast keep `--sy-radius-lg`.

Derive a radius that rounds something whose size varies. An app icon is drawn at 72 with a label and 78 without, and a widget tile scales with the dashboard.

`.btn.sm` outranks `.ic`. Name an icon button again in the touch block or it takes a text button's side padding.

The choice rows draw a segmented control on radio inputs. The inputs stay: the form reads them and a screen reader announces them. The input is 0 by 0, so the segment wears the focus ring.

The group keeps `overflow: visible` so a dropdown can escape it. The first and last visible rows carry the corner radius themselves, or a row's hover fill squares off the corners.

## Widgets

A widget is a separate document in an iframe. It keeps its own stylesheet, does not load `tokens.css`, and cannot name a token. It carries the values instead.

**Colour.** Every colour must be a palette value or be listed in `ui/test/widget-colours.test.mjs` with what it is. A second test removes an entry once nothing uses it.

**The face.** A widget spells the font stack the same way as everything else.

**Size.** Widget text is not on the type scale. The scale stops at 11 and the densest tiles go to 6.5. Sizes are snapped to a step where one is within a point.

## Page-scoped tokens

A surface particular to one page is declared in that page's own `:root`, and its light values in the same file under `html[data-theme="light"]`. `--pane` and `--cp` on the admin page, `--glass-bg` and `--dock-bg` on the dashboard. These are not part of the system.

The admin page scopes two more families there.

| Family | Tokens | Use |
| --- | --- | --- |
| Overlays | `--ov-soft`, `--ov`, `--ov-strong`, `--field-fill`, `--track-off` | A tint over whatever surface a control sits on. White over dark, black over light |
| Elevation | `--shadow-pop`, `--shadow-dlg`, `--shadow-login`, `--shadow-ghost`, `--shadow-bar`, `--shadow-knob`, `--shadow-tog`, `--shadow-sunken` | A shadow over a dark surface is depth; the same shadow over a light one is dirt |

## Rules

A colour written as a literal outside `tokens.css` fails `ui/test/css-tokens.test.mjs`. The same test checks that every `var()` names a token that exists. `ui/test/palette-values.test.mjs` pins each palette entry to its reference value.

`#fff` and `#000` are allowed as ink on an arbitrary coloured fill, where the colour underneath is user-chosen and no token can describe it. On the admin page `--on-accent` names that ink.
