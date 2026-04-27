# Design System Document: The Architectural Ledger

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Architectural Ledger."** 

This system is designed to evoke the permanence of a blueprints and the precision of a high-stakes financial audit. We are moving away from the "SaaS-standard" look of rounded bubbles and playful animations. Instead, we embrace a high-end editorial experience that prioritizes information density, operational rigor, and absolute control. 

Through intentional asymmetry—such as placing heavy typographic headers against expansive white space—we create a sense of institutional authority. The layout should feel like a bespoke financial broadsheet: rigid, disciplined, and unapologetically technical.

---

## 2. Colors
The palette is a study in restraint. We utilize a range of tonal greys and deep charcoals to establish hierarchy, reserving the single 'Institutional Blue' for moments of strategic importance.

### Palette Strategy
*   **Primary (#545f73):** Used for primary actions and structural emphasis.
*   **Institutional Blue (#1e293b):** This is our "High-Trust" accent. Use it sparingly for primary buttons, active states, or critical data flags.
*   **Surface Tiers:** Use `surface_container_lowest` (#ffffff) for the main content "paper" and `surface_container_low` (#f0f4f7) for structural sidebars or secondary zones.

### The "No-Line" Rule
While the user prompt suggests 1px borders, as a signature experience, we must prioritize **background shifts** to define primary sections. Reserve the `outline_variant` (#a9b4b9) only for internal table structures. For layout-level sectioning, use a transition from `surface` (#f7f9fb) to `surface_container_low` (#f0f4f7). This creates a "milled" look rather than a "boxed" look.

### The "Glass & Gradient" Rule
To add a layer of premium depth to a rigid system, use `surface_container_lowest` at 80% opacity with a `20px` backdrop-blur for floating modals or navigation bars. This prevents the UI from feeling flat or "legacy" while maintaining its analytical edge.

---

## 3. Typography
We use **Manrope** exclusively. It provides a geometric skeleton that feels modern but retains the gravity of a classic grotesque.

*   **The Power of Contrast:** High-end editorial feel is achieved through weight variance. Use `ExtraBold` (700 or 800 weight) for `display` and `headline` levels, and `Regular` (400) for `body` text. 
*   **Display-LG (3.5rem):** Reserved for portfolio-level totals or high-level status.
*   **Headline-SM (1.5rem):** The workhorse for section titles. Always `ExtraBold`.
*   **Label-MD (0.75rem):** Used for technical metadata. Tight tracking (e.g., +2%) for a "ledger" look.

Typography is our primary tool for hierarchy. A large, bold number next to a small, regular-weight label provides more clarity than any icon or shadow could.

---

## 4. Elevation & Depth
In this system, depth is a function of **Tonal Layering** rather than light and shadow.

*   **The Layering Principle:** Stacking determines importance. 
    *   Level 0: `surface` (The base).
    *   Level 1: `surface_container_low` (The structural background).
    *   Level 2: `surface_container_lowest` (The "Sheet" where data lives).
*   **Ambient Shadows:** For floating elements, use a "Ghost Shadow." 
    *   `box-shadow: 0 4px 24px rgba(42, 52, 57, 0.06);` 
    *   The shadow must be barely perceptible, mimicking natural light hitting a thick sheet of cardstock.
*   **The Ghost Border:** For table headers or input fields, use the `outline_variant` at 20% opacity. It should act as a subtle guide, not a barrier.

---

## 5. Components

### Tables: The Hero Component
Tables are the heart of an asset management platform. 
*   **Styling:** No vertical borders. Use 1px `outline_variant` at 15% opacity for horizontal row separators only.
*   **Spacing:** Generous cell padding (16px vertical, 24px horizontal). 
*   **Header:** `label-md` in `on_surface_variant`, all-caps, with a 1px border-bottom.

### KPI Cards
*   **Style:** Typographic-first. 
*   **Layout:** Top-aligned `headline-lg` for the value. Bottom-aligned `label-sm` for the metric name. 
*   **Background:** Use `surface_container_lowest` with a 2px radius (token: `sm`).

### Buttons
*   **Primary:** Background `primary` (#545f73), text `on_primary`. Sharp 2px corners.
*   **Secondary:** Background `transparent`, border 1px `outline`. 
*   **Tertiary:** No border, no background. Underline on hover only.

### Inputs
*   **Style:** Rectangular, 2px radius. 
*   **Default State:** `surface_container_highest` background with a subtle bottom-border in `outline`.
*   **Focus State:** Border-bottom becomes `Institutional Blue` (#1e293b).

### Minimal Charts
*   **Colors:** Use `primary`, `secondary`, and `tertiary` tokens. 
*   **Geometry:** No rounded ends on bar charts. Use thin 1px stroke lines for grid axes. Remove all unnecessary "chart junk" (labels should only appear on hover or at key intervals).

---

## 6. Do’s and Don'ts

### Do
*   **Do** use extreme white space. If you think there is enough margin, add 16px more.
*   **Do** align everything to a strict 8px grid. Alignment is the key to "Absolute Control."
*   **Do** use monochromatic icons (24px, 1.5pt stroke) only when necessary for navigation.

### Don’t
*   **Don’t** use rounded corners above 4px. Anything "pill-shaped" is prohibited.
*   **Don’t** use colorful status badges. Use text labels with a 4px colored "status dot" next to them for `error` or `success`.
*   **Don’t** use trendy "bento box" layouts. Use a traditional, sophisticated column-based grid.
*   **Don’t** use animations that bounce or slide. Use simple "Fade In" or "Instant" transitions to maintain a serious, high-velocity tone.