# Design document and editing boundary

The editor stores persistent content in `useDesignDocument`. Its `updateDocument` callback receives the latest document, so related changes such as deleting equipment and its wires belong in one callback. `replaceDocument` validates imported or saved content before changing the canvas. Selection, hovered terminals, viewport, and open panels remain separate UI state.

The document format version is currently 1. It is independent of the controller's monotonic `sequence`, which indicates changes during the editing session, and of the server's future cloud version for save conflicts. Calculation engine versions belong to analysis results. `documentFingerprint` is a stable, noncryptographic content identifier for freshness and comparison; it must not be used for authentication or security decisions.

Documents retain names, descriptions, project identity, electrical settings, component and wire IDs, terminals, custom component snapshots, extension properties, and calculation options. UI display units, theme, panel visibility, routing preferences, and load visualization mode currently remain browser preferences. Persisted calculation options are an extension point for options that actually affect electrical calculations.

Legacy `/api/designs`, `/api/schematics`, feedback records, and browser recovery objects pass through `loadDesignDocument`. The adapter supplies absent legacy component properties, missing terminal strings, default system voltage, metadata, and format version. It preserves extension fields. It rejects unsupported document versions, duplicate component or wire IDs, missing component references, nonfinite positions and lengths, and negative lengths rather than filtering invalid objects away. Incomplete circuits remain valid editable documents. Terminal existence and electrical suitability belong to electrical analysis; old center-to-center wires retain empty terminal strings for compatibility.

An invalid browser recovery document is copied to `invalidAutoSavedDiagramState` before a new edit can replace the original autosave slot. The UI reports that recovery data remains on the device. Invalid imported account documents leave the current canvas intact. Login and feedback recovery failures retain their respective source records.

## Persistence inventory

The visible Save/Open dialogs use `/api/designs` and `server/user-designs-storage.ts`, which stores account designs in `user_designs`. These operations use `AuthUser.id` as the ownership identity, consistent with Google account identity elsewhere in the app. This is the flow to extend for autosave and revisions.

The editor also retains a `/api/schematics/:id` loading path and legacy schematic CRUD through `server/storage.ts`. Keep those endpoints compatible while adapting loaded records to the shared document; no existing records are deleted or bulk migrated by this foundation. The two tables must not be treated as interchangeable IDs or silently moved between identity conventions.

## Verification and limits

`tests/fixtures/design-documents.ts` covers solar, AC/DC loads, multiple banks, shore power, parallel conductors, custom definitions, incomplete circuits, and legacy extension data. These are structural regression inputs, not certified electrical examples. Tests check identifier/property preservation, error reporting, atomic connected deletion, monotonic freshness, no-op handling, and stable fingerprints.

Electrical golden values and export baselines still require the calculation and installation-package work. The controller does not itself certify electrical designs or replace endpoint authorization. Undo history, autosave concurrency, and asynchronous validation freshness extend this boundary in their respective releases.
