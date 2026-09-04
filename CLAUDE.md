# CLAUDE.md - VictronDesigner.com AI Assistant Guide

## Project Overview

**VictronDesigner.com** is a professional electrical schematic design tool for Victron energy systems (solar/power systems). It provides a drag-and-drop interface with terminal-based wire connections, automatic wire sizing calculations based on ABYC/NEC standards, real-time orthogonal wire routing with grid snapping, and AI-powered system recommendations.

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
- **AI Integration**: OpenAI API (GPT-5.x family; the model is configurable in Admin Settings)

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

### Component Orientation (rotation & mirroring)
Components can be turned in 90-degree steps and mirrored. State lives in
`properties`: `rotation` (0/90/180/270), `mirrorX`, `mirrorY`.

**The transform is applied inside `getComponentTerminals` and
`getComponentDimensions`.** Everything resolves geometry through those two, so
wire routing, hit testing, the selection box, canvas bounds, server-side overlap
detection and PNG export all inherit rotation without knowing it exists. When
adding code that needs a component's size or terminals, call those helpers -
never a local size table.

- `getComponentDimensions()` - the **rotated** footprint (what you almost always want)
- `getBaseComponentDimensions()` - the unrotated artwork size (renderer only)

Rendering draws the artwork at its natural size and turns it with a CSS
transform. The terminal overlay sits deliberately *outside* that wrapper -
terminals come back already rotated, so wrapping them would apply the transform
twice. Text nodes are counter-transformed (`.component-artwork` in `index.css`)
so labels never read backwards or upside down.

Only quarter turns are allowed: the router is orthogonal and terminals declare
which edge they exit from, so arbitrary angles would make those meaningless.

### Custom Components (user-defined parts)
Signed-in users can define their own component with their own terminals
(`client/src/components/CustomComponentEditor.tsx`, stored in `custom_components`).

**Placed instances snapshot the definition** - terminals, dimensions, appearance
and supported voltages are copied into the instance's `properties` at drop time,
so a saved schematic keeps rendering correctly after the definition is edited or
deleted. `definitionId`/`definitionVersion` exist to detect drift, not to resolve
geometry.

Custom parts deliberately carry **no** `voltage` property: there is no voltage
field in the panel to correct it, so a frozen snapshot would go stale against the
live system voltage and feed both wire sizing and `inferSystemVoltage()`.
`supportedVoltages` (a list, e.g. `[12, 24]` for a dual-voltage charger) is the
declared constraint instead; empty means "not declared" and the voltage-mismatch
check skips the part.

### Component Dimensions (Critical for AI Generation)
When AI generates systems, components must not overlap. Minimum spacing:
- **Horizontal**: 300px between component centers
- **Vertical**: 250px between component centers

```typescript
// Component sizes (width × height)
multiplus: 180×140px
quattro: 240×150px
argofet: 150×110px
cyrix-ct: 130×90px
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
quattro: "ac-in-1-*", "ac-in-2-*", "ac-out-*" (hot/neutral/ground each), "dc-positive", "dc-negative"
argofet: "input-positive", "out-1-positive", "out-2-positive", "out-3-positive"
cyrix-ct: "batt-1-positive", "batt-2-positive", "ground"
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

**Wire Gauge Selection Guide** (used by AI; ABYC 105°C free-air ampacity with 20% margin):
```
0-50A: 10 AWG
50-65A: 8 AWG
65-100A: 6 AWG
100-130A: 4 AWG
130-175A: 2 AWG
175-200A: 1 AWG
200-235A: 1/0 AWG
370A+: parallel 4/0 AWG runs
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

### AI Prompt System (`server/ai/skills/`)
Prompts are **versioned skills**, not inline strings. They used to be pasted into
`server/routes.ts` twice, which is how the Lynx terminal ids ended up documented
in one copy and not the other.

- `server/ai/skills/fragments.ts` - the reusable pieces: component dimensions,
  layout rules, terminal ids, wiring rules, wire gauge selection, orientation
- `server/ai/skills/` - the skills that compose those fragments into a prompt

**When modifying AI behaviour**, edit the fragment - every skill that uses it
picks the change up. Preview the rendered prompt without spending a model call:
`GET /api/admin/ai/skills/:id/preview`.

