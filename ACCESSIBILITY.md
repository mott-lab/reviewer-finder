# Accessibility Audit

Audit performed 2026-04-29 against `index.html`, `styles.css`, and `js/app.js`. Findings organized by severity. Items marked Critical fail WCAG AA; the rest are improvements that bring the page closer to the WCAG AA bar.

## Critical (fail WCAG AA)

### 1. Viridis cell text contrast

`textOnViridis(t)` in `js/app.js` flips white→black at a fixed `t > 0.6` threshold. At mid-viridis teal `rgb(34, 168, 132)` (around clamped t=0.6), white text gives **2.88:1** — fails AA (4.5:1 for normal text). Black text on the same background is **7.29:1**.

**Fix:** compute the relative luminance of the actual cell RGB and pick black text if `L > 0.179`, else white. Replace the fixed-threshold heuristic with a proper sRGB→linear→luminance calculation.

### 2. Dark-theme primary button contrast

White text on dark-mode `--primary: #3b82f6` is **3.62:1** — fails AA for normal text (passes AA-large only). The "Find Reviewers" button label is normal weight.

**Fix:** use `#2563eb` (the light-theme primary) for dark mode too. The button still stands out against the dark-navy page bg, just with white-on-blue at 5.05:1.

### 3. Paper table is grid-of-divs, not a real `<table>`

`renderReviewers` builds the per-card paper list as a CSS grid of `<span>`/`<a>` elements. Screen readers read each cell in DOM order with no header relationships, so users can't tell which number is `wt` vs `sim`.

**Fix:** convert to `<table>` with `<thead><th scope="col">…</th></thead>` and a `<tbody>` of `<tr><td>` rows. The current `1fr auto auto auto` grid layout can be retained via `display: contents` on `<tr>`/`<thead>`/`<tbody>` so the cells participate in a `display: grid` parent. Alternatively, switch to native `display: table`.

## High priority

### 4. Status messages aren't live regions

`#dataStatus`, `#findReviewersStatus`, `#connectionStatus` all update dynamically (load progress, ranking progress, errors). Screen readers don't announce changes by default.

**Fix:** add `role="status"` to each `<span>` (implies `aria-live="polite"` and `aria-atomic="true"`).

### 5. Conferences checkboxes lack group semantics

Currently:
```html
<div class="conferences-group">
  <span class="filter-label">Conferences</span>
  <div id="conferenceFilters">...</div>
</div>
```
The label isn't programmatically associated with the checkboxes, so screen reader users hear each conference acronym individually with no "Conferences" context.

**Fix:** convert to `<fieldset class="conferences-group"><legend class="filter-label">Conferences</legend>...</fieldset>` (with CSS reset for default fieldset border/padding) or apply `role="group" aria-labelledby="…"` to the wrapper.

### 6. `<section id="input-section">` has no accessible name

Sectioning content should have a heading or `aria-label`. The "Submission" H2 was removed during the UI condensing pass, leaving the section unlabeled.

**Fix:** add `aria-label="Submission"` to the section element.

### 7. Theme toggle doesn't communicate the action

Button text `Light` / `Dark` describes current state, not the action that clicking performs. Screen reader users hear "Light, button" without knowing what clicking does.

**Fix:** add an `aria-label` that describes the action — e.g. `aria-label="Switch to dark theme"` (or "Switch to light theme") — and update it alongside the visible text in `setTheme()`.

## Medium priority

### 8. `prefers-reduced-motion` ignored

`scrollIntoView({ behavior: 'smooth' })` runs even for users who've turned off animations.

**Fix:** read `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and pass `'auto'` if matched.

### 9. No custom `:focus-visible` styling

Relies entirely on browser defaults — functional but inconsistent across browsers, sometimes barely visible in dark mode.

**Fix:** add an explicit rule, e.g.:
```css
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
```

### 10. Result render doesn't move focus

After clicking Find Reviewers, focus stays on the button while the page scrolls. Screen reader users won't know the results landed.

**Fix:** programmatically focus the `#reviewers-section` H2 after render. Set `tabindex="-1"` on the heading so it's focusable but not in the tab order.

## Low priority

### 11. Paper links don't indicate "opens in new tab"

`target="_blank"` with no warning. Common convention, but WCAG-recommended (technique G201). Could add a small `↗` glyph after each link or per-link `aria-label="(opens in new tab)"`. Lower priority because it's a known UX pattern and adds visual/code noise to every paper row.

### 12. `rel="noopener"` could be `rel="noopener noreferrer"`

Security/privacy hardening; not strictly accessibility.


## What's already correct

- Form labels properly wrap inputs (implicit association). Title, Abstract, all numeric inputs, Ollama URL/Model.
- Heading hierarchy h1 → h2 → h3 is clean.
- `lang="en"` on `<html>`, viewport meta, page title all present.
- All interactive elements (buttons, inputs, `<details>`, checkboxes, links) are natively keyboard-focusable; no custom keypress handlers needed.
- `feature-disabled` uses `display: none !important` so screen readers correctly skip Ollama UI and the recency half-life input.
- Color isn't the only signal — viridis cells also show the numeric value, so colorblind users still get the data.
- Light-mode contrasts (muted text on white, primary button) all pass AA.
- Dark-mode `color-scheme: dark` declaration ensures form-control internals and scrollbars match the theme.
- Per-card heading (h3) carries the reviewer name, so SR users get context before the table cells.
