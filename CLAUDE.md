# CLAUDE.md - Victron Designer AI Assistant Guide

## Project Overview

**Victron Designer** is a professional electrical schematic design tool for Victron energy systems (solar/power systems). It provides a drag-and-drop interface with terminal-based wire connections, automatic wire sizing calculations based on ABYC/NEC standards, real-time orthogonal wire routing with grid snapping, and AI-powered system recommendations.

**User Preference**: Use simple, everyday language when communicating about this project.

## Quick Reference

- **Main Entry**: `server/index.ts` (Express backend)
- **Frontend Entry**: `client/src/main.tsx` (React + Vite)
- **Schema**: `shared/schema.ts` (TypeScript types & Drizzle ORM)
- **Canvas Dimensions**: 2000px × 1500px
- **Grid Size**: 20px snap grid
- **Design Guidelines**: `design_guidelines.md` (Material Design 3 adapted for technical tools)

## Codebase Structure

```
VictronDesigner/
├── client/src/           # React frontend
│   ├── components/       # UI components
│   │   ├── ui/          # Shadcn/ui components (Radix UI primitives)
│   │   ├── SchematicCanvas.tsx    # Main canvas component
│   │   ├── SchematicComponent.tsx # Individual component renderer
│   │   ├── ComponentLibrary.tsx   # Component palette
│   │   ├── PropertiesPanel.tsx    # Right sidebar
│   │   ├── AIPromptDialog.tsx     # AI generation UI
│   │   ├── ExportDialog.tsx       # Export functionality
│   │   └── TopBar.tsx             # Application header
│   ├── lib/             # Utility libraries
│   │   ├── terminal-config.ts     # Terminal definitions for all components
│   │   ├── wire-routing.ts        # Orthogonal routing algorithm
│   │   ├── theme-provider.tsx     # Dark/light mode
│   │   └── utils.ts               # General utilities
│   ├── pages/           # Page components
│   │   └── SchematicDesigner.tsx  # Main app page
│   └── hooks/           # React hooks
│
├── server/              # Express backend
│   ├── index.ts         # Server entry point
│   ├── routes.ts        # API endpoints
│   ├── wire-calculator.ts         # ABYC/NEC wire sizing
│   ├── export-utils.ts            # Shopping lists, labels, reports
│   ├── storage.ts                 # Database abstraction
│   └── vite.ts                    # Dev server integration
│
├── shared/              # Shared TypeScript types
│   └── schema.ts        # Data models, Drizzle schema, Zod validators
│
├── design_guidelines.md # Design system documentation
├── replit.md           # Project overview and recent changes
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── vite.config.ts      # Vite bundler config
├── tailwind.config.ts  # Tailwind CSS config
└── drizzle.config.ts   # Database ORM config
```

## Technology Stack

### Frontend
- **Framework**: React 18.3 with TypeScript
- **Build Tool**: Vite 5.4
- **Routing**: Wouter 3.3 (lightweight React Router alternative)
- **State Management**: TanStack Query (React Query) for server state
- **UI Library**: Shadcn/ui (New York variant) built on Radix UI primitives
- **Styling**: Tailwind CSS 3.4 with custom design tokens
- **Theming**: next-themes for dark/light mode
- **Icons**: Lucide React

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js 4.21
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Drizzle ORM 0.39 with Zod validation
- **Session Storage**: PostgreSQL-backed sessions (connect-pg-simple)
- **AI Integration**: OpenAI API (GPT-4o-mini)

### Development Tools
- **TypeScript**: 5.6.3 with strict mode
- **ESBuild**: For production server bundling
- **tsx**: For development server with hot reload
- **Replit Plugins**: Cartographer, dev banner, runtime error modal

## Key Architectural Patterns

### Path Aliases
TypeScript path aliases are configured in `tsconfig.json`:
- `@/*` → `client/src/*` (frontend code)
- `@shared/*` → `shared/*` (shared types)
- `@assets/*` → `attached_assets/*` (images)

**Always use these aliases** instead of relative paths for imports.

### Monorepo Structure
This is a **monorepo** with client, server, and shared code in one repository. The build process:
1. Development: `npm run dev` runs tsx server with Vite dev middleware
2. Production: `npm run build` builds Vite frontend to `dist/public/` and esbuild bundles server to `dist/`
3. Start: `npm start` runs the production server

### Database Schema (Drizzle ORM)
Located in `shared/schema.ts`:

