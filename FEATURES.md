# VictronDesigner Features

## Latest Features (December 2025)

### 1. Realistic AI-Generated Power Values

The AI system now generates realistic electrical specifications for all components instead of placeholder zeros.

**Examples:**
- **LED Lights**: 10-50W (1-4A @ 12V)
- **Refrigerator**: 50-150W (4-12A @ 12V)
- **Water Pump**: 40-100W (3-8A @ 12V)
- **Microwave** (AC): 1000-1500W (8-12A @ 120V)
- **Coffee Maker** (AC): 800-1200W (7-10A @ 120V)

**Implementation**: AI prompt in `server/routes.ts` includes comprehensive component property guidelines with realistic value ranges.

### 2. Automatic Watts ↔ Amps Calculation

Properties panel automatically calculates power from current and vice versa using Ohm's Law.

**How it works:**
- Edit **Current (A)**: Power automatically calculated as `P = V × I`
- Edit **Power (W)**: Current automatically calculated as `I = P / V`
- Edit **Voltage (V)**: If power is set, current recalculates to maintain power rating

**Location**: `client/src/components/PropertiesPanel.tsx:58-112`

**Example:**
```
Voltage: 12V
Enter Current: 10A → Power automatically becomes 120W
Enter Power: 240W → Current automatically becomes 20A
```

### 3. NEC-Compliant Wire Ampacity Validation

Wire gauges are validated against NEC/ABYC electrical standards with temperature derating.

**Validation Rules:**
- **Error**: Current exceeds maximum ampacity (red glow)
- **Warning**: Current exceeds 80% of maximum ampacity (orange glow)
- Temperature derating per NEC Table 310.15(B)(2)(a)
- Default conditions: 75°C insulation, 30°C ambient

**Implementation**:
- Calculation: `server/wire-calculator.ts:57-64` (`getWireAmpacity`)
- Validation: `server/design-validator.ts:291-323`

**Example Thresholds (75°C insulation, 30°C ambient):**
| Wire Gauge | Max Ampacity |
|------------|--------------|
| 18 AWG     | 14A          |
| 14 AWG     | 20A          |
| 12 AWG     | 25A          |
| 10 AWG     | 35A          |
| 8 AWG      | 50A          |
| 6 AWG      | 65A          |

### 4. Visual Wire Validation with Glow Effects

Wires with validation issues are highlighted with colored glow effects while preserving electrical color conventions.

**Visual Indicators:**
- **Red Glow**: Wire gauge insufficient for current (error)
- **Orange Glow**: Wire running at >80% capacity (warning)
- **No Glow**: Wire properly sized (valid)

**Key Feature**: Main wire color always maintains correct polarity (red = positive, black = negative). Glow appears as colored halo around wire.

**Implementation**: `client/src/components/SchematicCanvas.tsx:617-621, 767-779`

**SVG Filter**:
```svg
<filter id="wire-glow">
  <feGaussianBlur stdDeviation="3" />
  <feComposite operator="over" />
</filter>
```

### 5. Wire Drag-and-Drop with Real-Time Updates

Drag wire endpoints between terminals with automatic path recalculation.

**How to use:**
1. Click a wire to select it
2. Drag the circular handles at either end
3. Drop on any compatible terminal
4. Wire path and length automatically update

**Features:**
- Real-time wire path preview while dragging
- Snap to nearest terminal within 20px
- Automatic wire length recalculation
- Compatible terminal detection

**Implementation**: `client/src/components/SchematicCanvas.tsx:79-85, 427-476, 1004-1036`

**Terminal Compatibility:**
- Positive terminals → Positive terminals
- Negative terminals → Negative terminals
- AC terminals → AC terminals (same type)
- Ground terminals → Ground terminals

### 6. Component Drag Preview

Semi-transparent preview of component position while dragging with connected wires updating in real-time.

**Features:**
- 50% opacity preview follows cursor
- All connected wires update paths during drag
- Grid snapping (20px intervals)
- Smooth visual feedback

**Implementation**: `client/src/components/SchematicCanvas.tsx:61, 977-1001, 707-741`

**Wire Behavior**: Wires dynamically recalculate using preview position:
```typescript
const fromCompX = (draggedComponentId === fromComp.id && dragPreviewPos)
  ? dragPreviewPos.x
  : fromComp.x;
```

### 7. Automatic Design Validation

Design validation runs automatically after any component or wire changes.

**Timing**: 500ms debounce after last change
**Location**: `client/src/pages/SchematicDesigner.tsx:119-133`

**Validation Categories:**
- Electrical safety (wire ampacity, voltage drop)
- Wire sizing (gauge recommendations)
- Layout quality (component spacing, overlap)
- Terminal connections (polarity matching)
- AI-generated system quality

**Visual Feedback**:
- Design Review Panel updates with quality score
- Validation issues listed by category
- Click issue to highlight affected components/wires

### 8. Scroll-Aware Coordinate Calculations

Fixed coordinate transformations for all mouse interactions when canvas is scrolled.

**Affected Interactions:**
- Wire endpoint dragging
- Component dragging
- Selection box drawing
- Terminal clicking

**Implementation**: All mouse handlers account for scroll offsets:
```typescript
const scrollLeft = canvasRef.current.scrollLeft;
const scrollTop = canvasRef.current.scrollTop;
const x = (e.clientX - rect.left + scrollLeft) / (zoom / 100);
const y = (e.clientY - rect.top + scrollTop) / (zoom / 100);
```

