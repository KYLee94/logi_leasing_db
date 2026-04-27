# Design System Specification: The Luminescent Dashboard

## 1. Overview & Creative North Star
The "Luminescent Dashboard" is a design system engineered to bridge the gap between high-density data utility and editorial elegance. The **Creative North Star** for this system is **"The Hyper-Digital Atelier."** 

We are moving away from the rigid, "boxed-in" feel of standard SaaS dashboards. Instead, we treat the interface as a living environment where information floats on light and shadow. This system uses intentional asymmetry in card sizing, breathing room through exaggerated white space, and a sophisticated interplay of matte surfaces versus glowing data points to create an authoritative, premium experience.

---

## 2. Colors & Tonal Depth

Our palette is anchored by the primary neon green (`#b8fd4b`), which serves as a high-energy beacon against deep charcoals and soft whites.

### Primary Tokens
- **Primary:** `#b8fd4b` (The signature neon glow)
- **Primary Container:** `#83c300` (Used for active states and highlights)
- **Background:** `#0c0e0f` (The void; deep charcoal for dark mode)
- **Surface:** `#0c0e0f` (The base layer)

### Semantic States
- **Error:** `#ff7351` (Warm coral, high visibility)
- **Secondary:** `#dae7cb` (Desaturated sage for low-priority accents)
- **Tertiary:** `#fffae4` (Off-white for warm, light-mode elegance)

### The "No-Line" Rule
**Borders are strictly prohibited for sectioning.** This design system relies on tonal shifts to define space. 
- To separate a sidebar from a main feed, use a shift from `surface` to `surface-container-low`.
- To highlight a section, place it on `surface-bright`.
- **The Glass & Gradient Rule:** For hero metrics (e.g., total revenue), use a semi-transparent `surface-variant` with a 20px `backdrop-blur`. Apply a subtle linear gradient from `primary` to `primary_container` at 15% opacity to give the card a "soul."

---

## 3. Typography

The system utilizes **Inter** as its workhorse, but we treat it with editorial intent. The contrast between massive `display` figures and microscopic `label-sm` metadata creates a sense of hierarchy and scale.

| Token | Size | Weight | Use Case |
| :--- | :--- | :--- | :--- |
| **display-lg** | 3.5rem | 700 | Primary KPIs (e.g., "$3.1M") |
| **headline-sm**| 1.5rem | 600 | Card Titles and Section Headers |
| **title-sm**   | 1.0rem | 500 | Sidebar Navigation Labels |
| **body-md**    | 0.875rem| 400 | General metadata and table rows |
| **label-sm**   | 0.68rem | 700 | Uppercase micro-copy / Badges |

**Hierarchy Note:** Always pair a `display-lg` metric with a `label-sm` descriptor. This extreme contrast in scale is a hallmark of high-end data design.

---

## 4. Elevation & Depth: Tonal Layering

We convey hierarchy through **Tonal Layering** rather than structural lines.

### The Layering Principle
Stacking tiers creates a natural sense of proximity. 
*   **Base:** `surface`
*   **In-page sections:** `surface-container-low`
*   **Actionable Cards:** `surface-container-highest`

### Ambient Shadows
For floating elements (modals, dropdowns, hovered cards), use "Ambient Shadows":
- **Shadow Token:** `0 24px 48px -12px rgba(0, 0, 0, 0.45)`
- The shadow color should be a tinted version of `on-surface` at 5% opacity to mimic light bouncing off the neon accents.

### The "Ghost Border"
If a border is necessary for accessibility (e.g., input fields), use a **Ghost Border**:
- `outline-variant` at **15% opacity**. Never use 100% opaque borders.

---

## 5. Components

### Navigation Sidebar
- **Background:** `surface_container_low`
- **Active State:** The active item uses a `primary_fixed` background with `on_primary_fixed` text. The corner radius must be `full` to create a pill-like visual.
- **Icons:** Thin-stroke (1.5px) icons only.

### Cards & Data Viz
- **The Container:** `surface_container` with `xl` (1.5rem) corner radius.
- **Data Viz Colors:**
    - **Trend Up:** `primary` (#b8fd4b)
    - **Trend Down:** `error` (#ff7351)
    - **Neutral:** `secondary_dim` (#ccd9bd)
- **Charts:** Line charts must utilize a gradient fill under the line, transitioning from `primary` (20% opacity) to `transparent`.

### Buttons
- **Primary:** Solid `primary` background. `sm` (0.25rem) corner radius for a sharp, technical look.
- **Secondary:** Transparent background with a `ghost border`.
- **States:** On hover, apply a `primary_dim` glow effect using a `0px 0px 15px` outer shadow of the same color.

### Input Fields
- **Background:** `surface_container_highest`.
- **Transition:** On focus, the ghost border opacity increases to 40% and the label shifts to `primary`.

---

## 6. Do’s and Don'ts

### Do
- **Use "Breathing Room":** Maintain at least 32px of padding inside all major cards.
- **Embrace Asymmetry:** If a dashboard has three cards, make the primary metric card 60% width and the others 20% each to break the "grid" feel.
- **Color Logic:** Use the `primary` neon color sparingly. It should be the "north star" of the eye, leading the user to the most important data point.

### Don’t
- **No Divider Lines:** Never use a `1px` line to separate table rows. Use a 4px vertical gap or a subtle `surface-variant` background on hover instead.
- **No Pure Black:** Never use `#000000` for backgrounds (except in specific "lowest" container levels). Use the `surface` token (#0c0e0f) to maintain depth.
- **No High-Contrast Borders:** Avoid any border that creates a hard visual "snap." Surfaces should melt into one another.

---

## 7. Roundedness Scale
| Token | Value | Application |
| :--- | :--- | :--- |
| **none** | 0px | High-utility data tables |
| **sm** | 0.25rem | Buttons, Input fields |
| **md** | 0.75rem | Inner nested cards |
| **xl** | 1.5rem | Primary Layout Cards / Containers |
| **full** | 9999px | Badges, Search bars, Active nav states |