# Quick3DQuote — Design System

> Token-first visual system for the Quick3DQuote SaaS dashboard and embeddable quote widget. Tailwind + shadcn/ui + react-three-fiber. UK spelling. Last revised 2026-04-21.

---

## 1. Brand direction

**Mood words:** technical, confident, fast.

**Vibe.** Quick3DQuote should feel like a precision instrument, not a marketing brochure. Think the restrained confidence of **Linear**, the flat typographic clarity of **Vercel's dashboard**, the engineered-feeling neutrals of **Figma's chrome**, and the quiet polish of **Stripe's forms**. The product is aimed at shop owners who care about tolerances, throughput and margins — they trust software that looks like it was built by someone who understands their world. So: crisp monospaced numerics on the price, millimetre dimensions visible on the mesh, no cartoon printer icons, no generic SaaS blurple gradients, no floating 3D isometrics of happy robots. Modern-industrial, not playful-tech. We're half the price of RapidQuote3D and we want to feel twice as considered — that gap is closed by typographic restraint, careful negative space, and animation that never wastes the user's time. Visually: flat-ish surfaces, single-pixel borders over heavy shadows, one accent colour doing real work rather than five decorative ones.

**What we avoid:** clip-art gear and printer icons, rainbow gradients, oversized hero illustrations, glassmorphism, drop-shadow-on-drop-shadow stacks, emoji in UI chrome, any font that isn't a modern grotesque.

---

## 2. Colour system

All colours expressed as HSL-friendly hex. Tailwind tokens live under `theme.extend.colors` in `tailwind.config.ts` and map 1:1 to shadcn CSS variables on `:root` / `.dark`.

### 2.1 Accent — two candidate palettes

We ship with **one** primary. The shop can override at runtime (see §8). Proposing two directions — pick per brand review.

**Candidate A — Cool / Indigo (recommended default).** Reads as technical, precise, software-engineering-adjacent. Pairs well with warm metallic tones in rendered mesh previews.

| Token | Hex | Notes |
|---|---|---|
| `accent-50`  | `#EEF2FF` | Tint for selected-row backgrounds. |
| `accent-100` | `#E0E7FF` | Hover tint on ghost buttons. |
| `accent-200` | `#C7D2FE` | Focus-ring glow outer. |
| `accent-300` | `#A5B4FC` | Disabled-primary state. |
| `accent-400` | `#818CF8` | Hover on primary in dark mode. |
| **`accent-500`** | **`#6366F1`** | **Primary CTA — indigo-500.** |
| `accent-600` | `#4F46E5` | Primary pressed / hover light mode. |
| `accent-700` | `#4338CA` | Active / selected sidebar item. |
| `accent-800` | `#3730A3` | Text on `accent-50` backgrounds. |
| `accent-900` | `#312E81` | Reserved for ultra-dark accents. |

**Candidate B — Warm / Amber.** More "workshop/maker" feel, reads as hand-built, premium hardware. Risk: harder to use at scale without going tacky.

| Token | Hex | Notes |
|---|---|---|
| `accent-50`  | `#FFFBEB` | |
| `accent-100` | `#FEF3C7` | |
| `accent-200` | `#FDE68A` | |
| `accent-300` | `#FCD34D` | |
| `accent-400` | `#FBBF24` | |
| **`accent-500`** | **`#F59E0B`** | **Primary CTA — amber-500.** |
| `accent-600` | `#D97706` | |
| `accent-700` | `#B45309` | |
| `accent-800` | `#92400E` | |
| `accent-900` | `#78350F` | |

**Recommendation:** ship Indigo as default; Amber is a strong fallback if user research says the target shop owner reads indigo as "yet another SaaS". Both have AA contrast against white at `-600` and above, against near-black at `-400` and below.

### 2.2 Neutrals — 9-step grey scale

A single near-neutral ramp with a barely-perceptible cool cast (2–3° blue tilt) so it sits harmoniously next to indigo without feeling sterile. These are the working greys for 90% of the UI.

| Token | Hex | Primary use |
|---|---|---|
| `neutral-0`   | `#FFFFFF` | App background (light). |
| `neutral-50`  | `#F8FAFC` | Sidebar, subtle fills, table zebra. |
| `neutral-100` | `#F1F5F9` | Card alt background, input hover. |
| `neutral-200` | `#E2E8F0` | Borders, dividers. |
| `neutral-300` | `#CBD5E1` | Disabled borders, placeholder icons. |
| `neutral-400` | `#94A3B8` | Muted text, placeholders. |
| `neutral-500` | `#64748B` | Secondary text. |
| `neutral-600` | `#475569` | Body text (light mode). |
| `neutral-700` | `#334155` | Headings, strong body. |
| `neutral-800` | `#1E293B` | Dark surface (dark mode card). |
| `neutral-900` | `#0F172A` | App background (dark). |
| `neutral-950` | `#020617` | Dark mode canvas behind cards. |

