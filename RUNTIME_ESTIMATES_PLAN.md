# Runtime & Charging Estimates Feature Plan

## Overview
Add battery runtime estimates and charging calculations to help users understand their system's energy balance and autonomy.

## New Component Properties

### Loads (DC & AC)
- `dailyHours` (number): Hours per day the load runs (0-24)
  - Default: 0 (always on) or user-specified
  - Used for: Daily energy consumption calculation

### Battery
- `safeDOD` (number): Safe depth of discharge percentage (0-100)
  - LiFePO4: 80% (default)
  - AGM: 50% (default)
  - Lithium Ion: 80% (default)
  - GEL: 50% (default)
  - FLA: 50% (default)
  - Used for: Runtime calculation (only use safe capacity)

### Solar Panels
- No new properties needed (already has `watts`)
- Will use solar irradiance scenarios:
  - Low: 2 sun hours/day (cloudy/winter)
  - Medium: 4 sun hours/day (average)
  - High: 6 sun hours/day (sunny/summer)

### New Components

#### Shore Power
- Type: `shore-power`
- Category: `source`
- Terminals:
  - `ac-out-hot` (AC output)
  - `ac-out-neutral` (AC output)
  - `ac-out-ground` (AC output)
- Properties:
  - `voltage`: 120V or 230V (AC)
  - `maxAmps`: Maximum current available (e.g., 30A, 50A)
- Usage: AC power source for Blue Smart Charger or MultiPlus AC input

#### Transfer Switch
- Type: `transfer-switch`
- Category: `distribution`
- Terminals:
  - `source1-hot`, `source1-neutral`, `source1-ground` (e.g., inverter)
  - `source2-hot`, `source2-neutral`, `source2-ground` (e.g., shore power)
  - `output-hot`, `output-neutral`, `output-ground` (to loads)
- Properties:
  - `switchType`: "manual" | "automatic"
  - `priority`: "source1" | "source2" (for automatic)
- Usage: Switch between inverter and shore power for AC loads

## Calculations

### 1. Daily Energy Consumption
```
For each load:
  dailyEnergy = loadWatts × dailyHours

Total daily consumption = sum of all load dailyEnergy
```

### 2. Battery Runtime (Battery Only)
```
usableCapacity = batteryCapacity × voltage × (safeDOD / 100)
averageLoadWatts = totalDailyConsumption / 24
runtimeHours = usableCapacity / averageLoadWatts
```

### 3. Daily Energy Production (Solar)
```
For each solar panel:
  lowProduction = panelWatts × 2 hours × 0.85 efficiency
  mediumProduction = panelWatts × 4 hours × 0.85 efficiency
  highProduction = panelWatts × 6 hours × 0.85 efficiency

Total production = sum of all panel production
```

### 4. Charging Time (Solar)
```
batteryCapacityWh = batteryCapacity × voltage
currentSOC = 0.5 (assume 50% for calculation, or use property if available)
energyNeeded = batteryCapacityWh × (1 - currentSOC)
chargingTimeHours = energyNeeded / (solarWatts × efficiency × sunHours)
```

### 5. Daily Energy Balance
```
netDailyEnergy = dailyProduction - dailyConsumption
autonomyDays = (usableCapacity / netDailyEnergy) if netDailyEnergy > 0
```

### 6. Shore Power Charging
```
If Blue Smart Charger connected to shore power:
  chargerWatts = chargerAmps × systemVoltage
  chargingTimeHours = energyNeeded / chargerWatts
```

## UI Changes

### Properties Panel
- Add "Daily Hours" input for DC and AC loads
- Add "Safe DOD %" for batteries (with battery-type defaults)
- Show runtime estimates in a new "Estimates" tab

### New "Estimates" Tab in Properties Panel
- Battery Runtime (hours)
- Daily Energy Consumption (Wh)
- Daily Energy Production (Wh) - Low/Medium/High scenarios
- Net Daily Energy (Wh)
- Autonomy Days
- Charging Time (hours) - Solar scenarios
- Charging Time (hours) - Shore power (if applicable)

## Test Cases

### Test 1: Daily Energy Consumption
- DC load: 100W, 8 hours/day = 800Wh/day
- AC load: 500W, 4 hours/day = 2000Wh/day
- Total: 2800Wh/day

### Test 2: Battery Runtime
- Battery: 200Ah @ 12V, LiFePO4 (80% DOD)
- Usable: 200 × 12 × 0.8 = 1920Wh
- Average load: 2800Wh / 24h = 116.7W
- Runtime: 1920Wh / 116.7W = 16.5 hours

### Test 3: Solar Production
- Solar: 300W panel
- Low: 300 × 2 × 0.85 = 510Wh/day
- Medium: 300 × 4 × 0.85 = 1020Wh/day
- High: 300 × 6 × 0.85 = 1530Wh/day

### Test 4: Energy Balance
- Consumption: 2800Wh/day
- Production (medium): 1020Wh/day
- Net: -1780Wh/day (deficit)
- Autonomy: Not applicable (deficit)

### Test 5: Charging Time
- Battery: 200Ah @ 12V, 50% SOC
- Energy needed: 200 × 12 × 0.5 = 1200Wh
- Solar: 300W, medium (4h)
- Charging time: 1200Wh / (300W × 0.85 × 4h) = 1.18 days

### Test 6: Shore Power Charging
- Battery: 200Ah @ 12V, 50% SOC
- Energy needed: 1200Wh
- Blue Smart Charger: 15A @ 12V = 180W
- Charging time: 1200Wh / 180W = 6.67 hours

## Implementation Order

1. ✅ Write tests first (TDD)
2. Create runtime calculator utility
3. Add new component properties to schema/types
4. Add UI inputs for dailyHours and safeDOD
5. Add Estimates tab to Properties Panel
6. Add shore-power and transfer-switch components
7. Update device definitions
8. Update terminal configs
9. Run tests and fix any failures
10. Update validation if needed
