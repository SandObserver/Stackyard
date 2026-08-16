# Design system

The visual system both pages share. It lives in `ui/css/tokens.css`.

Values come from Apple's iOS, iPadOS and macOS design kits. Both the dashboard and the settings page follow iOS on a phone and iPadOS on a tablet or desktop.

Dark values only. No stylesheet declares a `prefers-color-scheme` rule.

## The three colour layers

Pick from the lowest layer that answers the question.

**Palette.** The system colours named by hue: `--sy-teal`, `--sy-red`, `--sy-gray4`. Twelve hues and six greys. Each has a `-hi` partner holding an increased-contrast value, and the `prefers-contrast: more` block swaps the whole palette to the `-hi` set.

A rule should not name a palette entry directly. The palette exists so the layers above it have something to point at.

**Roles.** What a colour is for: `--accent`, `--danger`, `--warning`, `--success`. Each points at a hue. Changing the accent is one line.

**Semantic.** What a colour is applied to, in the kit's own sets.

| Set | Tokens | Use |
| --- | --- | --- |
| Labels | `--label-primary`, `--label-secondary`, `--label-tertiary`, `--label-quaternary` | Text, in descending prominence |
| Fills | `--fill-primary` through `--fill-quaternary` | The tint behind a small control |
| Separators | `--separator`, `--separator-opaque` | Dividing content |
| Backgrounds | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` | The three layered surfaces |
| Backgrounds, elevated | `--bg-elevated-primary`, `--bg-elevated-secondary`, `--bg-elevated-tertiary` | The same three, for content over a sheet |

Two singletons sit beside them. `--bg-primary-light` is the opt-in light widget card, the one surface that renders in the light theme. `--control-knob` is the white of a knob on a slider or a switch, which is drawn at full white in both themes.

## Two limits on the semantic layer

**Label levels below primary do not clear WCAG on this project's cards.** The ramp assumes the surfaces it was drawn against. Use `--sy-a11y-dim` for text that has to be read on a card; use a label level for hierarchy. `ui/test/contrast.test.mjs` computes the ratios and fails on a regression, so this is enforced rather than remembered.

**The dashboard's glass is not built from Fills.** Its overlays are pure white at low alpha over a wallpaper. The kit's fills are grey-tinted and assume an opaque surface beneath. Substituting one for the other changes the look.

## Type

Eleven text styles, at the default Dynamic Type step. Three tokens each: `--fs-<style>`, `--lh-<style>`, `--tr-<style>`.

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

Set all three tokens together. A size without its leading and tracking is a third of a style, and `ui/test/type-scale.test.mjs` fails on it.

```css
.rl {
  font-size:      var(--fs-footnote);
  line-height:    var(--lh-footnote);
  letter-spacing: var(--tr-footnote);
}
```

Line height is stored unitless and tracking in `em`, not as the published pixel values. The dashboard multiplies its sizes by `var(--sc)` and a reader can zoom; a ratio and an em follow the size they are used with, where a pixel leading would hold still and the style would come apart at every size but the default. The test multiplies each ratio back out and checks it still lands on the published pair.

On the admin page:

| Element | Style |
| --- | --- |
| Settings rows, sidebar items, inline inputs | `body` |
| Row subtitles, menu items, the toast, the login subtitle | `subheadline` |
| Group and dialog headers, group footers and hints | `footnote` |
| Segmented options, dialog body text, small glyph buttons | `footnote` |
| The version line and the mobile tab bar | `caption-2` |

A grouped list's header and footer are `footnote`, not a caption. Caption 1 sits below the size either is drawn at.

### Steps

The table above is the default Dynamic Type step. A page can run the whole scale at a smaller step, which is how a denser screen is handled: the same eleven styles at smaller sizes, never a size chosen outside the scale.

A document opts in with a class on `<html>`, and the step applies only where the layout is not a phone. The admin page carries `type-small`, so its desktop panel runs at the Small step and a settings row is 15. On a phone it falls back to the default step and a settings row is 17, matching the phone settings design.

| Style | Default | Small |
| --- | --- | --- |
| `title-3` | 20/25 | 18/23 |
| `body`, `headline` | 17/22 | 15/20 |
| `callout` | 16/21 | 14/19 |
| `subheadline` | 15/20 | 13/18 |
| `footnote` | 13/18 | 12/16 |
| `caption-1` | 12/16 | 11/13 |

Tracking is republished per step rather than inherited. There is one absolute tracking per style, so the em that reproduces -0.43 at 17 does not reproduce it at 15. The test checks every step against the same published pairs.

Adding a step is a block of eleven declarations and an entry in `ui/test/type-scale.test.mjs`. Moving a page between steps is one class.

### Off the scale

Six rules do not use it, on purpose.

- `.rico`, `.icon-prev`, `.fp-ic`, `.ipv`, `.kv-box::after` size a single character centred in a fixed box. That is a mark, not text, and a text leading and tracking would push it off centre.
- `.bsep` is an uppercase separator label. Uppercase needs positive tracking, and the scale's values are for sentence case. `.dlg-sec` and `.sr-section` keep their own tracking for the same reason while taking their size from the scale.

## Page-scoped tokens

A surface particular to one page is declared in that page's own `:root`, not here. `--pane` and `--cp` on the admin page, `--glass-bg` and `--dock-bg` on the dashboard. These are not part of the system.

## Rules

A colour written as a literal outside `tokens.css` fails `ui/test/css-tokens.test.mjs`. The same test checks that every `var()` names a token that exists. `ui/test/palette-values.test.mjs` pins each palette entry to its reference value.

`#fff` and `#000` are allowed as ink on an arbitrary coloured fill, where the colour underneath is chosen by the user and no token can describe it.
