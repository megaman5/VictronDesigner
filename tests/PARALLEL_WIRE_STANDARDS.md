# Parallel Wire Run Standards (NEC/ABYC)

## Standard Requirements

Based on NEC (National Electrical Code) and ABYC (American Boat and Yacht Council) standards:

### Key Requirements:
1. **Minimum Size for Parallel Conductors:** 1/0 AWG
   - Conductors smaller than 1/0 AWG cannot be used in parallel
   - Each parallel conductor must be at least 1/0 AWG

2. **Maximum Practical Single Conductor:** 4/0 AWG
   - 4/0 AWG is typically the largest practical single conductor size
   - Ampacity: 230A at 75°C (most common rating)

3. **When to Use Parallel Runs:**
   - **ONLY** when single 4/0 AWG (230A) is insufficient
   - For currents exceeding 230A, use multiple 4/0 AWG conductors in parallel
   - Example: 300A load → 2 parallel 4/0 AWG wires (150A each)

### Code References:
- NEC Article 310.10(H) - Paralleling of Conductors
- ABYC E-11 - AC and DC Electrical Systems on Boats

## Implementation

### Current Logic (Correct):
1. **Wire Calculator** (`server/wire-calculator.ts`):
   - Only suggests parallel runs when current exceeds 4/0 AWG capacity (230A)
   - Message: "Use X parallel run(s) of 4/0 AWG"

2. **Design Validator** (`server/design-validator.ts`):
   - `suggestWireGauge()` only suggests parallel runs for currents >230A
   - Returns: "X parallel run(s) of 4/0 AWG"

3. **AI Prompt** (`server/routes.ts`):
   - Updated to only suggest parallel runs when 4/0 AWG is insufficient
   - Emphasizes using larger single conductors first (up to 4/0 AWG)
   - Only then suggests parallel 4/0 AWG runs

## Wire Gauge Progression

For increasing current requirements:
1. Use progressively larger single conductors:
   - 2 AWG (115A) → 1 AWG (130A) → 1/0 AWG (150A) → 2/0 AWG (175A) → 3/0 AWG (200A) → 4/0 AWG (230A)

2. Only when 4/0 AWG is insufficient:
   - Use parallel runs of 4/0 AWG
   - Example: 300A → 2 parallel 4/0 AWG (150A each)
   - Example: 400A → 2 parallel 4/0 AWG (200A each, 87% capacity)

## Examples

### ✅ Correct Usage:
- **200A load:** Use single 4/0 AWG (230A max = 87% capacity)
- **250A load:** Use 2 parallel 4/0 AWG wires (125A each, 230A max per wire = 54% capacity)
- **300A load:** Use 2 parallel 4/0 AWG wires (150A each, 230A max per wire = 65% capacity)

### ❌ Incorrect Usage (Now Prevented):
- ~~**150A load:** Use 2 parallel 1/0 AWG wires~~ → Should use single 2/0 AWG (175A max)
- ~~**200A load:** Use 2 parallel 2/0 AWG wires~~ → Should use single 4/0 AWG (230A max)
- ~~**190A load:** Use 2 parallel 1/0 AWG wires~~ → Should use single 2/0 AWG (175A max) or 3/0 AWG (200A max)

## AI Prompt Updates

Updated AI prompt to reflect these standards:
- Removed suggestions for parallel runs below 4/0 AWG capacity
- Emphasized using larger single conductors first
- Only suggests parallel 4/0 AWG runs when current >230A
- Clarifies NEC/ABYC requirement: parallel conductors must be ≥1/0 AWG

## Benefits

1. **Code Compliance:** Follows NEC/ABYC standards
2. **Simpler Installations:** Fewer parallel runs needed
3. **Better Quality:** Single larger conductors are often easier to work with
4. **Cost Effective:** Single 4/0 AWG may be cheaper than multiple smaller parallel wires

---

**Date:** 2025-12-22  
**Status:** ✅ Updated to match NEC/ABYC standards