### Which vendor serves the configured model
The production endpoints call the OpenAI SDK directly (they need streaming,
which `server/ai/providers` does not expose), so `server/ai/model-client.ts`
picks the base URL and key from the model id:

- `gemini-*` -> Google's OpenAI-compatible endpoint, `GEMINI_API_KEY`
- `vendor/model` -> OpenRouter, `OPENROUTER_API_KEY`
- anything else -> OpenAI, `OPENAI_API_KEY`

Before this, every id went to OpenAI, so the admin "AI model" setting could
name a model it could not actually reach - it 404'd at request time rather
than being rejected at configuration time. Prefer a bare `gemini-*` id over
`google/gemini-*`: same model, but billed to our own Google key instead of a
reseller balance that can run dry.

### AI access control
The AI endpoints spend real money on the platform key, so they are **not open**:
- All four (`ai-generate-system`, `-wire-components`, `-iterative`, `-stream`)
  sit behind `requireAiQuota` in `server/routes.ts` - sign-in required
- Two caps, both enforced: a per-user lifetime allowance (default $10) and a
  monthly cap (default $5). See `server/ai/usage-limits.ts`
- Admin view and top-ups: `/ai-usage-admin`
- Cost is derived in `observability-storage.ts` from token usage. A model with
  no price entry logs `null`, which means *unknown* - never treat it as zero

### AI benchmark playground (`npm run bench`)
The harness in `server/ai/benchmark/` tests, compares and grades prompt/model
changes. The CLI is the intended interface (admin API exists too, at
`/api/admin/ai/benchmarks`); on a production checkout the `.env` is root-owned,
so run it with sudo:

```bash
sudo npm run bench -- suites          # what exists + which provider keys are set
sudo npm run bench -- run --suite core-designs --model gpt-5.2 --judge --label "why"
sudo npm run bench -- list            # recent runs
sudo npm run bench -- compare <a> <b> # case-by-case diff of two runs (8-char ids ok)
sudo npm run bench -- judge <runId>   # grade a stored run's outputs, no regeneration
sudo npm run bench -- exemplar --case van-12v --models a,b,c --judge
sudo npm run bench -- report --out review.html  # visual review of every exemplar
```

How grading works, and the traps:
- The **validator score** (`design-validator.ts`) is the primary metric; each
  case also has machine-checked expectations. Both run on the *normalized*
  design, same as production.
- `--judge` adds a **vision-judge panel**: cheap models (default gpt-5-mini,
  claude-haiku-4-5, gemini-3.6-flash, filtered to keys in `.env`) grade the
  rendered PNG on layout/routing/correctness/completeness. The stored score is
  the panel **median**; stddev is kept because judges disagree - a
  `lowConfidence` flag marks single-judge or split verdicts. Never act on a
  low-confidence judge number without reading the notes.
- **Exemplars** (`bench exemplar`) are one-off reference designs per case,
  stored in `benchmark_exemplars` and shown to judges as a calibration anchor.
  Generate them once; they're reused free. `--models a,b,c` runs several and
  keeps the best (validator score first, judge panel breaks ties) - no single
  vendor wins every case, so a best-of sweep beats trusting one model.
- **`bench report`** writes a self-contained HTML file (renders, validator
  issues, per-judge notes) for human review of the reference set.
- Every run records a **prompt content hash** (`skillFingerprint`) plus git
  rev/dirty. Version strings are hand-bumped and lie; the hash is what proves
  two runs used the same prompt. `compare` says so explicitly.
- LLM output is not reproducible: use `--repeats` and read stddev instead of
  trusting one sample. Runs cost real money on the platform keys; costs are
  printed and persisted (null = unpriced model, never "free").
- A low validator score is evidence, not proof - read the issues before
  blaming the model. The branch-current bug below was found exactly this way:
  Fable's van-12v design scored 29 and was actually perfect.

### AI prompt caching
The Anthropic provider (`server/ai/providers/anthropic.ts`) marks the system
prompt as an `ephemeral` cache breakpoint on every call, covering every native
Claude model (Fable, Opus, Sonnet, Haiku) through the one adapter. Verified
against the real API: a call wrote ~4.7k tokens to cache, the next call read
them back (input tokens for that portion dropped from full price to ~10%).
Below a model's minimum cacheable prefix (Haiku's is higher than Opus/Sonnet's)
the breakpoint is a harmless no-op. OpenAI and Gemini cache automatically
server-side with no request field to set - already confirmed via
`usage.prompt_tokens_details.cached_tokens` / `usageMetadata.cachedContentTokenCount`.