```typescript
// Database tables
users: { id, username, password }
schematics: { id, name, description, systemVoltage, components (JSONB), wires (JSONB), createdAt, updatedAt }

// Key types
SchematicComponent: { id, type, name, x, y, properties }
Wire: { id, fromComponentId, toComponentId, fromTerminal, toTerminal, polarity, length, gauge, current, voltageDrop, color }
```

**Important**: `components` and `wires` are stored as JSONB arrays in PostgreSQL.

## Terminal System - Critical Concept

### Terminal Configuration
Each component type has **defined terminal connection points** in `client/src/lib/terminal-config.ts`. This is a **critical file** for understanding how components connect.

**Terminal Types**:
- `positive` / `negative` - DC power terminals
- `ground` - Data/communication terminals
- `ac-in` / `ac-out` - AC power terminals
- `pv-positive` / `pv-negative` - Solar panel terminals

**Terminal Properties**:
```typescript
interface Terminal {
  id: string;              // Unique ID (e.g., "dc-positive", "pos-1")
  type: TerminalType;      // Terminal type
  label: string;           // Display label
  x: number;               // Relative X position from component top-left
  y: number;               // Relative Y position from component top-left
  color: string;           // CSS color variable
  orientation: "left" | "right" | "top" | "bottom";  // Wire exit direction
}
```

### Component Dimensions (Critical for AI Generation)
When AI generates systems, components must not overlap. Minimum spacing:
- **Horizontal**: 300px between component centers
- **Vertical**: 250px between component centers

```typescript
// Component sizes (width × height)
multiplus: 180×140px
mppt: 160×130px
cerbo: 180×120px
bmv: 140×140px
smartshunt: 140×130px
battery: 160×110px
solar-panel: 140×120px
ac-load: 120×100px
dc-load: 120×100px
busbar-positive: 200×60px
busbar-negative: 200×60px
```

### Terminal IDs by Component
**Critical reference** for wiring:

```typescript
multiplus: "ac-in", "ac-out", "dc-positive", "dc-negative"
mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
cerbo: "data-1", "data-2", "data-3", "power"
bmv: "data"
smartshunt: "negative" (battery side), "system-minus" (system side), "data"
battery: "positive", "negative"
solar-panel: "positive", "negative"
ac-load: "ac-in"
dc-load: "positive", "negative"
busbar-positive: "pos-1" through "pos-6"
busbar-negative: "neg-1" through "neg-6"
```

## Wire Routing Algorithm

### Key File: `client/src/lib/wire-routing.ts`

**Grid Snapping**: All coordinates snap to 20px grid for clean alignment.

**Orthogonal Routing**: Wires use only horizontal and vertical segments with rounded corners (no diagonal lines).

**Early Offset Strategy**:
- Wires separate immediately from source (2×GRID_SIZE = 40px exit distance)
- Each wire maintains dedicated lane throughout journey
- Distance-based routing: simple for close components (<120px), offset lanes for distant components
- Overshoot prevention: exit/entry distances clamped to 1/3 total distance

**Two Routing Functions**:
1. `calculateOrthogonalPathWithOrientation()` - Uses terminal orientations (preferred)
2. `calculateOrthogonalPath()` - Legacy function with wireOffset parameter

**Wire Length Calculation**:
- Euclidean distance in pixels / pixels-per-inch / 12 (convert to feet)
- Adds 20% for routing and connections

## Wire Sizing - ABYC/NEC Standards

### Key File: `server/wire-calculator.ts`

**Wire Gauge Data**: Resistance and ampacity tables for AWG sizes 18 through 4/0.

**Calculation Inputs**:
```typescript
{
  current: number;          // Load current in amps
  length: number;           // Wire run length in feet
  voltage: number;          // System voltage (12/24/48V)
  temperatureC: number;     // Ambient temperature (default 30°C)
  insulationType: "60C" | "75C" | "90C";  // Default 75°C
  bundlingFactor: number;   // Derating for bundled wires (default 1.0)
  maxVoltageDrop: number;   // Max voltage drop % (default 3% per ABYC)
}
```

**Algorithm**:
1. Calculate maximum allowable voltage drop: `maxVDropVolts = voltage × maxVoltageDrop / 100`
2. Apply temperature derating factor from NEC Table 310.15(B)(2)(a)
3. For each gauge (smallest to largest):
   - Calculate voltage drop: `VD = 2 × I × R × L / 1000` (2 for round trip)
   - Calculate derated ampacity: `baseAmpacity × tempDeratingFactor × bundlingFactor`
   - If both voltage drop and ampacity requirements met, use this gauge
