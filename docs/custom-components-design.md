# Custom Components — Design Proposal

**Status:** proposed, not built
**Source:** user feedback `6c27020c-d272-41f8-aa58-06c19010c8dc` (2026-07-14)

> "Custom Components... we need to be able to define snap points, additional points, etc, etc
> so we can build actual components (i.e. Lynx). Be fantastic if it could be community
> components, or if we can apply to be component builders?"

## Where we are today

There is already an "Add Custom Component" button (`handleAddCustomComponent` in
`client/src/pages/SchematicDesigner.tsx`). It drops a component of type `custom` with a
name and a subtitle. Its terminals are **fixed**: `in-positive`, `in-negative`,
`out-positive`, `out-negative` (`custom` entry in `client/src/lib/terminal-config.ts`).

That covers "a box with two pairs of studs". It does not cover what this request is
asking for: defining your own terminals, at your own positions, with your own labels and
polarities — which is what it takes to model something like a Lynx module.

(The specific example in the feedback — Lynx — is now shipped as first-class components:
`lynx-power-in`, `lynx-distributor`, `lynx-shunt`, `lynx-smart-bms`. The general request
stands on its own.)

## The core constraint

Terminals are currently keyed by **component type**, in a module-level constant:

```ts
export const TERMINAL_CONFIGS: Record<string, ComponentTerminalConfig> = { ... }
```

Every consumer — canvas rendering, wire routing, hit testing, validation, export — looks
up `TERMINAL_CONFIGS[comp.type]`. A user-defined component has no entry there.

Recent work on MPPT LOAD terminals introduced the seam we need:

```ts
export function getComponentTerminals(
  componentType: string,
  properties?: Record<string, any> | null
): Terminal[]
```

Call sites now resolve terminals **per component instance** rather than per type. A custom
component can therefore carry its own terminal list in `properties` (or be resolved from a
definition id) without touching those call sites again.

## Proposed data model

Store definitions in their own table rather than inline on every instance, so one edit
updates every placement and definitions can be shared later.

```ts
// shared/schema.ts
export const customComponents = pgTable("custom_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: integer("owner_id").references(() => users.id),
  name: text("name").notNull(),
  subtitle: text("subtitle"),
  category: text("category").notNull().default("custom"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  terminals: jsonb("terminals").notNull(),   // Terminal[]
  appearance: jsonb("appearance"),           // body colour, label placement, optional bars
  visibility: text("visibility").notNull().default("private"), // private | unlisted | public
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

A placed instance stays a normal `SchematicComponent`:

```ts
{ type: "custom", properties: { definitionId: "<uuid>", definitionVersion: 3, ... } }
```

**Snapshot on place.** Copy the terminal list into the instance's properties at placement
time. A schematic saved today must still open correctly after the author edits or deletes
their definition. Treat the snapshot as the source of truth for rendering and validation;
use `definitionId`/`version` only to offer "this part has an update, apply it?".

## Editor UI

A dialog/route (`CustomComponentEditor.tsx`) with:

1. **Body** — name, subtitle, width/height on the 20px grid, category.
2. **Terminal placement** — click an edge of the preview to drop a terminal; drag to move
   (snapped to the grid); edit `id`, `label`, `type` (positive / negative / ac-in / ac-out
   / hot / neutral / ground / pv-positive / pv-negative) and `orientation`.
3. **Validation** — unique non-empty terminal ids, terminals on the body edge, orientation
   consistent with the edge, at least one terminal.
4. **Live preview** — reuse `SchematicComponent`'s renderer with a generic body so the
   preview is exactly what lands on the canvas.

Rendering: a generic component body (rounded rect, name, subtitle, optional busbar strip)
driven by `appearance`, rather than per-type hand-written SVG. Hand-drawn SVG stays for
built-in Victron parts.

## Work breakdown

| # | Work | Notes |
|---|---|---|
| 1 | `customComponents` table + Drizzle schema + `db:push` | ~half day |
| 2 | CRUD endpoints, owner-scoped | needs real auth (see risks) |
| 3 | Editor UI with terminal placement | the bulk of the work, ~3-4 days |
| 4 | Generic renderer driven by `appearance` | ~1 day |
| 5 | Resolve instances through `getComponentTerminals` | seam already exists; small |
| 6 | Library section "My Components" | ~half day |
| 7 | Validator handling for unknown types | must not fire false errors on custom parts |
| 8 | Export/shopping list entries | description from the definition |

Roughly **1.5–2 weeks** for the single-user version.

## Community sharing — phase 2

The feedback also asks for community components and a "component builder" role. That is a
separate project on top of phase 1:

- publish/unpublish, a browse-and-search gallery, fork-on-import
- **moderation**: a public component is wiring advice. A part with mislabelled polarity or
  a terminal in the wrong place produces designs that are wrong in a way the user cannot
  see. Curation is the hard problem here, not the plumbing.
- a `component_builder` role, granted manually at first — which is close to what the user
  proposed ("or if we can apply to be component builders?")
- attribution, versioning, and a report path

Recommendation: ship phase 1, invite the users who asked for it to build parts, and use
what they build to decide whether the gallery is worth the moderation cost.

## Risks

- **Auth.** `users` exists in the schema but there is no real login flow. Per-user
  definitions need one first — or definitions get scoped to the browser, which loses them.
- **Validation false positives.** Electrical rules key off component type. Custom parts
  need either a declared behaviour ("acts like a busbar", "acts like a charger") or
  exclusion from type-specific rules. Declared behaviour is better: it keeps wire sizing
  and current calculations meaningful.
- **Terminal id collisions** with built-in ids in saved wires — namespace custom ids.