Also: the Anthropic adapter uses `client.messages.stream()` +
`.finalMessage()`, not `.create()` - Fable's long reasoning turns trip the
SDK's "streaming required past 10 minutes" guard on the non-streaming call.

### AI vision on iteration
From the second iteration, both iterating endpoints attach a rendered PNG of the
current design (`server/ai/schematic-image.ts`, drawn with node-canvas). The
model cannot see overlaps or long wire runs from JSON alone. Rendering happens
per iteration so it sees what it just produced. Non-vision models are detected
and sent text only.

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

### Production Deployment (Systemd)
The production server runs as a systemd service:

```bash
# Check service status
sudo systemctl status victron-designer.service

# Restart after code changes (MUST rebuild first!)
npm run build
sudo systemctl restart victron-designer.service

# View logs
sudo journalctl -u victron-designer.service -f

# Service file location: /etc/systemd/system/victron-designer.service
```

**Important**: After changing any server-side TypeScript files (`server/*.ts`, `shared/*.ts`), you MUST:
1. Run `npm run build` to recompile
2. Run `sudo systemctl restart victron-designer.service` to restart

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

5. **Update AI Prompts** in `server/ai/skills/fragments.ts` (shared by every skill)

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
1. Edit the relevant fragment in `server/ai/skills/fragments.ts` (layout, wiring
   rules, terminal ids, gauge selection, orientation)
2. Preview the rendered prompt via `GET /api/admin/ai/skills/:id/preview` - no
   model call, no spend
3. Fragments are shared, so there is no second copy to keep in sync
4. If the change affects the shape of the model's output, extend
   `server/ai-design-normalizer.ts` so a bad value is repaired rather than
   reaching the canvas

### Task: Debug Component Overlap
1. Check component positions in database/state
2. Verify dimensions in `terminal-config.ts` match actual SVG sizes
3. Review AI spacing rules in `server/ai/skills/fragments.ts` (`layoutFragment`)
4. Ensure minimum spacing: 300px horizontal, 250px vertical
5. Use canvas grid overlay (20px grid) to visualize positions

### Task: Fix Dark/Light Mode Issues
1. Check theme provider in `client/src/lib/theme-provider.tsx`
2. Verify CSS variables in Tailwind config
3. Use `hsl(var(--variable-name))` for theme-aware colors
4. Reference `design_guidelines.md` for color palette
5. Test component rendering in both modes

## Testing Guidelines

Run the suite with `npm test` (Vitest). There are 300+ tests in `tests/`:
- `tests/unit/` - calculators, validator rules, wire routing, rotation geometry,
  AI pricing/quota logic, the AI design normalizer, schematic image rendering
- `tests/functional/` - component rendering and library behaviour (React Testing Library)
- `tests/integration/` - export and AI generation paths

Notes:
- `vitest.config.ts` sets `envDir: './tests'` on purpose. Vite's `loadEnv` reads
  the project `.env` at config time, and in a production checkout that file is
  root-owned `0600`, so without this `npm test` fails with EACCES for any
  non-root user.
- Not yet covered: E2E. Browser-driven flows (OAuth, drag-and-drop) are still
  manual, because the Google callback is pinned to the production domain.

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
5. **Community Component Sharing**: Not supported (custom components are private to their owner)

## Recent Changes

**Production model is now gemini-3.8-flash** - benchmarked on the same suite
and prompt hash, 12 designs each:

| model | validator | pass | judge | repairs | cost/12 |
|---|---|---|---|---|---|
| gpt-5.4 (the old default) | 65.6 (stddev 31) | 58% | 52.8 | 28 | $1.35 |
| gemini-3.1-pro-preview | 90.6 | 100% | 57.6 | 2 | $1.98 |
| gemini-3.8-flash | 92.0 (stddev 7.4) | 100% | 61.5 | 0 | $0.70 |

gpt-5.4 was not merely lower but erratic, and produced one design scoring
zero. 3.8-flash then beat 3.1-pro on three of the four cases at a third of
the price, so it took over. `DEFAULT_AI_MODEL` is kept in step with the
setting so a fresh database does not fall back to the rejected model.

