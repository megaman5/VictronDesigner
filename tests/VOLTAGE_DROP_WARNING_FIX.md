# Voltage Drop Warning Current Display Fix

## Issue Identified

The voltage drop warning messages were showing the **total current** instead of the **current per wire** when parallel wires exist, causing confusion.

### Example Problem:
- **Scenario:** 2 parallel wires between components (154.3A total load)
- **Expected:** Warning shows 77.1A per wire (154.3A ÷ 2)
- **Bug:** Warning showed 154.3A (total current, not per wire)
- **Result:** Warning didn't match the "Calculated Load" display (77.1A)

## Root Cause

In `server/design-validator.ts`, the voltage drop calculation and warning messages used:
- `current` (total current) instead of `currentPerWire` (current per wire)
- This caused warnings to show double the actual per-wire current when parallel wires exist

### Before Fix:
```typescript
// Line 1518: Used total current
const voltageDrop = 2 * current * resistancePerFoot * length;

// Line 1536: Warning showed total current
message: `High voltage drop: ${voltageDropPercent.toFixed(1)}% at ${current.toFixed(1)}A, ...`
```

## Fix Applied

### 1. Voltage Drop Calculation
Changed to use `currentPerWire` instead of `current`:
```typescript
// Now uses currentPerWire (each wire only carries its share)
const voltageDrop = 2 * currentPerWire * resistancePerFoot * length;
```

### 2. Warning Messages
Updated to show per-wire current, with total shown if parallel:
```typescript
// Format: "77.1A (154.3A total, 2 parallel)" or just "77.1A" if single wire
const currentDisplay = parallelCount > 1 
  ? `${currentPerWire.toFixed(1)}A (${current.toFixed(1)}A total, ${parallelCount} parallel)`
  : `${currentPerWire.toFixed(1)}A`;

message: `High voltage drop: ${voltageDropPercent.toFixed(1)}% at ${currentDisplay}, ...`
```

### 3. Ampacity Error Messages
Also fixed ampacity error messages to show per-wire current:
```typescript
const currentDisplay = parallelCount > 1 
  ? `${currentPerWire.toFixed(1)}A per wire (${current.toFixed(1)}A total, ${parallelCount} parallel)`
  : `${currentPerWire.toFixed(1)}A`;

message: `Wire gauge ${wire.gauge} insufficient for ${currentDisplay} (max ${maxAmpacity.toFixed(1)}A at 75°C per wire)`
```

## Files Modified

1. **`server/design-validator.ts`**
   - Line 1472: Changed condition from `current > 0` to `currentPerWire > 0`
   - Line 1518: Changed voltage drop calculation to use `currentPerWire`
   - Line 1525: Updated error message to show per-wire current
   - Line 1536: Updated warning message to show per-wire current
   - Line 1404: Updated ampacity error message to show per-wire current

## Verification

### Before Fix:
- Warning: "High voltage drop: 2.5% at **154.3A**, 10ft, 12V"
- Calculated Load: Current: **77.1A**
- **Mismatch:** Warning showed 2x the calculated load

### After Fix:
- Warning: "High voltage drop: 2.5% at **77.1A (154.3A total, 2 parallel)**, 10ft, 12V"
- Calculated Load: Current: **77.1A**
- **Match:** Warning now shows per-wire current that matches calculated load

## Impact

- ✅ **Warning messages now match calculated load** - Shows per-wire current
- ✅ **Voltage drop calculation correct** - Uses per-wire current (each wire only carries its share)
- ✅ **Clear parallel wire indication** - Shows both per-wire and total when parallel
- ✅ **Consistent display** - All current displays now use same logic

## Example

### Scenario:
- 2 parallel wires between battery and inverter
- Total load: 154.3A
- Per-wire current: 77.1A
- Wire gauge: 1/0 AWG
- Length: 10ft
- Voltage: 12V

### Before Fix:
- Warning: "High voltage drop: 2.5% at **154.3A**, 10ft, 12V" ❌
- Calculated Load: 77.1A
- **Mismatch!**

### After Fix:
- Warning: "High voltage drop: 2.5% at **77.1A (154.3A total, 2 parallel)**, 10ft, 12V" ✅
- Calculated Load: 77.1A
- **Match!**

---

**Date:** 2025-12-22  
**Status:** ✅ Fixed and verified


