# Design system

The visual system both pages share. It lives in `ui/css/tokens.css`.

Values come from Apple's iOS, iPadOS and macOS design kits. The dashboard follows iOS on a phone and iPadOS on a desktop. The admin page follows the macOS settings pattern.

Dark values only. No stylesheet declares a `prefers-color-scheme` rule.

## The three colour layers

Pick from the lowest layer that answers the question.

**Palette.** Apple's system colours named by hue: `--sy-teal`, `--sy-red`, `--sy-gray4`. Twelve hues and six greys. Each has a `-hi` partner holding an increased-contrast value, and the `prefers-contrast: more` block swaps the whole palette to the `-hi` set.

A rule should not name a palette entry directly. The palette exists so the layers above it have something to point at.

**Roles.** What a colour is for: `--accent`, `--danger`, `--warning`, `--success`. Each points at a hue. Changing the accent is one line.

**Semantic.** What a colour is applied to, in Apple's own sets.

| Set | Tokens | Use |
| --- | --- | --- |
| Labels | `--label-primary`, `--label-secondary`, `--label-tertiary`, `--label-quaternary` | Text, in descending prominence |
| Fills | `--fill-primary` through `--fill-quaternary` | The tint behind a small control |
| Separators | `--separator`, `--separator-opaque` | Dividing content |
| Backgrounds | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` | The three layered surfaces |
| Backgrounds, elevated | `--bg-elevated-primary`, `--bg-elevated-secondary`, `--bg-elevated-tertiary` | The same three, for content over a sheet |

Two singletons sit beside them. `--bg-primary-light` is the opt-in light widget card, the one surface that renders in the light theme. `--control-knob` is the white of a knob on a slider or a switch, which Apple draws at full white in both themes.

## Two limits on the semantic layer

**Label levels below primary do not clear WCAG on this project's cards.** Apple's ramp assumes Apple's surfaces. Use `--sy-a11y-dim` for text that has to be read on a card; use a label level for hierarchy. `ui/test/contrast.test.mjs` computes the ratios and fails on a regression, so this is enforced rather than remembered.

**The dashboard's glass is not built from Fills.** Its overlays are pure white at low alpha over a wallpaper. Apple's fills are grey-tinted and assume an opaque surface beneath. Substituting one for the other changes the look.

## Page-scoped tokens

A surface particular to one page is declared in that page's own `:root`, not here. `--pane` and `--cp` on the admin page, `--glass-bg` and `--dock-bg` on the dashboard. These are not part of the system.

## Rules

A colour written as a literal outside `tokens.css` fails `ui/test/css-tokens.test.mjs`. The same test checks that every `var()` names a token that exists. `ui/test/palette-values.test.mjs` pins each palette entry to its Apple value.

`#fff` and `#000` are allowed as ink on an arbitrary coloured fill, where the colour underneath is chosen by the user and no token can describe it.
