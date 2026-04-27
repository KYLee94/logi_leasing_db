# Design System Specification: The Architectural Ledger

## 1. Overview & Creative North Star
**Creative North Star: The Architectural Ledger**

This design system is built for the high-stakes world of enterprise real estate asset management. It rejects the "disruptive startup" aesthetic in favor of **Institutional Authority**. We are not building a social app; we are building a digital environment for stewards of immense physical value.

The design breaks the "template" look through **The Architectural Ledger** philosophy: a layout that feels drafted, not just "coded." It uses intentional asymmetry, generous editorial whitespace, and high-contrast typography scales. We prioritize "The Quiet Room" effect—a UI that doesn't scream for attention but provides a calm, high-fidelity lens through which to view complex data.

---

## 2. Colors & Surface Hierarchy
Our palette moves beyond simple "dark and light." We use tonal depth to signify the importance of data.

### The Surface Hierarchy & Nesting
Instead of using lines to separate content, we use **Tonal Layering**. Think of the UI as stacked sheets of premium cardstock.
- **Base Layer:** `surface` (#f7f9fb) is your canvas.
- **Secondary Content:** `surface_container_low` (#f2f4f6) for sidebar navigation or secondary utility panels.
- **Primary Content Areas:** `surface_container_lowest` (#ffffff) for the main data work-area to provide maximum "pop" and clarity.
- **Nested Detail:** `surface_container_high` (#e6e8ea) for utility components inside a main card.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to section off large areas of the interface. Boundaries must be defined solely through background color shifts. A `surface_container_low` section sitting against a `surface` background creates a natural, sophisticated edge that feels integrated, not "boxed in."

### The "Glass & Gradient" Rule
To prevent the UI from feeling "flat" or "sterile," use subtle visual "soul":
- **Floating Elements:** Use `surface_container_lowest` at 80% opacity with a `24px` backdrop blur for modals and dropdowns.
- **Primary CTAs:** Use a subtle linear gradient from `primary` (#000000) to `primary_container` (#131b2e) at 135 degrees. This provides a deep, ink-like luster that flat hex codes cannot achieve.

---

## 3. Typography
We employ a disciplined, editorial hierarchy using two typefaces.

*   **Display & Headlines (Manrope):** Chosen for its geometric stability and architectural feel. Use `display-lg` through `headline-sm` to create "Editorial Moments" in the dashboard.
*   **Body & UI (Inter):** The workhorse. Inter provides maximum legibility for high-density asset data. Use `body-md` for standard data and `label-sm` for technical metadata.

**Hierarchy Strategy:**
- Use **heavy weight contrast** rather than size alone. A `label-md` in Bold `on_surface` is often more effective than a large, light-weight headline.
- All numbers in tables must use **tabular lining** to ensure columns of figures align perfectly for visual scanning.

---

## 4. Elevation & Depth
In this system, depth is a functional tool, not a decoration.

### The Layering Principle
Depth is achieved by "stacking" surface-container tiers. Place a `surface_container_lowest` card on a `surface_container_low` section. This creates a soft, natural lift without the "dirtiness" of heavy shadows.

### Ambient Shadows
When an element must float (e.g., a critical KPI card), use **Ambient Shadows**:
- **Color:** Use a tinted version of `on_surface` (approx 4-8% opacity).
- **Blur:** Extra-diffused (e.g., `blur: 32px`, `offset-y: 8px`). 
- **Goal:** Mimic natural, soft lighting in a gallery, not a computer-generated "drop shadow."

### The "Ghost Border" Fallback
If a border is absolutely required for accessibility (e.g., input fields), use a **Ghost Border**:
- Token: `outline_variant` (#c6c6cd) at **20% opacity**.
- **Forbid:** Never use 100% opaque, high-contrast borders for layout containers.

---

## 5. Components

### High-Density Tables
- **Styling:** Forbid horizontal and vertical divider lines.
- **Separation:** Use a 4px `surface_container_low` background on hover. Use `body-sm` for data to maximize information density without clutter.
- **Alignment:** Numbers are always right-aligned; text is left-aligned.

### Refined KPI Cards
- **Structure:** `surface_container_lowest` background. No border.
- **Shadow:** Small ambient shadow to suggest importance.
- **Typography:** Use `headline-md` for the primary metric.

### Elegant Status Badges
Status badges use a "Muted Signal" approach. Use `secondary_container` as the base.
- **Normal:** `secondary` text on `surface_container_high`.
- **Missing:** `outline` text on `surface_container_low`.
- **Suspected Error:** `error` text on `error_container` (keep opacity low).
- **Review Required:** `on_primary_container` text on `primary_fixed`.

### Input Fields
- **Background:** `surface_container_lowest`.
- **Border:** 1px Ghost Border (`outline_variant` at 20%).
- **Focus State:** 1px `primary` border—a sharp, decisive change.

### Integrated Chart Containers
Charts should feel "printed" on the page. Use `surface_container_lowest` for the container and ensure the chart's grid lines use `outline_variant` at 10% opacity. Avoid bright "startup" colors; use the palette's `slate`, `charcoal`, and `muted blue`.

---

## 6. Do’s and Don’ts

### Do
- **Do** use whitespace as a structural element. If a section feels crowded, increase padding rather than adding a line.
- **Do** use `letter-spacing: -0.01em` on headlines for a tighter, premium editorial feel.
- **Do** use the `Roundedness Scale` of `0.25rem` (md) for buttons and cards to maintain a structured, professional geometry.

### Don’t
- **Don’t** use pure #000000 for text. Use `on_surface` (#191c1e) to keep the "ink on paper" feel.
- **Don’t** use flashy gradients or "gamified" animations. Transitions should be fast and linear (e.g., 150ms).
- **Don’t** use standard 1px grey dividers in lists. Use `8px` or `12px` of vertical space to separate items instead.
- **Don't** use "Startup Blue." Stick to the muted, professional `primary_container` (#131b2e) for all major brand accents.