4. Return smallest gauge that meets both requirements

**Wire Gauge Selection Guide** (used by AI):
```
0-25A: 10 AWG
25-40A: 8 AWG
40-60A: 6 AWG
60-100A: 4 AWG
100-150A: 2 AWG
150-200A: 1 AWG
```

## AI System Generation

### Endpoints
1. **POST /api/ai-generate-system** - Full system generation from prompt
2. **POST /api/ai-wire-components** - Wire existing components

### Critical Wiring Rules (Enforced by AI)
1. **SmartShunt Placement**: MUST be in negative path between battery and ALL loads
   - Battery negative → SmartShunt "negative" terminal
   - SmartShunt "system-minus" → All loads' negative terminals
   - Ensures ALL current flows through shunt for accurate monitoring

2. **Bus Bar Usage**:
   - Use when 3+ connections of same type
   - Separate DC and AC bus bars (never mix)
   - Never mix polarities on same bus bar
   - Clear naming: "DC Positive Bus", "DC Negative Bus", "AC Positive Bus", "AC Negative Bus"

3. **Wire Requirements**: ALL wires must have these fields:
   ```typescript
   {
     fromComponentId: string;    // Source component ID
     toComponentId: string;      // Destination component ID
     fromTerminal: string;       // Source terminal ID (exact match from terminal-config.ts)
     toTerminal: string;         // Destination terminal ID (exact match)
     polarity: "positive" | "negative" | "neutral" | "ground";
     gauge: string;              // e.g., "10 AWG"
     length: number;             // in feet
   }
   ```

### AI Prompt System (server/routes.ts)
The AI prompt in `server/routes.ts` lines 100-192 contains the **complete specification** for system generation. This prompt:
- Defines canvas dimensions and component sizes
- Specifies layout rules to prevent overlap
- Lists all terminal IDs for each component type
- Enforces critical wiring rules
- Provides wire gauge selection guidelines
- Defines JSON response format

**When modifying AI behavior**, update this prompt in `server/routes.ts`.

## Design System (Material Design 3 Adaptation)

### Key File: `design_guidelines.md`

**Core Principles**:
1. **Clarity First** - Technical accuracy over decoration
2. **Spatial Efficiency** - Dense information without clutter
3. **Purposeful Color** - Color indicates status, warnings, electrical properties
4. **Professional Precision** - Engineering-grade visual language

### Color Palette (CSS Variables)
Functional colors defined in Tailwind config:
- **Wire Colors**:
  - Positive: Red (`hsl(0 70% 50%)`)
  - Negative: Black/Dark (`hsl(210 15% 15%)`)
  - Ground: Green (`hsl(142 71% 45%)`)
  - AC Neutral: White (`hsl(210 5% 95%)`)

### Typography
- **Primary**: Inter (technical interfaces)
- **Monospace**: JetBrains Mono (specifications, calculations, wire labels)

### Spacing System (Tailwind)
Use multiples of 4px: `p-2` (8px), `m-4` (16px), `gap-8` (32px), etc.

### Layout System
- **Left Toolbar**: 280px (component library)
- **Right Panel**: 320px (properties/calculations)
- **Canvas**: Flexible center with 20×20px grid overlay

## Development Workflows

### Starting Development Server
```bash
npm run dev
# Runs tsx server/index.ts with Vite dev middleware
# Backend: http://localhost:5000
# Frontend: Proxied through Express
```

### Type Checking
```bash
npm run check
# Runs tsc without emitting files
```

### Building for Production
```bash
npm run build
# 1. Vite builds frontend → dist/public/
# 2. esbuild bundles server → dist/index.js
```

### Database Migrations
```bash
npm run db:push
# Pushes Drizzle schema changes to PostgreSQL
```

### Adding New Components

1. **Define Terminal Configuration** in `client/src/lib/terminal-config.ts`:
   ```typescript
   "new-component": {
     width: 160,
     height: 120,
     terminals: [
       { id: "terminal-1", type: "positive", label: "T1", x: 30, y: 100, color: "hsl(var(--wire-positive))", orientation: "bottom" },
     ],
   }
   ```

2. **Add Component Type** to TypeScript types if needed

3. **Update Component Library** in `client/src/components/ComponentLibrary.tsx`

4. **Create SVG Rendering** in `client/src/components/SchematicComponent.tsx`