**Locations**: `SchematicCanvas.tsx:206-209, 243-246, 439-442`

### 9. Z-Order Fix for Wire Drag Handles

Wire drag handles render in separate SVG overlay layer for proper visibility above components.

**Problem Solved**: Drag handles were rendering behind components, making them invisible.

**Solution**: Separate SVG layer with `pointer-events` control:
- Main layer: `pointer-events: none` on overlay
- Handles: `pointer-events: all` on individual circles

**Implementation**: `client/src/components/SchematicCanvas.tsx:1004-1036`

## Core Features (Previous Versions)

### Terminal-Based Wire Connections
- Components have defined terminal connection points
- Each terminal has type, position, and orientation
- Wire routing respects terminal orientations
- Configuration: `client/src/lib/terminal-config.ts`

### AI System Generation
- Full electrical system generation from text prompts
- Automatic component placement with anti-overlap
- Wire sizing based on load calculations
- SmartShunt placement in negative path
- Bus bar usage for multi-connection scenarios

### Wire Routing Algorithm
- Orthogonal routing (only horizontal/vertical segments)
- Grid snapping (20px intervals)
- Early offset strategy for clean separation
- Rounded corners for professional appearance
- Automatic length calculation

### Design Validation
- Real-time electrical safety checks
- NEC/ABYC standards compliance
- Layout quality metrics
- Issue categorization (error/warning/info)
- Quality score (0-100)

### Component Library
- Multiplus inverter/charger
- MPPT solar charge controllers
- Cerbo GX monitoring
- SmartShunt/BMV battery monitors
- Batteries, solar panels
- AC and DC loads
- Bus bars (positive/negative)
- Fuses, switches, distribution panels

### Export Capabilities
- Shopping list with quantities and specifications
- Wire labels (terminal IDs, gauges)
- System reports (load calculations, recommendations)
- PDF export (planned)

## Testing

### Manual Testing Checklist

**Power Calculations:**
- [ ] AI generates non-zero power values for loads
- [ ] Editing current auto-updates power
- [ ] Editing power auto-updates current
- [ ] Editing voltage recalculates current (if power set)

**Wire Validation:**
- [ ] Undersized wires show red glow
- [ ] Wires at 80%+ capacity show orange glow
- [ ] Properly sized wires have no glow
- [ ] Wire colors remain correct (red=positive, black=negative)

**Wire Drag-Drop:**
- [ ] Wire selection shows drag handles
- [ ] Dragging handle shows preview circle
- [ ] Wire path updates in real-time
- [ ] Drop on terminal reconnects wire
- [ ] Wire length recalculates after drop

**Component Drag Preview:**
- [ ] Dragging component shows semi-transparent preview
- [ ] Connected wires update during drag
- [ ] Preview snaps to 20px grid
- [ ] Final position updates all wires

**Scroll Interactions:**
- [ ] Selection box works when scrolled
- [ ] Wire dragging works when scrolled
- [ ] Component dragging works when scrolled
- [ ] Terminal clicking works when scrolled

### Automated Testing (Planned)

```typescript
// Wire ampacity validation tests
describe('Wire Ampacity Validation', () => {
  it('should flag wire as error when current exceeds ampacity', () => {
    const wire = { gauge: '18 AWG', current: 20 }; // 18 AWG max ~14A
    const result = validateWireAmpacity(wire);
    expect(result.severity).toBe('error');
  });

  it('should flag wire as warning when current > 80% ampacity', () => {
    const wire = { gauge: '10 AWG', current: 30 }; // 10 AWG max ~35A
    const result = validateWireAmpacity(wire);
    expect(result.severity).toBe('warning');
  });
});

// Auto-calculation tests
describe('Power Auto-Calculation', () => {
  it('should calculate power when current changes', () => {
    const result = calculatePower({ voltage: 12, current: 10 });
    expect(result.power).toBe(120);
  });

  it('should calculate current when power changes', () => {
    const result = calculateCurrent({ voltage: 12, power: 240 });
    expect(result.current).toBe(20);
  });
});
```

## Future Enhancements

### Short Term
- [ ] Undo/Redo functionality
- [ ] Component rotation
- [ ] Wire label auto-positioning improvements
- [ ] PDF export for schematics

### Long Term
- [ ] Real-time collaboration
- [ ] Mobile/tablet optimization
- [ ] Component library expansion
- [ ] Advanced wire routing (obstacle avoidance)
- [ ] 3D cabinet layout view
- [ ] Integration with Victron VRM

## Known Limitations

1. **Mobile Support**: Not optimized for touch interfaces
2. **Component Rotation**: All components have fixed orientation
3. **Undo/Redo**: Not implemented (use browser back as workaround)
4. **Wire Label Overlap**: Labels may overlap on complex layouts
5. **Parallel Wire Runs**: Not supported (workaround: use larger gauge)

## Performance Notes

- **Large Schematics** (20+ components): May experience slight lag in wire routing
- **AI Generation**: Takes 3-10 seconds depending on system complexity
- **Validation**: Runs asynchronously with 500ms debounce to avoid UI blocking

## Browser Compatibility

- **Recommended**: Chrome 90+, Edge 90+, Firefox 88+
- **Safari**: 14+ (some CSS grid issues possible)
- **Mobile**: Not optimized, use desktop browser

---

**Last Updated**: December 2025
**Version**: 1.2.0
**Documentation**: See CLAUDE.md for technical implementation details
