# Accessibility

Stackyard targets [WCAG 2.1](https://www.w3.org/TR/WCAG21/) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at level AA.

## Conformance status

Stackyard is **partially conformant** with WCAG 2.2 level AA. Partially conformant means most of the standard is met, and the parts that are not are listed below.

This is a self-assessment. No external audit has been carried out.

## What is supported

- Every control has a name, a role, and a visible focus indicator.
- The interface is operable by keyboard alone. Reordering, paging, search, and dialogs each have a keyboard route.
- Dialogs trap focus, close on Escape, and return focus to the control that opened them. The first-run password prompt does not close on Escape; Skip dismisses it.
- Text in the dashboard and in Settings, outside widgets, meets the 4.5:1 contrast minimum in both the light and the dark theme. A test computes these colour pairs from the stylesheets, so a change that drops one of them below the minimum fails the build. A colour written directly into a rule, or text dimmed with opacity, fails the build until it is measured.
- The interface honours `prefers-reduced-motion` and `prefers-contrast`.
- Content reflows to a 320 CSS pixel viewport with no horizontal scrolling, and survives text resizing to 200%.
- The interface is translated into six languages. Accessible names are translated with it, apart from the status text listed below.
- Page changes are announced. Polled figures are not announced, so a screen reader is not interrupted by data that changes on a timer. A tile's badge is part of the tile's name, so it is read on arrival rather than spoken when it changes.

## Known limitations

- **Widgets need an extra step to read.** Each widget is an embedded document. A screen reader does not enter one during linear navigation, so its contents are read only after the reader is asked to enter it. Widgets containing a button or a link are also reachable with Tab.
- **A phone shortcut that responds only to touch.** On a phone, a widget that has a link set opens it when tapped away from the widget's own controls. There is no keyboard equivalent for that shortcut. Widgets that carry their own link also expose it as a control, and that one is reachable by keyboard. The shortcut does not exist on a desktop.
- **Some status text is in English.** In Weather, a location with no city name is read as "Current location". The System Stats summary for screen readers names its figures in English, such as "CPU 12 percent". The Backup widget reads a job's status and its relative times in English. An app tile's health reason is in English when it quotes a connection error or the container's state. The day tooltips in GitHub Contributions are in English.
- **Two Settings controls are below the 3:1 contrast minimum for non-text elements.** The selected segment of a segmented control, and the track of a switch that is off, are faint against their background. The selected segment also has a heavier label, and the switch shows its state by the knob position.
- **The contrast test does not read every colour.** A grey from the shared palette is measured only on the surfaces the test lists. Colours set from scripts and colours inside media queries are checked by hand. So are app and folder names on the dashboard, and white text with a shadow over the wallpaper, such as the phone search pill.
- **Widget colours are not covered by the contrast test.** Each widget is a separate document with its own stylesheet. Those colours are checked by hand rather than by the build, and a widget rendered on a transparent background cannot be measured automatically.

## How this was assessed

- Automated testing with [axe-core](https://github.com/dequelabs/axe-core) in Chromium and WebKit, against the released container.
- Manual browser testing for reflow, text resize, text spacing, target size, and keyboard operation.
- Manual screen reader testing with VoiceOver, on macOS with Safari and on iOS.
- A review of the source for names, focus, keyboard routes, contrast, and translation, in September 2026.

Automated testing has covered every widget. Screen reader testing has covered the dashboard, Settings, and the widgets on a running dashboard, but not every widget in every configuration. The Windows screen readers NVDA and JAWS have not been used.

## Reporting a problem

Open an issue at [github.com/SandObserver/stackyard/issues](https://github.com/SandObserver/stackyard/issues). Include the page, the assistive technology and browser, and what you expected to happen.

Last reviewed 2026-10-02, for the release that follows Stackyard 1.15.0.