5. **Update AI Prompts** in `server/routes.ts` (lines 100-192 and 235-298)

### Adding New API Endpoints

1. **Define Route** in `server/routes.ts`:
   ```typescript
   app.post("/api/your-endpoint", async (req, res) => {
     try {
       // Implementation
       res.json(result);
     } catch (error: any) {
       res.status(500).json({ error: error.message });
     }
   });
   ```

2. **Add Types** to `shared/schema.ts` if needed

3. **Create Frontend Hook** using TanStack Query in component or `client/src/hooks/`

## Code Conventions

### TypeScript
- **Strict Mode**: Enabled (`strict: true` in tsconfig.json)
- **No Implicit Any**: Always type parameters and return values
- **Prefer Interfaces**: For object shapes, use `interface` over `type`
- **Use Zod**: For runtime validation of external data (API requests, AI responses)

### React Patterns
- **Functional Components**: Always use function components with hooks
- **Props Typing**: Define explicit prop interfaces
  ```typescript
  interface MyComponentProps {
    value: string;
    onChange: (value: string) => void;
  }

  export function MyComponent({ value, onChange }: MyComponentProps) {
    // Implementation
  }
  ```

### File Naming
- **Components**: PascalCase (e.g., `SchematicCanvas.tsx`)
- **Utilities**: kebab-case (e.g., `wire-routing.ts`)
- **Hooks**: kebab-case with `use-` prefix (e.g., `use-toast.ts`)

### Import Order
1. External dependencies (React, libraries)
2. Internal aliases (`@/`, `@shared/`)
3. Relative imports
4. Types (if using `import type`)

### State Management
- **Server State**: Use TanStack Query (`useQuery`, `useMutation`)
- **Local UI State**: Use React `useState`, `useReducer`
- **Derived State**: Use `useMemo` for expensive calculations
- **Side Effects**: Use `useEffect` with proper dependency arrays

### Error Handling
- **Backend**: Always wrap route handlers in try/catch
- **Frontend**: Use error boundaries for component errors
- **API Calls**: TanStack Query handles errors automatically (use `onError` callbacks)

## Common Tasks for AI Assistants

### Task: Fix Wire Routing Issue
1. Read `client/src/lib/wire-routing.ts` to understand current algorithm
2. Check `client/src/lib/terminal-config.ts` for terminal orientations
3. Review wire rendering in `client/src/components/SchematicCanvas.tsx`
4. Test with different component positions and terminal orientations

### Task: Add New Component Type
1. Update `TERMINAL_CONFIGS` in `client/src/lib/terminal-config.ts`
2. Add SVG rendering case in `client/src/components/SchematicComponent.tsx`
3. Add to component library in `client/src/components/ComponentLibrary.tsx`
4. Update AI system prompts in `server/routes.ts` (2 prompts: full system + wire-only)
5. Update component dimensions list in this CLAUDE.md

### Task: Modify Wire Calculation Logic
1. Read `server/wire-calculator.ts` to understand ABYC/NEC implementation
2. Check wire data tables (resistance, ampacity)
3. Test with various current/length/voltage combinations
4. Ensure voltage drop and ampacity requirements both met
5. Update wire gauge selection guide if thresholds change

### Task: Update AI System Generation
1. Edit system prompt in `server/routes.ts` starting at line 100
2. Key sections to modify:
   - Component dimensions (lines 106-117)
   - Layout rules (lines 119-133)
   - Terminal IDs (lines 135-146)
   - Wiring rules (lines 160-173)
   - Wire gauge selection (lines 175-180)
3. Also update wire-only prompt at line 235 if wiring rules change
4. Test AI generation with various prompts to validate

### Task: Debug Component Overlap
1. Check component positions in database/state
2. Verify dimensions in `terminal-config.ts` match actual SVG sizes
3. Review AI spacing rules in `server/routes.ts` (lines 119-133)
4. Ensure minimum spacing: 300px horizontal, 250px vertical
5. Use canvas grid overlay (20px grid) to visualize positions

### Task: Fix Dark/Light Mode Issues
1. Check theme provider in `client/src/lib/theme-provider.tsx`
2. Verify CSS variables in Tailwind config
3. Use `hsl(var(--variable-name))` for theme-aware colors
4. Reference `design_guidelines.md` for color palette
5. Test component rendering in both modes

## Testing Guidelines