**Prompt A/B: name every part with its rating** - the vision judges kept
noting that parts were unlabelled, and measurement agreed: only ~30% of fuses,
bus bars and batteries had a rating in their name (the name is what the drawing
shows). One line in `layoutFragment()` took that to 85%, with no validator
regression. Skills bumped to 2026-09-03.3.

Two lessons from running it, both worth repeating:
- **Replicate the baseline before believing a delta.** The first baseline
  (n=8) read 95.4 validator / 53.6 judge; re-running the *identical* prompt
  hash at n=12 gave 92.5 / 57.2. The "regression" and the "judge improvement"
  the first comparison showed were both that one lucky draw, not the change.
- **Placement guidance in prose did nothing.** Instructions to put the main
  fuse beside the battery and keep wire runs short moved their own metrics not
  at all (battery-to-fuse 318px -> 321px, spans unchanged), so they were
  removed rather than left in as decoration. Layout quality appears to need the
  vision feedback loop, not more text.

**Reference designs regenerated best-of-5, and a renderer fix** - exemplars are
now chosen across claude-fable-5, gpt-5.5, gemini-3.1-pro, grok-4.6 and kimi-k3;
all six cases validate at 100. The PNG renderer shrinks a long component name
to fit instead of clipping it - vision judges were reading "300A Posit..." as a
design fault, and that complaint appeared in 5 of 19 judge notes before the fix
and 0 after.

**Branch-circuit wire current, fixed** - `design-validator.ts` sized every
wire between two "trunk-ish" component *types* (battery, fuse, switch, shunt,
bus bar) at the whole system's current. A fused branch off a bus bar - the
pattern `fuseGuidanceFragment()` tells the AI to use - therefore had its 5A
fridge wire failed for not carrying 157A. Real users saw bogus ABYC errors on
correct designs, and it deflated every benchmark score.

`calculateWireCurrentByCut()` replaces the type guess: cut the wire out of the
same-polarity graph (each polarity alone is a tree, though the DC circuit as a
whole is a loop), see which side still reaches a battery, and the other side is
what the wire feeds. Ambiguous cuts - series links and parallel banks put a
battery on both sides - fall back to the old whole-system estimate. Fable's
van-12v exemplar went 29 -> 100 on the same unchanged design.

**Prompt caching** - Anthropic requests now cache the system prompt (verified
live: cache write then cache read on repeat calls); OpenAI/Gemini confirmed
already automatic. Added the missing AWG-by-current table to the system prompt
(`wireGaugeFragment`, skills bumped to 2026-08-31.1) after benchmark exemplars
showed 12 AWG on 150A+ circuits.

**Benchmark playground with vision judging** - `npm run bench` CLI over the
existing harness; multi-judge PNG grading with median + disagreement, Fable
exemplars as calibration anchors, prompt content hashes for honest A/B runs.
Providers now accept image content parts (OpenAI, Anthropic, Gemini).

**AI access control and spend caps**
- All four AI endpoints now require sign-in (they previously served anonymous
  traffic on the platform key - 3,633 such requests were logged)
- Lifetime ($10) and monthly ($5) caps, both enforced; `/ai-usage-admin` for
  per-user view, top-ups and resets
- Token usage and cost are now actually persisted. They never were, so every
  `ai_logs` row had `cost_usd = null` and any cap would have been inert
- `lookupPrice` resolves rolling aliases (`gpt-5.2-chat-latest` -> `gpt-5.2`)

**Component orientation** - 90-degree rotation and mirroring, applied inside the
terminal/dimension resolvers. `R` / `Shift+R` rotates a whole selection.

**AI vision on iteration** - the design is rendered to PNG server-side each round
and shown to the model, so it can see overlaps and long runs.

**Custom components** - user-defined parts with author-placed terminals,
snapshotted on placement. Community sharing is deliberately not built.

**Units and library** - ft/m toggle alongside the existing AWG/mm² one; the
component library leads with common parts and hides the rest behind "Show more";
device-shaped icons replaced the repeated Cable/Gauge glyphs.

See `git log` for detail - each of these has a commit message explaining the
reasoning, and `replit.md` covers earlier work.

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
