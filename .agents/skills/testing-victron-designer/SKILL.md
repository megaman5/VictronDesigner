---
name: testing-victron-designer
description: Test VictronDesigner UI and export flows end-to-end. Use when verifying component library, schematic canvas, wire labels, or export behavior.
---

# VictronDesigner Testing

## Devin Secrets Needed

- For component-library, canvas rendering, and export endpoint tests, real secrets are usually not required. The server imports DB/OpenAI modules at startup, so local non-AI testing can use placeholder values such as `DATABASE_URL=postgresql://devin:devin@localhost:5432/devin` and `OPENAI_API_KEY=sk-test`.
- For real AI generation tests, use a valid `OPENAI_API_KEY` secret.
- For tests involving saved designs, auth, feedback admin, or DB-backed persistence, use a valid `DATABASE_URL` secret.

## Local Startup

1. Install dependencies with `npm ci --legacy-peer-deps` if `npm ci` hits the known `canvas`/`jsdom` peer dependency conflict.
2. Start the app from the repo root:
   ```bash
   DATABASE_URL=postgresql://devin:devin@localhost:5432/devin OPENAI_API_KEY=sk-test npm run dev
   ```
3. Open `http://localhost:5000` in Chrome.
4. Maximize Chrome before recording:
   ```bash
   wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
   ```

## UI Testing Checklist

- Verify component-library items visually from the left sidebar.
- Drag components onto the canvas and confirm their rendered label, shape, and visible terminal anchors.
- For wire-label tests, prefer creating wires through the UI first. If terminal-click wiring does not complete in the current environment, load deterministic state through `loadedFeedbackState` and reload the page.

## Prepared State Restore Pattern

Use Chrome CDP at `http://localhost:29229` to set `loadedFeedbackState` for a deterministic schematic before reloading. The app prioritizes this key over stale auto-save state and then removes it after loading.

Example state shape:

```json
{
  "components": [
    {"id":"c-battery","type":"battery","name":"Battery Bank","x":120,"y":300,"properties":{"voltage":24,"capacity":200,"current":10}},
    {"id":"c-bus","type":"busbar-positive","name":"Positive Bus Bar","x":420,"y":300,"properties":{"voltage":24,"current":100}}
  ],
  "wires": [
    {"id":"w-10awg-positive","fromComponentId":"c-battery","toComponentId":"c-bus","fromTerminal":"positive","toTerminal":"pos-1","polarity":"positive","length":6,"gauge":"10 AWG","current":10,"conductorMaterial":"copper"}
  ],
  "systemVoltage": 24
}
```

## Wire Gauge / Export Checks

- In AWG mode, a `10 AWG` wire should render as `10 AWG` on the canvas.
- Switching the top-bar selector to `mm²` should render the same wire as `5.26 mm²` without changing length/polarity text.
- Verify export endpoints directly with the same state payload:
  - `POST /api/export/wire-labels`
  - `POST /api/export/system-report`
- Include `wireGaugeFormat: "metric"` and expect `5.26 mm²` plus `Wire Gauge Format: mm²` in the report.
- Include `wireGaugeFormat: "awg"` and expect `10 AWG` plus `Wire Gauge Format: AWG` in the report.

## Reporting

- Record browser interactions for visual UI tests and annotate setup, test starts, and assertions.
- Attach the recording plus a markdown test report with full-screen screenshots and endpoint-output excerpts.
