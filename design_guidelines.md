# Victron Schematic App - Design Guidelines

## Design Approach: Design System Framework

**Selected System**: Material Design 3 with technical tool adaptations
**Justification**: This utility-focused electrical design application requires precision, clarity, and information density. Material Design 3 provides robust component patterns for complex data visualization, drag-and-drop interactions, and technical tooling while maintaining professional aesthetics.

**Key Design Principles**:
- **Clarity First**: Technical accuracy and readability override decorative elements
- **Spatial Efficiency**: Dense information presentation without visual clutter  
- **Purposeful Color**: Color indicates status, warnings, and electrical properties
- **Professional Precision**: Clean, engineering-grade visual language

---

## Core Design Elements

### A. Color Palette

**Light Mode**:
- Primary: 210 100% 45% (Technical Blue - represents electrical/Victron brand)
- Surface: 210 20% 98% (Clean workspace background)
- Surface Variant: 210 15% 94% (Canvas/diagram area)
- Error/Warning: 0 70% 50% (Critical alerts)
- Success: 142 71% 45% (Proper connections/calculations)
- On-Surface: 210 15% 15% (Primary text)
- On-Surface Variant: 210 10% 40% (Secondary text)

**Dark Mode**:
- Primary: 210 100% 60% (Brighter for contrast)
- Surface: 210 15% 8% (Dark workspace)
- Surface Variant: 210 12% 12% (Canvas area)
- Error/Warning: 0 70% 60%
- Success: 142 71% 55%
- On-Surface: 210 5% 95% (Primary text)
- On-Surface Variant: 210 8% 70% (Secondary text)

**Functional Colors**:
- Wire Positive: 0 70% 50% (Red)
- Wire Negative: 210 15% 15% (Black/Dark)
- Wire AC Hot: 0 70% 50% (Red)
- Wire AC Neutral: 210 5% 95% (White)
- Wire Ground: 142 71% 45% (Green)
- Component Highlight: 45 100% 50% (Gold for selected state)

### B. Typography

**Font Family**: 
- Primary: "Inter" (Google Fonts) - Excellent for technical interfaces, high legibility
- Monospace: "JetBrains Mono" (Google Fonts) - For specifications, calculations, wire labels

**Type Scale**:
- Display (Hero/Headers): 32px / 2rem, Weight 600
- Title (Section Headers): 24px / 1.5rem, Weight 600
- Headline (Component Names): 20px / 1.25rem, Weight 500
- Body (General UI): 16px / 1rem, Weight 400
- Label (Field Labels): 14px / 0.875rem, Weight 500
- Caption (Metadata): 12px / 0.75rem, Weight 400
- Monospace (Specs): 14px / 0.875rem, Weight 400

### C. Layout System

**Spacing Primitives**: Tailwind units of **2, 4, 8, 12, 16** (p-2, m-4, gap-8, py-12, h-16)
- Micro spacing: 2 (8px) - Between related inline elements
- Component padding: 4 (16px) - Internal component spacing
- Section gaps: 8 (32px) - Between distinct UI groups
- Panel padding: 12 (48px) - Major container spacing
- Hero/Feature spacing: 16 (64px) - Large visual breathing room

**Grid System**:
- Main Canvas: Full viewport with fixed sidebars
- Left Toolbar: 280px fixed width (component library)
- Right Panel: 320px fixed width (properties/calculations)
- Canvas: Flexible center area with grid overlay (20px × 20px snap grid)

### D. Component Library

**Navigation & Controls**:
- Top App Bar: Fixed 64px height, contains project controls, AI prompt button, export options
- Tool Palette (Left): Collapsible sections for component categories (Victron, Generic, Custom)
- Properties Panel (Right): Tabbed interface for component specs, wire calculations, outputs

**Canvas Components**:
- Component Blocks: Rounded rectangles (12px radius) with icon, label, status indicator
- Connection Lines: SVG paths with arrowheads, color-coded by wire type, 3px stroke weight
- Wire Labels: Floating badges showing amperage, gauge, length calculations
- Selection State: 2px gold border with subtle drop shadow
- Grid Overlay: Dotted 1px lines at 20px intervals (toggle-able)

**Forms & Inputs**:
- Text Fields: Material outlined style, 48px height, focused state with primary color
- Dropdowns: Custom select with component thumbnails for visual selection
- Number Inputs: Steppers for precise value adjustment
- Toggle Switches: For load on/off states, calculation modes

**Data Display**:
- Calculation Cards: Elevated cards showing wire sizing results, voltage drop, total load
- Component Specs Table: Dense data grid with monospace numbers
- Shopping List: Grouped by category with quantity, part numbers, pricing placeholders
- Warning Badges: Amber/red pills for undersized wires, overload conditions

**AI Interface**:
- Prompt Input: Large textarea (240px height) with send button
- Suggestion Cards: Generated system previews with "Apply to Canvas" action
- Iteration Controls: Refine, regenerate, save options

**Dialogs & Overlays**:
- Export Modal: Multi-step wizard for diagram/label/BOM generation
- Custom Component Creator: Form-based dialog for user-defined components
- Settings Panel: Slide-out drawer from top bar

### E. Interaction Patterns

**Drag & Drop**:
- Ghost preview while dragging (60% opacity)
- Snap-to-grid feedback with subtle animation
- Drop zone highlighting with dashed border
- Connection points appear on hover (small circles on component edges)

**Wiring Workflow**:
- Click component port to start wire → cursor shows active wire → click destination port
- Wire automatically routes with orthogonal paths (avoid diagonal lines)
- Click wire to show inline property editor (gauge, length, label)

**Responsiveness**:
- Desktop First: Optimized for 1440px+ screens (primary use case)
- Tablet (1024px): Collapsible sidebars, preserve canvas
- Mobile (768px): Not supported - show message to use desktop

### F. Visual Enhancements

**Micro-interactions** (minimal):
- Component hover: Subtle elevation increase (shadow depth)
- Button press: Slight scale down (0.98) with no color change
- Wire connection: Brief pulse animation on successful connection
- Calculation update: Number count-up animation for dramatic changes

**Status Indicators**:
- Connection Status: Green dot (connected), gray (disconnected), red (error)
- Calculation Validity: Check icon (valid), warning triangle (caution), X (invalid)
- Load Status: Battery charge level visual, power flow arrows

---

## Images & Assets

**Icons**: Heroicons (via CDN) for UI controls, custom technical icons for components
- Use outline style for inactive states, solid for active/selected
- Electrical symbols library (batteries, inverters, controllers) - placeholder comments for custom SVGs

**Component Thumbnails**: 
- Simplified schematic representations of each Victron product
- 80×80px size for library, 120×120px for canvas
- High contrast vector graphics with brand colors

**No hero images** - This is a utility application focused on the workspace canvas

---

## Accessibility & Usability

- Maintain WCAG AA contrast ratios (4.5:1 for text, 3:1 for UI components)
- Dark mode as default with persistent toggle in app bar
- Keyboard shortcuts for common actions (Ctrl+Z undo, Ctrl+S save, Delete remove component)
- Form inputs maintain dark backgrounds with proper contrast borders
- Focus indicators: 2px blue outline on interactive elements
- Screen reader labels for all canvas components and connections