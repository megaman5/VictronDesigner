# AI interruption handling and device models

Date: October 2, 2026

## AI investigation and changes

The reported run completed two passes and its third provider request was aborted. The server retained a candidate with 24 components and 42 wires. The exact reported blank screen was not reproduced; a successful two-pass stream displayed its proposal correctly in the new frontend integration test.

Two concrete problems were corrected:

- A stream that ended without a final completion/error event previously finished silently. It now displays an interruption error and retains the prompt for retry. Existing canvas content remains untouched.
- A second progress overlay rendered outside, and above, the AI dialog. Interacting with that overlay could dismiss the dialog and trigger cancellation. The duplicate overlay is suppressed while the AI dialog is open.

Cancelled older runs can no longer update the current run's loading state or process late stream events. A designer error boundary displays reload/recovery controls and records component-render errors instead of allowing a rendering exception to leave an empty page.

Automated tests cover two-pass completion and proposal application, premature stream closure with prompt retention, and recovery controls after a rendering exception. Provider requests were mocked; no additional paid AI calls were made for this verification.

## 3D models

The three devices in the user's screenshot now have individual geometry:

- Cerbo GX: shallow housing, mounting ears, USB sockets and side connector blocks. Data sockets no longer render as high-current binding posts.
- MultiPlus: taller enclosure, separate lower connection cover, indicators, switch, vents and a grille.
- Quattro: wider, deeper housing, two grilles, separate connection cover and supported terminal beds.

The large black nameplates were replaced with transparent lettering. Model proportions and depths differ by family; wire endpoints attach to the model's projected terminals. Saved 2D component positions and electrical connection IDs remain unchanged.

These remain illustrative family models, not dimensionally accurate CAD for every product variant. General appearance references: [Cerbo GX](https://www.victronenergy.com/communication-centres/cerbo-gx), [MultiPlus](https://www.victronenergy.com/inverters-chargers/multiplus-12v-24v-48v-800va-3kva), [Quattro](https://www.victronenergy.com/inverters-chargers/quattro), and [Cerbo dimension drawing](https://www.victronenergy.com/upload/documents/Cerbo-GX.PDF).

## Verification

- Full suite: **560 passed, 5 skipped**, 50 test files passed and one skipped.
- Focused model and AI tests: 27 passed before the final cancellation guard; the AI and recovery tests were rerun afterward.
- TypeScript check, production build and whitespace check passed.
- Rebuilt and restarted `victron-designer.service`; health returned HTTP 200 and systemd reported active.
- Browser at `https://www.victrondesigner.com/`: loaded a deterministic Cerbo/MultiPlus/Quattro fixture in a separate test tab, entered 3D, and inspected the rendered models. The original tab was untouched, and the test tab was restored to its original component/wire snapshot afterward.
- The browser was signed out. Browser verification covered rendering, while streamed AI behavior was tested with the real editor/controller and mocked network/provider responses.

Testing followed the [VictronDesigner testing skill](../../.agents/skills/testing-victron-designer/SKILL.md).

[Browser recording](/home/sean/.t3/userdata/attachments/f0c21dd3-9f8d-468c-9478-9202297a7f27-a3783ead-19ee-46c4-b62e-c7a810d2e4d1-mp4.mp4) · [Full test output](/tmp/victron-3d-full-tests.log)

![Updated Cerbo GX, MultiPlus and Quattro models](/home/sean/.t3/userdata/browser-artifacts/browser-screenshot-www-victrondesigner-com-murkj889-ad7f9e05.png)
