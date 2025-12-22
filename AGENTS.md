# VictronDesigner.com

## Overview

This is a professional electrical schematic design tool specifically for Victron energy systems. The application enables users to design solar and power systems through a drag-and-drop interface with terminal-based wire connections, automatic wire sizing calculations based on electrical engineering standards (ABYC/NEC), real-time wire preview with orthogonal routing, and grid snapping. It features AI-powered system recommendations via OpenAI integration and comprehensive export capabilities for wiring diagrams, shopping lists, and wire labels.

## User Preferences

Preferred communication style: Simple, everyday language.

## ⚠️ CRITICAL: Always Restart After Code Changes

**MANDATORY WORKFLOW - After making ANY code changes (server or client):**
1. **ALWAYS** run `npm run build` to rebuild the application
2. **ALWAYS** run `sudo systemctl restart victron-designer.service` to apply changes
3. Changes will NOT take effect until both steps are completed!

**This applies to ALL code changes - no exceptions!**

## Production Deployment

The app runs as a systemd service on the server:

```bash
# Restart after code changes (MUST rebuild first!)
npm run build
sudo systemctl restart victron-designer.service

# Check status
sudo systemctl status victron-designer.service

# View logs
sudo journalctl -u victron-designer.service -f
```

## Recent Changes

### Latest Session - AC/DC Voltage Separation & Current Calculation Fixes (December 2025)
1. **AC Load Voltage Handling**: Fixed AC loads to use AC voltage (110V/120V/220V/230V) instead of DC voltage
   - AC loads now use `acVoltage` property instead of `voltage` property
   - Properties panel shows AC voltage options (110V, 120V, 220V, 230V) for AC loads
   - Default AC load voltage set to 120V AC (North America standard)
   - Export report hides old `voltage` property for AC loads, only shows `acVoltage`
   - Current calculations for AC loads now use AC voltage (e.g., 1440W / 120V = 12A, not 120A)

2. **Voltage Mismatch Validation**: Fixed to exclude AC loads and AC panels from DC voltage checks
   - AC loads and AC panels are now excluded from voltage mismatch validation
   - Only DC components are checked against DC system voltage (12V/24V/48V)
   - AC wires (hot/neutral/ground) are excluded from wire voltage mismatch checks
   - Error messages clarified to specify "DC components" instead of "All components"

