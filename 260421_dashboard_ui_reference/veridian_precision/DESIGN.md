# Design System Strategy: The Precision Ledger

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Precision Ledger."** 

In high-density environments, the temptation is to clutter. This system rejects that impulse, instead drawing inspiration from high-end horology and technical drafting. It is designed for the "expert user"—someone who requires maximum data visibility without sacrificing the aesthetic of a premium, editorial experience. By utilizing a compact grid, micro-typography, and a sophisticated neon-on-neutral palette, we create an interface that feels like a finely tuned instrument rather than a basic utility.

We break the "template" look through **Rigid Minimalist Asymmetry**. While the grid is tight, we use the `display-lg` typography to create massive scale shifts against 12px body text, ensuring the layout feels intentional, prestigious, and architecturally sound.

---

## 2. Colors & Surface Architecture
The palette is anchored by a clinical, near-white foundation (`#F9FAFB`), punctuated by the electric energy of the `#A3E635` neon green.

### Surface Hierarchy & Nesting
To achieve depth in a high-density layout without using heavy shadows, we employ **Tonal Nesting**. The UI is treated as a series of recessed and raised planes:
*   **Base Layer:** `surface` (#F8F9FA) for the primary application background.
*   **Secondary Content Areas:** `surface_container_low` for sidebars or utility panels.
*   **Interactive Components:** `surface_container_lowest` (#FFFFFF) for cards and input fields to make them "pop" against the slightly darker base.

### The "Ghost Border" Protocol
While the system avoids heavy structural lines, it utilizes **Ghost Borders** for definition. 
*   **The Rule:** Prohibit 100% opaque, high-contrast borders. Instead, use the `outline_variant` token at 15–20% opacity. This provides a "technical" edge that defines boundaries without breaking the visual flow of the high-density grid.

### The "Glass & Gradient" Rule
To inject "soul" into the professional aesthetic:
*   **CTAs:** Use a subtle linear gradient from `primary` (#446900) to `primary_container` (#A3E635) at a 45-degree angle.
*   **Overlays:** Floating menus must use `surface_container_highest` with a 70% opacity and a `12px` backdrop-blur to create a "frosted glass" effect, ensuring the underlying data remains visible but diffused.

---

## 3. Typography
The typography scale is built on **Inter**, chosen for its mathematical clarity at small scales.

| Role | Token | Size | Tracking | Weight |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-lg` | 3.5rem | -0.02em | 700 (Bold) |
| **Title** | `title-sm` | 1.0rem | 0.01em | 600 (Semi-Bold) |
| **Body (Default)** | `body-sm` | 0.75rem (12px) | 0.01em | 400 (Regular) |
| **Caption/Label** | `label-sm` | 0.6875rem (11px) | 0.03em | 500 (Medium) |
| **Micro-Caption** | Custom | 0.625rem (10px) | 0.05em | 700 (Bold/All-Caps) |

**Editorial Intent:** Use `display-lg` sparingly for section headers to create a "monumental" feel that anchors the smaller, high-density data tables and lists surrounding it.

---

## 4. Elevation & Depth: Tonal Layering
In "The Precision Ledger," depth is a product of color, not physics. 

*   **Layering Principle:** Instead of shadows, move from "Low" to "Highest" surface containers to indicate hierarchy. A `surface_container_highest` element should represent the most actionable or urgent information.
*   **Ambient Shadows:** If a component must float (e.g., a Toast notification), use a "Tinted Ambient Shadow." Set the shadow color to 8% opacity of the `primary` tone rather than black. Blur radius should be a wide `16px` to avoid a "heavy" look.
*   **Subtle Roundness:** To maintain the compact grid's integrity, use the `md` (0.375rem / 6px) or `lg` (0.5rem / 8px) tokens. This keeps the edges sharp enough to feel professional, but soft enough to remain modern.

---

## 5. Components

### Buttons
*   **Primary:** Background: `primary_container` (#A3E635) | Text: `on_primary_container` (#416400).
*   **Style:** Height capped at `32px` for high-density. Padding: `0 12px`. 
*   **Interaction:** On hover, shift background to `primary_fixed_dim`.

### Input Fields
*   **Construction:** Height: `28px`. Background: `surface_container_lowest`. 
*   **Border:** 1px Ghost Border (`outline_variant` at 20%). 
*   **Focus State:** Border becomes 1px solid `primary` (#446900) with a 2px outer "glow" of `#A3E635` at 10% opacity.

### Compact Cards & Lists
*   **The No-Divider Rule:** Explicitly forbid 1px divider lines between list items. Use a 4px vertical gap or a subtle `surface_container_low` hover state to separate items.
*   **Density:** Vertical padding in list items is restricted to `4px` or `8px` maximum.

### Data Chips
*   **Visuals:** Use `label-sm` (11px). Background: `secondary_container`. 
*   **Geometry:** Use `full` (9999px) roundness to create a visual "pill" that breaks the rectangular rigidity of the grid.

---

## 6. Do's and Don'ts

### Do
*   **Do** use strict alignment. In a high-density layout, if one element is off by 1px, the entire system looks broken.
*   **Do** use "Visual Air"—intentional gaps of 16px or 24px between major functional blocks—to allow the eye to rest between data-heavy clusters.
*   **Do** leverage the Neon Green (`#A3E635`) for critical status indicators or primary CTAs only. Excessive use will fatigue the user.

### Don't
*   **Don't** use standard "Drop Shadows" for cards. Use background color shifts (`surface` to `surface_container_low`).
*   **Don't** use 14px or 16px text for body copy. This system is optimized for a 12px `body-sm` standard to maximize information density.
*   **Don't** use high-contrast black text on white backgrounds. Use `on_surface` (#191C1D) on `surface` (#F8F9FA) for a softer, premium contrast.