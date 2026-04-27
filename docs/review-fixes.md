# Review Fixes Task List

This tracks the larger issues found during the codebase review.

## Tasks

- [x] Fix broken `/api/schematics` auth helper usage (`getAuthUser` is undefined)
- [x] Add ownership checks to `/api/schematics/:id` read/update/delete routes
- [ ] Protect export-by-ID routes or remove legacy schematic export endpoints
- [ ] Validate OAuth `returnTo` redirects to prevent open redirects
- [ ] Move auth user deserialization away from in-memory-only storage
- [ ] Consolidate legacy `/api/schematics` and newer `/api/designs` save systems
- [ ] Add `"hot"` to shared `Wire.polarity` type
- [ ] Refactor `calculateWireSize` to use an explicit `foundSuitableGauge` flag
