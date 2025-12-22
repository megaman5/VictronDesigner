# VictronDesigner Test Suite

This directory contains comprehensive unit and functional tests for the VictronDesigner application.

## Test Structure

```
tests/
├── setup.ts                    # Test configuration and mocks
├── unit/                        # Unit tests for individual functions
│   ├── wire-calculator.test.ts  # Wire sizing calculations
│   ├── design-validator.test.ts # Design validation logic
│   ├── wire-routing.test.ts     # Wire routing algorithm
│   └── component-calculations.test.ts # Component calculations
├── functional/                  # Functional tests for user interactions
│   └── component-interactions.test.tsx # UI interaction tests
└── integration/                 # Integration tests
    ├── ai-generation.test.ts   # AI system generation
    └── export.test.ts           # Export functionality
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui
```

## Test Coverage

### Unit Tests

- **Wire Calculator**: Tests for gauge sizing, voltage drop calculations, ampacity validation, temperature derating
- **Design Validator**: Tests for voltage mismatch detection, wire sizing validation, layout checks, MPPT validation
- **Wire Routing**: Tests for grid snapping, obstacle avoidance, route calculation
- **Component Calculations**: Tests for inverter DC input calculation, AC voltage handling

### Functional Tests

- **Component Interactions**: Component selection, drag and drop, property editing
- **Wire Creation**: Terminal-based wire creation, compatibility validation
- **Wire Editing**: Endpoint dragging, path updates, length recalculation

### Integration Tests

- **AI Generation**: Prompt processing, component placement, wire generation, system validation
- **Export**: Shopping list generation, wire labels, system reports

## Writing New Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { calculateWireSize } from '../../server/wire-calculator';

describe('My Feature', () => {
  it('should do something', () => {
    const result = calculateWireSize({
      current: 10,
      length: 10,
      voltage: 12,
    });
    expect(result.recommendedGauge).toBeTruthy();
  });
});
```

### Functional Test Example

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('My Component', () => {
  it('should handle user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);
    
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Expected Result')).toBeInTheDocument();
  });
});
```

## Test Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Clear Names**: Use descriptive test names that explain what is being tested
3. **Arrange-Act-Assert**: Structure tests with clear setup, action, and verification
4. **Mock External Dependencies**: Mock API calls, timers, and browser APIs
5. **Test Edge Cases**: Include tests for boundary conditions and error cases
6. **Keep Tests Fast**: Unit tests should run quickly (< 100ms each)

## Continuous Integration

Tests should run automatically on:
- Pull requests
- Commits to main branch
- Before deployment

## Coverage Goals

- **Unit Tests**: > 80% coverage for business logic
- **Functional Tests**: Cover all major user workflows
- **Integration Tests**: Cover critical paths (AI generation, export)
