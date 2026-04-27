```markdown
# Design System Specification: The Strategic Ledger

## 1. Overview & Creative North Star
This design system is engineered for the high-stakes world of institutional logistics real estate. It moves away from the frenetic, rounded aesthetic of consumer SaaS to embrace **"The Strategic Ledger."** 

The Creative North Star—**The Strategic Ledger**—represents a dual commitment to analytical precision and editorial elegance. It mimics the clarity of a high-end financial audit cross-pollinated with the layout discipline of an architectural journal. We achieve this through intentional asymmetry, a strict rejection of decorative "fluff," and a reliance on tonal depth rather than structural lines. The goal is to make the user feel like they are navigating a definitive, permanent record of truth.

---

## 2. Colors & Tonal Logic
The palette is rooted in architectural materials: concrete, steel, and warm parchment. It avoids pure blacks and whites to reduce eye strain during deep analytical work.

### Core Palette
*   **Background (`#f9f9f8`):** A warm, paper-like white. This is the "base" of our ledger.
*   **Primary (`#091426`):** Deep navy. Reserved for the most critical navigational anchors and high-level headers.
*   **Secondary/Accent (`#3B82F6`):** A muted, professional blue used only for functional calls to action and interactive states.
*   **Surface Tiers:** 
    *   `surface-container-lowest`: `#ffffff` (Floating cards/active inputs)
    *   `surface-container-low`: `#f3f4f3` (Sectional backgrounds)
    *   `surface-container-highest`: `#e2e2e2` (De-emphasized utility areas)

### The "No-Line" Rule
To achieve a premium editorial feel, **explicitly prohibit 1px solid borders for sectioning.** Large layout blocks must be defined by shifts in background color (e.g., a `surface-container-low` sidebar against a `background` canvas). Contrast, not lines, defines the architecture.

### Glass & Texture
For floating modals or popovers, use **Glassmorphism**: 
*   **Fill:** `surface-container-lowest` at 80% opacity.
*   **Effect:** `backdrop-blur` (12px to 20px).
*   **Signature Gradient:** For primary Action Buttons, use a subtle vertical gradient from `primary` to `primary-container` to add a sense of "weight" and physical presence.

---

## 3. Typography
Typography is our primary tool for establishing order. We use two typefaces to balance the "Editorial" and the "Analytical."

*   **Display & Headlines (Manrope):** A geometric sans-serif that feels modern yet authoritative. 
    *   *Strategy:* Use `headline-lg` with tight tracking (-0.02em) and `medium` weight to create a "locked-in" institutional look.
*   **Body & Utility (Inter):** High-legibility sans-serif for data density.
    *   *Strategy:* Use `body-md` for standard data. Ensure a strict 1.5x line height for readability in long-form asset descriptions.

### Typographic Hierarchy
| Role | Token | Font | Size | Weight | Tracking |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-md` | Manrope | 2.75rem | 600 | -0.02em |
| **Section Head** | `headline-sm` | Manrope | 1.5rem | 500 | -0.01em |
| **Data Label** | `label-md` | Inter | 0.75rem | 600 | 0.05em (Uppercase) |
| **Body Text** | `body-md` | Inter | 0.875rem | 400 | Normal |

---

## 4. Elevation & Depth
In this system, depth is a matter of "Tonal Layering." We treat the interface as physical sheets of archival paper.

*   **The Layering Principle:** Instead of shadows, stack containers. Place a `surface-container-lowest` card (brightest) on top of a `surface-container-low` section to create a natural, soft lift.
*   **Ambient Shadows:** If a component must "float" (e.g., a dropdown or a critical modal), use an ultra-diffused shadow.
    *   *Spec:* `0 12px 32px -4px rgba(30, 41, 59, 0.08)`. The shadow color is a tint of the `on-surface` color, never pure gray.
*   **The "Ghost Border" Fallback:** If a boundary is strictly required for accessibility, use the `outline-variant` token at **15% opacity**. This creates a suggestion of a container without breaking the "No-Line" rule.
*   **Corner Radius:** A strict `4px` (`DEFAULT`) maximum. This provides just enough softness to feel "designed" while maintaining the sharp, professional edge of a ledger.

---

## 5. Components

### Cards & Containers
Cards must never have visible borders or heavy shadows.
*   **Styling:** Use `surface-container-lowest` background. 
*   **Separation:** Use the Spacing Scale (24px or 32px) to separate content. **Do not use divider lines.** The whitespace is the divider.

### Buttons
*   **Primary:** Background: `primary` gradient to `primary-container`. Typography: `on-primary`, semi-bold. Radius: 4px.
*   **Secondary:** Background: `surface-container-high`. Typography: `on-surface`. No border.
*   **Tertiary:** No background. `primary` text. Underline only on hover.

### Input Fields
*   **State:** Default state uses `surface-container-low` background with a `Ghost Border`.
*   **Focus:** The border transitions to `secondary` (#3B82F6) at 100% opacity, and the background shifts to `surface-container-lowest`.

### Data Grids (The "Ledger" View)
*   **Header:** `primary-container` background with `on-primary-fixed` text.
*   **Rows:** Alternate between `background` and `surface-container-low` for zebra striping.
*   **Visual Soul:** Use desaturated status indicators (e.g., teal for "Stable") as small 6px pips rather than large colored badges.

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical layouts. For example, a wide data column next to a narrow, high-density summary rail.
*   **Do** lean into "Super-Grids." Align every element to a strict 8px baseline. Precision is the foundation of trust.
*   **Do** use "Editorial" white space. Give the most important asset metrics 64px of clearance to let them breathe.

### Don't
*   **Don't** use 100% opaque 1px borders to separate content blocks. Use tonal shifts.
*   **Don't** use standard "SaaS" iconography (rounded, thick strokes). Use thin-stroke (1px or 1.5px) icons that match the weight of the Inter typeface.
*   **Don't** use vibrant, saturated colors for charts. Use the muted tones from the `tertiary` and `secondary` fixed ranges to ensure the data feels "institutional."
*   **Don't** use large corner radii. Anything above 8px will break the "Strategic Ledger" aesthetic.

---

## 7. Directional Note for Junior Designers
When in doubt, simplify. If a section feels cluttered, don't add a border—add 16px of padding. If a hierarchy feels flat, don't change the color—increase the font weight or the tracking. We are not building a "tool"; we are crafting an "instrument" for high-capital decision-making. Make every pixel feel intentional.```