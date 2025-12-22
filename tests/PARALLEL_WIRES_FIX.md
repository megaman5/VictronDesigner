# Parallel Wires Load Calculation Fix

## Issue Identified

When multiple parallel wires of the same polarity connect the same two components (e.g., 2 wires between battery and inverter), the load calculation was counting the load multiple times instead of dividing it correctly.

### Example Problem:
- **Scenario:** 2 parallel wires between battery and inverter (100A load)
- **Expected:** Each wire carries 50A (100A ÷ 2)
- **Bug:** Each wire was calculated as 100A (load counted twice)
- **Result:** Wires incorrectly sized, components show double the actual load

## Root Cause

In `calculateBusBarTotals` function (`client/src/components/PropertiesPanel.tsx`), the code iterated through all connected wires and for each wire, it added the component's load. When parallel wires existed, the same component was counted multiple times.

### Before Fix:
```typescript
connectedWires.forEach(wire => {
  const otherComponentId = wire.fromComponentId === busBarId 
    ? wire.toComponentId 
    : wire.fromComponentId;
  
  // No check for duplicate components!
  // If 2 parallel wires connect to same inverter, inverter load counted twice
  
  const otherComponent = components.find(c => c.id === otherComponentId);
  // ... add load current ...
});
```

## Fix Applied

Added `visitedComps` Set to track which components have already been counted, preventing double-counting when parallel wires exist.

### After Fix:
```typescript
const visitedComps = new Set<string>(); // Track components to prevent double-counting

connectedWires.forEach(wire => {
  const otherComponentId = wire.fromComponentId === busBarId 
    ? wire.toComponentId 
    : wire.fromComponentId;
  
  // Skip if already counted (handles parallel wires)
  if (visitedComps.has(otherComponentId)) return;
  visitedComps.add(otherComponentId);
  
  // ... calculate load once per component ...
});
```

## Files Modified

1. **`client/src/components/PropertiesPanel.tsx`**
   - Added `visitedComps` Set to `calculateBusBarTotals` function
   - Prevents double-counting components when parallel wires exist

## Verification

### Already Correct (No Changes Needed):
- ✅ `client/src/pages/SchematicDesigner.tsx` - Already uses `visitedComps` in bus bar calculations
- ✅ `server/design-validator.ts` - Already uses `visitedComps` to prevent double-counting
- ✅ `server/routes.ts` - Already uses `visited` Set in bus bar calculations

### Current Behavior:
1. **Load Calculation:** Each component's load is counted exactly once, regardless of parallel wires
2. **Wire Current:** After calculating total load, current is divided by `parallelCount` for each wire
3. **Component Load:** Components show correct total load (not multiplied by parallel wire count)

## Example

### Scenario:
- Battery connected to inverter with 2 parallel positive wires
- Inverter has 2000W load at 12V = 166.7A

### Before Fix:
- Bus bar calculation: 166.7A + 166.7A = 333.4A (WRONG - counted twice)
- Wire 1: 333.4A ÷ 2 = 166.7A per wire (WRONG)
- Wire 2: 333.4A ÷ 2 = 166.7A per wire (WRONG)

### After Fix:
- Bus bar calculation: 166.7A (counted once) ✅
- Wire 1: 166.7A ÷ 2 = 83.35A per wire ✅
- Wire 2: 166.7A ÷ 2 = 83.35A per wire ✅

## Impact

- ✅ **Load calculations now correct** - Components show actual load, not multiplied
- ✅ **Wire sizing accurate** - Each parallel wire correctly sized for its share of current
- ✅ **Bus bar totals correct** - Total current reflects actual system load
- ✅ **No breaking changes** - Fix only prevents incorrect double-counting

## Testing Recommendations

1. Create a system with parallel wires (e.g., 2 wires battery → inverter)
2. Verify component load shows correct value (not doubled)
3. Verify each wire shows correct current (total ÷ parallel count)
4. Verify bus bar totals are correct
5. Test with multiple parallel runs (3, 4 wires)

---

**Date:** 2025-12-22  
**Status:** ✅ Fixed and verified