3. **Bus Bar Current Calculations**: Fixed double-counting and incorrect current calculations
   - Bus bars now correctly exclude AC loads (they're on separate AC system)
   - For inverters, uses `dcInputCurrent` directly instead of tracing through AC loads
   - For MPPT/chargers, uses their output current directly
   - For DC loads, calculates from watts/voltage directly
   - Prevents recursive tracing through bus bars that caused exponential current growth
   - Fixed 414.8A and 411.4A errors (were double-counting currents)

4. **Wire Current Calculation Logic**: Implemented direction-aware current calculation
   - **Source-to-Bus Bar wires** (solar → MPPT, MPPT → bus bar): Uses source output current directly
   - **Bus Bar-to-Load wires** (bus bar → inverter, bus bar → DC panel): Traces to find actual load current
   - **Bus Bar-to-DC Panel wires**: Traces through panel to find connected DC loads
   - Prevents incorrect current calculations (e.g., solar panel wires showing 137.1A instead of ~25A)

5. **Inverter DC Input Calculation**: Enhanced to properly detect and calculate from AC loads
   - Returns full object with `acLoadWatts`, `dcInputWatts`, `dcInputCurrent`, and `acVoltage`
   - Fixed terminal matching to correctly find AC output wires (`ac-out-hot`, `ac-out-neutral`)
   - Prevents double-counting AC loads through AC panels
   - Inverter AC output wires now correctly show AC load current (13.1A @ 110V AC)

6. **MPPT Current Detection**: Fixed to use `maxCurrent` property
   - MPPT components use `maxCurrent` property, not `amps` or `current`
   - MPPT → Bus Bar wires now correctly show 50A (not "Cannot determine current")
   - Bus bar calculations also updated to use `maxCurrent` for MPPT components

7. **Export Report Enhancements**: Improved system report accuracy and clarity
   - AC Distribution Panel shows correct AC voltage (110V/120V AC, not 12V)
   - Wire power calculations show correct AC/DC voltage labels
   - Inverter DC input properly calculated and displayed
   - Bus bar totals exclude AC loads, only sum DC loads and inverter DC inputs
   - All validation warnings/errors included at bottom of report
   - AC load display cleaned up (hides old `voltage` property, formats current to 1 decimal)

8. **Inverter AC Output Wire Detection**: Fixed to handle all inverter types and wire polarities
   - Handles `inverter`, `multiplus`, and `phoenix-inverter` types
   - Detects hot, neutral, AND ground wires (ground carries 0A)
   - Fixes "Cannot determine current" warnings for inverter AC output wires

### Previous Session - MPPT Validation & Lynx Removal (December 2025)
1. **MPPT Solar Panel Validation**: Added validation rule that flags MPPT controllers missing solar panel connections as errors
   - Checks for PV positive/negative terminal connections
   - Verifies actual connection to solar panel components
   - Provides helpful error messages with suggestions
2. **Removed Lynx Distributor**: Removed from component library to reduce diagram clutter
   - Still available in device definitions for backward compatibility
   - AI will use bus bars instead for cleaner diagrams

### Previous Session - AI Component Properties Fix (December 2025)
1. **Fixed AI omitting properties**: AI was generating loads without `properties` field (watts/amps = 0)
2. **Enhanced AI prompts**: Added explicit JSON examples showing required `properties` for all components
3. **Validation for missing properties**: `design-validator.ts` now flags loads without watts/amps as errors
4. **Iterative feedback**: AI receives validation errors when properties missing, helping it self-correct

### Previous Session Improvements
1. **AI Loading Animation**: Added visual feedback during system generation with animated progress indicator
2. **Bus Bar Components**: Added busbar-positive and busbar-negative with 6 terminals each for multi-wire connections
   - Professional SVG rendering with copper/black styling
   - Terminals: pos-1 to pos-6, neg-1 to neg-6
3. **SmartShunt Wiring Rules**: AI now follows electrical best practices
   - SmartShunt placed in negative path between battery and loads for accurate current monitoring
   - Recommends bus bars for systems with 3+ connections
4. **Advanced Wire Routing Algorithm**: Complete redesign for cleaner visual separation
   - **Early Offset Strategy**: Wires separate immediately from source (2×GRID_SIZE exit distance)
   - **Distance-Based Routing**: Simple routing for close components (<120px), offset lanes for distant components
   - **Overshoot Prevention**: Exit/entry distances clamped to 1/3 total distance to prevent path errors
   - **Visual Separation**: Each wire maintains dedicated lane throughout journey, only converging at destination
   - **Test Results**: 83% early offset success rate, no overshooting issues with close/far components
5. **Mobile Wire Visibility Fix**: Fixed issue where wires weren't visible on mobile devices
   - SVG now has explicit dimensions (2400x1600) ensuring wires render correctly across all screen sizes
6. **AI Wire Generation**: New feature to automatically wire manually-placed components
   - "AI Wire" button generates intelligent connections for user-placed components
   - Follows same electrical rules as full AI system generation
   - Perfect for users who want to layout components manually but need help with proper wiring
   - Fixed wire rendering bug with unique ID generation using index-seeded tokens
7. **Selection Box Multi-Select**: Drag-to-select multiple components on canvas
   - Click and drag on empty canvas to create selection box
   - Visual selection box with dashed border and semi-transparent fill
   - All components intersecting the box are selected with blue ring highlight
   - Clicking single component clears multi-selection
   - Supports properties panel inspection of first selected component
   - **Bug Fixes**:
     - Fixed delete key to remove ALL selected components (was only deleting one)
     - Fixed properties panel to update when clicking different components (added component ID as key to force re-render)

### Terminal-Based Wire Connections (Completed)
- Each component now has defined terminal connection points (positive, negative, ground, AC, PV, data)
- Visual terminal indicators with color coding (red=positive, black=negative, gray=data)
- Click terminals to create wire connections instead of component centers
- Real-time wire preview with orthogonal routing (straight sections, rounded corners)
- Grid snapping (20px) for clean wire alignment
- Automatic wire gauge calculation based on connected component specifications
- Wires store terminal IDs for accurate connection tracking

### AI System Generation (Fixed)
- Updated AI prompt to generate terminal-specific wire connections
- AI now includes fromTerminal/toTerminal IDs in all wire objects
- Proper component spacing (200-300px) for cleaner layouts
- All wire objects include gauge, length, and polarity information

### SmartShunt Component (Added)
- New Victron SmartShunt component for current monitoring
- Three terminals: BATT- (battery negative), SYS- (system negative), VE.Direct (data)
- Placed in negative path for accurate battery current measurement
- Available in Victron Components library

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript using Vite as the build tool

**Routing**: Wouter for client-side routing (lightweight React Router alternative)

**State Management**: 
- TanStack Query (React Query) for server state management and caching
- Local React state for UI interactions and component editing

**UI Component System**:
- Radix UI primitives for accessible, unstyled components
- Shadcn/ui component library (New York variant) with Tailwind CSS
- Custom theming system with light/dark mode support via context provider
- Material Design 3 principles adapted for technical/engineering interfaces

**Design System**:
- Typography: Inter (primary), JetBrains Mono (monospace for technical specs)
- Color scheme focused on Victron brand blue (210° 100% 45%) with functional colors for electrical components (red/positive, black/negative, green/ground)
- Spatial efficiency and information density prioritized for professional tools

**Key UI Features**:
- Drag-and-drop canvas for component placement
- Real-time wire calculation display
- Component library panel with Victron-specific and generic electrical components
- Properties panel with tabbed interface for settings and calculations
- Export dialog for generating documentation

### Backend Architecture

**Server**: Express.js with TypeScript running on Node.js

**API Design**: RESTful endpoints with JSON payloads
- `/api/schematics` - CRUD operations for schematic management
- `/api/wire-calculate` - Real-time wire sizing calculations
- `/api/ai/system-design` - AI-powered system recommendations
- `/api/export/*` - Document generation endpoints

**Data Models**:
- `Schematic` - Main project container with metadata, system voltage, components array, and wires array
- `SchematicComponent` - Individual components with type, position, and properties
- `Wire` - Connection data with start/end points and electrical properties
- `User` - Basic user authentication structure

**Business Logic**:
- Wire calculation engine implementing ABYC/NEC standards with temperature derating
- Ampacity tables for wire gauges from 18 AWG to 4/0 AWG
- Voltage drop calculations based on wire length, current, and resistance
- **AC/DC Voltage Separation**: AC loads use AC voltage (110V/120V/220V/230V), DC components use DC voltage (12V/24V/48V)
- **Inverter DC Input Calculation**: Calculates DC input power/current from connected AC loads with efficiency factor (87.5%)
- **Direction-Aware Wire Current Calculation**: Distinguishes between source wires (solar/MPPT output) and load wires (inverter/DC load input)
- Shopping list aggregation from component specifications
- System report generation combining diagrams, parts lists, wire labels, and validation results

**Export Utilities**:
- CSV generation for shopping lists
- Wire label formatting for installation
- System report compilation

### Data Storage

**Primary Database**: PostgreSQL accessed via Neon serverless driver

**ORM**: Drizzle ORM with Zod schema validation

**Schema Structure**:
- `users` table - User authentication
- `schematics` table - Stores complete schematic designs with JSONB columns for components and wires arrays

**Development Storage**: In-memory storage implementation (`MemStorage`) for development/testing without database dependency

**Migration Strategy**: Drizzle Kit for schema migrations in `./migrations` directory

### Authentication & Session Management

**Session Storage**: PostgreSQL-backed sessions using `connect-pg-simple`

**Current Implementation**: Basic user schema defined, authentication endpoints prepared but not fully implemented in routes

### External Dependencies

**AI Integration**:
- **OpenAI API** - GPT-4o mini for AI-powered system design recommendations
- Configured via `OPENAI_API_KEY` environment variable
- Used in `/api/ai-generate-system` endpoint for natural language system generation
- AI generates complete systems with:
  - Proper component placement (200-300px spacing)
  - Terminal-specific wire connections (fromTerminal/toTerminal IDs)
  - Calculated wire gauges and lengths
  - ABYC/NEC compliant recommendations
  - AC loads with proper AC voltage (110V/120V/220V/230V) and `acVoltage` property
  - Inverter DC input calculations from connected AC loads
  - Validation feedback for wire sizing, voltage drop, and current calculations

**Database**:
- **Neon Serverless PostgreSQL** - Cloud-hosted PostgreSQL database
- Connection via `@neondatabase/serverless` driver
- Configured through `DATABASE_URL` environment variable

**Development Tools**:
- **Replit Development Plugins** - Cartographer for code navigation, dev banner, runtime error overlay (development only)

**Font Services**:
- **Google Fonts** - Inter and JetBrains Mono font families loaded via CDN

**UI Component Libraries**:
- **Radix UI** - 25+ primitive component packages for accessible UI foundation
- **Embla Carousel** - Carousel/slider functionality
- **cmdk** - Command palette interface
- **Lucide React** - Icon library

**Form Management**:
- **React Hook Form** - Form state and validation
- **@hookform/resolvers** - Zod integration for schema validation

**Utility Libraries**:
- **class-variance-authority** - Type-safe variant styling
- **clsx & tailwind-merge** - Conditional className management
- **date-fns** - Date manipulation and formatting