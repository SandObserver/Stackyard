# Accessibility

Stackyard targets [WCAG 2.1](https://www.w3.org/TR/WCAG21/) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at level AA.

## Conformance status

Stackyard is **partially conformant** with WCAG 2.2 level AA. Partially conformant means most of the standard is met, and the parts that are not are listed below.

This is a self-assessment. No external audit has been carried out.

## What is supported

- Every control has a name, a role, and a visible focus indicator.
- The interface is operable by keyboard alone. Reordering, paging, search, and dialogs each have a keyboard route.
- Dialogs trap focus, close on Escape, and return focus to the control that opened them.
- Text in the dashboard and in Settings meets the 4.5:1 contrast minimum in both the light and the dark theme. The ratios are computed from the stylesheets by a test, so a colour change that drops a pair below the minimum fails the build.
- The interface honours `prefers-reduced-motion` and `prefers-contrast`.
- Content reflows to a 320 CSS pixel viewport with no horizontal scrolling, and survives text resizing to 200%.
- The interface is translated into six languages. Accessible names are translated with it, apart from those listed below.
- Page changes are announced. Polled figures are not announced, so a screen reader is not interrupted by data that changes on a timer.

## Known limitations

- **Widgets need an extra step to read.** Each widget is an embedded document. A screen reader does not enter one during linear navigation. In VoiceOver, use Control + Option + Shift + Down to read a widget's contents. Widgets containing a button or a link are also reachable with Tab.
- **Opening a widget's link on mobile.** Tapping a widget away from its own controls opens the configured link. This responds to touch only. Widgets that carry their own link expose it separately, and that one is reachable by keyboard.
- **Widget colours are not covered by the contrast test.** Each widget is a separate document with its own stylesheet. Those colours are checked by hand rather than by the build, and a widget rendered on a transparent background cannot be measured automatically.
- **Untranslated names.** The Move up and Move down buttons in Settings, and the pull request filter names in the GitHub widget, are English in every language.

## How this was assessed

- Automated testing with [axe-core](https://github.com/dequelabs/axe-core) in Chromium and WebKit, against the released container.
- Manual browser testing for reflow, text resize, text spacing, target size, and keyboard operation.
- Manual screen reader testing with VoiceOver on macOS and Safari.

Screen reader testing has covered the dashboard and Settings. It has not covered every widget. NVDA and JAWS have not been used.

## Reporting a problem

Open an issue at [github.com/SandObserver/stackyard/issues](https://github.com/SandObserver/stackyard/issues). Include the page, the assistive technology and browser, and what you expected to happen.

Last reviewed 2026-08-23, against Stackyard 1.8.0 and later.