Currently there are no automated tests. When adding tests:
1. **Unit Tests**: Use Vitest for utilities (wire-routing, wire-calculator)
2. **Component Tests**: Use React Testing Library
3. **API Tests**: Use Supertest for Express endpoints
4. **E2E Tests**: Use Playwright for full workflows

## Environment Variables

Required for full functionality:
- `OPENAI_API_KEY` - OpenAI API key for AI generation
- `DATABASE_URL` - PostgreSQL connection string (Neon serverless)
- `NODE_ENV` - "development" or "production"

## Performance Considerations

1. **Canvas Rendering**: Large schematics (20+ components) may slow down
   - Consider virtualization for component library
   - Debounce wire routing calculations

2. **AI Generation**: OpenAI API calls can take 3-10 seconds
   - Show loading indicator (already implemented)
   - Consider caching common system patterns

3. **Database Queries**: Components/wires stored as JSONB
   - Full schematic loaded on each request
   - Consider pagination for schematic list

## Known Issues & Limitations

1. **Mobile Support**: Not optimized for mobile (desktop-first design)
2. **Real-time Collaboration**: Not supported (single-user editing)
3. **Undo/Redo**: Not implemented (use browser back button as workaround)
4. **Wire Label Positioning**: Labels use longest segment midpoint (may overlap)
5. **Component Rotation**: Not supported (all components have fixed orientation)

## Recent Changes (Last Session)

**December 2025 - Enhanced Power Calculations and Wire Validation:**
- **AI Realistic Power Values**: AI now generates realistic amps/watts for loads (LED: 10-50W, Refrigerator: 50-150W, etc.) instead of placeholder zeros
- **Auto-Calculate Watts ↔ Amps**: Properties panel automatically calculates power from current and vice versa using Ohm's Law (P = V × I)
- **NEC-Compliant Wire Ampacity Validation**: Wire gauges validated against NEC/ABYC standards with temperature derating factors
- **Visual Wire Validation**: Wires with validation issues highlighted with colored glow effects (red = error, orange = warning)
- **Wire Drag-and-Drop**: Drag wire endpoints between terminals with real-time path updates and automatic length recalculation
- **Component Drag Preview**: Semi-transparent preview of component position while dragging with connected wires updating in real-time
- **Auto-Validation**: Design validation runs automatically 500ms after any component or wire changes
- **Scroll-Aware Interactions**: Fixed coordinate calculations for selection box and wire dragging when canvas is scrolled
- **Z-Order Fix**: Wire drag handles now render in separate overlay layer for proper visibility

Previous features (see `replit.md` for details):
- Terminal-based wire connections
- AI system generation with terminal support
- SmartShunt component and wiring rules
- Advanced wire routing algorithm (early offset strategy)
- Selection box multi-select
- AI wire generation for manually placed components

## Dependencies to Be Aware Of

### Critical Production Dependencies
- `openai` ^6.2.0 - AI system generation
- `drizzle-orm` ^0.39.1 - Database ORM
- `@neondatabase/serverless` ^0.10.4 - PostgreSQL driver
- `@tanstack/react-query` ^5.60.5 - Server state management
- `wouter` ^3.3.5 - Client-side routing

### UI Component Libraries
The app uses **Radix UI primitives** (25+ packages) with custom Shadcn/ui styling. These are **unstyled, accessible components** that we style with Tailwind CSS. Don't remove or replace these without understanding the design system.

## Tips for AI Assistants

1. **Always check terminal IDs** in `terminal-config.ts` before modifying wire connections
2. **Test wire routing** with both close and distant components
3. **Validate AI responses** - AI-generated systems must have valid terminal IDs and non-overlapping positions
4. **Use the grid** - All positions should snap to 20px grid
5. **Follow ABYC/NEC standards** - Wire calculations are legally significant
6. **Preserve component dimensions** - These are carefully calibrated to match visual SVG sizes
7. **Update both AI prompts** when changing wiring rules (full system + wire-only)
8. **Check design_guidelines.md** before making UI/UX changes
9. **Use path aliases** (`@/`, `@shared/`) instead of relative imports
10. **Simple language** - User prefers everyday language over technical jargon

## Getting Help

- **Design Guidelines**: See `design_guidelines.md`
- **Project Overview**: See `replit.md`
- **TypeScript Errors**: Run `npm run check`
- **Database Schema**: See `shared/schema.ts`
- **Component Terminal Reference**: See `client/src/lib/terminal-config.ts`

---

**Last Updated**: December 2025
**Maintainer**: AI Assistant
**Project Type**: Electrical schematic design tool (Victron energy systems)