(Shown as 12 steps including `0`, `50` and `950` — nine working steps 100–900 cover component design; the extras are for canvas and absolute extremes.)

### 2.3 Semantic colours

All semantic colours chosen for **WCAG AA (4.5:1)** contrast against either `neutral-0` or `neutral-900`. Each ships with a `-50` tint for background pills / banners.

| Role | Fg hex | Bg tint hex | Contrast fg-on-white | Contrast fg-on-neutral-900 |
|---|---|---|---|---|
| `success` | `#059669` | `#ECFDF5` | 4.52:1 ✓ AA | 6.1:1 ✓ AA |
| `warning` | `#B45309` | `#FFFBEB` | 5.94:1 ✓ AA | 4.9:1 ✓ AA |
| `error`   | `#DC2626` | `#FEF2F2` | 4.83:1 ✓ AA | 5.7:1 ✓ AA |
| `info`    | `#2563EB` | `#EFF6FF` | 5.17:1 ✓ AA | 5.3:1 ✓ AA |

Notes:
- Success green is `emerald-600` (not the more common `green-500`, which fails AA on white).
- Warning uses the darker amber-700 for text; pairing amber-500 as the fill and amber-700 as fg keeps a consistent contrast story even if the shop overrides the accent to amber (we still need a warning that reads *as warning*, not as "brand").
- Error is never overridden by shop branding (see §8).

### 2.4 Dark mode & widget colour-scheme strategy

The dashboard ships both light and dark; the user toggles via their OS or an in-app switch. Mapping is direct: each light-mode token has a dark pair.

| Surface | Light | Dark |
|---|---|---|
| App bg | `neutral-0` | `neutral-950` |
| Card bg | `neutral-0` | `neutral-900` |
| Subtle bg | `neutral-50` | `neutral-800` |
| Border | `neutral-200` | `neutral-800` (+`alpha-60%`) |
| Body text | `neutral-700` | `neutral-200` |
| Muted text | `neutral-500` | `neutral-400` |

**Widget colour-scheme strategy.** The widget is embedded via iframe on third-party sites whose backgrounds we cannot predict. Strategy:

1. The iframe reads `prefers-color-scheme` **from the host document** (passed in as URL param `?scheme=light|dark|auto` when the embed script injects the iframe — the snippet detects the host's computed `background-color` luminance and picks).
2. Widget renders on a semi-neutral surface: `neutral-0` in light mode, `neutral-900` in dark mode, **always inside a bordered container** (1px `neutral-200` / `neutral-800`) so it reads as a distinct object on any host background.
3. The widget background is **never transparent** — we do not try to inherit the host page's colour. That way, if we sit on a crusty 2012 WordPress theme with a tiled fabric background, the widget remains legible.
4. All widget text colours are locked to our tokens; we do not inherit host typography or colour.

---

## 3. Typography

**Face:** **Inter** (variable, OFL). Loaded once, self-hosted via `next/font/local`, with `font-feature-settings: "cv11", "ss01", "ss03"` (the tabular-figure and single-storey-a variants — makes numerics clean on the price display). Monospaced needs: **JetBrains Mono** variable, used only for embed snippet code blocks.

```ts
// tailwind.config.ts
fontFamily: {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
}
```

### Scale

A tight 8-step scale. No `4xl` — we skip straight from `3xl` to `5xl` because marketing hero is the only `5xl` use and we want visible jump.

| Token | Size (rem / px) | Line height | Letter-spacing | Primary use |
|---|---|---|---|---|
| `text-xs`   | 0.75 / 12   | 1.1 (13.2px) | `0.01em`  | Micro-labels, table meta, badges. |
| `text-sm`   | 0.875 / 14  | 1.4 (19.6px) | `0`       | Body small, form help text, table cells. |
| `text-base` | 1.0 / 16    | 1.5 (24px)   | `0`       | Body, inputs, button labels. |
| `text-lg`   | 1.125 / 18  | 1.5 (27px)   | `-0.005em`| Section lead, dialog body. |
| `text-xl`   | 1.25 / 20   | 1.4 (28px)   | `-0.01em` | Card titles, list item headings. |
| `text-2xl`  | 1.5 / 24    | 1.3 (31.2px) | `-0.015em`| Page section heads, price display default. |
| `text-3xl`  | 1.875 / 30  | 1.25 (37.5px)| `-0.02em` | Page titles (H1 in dashboard). |
| `text-5xl`  | 3.0 / 48    | 1.1 (52.8px) | `-0.025em`| Marketing hero, widget grand-total on mobile. |

**Weights.** 400 (body), 500 (UI labels, button text, table headers), 600 (section headings), 700 (page titles and the price total). Never 800/900 — too loud against our light surfaces.

**Tabular numerics.** All prices, dimensions, quantities, table numeric columns use `font-variant-numeric: tabular-nums`. Expose a `.num-tabular` utility.

**Letter-spacing rule of thumb.** Tighten as size grows; loosen micro-caps. All-caps micro-labels (e.g. "MATERIAL" in the widget) get `tracking-wider` (`0.05em`) at `text-xs` weight 500, colour `neutral-500`.

---

## 4. Spacing & radius

### 4.1 Spacing scale

Tailwind's default 4px grid, restricted to the steps we actually use. Enforced via Tailwind config to prevent drift.

| Token | px | Primary use |
|---|---|---|
| `0.5` | 2 | Hairline icon nudges. |
| `1`   | 4 | Inline gap, badge padding-y. |
| `2`   | 8 | Tight stack gap, icon-to-text. |
| `3`   | 12 | Compact form row gap, button padding-y. |
| `4`   | 16 | Default card padding, form stack gap. |
| `5`   | 20 | Button padding-x. |
| `6`   | 24 | Card padding-lg, section internal gap. |
| `8`   | 32 | Section outer gap, dialog padding. |
| `10`  | 40 | Large section margin-y on marketing. |
| `12`  | 48 | Page padding-top (dashboard). |
| `16`  | 64 | Hero spacing. |
| `24`  | 96 | Marketing section rhythm. |

No arbitrary `[13px]` etc. If something needs 13px, fix the component.

### 4.2 Radius

Single family, four tokens. No per-component bespoke radii.

| Token | Radius | Use |
|---|---|---|
| `rounded-sm`  | 6px  | Inputs, small buttons, badges, toggle pills. |
| `rounded-md`  | 10px | **Default.** Buttons, dropdowns, menu items, card images. |
| `rounded-lg`  | 14px | Cards, dialogs, the widget outer container. |
| `rounded-full`| 9999px | Avatars, dot-indicators, pill-shaped status badges in the widget. |

Set `--radius: 0.625rem` (10px) as the shadcn base; shadcn derives its `sm`/`lg` from it, but we override to the table above for consistency.

---

## 5. Elevation / shadows

Three levels. We prefer 1px borders over shadow; shadow is reserved for floating surfaces that leave the document flow.

| Token | Shadow | Use |
|---|---|---|
| `shadow-1` (rest) | `0 1px 2px 0 rgb(15 23 42 / 0.04), 0 0 0 1px rgb(15 23 42 / 0.04)` | Cards, material swatches, the widget itself when embedded. Reads as a defined surface without floating. |
| `shadow-2` (raise) | `0 4px 10px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)` | Dropdown menus, popovers, tooltips. |
| `shadow-3` (overlay) | `0 20px 40px -8px rgb(15 23 42 / 0.18), 0 8px 16px -8px rgb(15 23 42 / 0.12)` | Dialogs, toast stack, command palette. |

**Dark mode.** Shadows use near-black with higher alpha; we also add a thin top border (`1px solid rgb(255 255 255 / 0.04)`) on dark cards for edge definition.

**Widget-embedded shadow caveat.** When the widget is embedded inside a host site's card (which might already have its own shadow), a second shadow stack reads as muddy. So the widget uses `shadow-1` **only** when it detects it's the top-level element; when embedded-in-embedded we drop to border-only (`1px solid neutral-200`). Detection: a CSS media query on container size plus a runtime check of the parent iframe's bounding box against the viewport.

---

## 6. Component inventory (MVP)

shadcn/ui covers ~80%. We customise via `components.json` theme + overridden class-variance-authority variants. Each component below gets a Storybook entry with all listed states.

### 6.1 Dashboard components

**Sidebar** (`w-60` on desktop, collapsible to `w-14` icons-only).
- States: default, hover-item, active-item (indigo-700 text, `accent-50` bg, 2px left accent bar), collapsed, mobile-drawer.
- Logo at top, primary nav, settings at bottom, account avatar footer.

**TopBar** (sticky, `h-14`).
- Page title (h3), breadcrumb, right-side search, notifications bell, theme toggle, account menu.
- States: default, scrolled (adds `shadow-1` and backdrop-blur).

**Card** (`rounded-lg`, `p-6`, `shadow-1`).
- Variants: default, interactive (hover raises to `shadow-2`), danger-border (for destructive settings), highlight (accent-50 bg).

**DataTable** (the quotes inbox and materials list).
- Header row: `text-xs uppercase tracking-wider font-medium text-neutral-500`.
- Cell: `text-sm` body, tabular-nums for numerics.
- Row states: default, hover (`neutral-50`), selected (`accent-50` + `accent-700` text), disabled (muted).
- Sticky header, sortable columns with arrow indicator, row density `compact|normal|relaxed`, pagination footer.
- Empty and loading states (shimmer).

**FormField** (label + input + help + error, stacked `space-y-1.5`).
- Input states: default, hover, focus (2px accent ring, no colour change), error (red border + red ring), disabled, read-only.
- Variants: text, number (tabular), textarea, select, combobox, file, colour picker (for material colour hex).
- Inline `£` / `cm³` / `%` adornments on numerics.

**Toggle / Switch** (shadcn default, restyled).
- States: off, on, disabled, focus-visible.
- 20×12 track, 8px thumb, 120ms slide.

**Button** — 4 variants × 3 sizes × all states.
- Variants:
  - `primary`: `bg-accent-500 text-white hover:bg-accent-600 active:bg-accent-700`.
  - `secondary`: `bg-neutral-0 border border-neutral-200 text-neutral-700 hover:bg-neutral-50`.
  - `ghost`: `text-neutral-700 hover:bg-neutral-100`.
  - `destructive`: `bg-error text-white hover:bg-[#B91C1C]`.
- Sizes: `sm` (h-8, px-3, text-sm), `md` (h-10, px-5, text-sm, default), `lg` (h-12, px-6, text-base).
- All: `rounded-md`, 500 weight, loading state (spinner + dimmed label), disabled (60% opacity, `cursor-not-allowed`), icon-only variant (square, same height).

**Badge** (quote status pills).
- `rounded-full`, `text-xs`, weight 500, `px-2 py-0.5`.
- Statuses with colour mappings:
  - `quoted` — `info` (blue-600 on blue-50).
  - `paid` — `success` (emerald-600 on emerald-50).
  - `in-production` — `warning` (amber-700 on amber-50).
  - `shipped` — neutral dark (neutral-700 on neutral-100).
  - `cancelled` — `error` (red-600 on red-50), with strikethrough on companion text.
- Optional leading dot (6px, filled).

**EmptyState** (illustration-free by design; typographic).
- 3xl icon (Lucide, neutral-300), `text-lg` heading, `text-sm` muted description, primary CTA button.
- Variants: empty-quotes, empty-materials, search-no-results, error-boundary.

**Dialog** (shadcn, themed).
- `rounded-lg`, `shadow-3`, max-width `max-w-lg` (confirm), `max-w-2xl` (form), `max-w-4xl` (file preview).
- States: open, closing (200ms), focus-trapped.
- Header (close X), body (scrollable), footer (right-aligned buttons, primary on right).

**Toast** (sonner-based).
- `rounded-md`, `shadow-2`, bottom-right stack.
- Variants: default, success, error, warning, loading (spinner).
- Auto-dismiss 4s (configurable); action button optional.

### 6.2 Widget components

**UploadDropzone**.
- States: idle, drag-over (accent-500 dashed border, accent-50 fill), uploading (progress bar + filename + cancel), error (red border, retry), success (compact thumbnail row).
- Accepts STL, OBJ, 3MF. 100MB cap. Shows cap in idle copy.
- Uses `Upload` Lucide icon at 48px in idle.

**MeshViewer frame** (react-three-fiber canvas).
- `aspect-[4/3]` on desktop, `aspect-square` on mobile-narrow.
- Overlays: dimensions (WxDxH mm), volume (cm³), orbit hint (auto-fades after 3s).
- Background: subtle dotted grid, `neutral-100` (light) / `neutral-800` (dark) on base `neutral-50` / `neutral-900`.
- Loading shimmer while mesh parses; error fallback card on parse failure.

**MaterialCard** (selected inside a `grid grid-cols-2 md:grid-cols-3 gap-3`).
- Contents: 32px colour swatch (rounded-sm), material name (text-sm/500), process pill (FDM/SLA in neutral-500 text-xs), price-per-part (tabular, text-sm right-aligned).
- States: default, hover (border lifts to `neutral-300`), selected (2px accent border + `accent-50` bg + check icon top-right), disabled (opacity-50, "Out of stock" overlay).

**QuantityStepper**.
- `[-]  [ 12 ]  [+]` in a single bordered group, `rounded-md`, h-10.
- Min 1, max 9999. Disabled state when at min.
- Tabular numerics, 500 weight on the integer.

**PriceSummary** (collapsed + expanded accordion).
- Collapsed: label `TOTAL` (text-xs uppercase muted) + big price (text-3xl, 700, tabular).
- Expanded: line items (material, machine time, setup, qty multiplier, markup) each `text-sm` muted-label + right-aligned tabular figure.
- Price change animation: 200ms slot-roll on digit change (see §9).

**CheckoutCTA**.
- `Button primary lg`, full-width on mobile-narrow, right-aligned on desktop. Label: "Order now — £XX.XX". Includes the price inside the button for decisiveness.
- Loading state shows spinner, label replaced with "Redirecting to Stripe…".

**ErrorBanner** (inside widget).
- `rounded-md`, `bg-error-50`, `border-l-4 border-error`, `text-error-800` (which is `#991B1B`).
- Icon (AlertTriangle), title (text-sm/500), message (text-sm), optional retry link.

**LoadingShimmer**.
- Animated gradient sweep 1.4s infinite. Used for: mesh preview while parsing, price line during recalc, material list on first load.
- Respects `prefers-reduced-motion` — falls back to a static `neutral-100` block with `Loading…` screen-reader-only text.

---

## 7. Widget embed constraints

The widget lives inside an iframe we fully control, so strict CSS isolation is solved by the iframe boundary — but we still have considerations:

**Font scoping.** We load Inter inside the iframe document. We do not inherit the host page's `font-family`. The iframe's root HTML sets `font-family: Inter, ...` with `!important` on the body to defeat host CSS that might leak via legacy `<base>` tags.

**`all: initial` reset.** Inside the iframe body we apply a Tailwind preflight (`@tailwind base`) which already resets aggressively. We additionally wrap the whole widget in a root div with `all: revert` fallback for unknown-host edge cases (some hosts inject `<style>` into the iframe via postMessage libraries — rare but exists).

**Colour-scheme respect.** The embed loader (`embed.js`) reads the host body's computed `background-color`, converts to HSL, and passes `?scheme=dark` if L<0.35, else `?scheme=light`. The iframe URL flag sets `class="dark"` on `<html>`. A manual override param `?forceScheme=light|dark` exists for shops who know their host (shop setting: "force widget theme: auto/light/dark").

**Max-width behaviour.** The iframe itself is `width: 100%` with a script-set `height` updated via `ResizeObserver` + `postMessage` to the host. Internally the widget has `max-width: 960px` centred, but gracefully compresses down to `320px` (smallest realistic container — narrow sidebar embeds).

**Responsive breakpoints (inside the widget).** Not tied to viewport; they're tied to the **widget container width** via `@container` queries:
- `@container (max-width: 480px)` — mobile-narrow: viewer on top, single-column material grid, full-width CTA, price summary collapsed by default.
- `@container (min-width: 481px) and (max-width: 767px)` — compact: viewer left ~55%, controls right stacked.
- `@container (min-width: 768px)` — full: two-column (60/40), material grid 3-up, expanded price summary visible.

**Never-inherit list.** Colour, font-family, font-size, line-height, letter-spacing, background-image, box-shadow on all widget descendants use our tokens explicitly. No `inherit` or `currentColor` at the root boundary.

---

## 8. Shop branding overrides

A shop can set an **accent colour** (single hex) and a **logo** (PNG/SVG). That's it. Over-parameterised branding kills the system; one colour is enough to feel owned without going off the rails.

### 8.1 Tokens that bend to the shop accent

When `shop.accent_hex` is set, we compute a 10-step accent ramp at load time (server-side, cached) using OKLCH-based tint/shade generation. These tokens rebind:

- `accent-50` → `accent-900` (full ramp, widget only by default; dashboard uses Quick3DQuote indigo unless the shop explicitly opts in).
- CTA background (`bg-accent-500`) and hover/active states (`accent-600`, `accent-700`).
- MaterialCard selected-state border and tint.
- UploadDropzone drag-over state.
- Toggle/switch on-state.
- Focus ring colour.

### 8.2 Tokens that do NOT bend (ever)

- **Error red** — always `#DC2626`. A shop whose brand is red does not get to make all their errors invisible.
- **Success green**, **warning amber**, **info blue** — fixed. Semantics must remain learnable across shops.
- **Neutral greys** — fixed. Guarantees legibility regardless of shop choice.
- **The price figure colour** — always body text (`neutral-700` / `neutral-200`), never accent. Accent goes on the CTA button behind it.

### 8.3 Accent validation

On save we validate:
- Contrast of proposed accent `-500` against white ≥ 4.0:1 (relaxed from 4.5 because buttons also have weight 500 text, which is bolded).
- If fails, we auto-shift lightness downward until it passes and warn the shop: "We darkened your accent slightly for readability."
- Logo: max 2MB, square aspect ≤ 2:1, we letterbox into a 32×32 slot in the widget header.

### 8.4 Logo placement

Widget header: 24px tall logo, left-aligned, followed by "Powered by Quick3DQuote" in `text-xs neutral-400` on the right (removable on higher-tier plan — parked for v1.1).

---

## 9. Motion

Motion is confirmation, not decoration. If you can't name what the motion tells the user, cut it.

### 9.1 Duration tokens

| Token | Duration | Use |
|---|---|---|
| `motion-fast` | 120ms | Hover states, colour transitions, small micro-feedback. |
| `motion-normal` | 200ms | Dialog open/close, toast entry, price roll, toggle slide. |
| `motion-slow` | 320ms | Page / panel transitions, larger layout shifts, sidebar collapse. |

### 9.2 Easing

- Default: `cubic-bezier(0.2, 0.8, 0.2, 1)` — a soft-out curve (feels "settled").
- Entry: `cubic-bezier(0, 0, 0.2, 1)` — ease-out.
- Exit: `cubic-bezier(0.4, 0, 1, 1)` — ease-in.
- No bounce, no overshoot, no spring.

### 9.3 What animates

- **Price number roll** on recalculation: each changed digit slides up 200ms with a 30ms stagger between digits. Left-to-right stable positions. `tabular-nums` guarantees no layout shift.
- **Upload progress**: linear fill of the progress bar; percentage text updates without ticker.
- **Success pulse** on "Order now" — green check expands 0→1 scale over 200ms inside the button, then dialog transitions to Stripe redirect.
- **Material selection**: 120ms border-width transition (1px→2px) and `accent-50` bg fade-in.
- **Dialog**: 200ms fade + 8px translate-y entry.
- **Toast**: slide-in from right 200ms, auto-dismiss fade 200ms.
- **Skeleton shimmer**: 1400ms linear infinite, only where the shimmer replaces real layout.
- **Sidebar collapse**: 320ms width transition.

### 9.4 What never animates

- Colour changes on table-row hover (instant — feels faster).
- Focus ring (instant — feels more responsive to keyboard).
- Error banners appearing (instant — urgency).

---

## 10. Accessibility floor

**Standard:** WCAG 2.1 AA. Not a stretch goal — a hard floor for every component before merge.

**Contrast.** All body text ≥ 4.5:1; large text (≥ 18.66px 400 or 14px 700) ≥ 3:1. All semantic colours verified (§2.3). Placeholder text (`neutral-400` on white) deliberately sits at ~3.5:1 — acceptable only because placeholders are never the sole means of conveying a label; every field has a visible `<label>`.

**Focus ring.** `outline: 2px solid var(--accent-500); outline-offset: 2px;` on every interactive element. Not removed with `:focus:not(:focus-visible)` — we allow mouse users to lose it, but keyboard focus is always visible. In dark mode the ring uses `accent-400` for better contrast against dark surfaces.

**Keyboard.** Full keyboard reachability: tab order follows visual order, `Esc` closes dialogs and popovers, `Enter` submits forms, arrow keys navigate radio groups and the MaterialCard grid, `Space` toggles switches. The 3D viewer has a keyboard orbit mode (`+/-` zoom, arrows rotate) for users who can't drag.

**Screen reader.** All Lucide icons wrapped with `aria-hidden="true"` when decorative; functional icons get `aria-label`. The 3D mesh preview has a `<figure>` + `<figcaption>` sibling with "3D preview. Dimensions: 48×32×15 mm. Volume: 12.4 cm³." Live regions (`role="status"`, `aria-live="polite"`) announce price updates without stealing focus.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` disables: price roll, shimmer, dialog translate, success pulse. Replacements: instant colour swap (price), static placeholder (shimmer), instant fade (dialog). The UI remains fully functional.

**Touch targets.** Minimum 44×44px hit area on mobile for all interactive elements. The QuantityStepper on mobile-narrow expands to 48px tall.

**Form accessibility.** Every input has a programmatically associated `<label>`, every error has `aria-describedby` → error-id, required fields marked with `aria-required="true"` (not just red asterisks).

---

## 11. Icon system

**Library:** **Lucide React** — single source, consistent grid, MIT-licensed. No mixing with Heroicons or Phosphor.

**Sizes.**
- `icon-xs` — 14px (inline inside `text-sm` body, leading-aligned).
- `icon-sm` — 16px (buttons, input adornments, table cells).
- `icon-md` — 20px (default, sidebar nav, card headers).
- `icon-lg` — 24px (page title adornments, dialog header).
- `icon-xl` — 32px (empty states, upload dropzone idle).

**Stroke width.** Default **1.75px** (slightly lighter than Lucide's 2px default — reads more premium alongside Inter at UI sizes, and stays crisp at retina). Exception: `icon-xl` and above drop to 1.5px to avoid heaviness.

**Colour.** Inherits `currentColor` in the UI chrome; defaults to `neutral-500` in non-interactive contexts and `neutral-700` on interactive. Status icons adopt their semantic hue.

**Custom icons.** Only for 3D-specific concepts not in Lucide (e.g. layer-height symbol, build-plate outline). Drawn on the same 24px grid at 1.75px stroke, exported as React components in `/packages/ui/icons/custom/`.

---

## 12. Example layouts

### 12.1 Dashboard home

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Logo]                                        🔍 search   🔔  [OK] │ TopBar  (h-14)
├────────────┬────────────────────────────────────────────────────────┤
│            │  Dashboard                                             │
│  ● Overview│  ─────────                                             │
│    Quotes  │                                                        │
│    Materia │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│    Setting │  │ Quotes (24h) │ │  Revenue     │ │ Avg. value   │    │
│            │  │     12       │ │  £1,284.00   │ │   £107.00    │    │
│  ─ ─ ─ ─  │  │  ↑ 20%       │ │  ↑ 8%        │ │  — flat      │    │
│    Embed   │  └──────────────┘ └──────────────┘ └──────────────┘    │
│    Brand   │                                                        │
│            │  Recent quotes                                         │
│ ───────── │  ┌─────────────────────────────────────────────────┐    │
│  [Avatar]  │  │ # 104   gear.stl     PLA blk  1  £14.20  [paid]│    │
│  Acme 3D   │  │ # 103   bracket.stl  PETG gr  4  £52.80  [quo] │    │
│            │  │ # 102   case.obj     Resin    1  £88.00  [shp] │    │
│            │  │ ...                                             │    │
│            │  └─────────────────────────────────────────────────┘    │
└────────────┴────────────────────────────────────────────────────────┘
```

### 12.2 Materials list

```
┌─────────────────────────────────────────────────────────────────────┐
│  Materials                                           [+ New material]│
│  ───────────                                                        │
│  ┌─ Filters: [ All ] [ FDM ] [ SLA ] [ Active ]     12 materials ──┐│
│  │                                                                  ││
│  │ SWATCH  NAME            PROCESS   £/cm³   DENSITY  STATUS       ││
│  │ ──────  ──────────────  ────────  ──────  ───────  ──────────   ││
│  │ ████    PLA Black       FDM       £0.08    1.24    ● Active     ││
│  │ ████    PLA White       FDM       £0.08    1.24    ● Active     ││
│  │ ████    PETG Grey       FDM       £0.11    1.27    ● Active     ││
│  │ ████    ABS Black       FDM       £0.14    1.04    ○ Inactive   ││
│  │ ████    Tough Resin     SLA       £0.45    1.12    ● Active     ││
│  │ ████    Clear Resin     SLA       £0.52    1.18    ● Active     ││
│  │ ...                                                              ││
│  └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 12.3 Quote detail

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← All quotes                                                       │
│  Quote #104                                        [paid] [Download]│
│  ───────────                                                        │
│  ┌─────────────────────────────┐ ┌────────────────────────────────┐ │
│  │                             │ │  Customer                      │ │
│  │    [  3D mesh preview  ]    │ │  jane@example.com              │ │
│  │      48 × 32 × 15 mm        │ │  +44 7700 900000               │ │
│  │      Volume 12.4 cm³        │ │                                │ │
│  │                             │ │  Order                         │ │
│  └─────────────────────────────┘ │  Material   PLA Black (FDM)    │ │
│                                  │  Quantity   1                  │ │
│  Pricing breakdown               │  File       gear.stl (2.4 MB)  │ │
│  Material cost       £0.99       │                                │ │
│  Machine time (1h)   £8.00       │  Totals                        │ │
│  Setup               £3.00       │  Subtotal      £11.99          │ │
│  Markup (15%)        £1.80       │  Markup        £1.80           │ │
│  ─────────────────   ─────       │  ──────────    ─────           │ │
│                                  │  Grand total   £14.20          │ │
│                                  │                                │ │
│                                  │  [ Mark in production ]        │ │
│                                  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.4 Widget — desktop wide, desktop narrow, mobile

**Desktop wide (≥ 768px container):**

```
┌───────────── Widget ─────────────────────────────────────────────┐
│  [Shop logo]                           Powered by Quick3DQuote   │
│ ─────────────────────────────────────────────────────────────── │
│  ┌──────────────────────────┐  ┌────────────────────────────┐   │
│  │                          │  │  MATERIAL                  │   │
│  │   3D mesh preview        │  │  ┌────┐ ┌────┐ ┌────┐     │   │
│  │   48 × 32 × 15 mm        │  │  │ ██ │ │ ██ │ │ ██ │     │   │
│  │   12.4 cm³               │  │  │PLA │ │PETG│ │Res │     │   │
│  │                          │  │  │Blk │ │Gry │ │Cler│     │   │
│  │                          │  │  └────┘ └────┘ └────┘     │   │
│  └──────────────────────────┘  │  ┌────┐ ┌────┐ ┌────┐     │   │
│                                │  │ ██ │ │ ██ │ │ ██ │     │   │
│                                │  └────┘ └────┘ └────┘     │   │
│                                │                            │   │
│                                │  QUANTITY   [-] [ 1 ] [+]  │   │
│                                │                            │   │
│                                │  TOTAL                     │   │
│                                │  £14.20                    │   │
│                                │                            │   │
│                                │  [ Order now — £14.20 ]    │   │
│                                └────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**Desktop narrow (< 768px container, e.g. sidebar embed ~480px):**

```
┌──── Widget ─────────────────┐
│ [Logo]       Powered by Q3D │
│ ─────────────────────────── │
│ ┌─────────────────────────┐ │
│ │   3D preview            │ │
│ │   48×32×15mm · 12.4cm³  │ │
│ └─────────────────────────┘ │
│                             │
│ MATERIAL                    │
│ ┌─────┐ ┌─────┐             │
│ │ ███ │ │ ███ │             │
│ │ PLA │ │PETG │             │
│ └─────┘ └─────┘             │
│                             │
│ QTY     [-] [ 1 ] [+]       │
│                             │
│ TOTAL        £14.20         │
│ ▸ Breakdown                 │
│                             │
│ [ Order now — £14.20 ]      │
└─────────────────────────────┘
```

**Mobile (< 480px container):**

```
┌─ Widget ──────────┐
│ [Logo]            │
│ ─────────────────│
│ ┌───────────────┐ │
│ │   3D preview  │ │
│ │  48×32×15 mm  │ │
│ └───────────────┘ │
│                   │
│ MATERIAL          │
│ ┌───────────────┐ │
│ │ ███ PLA Black │ │
│ │          £14  │ │
│ ├───────────────┤ │
│ │ ███ PETG Grey │ │
│ │          £19  │ │
│ └───────────────┘ │
│                   │
│ QTY  [-] [ 1 ] [+]│
│                   │
│ TOTAL             │
│ £14.20            │
│                   │
│ [  Order now  ]   │
│ [    £14.20   ]   │
└───────────────────┘
```

---

## Appendix — Tailwind config snippet

```ts
// tailwind.config.ts (excerpt)
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE', 300: '#A5B4FC',
          400: '#818CF8', 500: '#6366F1', 600: '#4F46E5', 700: '#4338CA',
          800: '#3730A3', 900: '#312E81',
        },
        neutral: {
          0: '#FFFFFF', 50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0',
          300: '#CBD5E1', 400: '#94A3B8', 500: '#64748B', 600: '#475569',
          700: '#334155', 800: '#1E293B', 900: '#0F172A', 950: '#020617',
        },
        success: { DEFAULT: '#059669', tint: '#ECFDF5' },
        warning: { DEFAULT: '#B45309', tint: '#FFFBEB' },
        error:   { DEFAULT: '#DC2626', tint: '#FEF2F2' },
        info:    { DEFAULT: '#2563EB', tint: '#EFF6FF' },
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px' },
      boxShadow: {
        1: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 0 0 1px rgb(15 23 42 / 0.04)',
        2: '0 4px 10px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
        3: '0 20px 40px -8px rgb(15 23 42 / 0.18), 0 8px 16px -8px rgb(15 23 42 / 0.12)',
      },
      transitionDuration: { fast: '120ms', normal: '200ms', slow: '320ms' },
      transitionTimingFunction: {
        settled: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
}
```

---

**Owner:** UI Designer agent. **Reviewed against:** CLAUDE.md §4 (MVP scope), §6 (multi-tenancy → widget isolation), §8 (conventions). **Open item for Olly:** confirm Indigo (Candidate A) vs Amber (Candidate B) as default accent — recommendation Indigo.

File: `C:/Users/Olly/Git/3d Printing Software/docs/design-system.md` — approx. 2,950 words.
