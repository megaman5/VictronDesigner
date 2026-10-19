import { describe, it, expect } from "vitest";
import { loadDesignDocument, documentFingerprint } from "../../shared/design-document";
import { documentReducer } from "../../client/src/hooks/use-design-document";
import { designFixtures } from "../fixtures/design-documents";

describe("document loading and editing contracts", () => {
  it("round trips all representative designs without losing identifiers, terminals or extension data", () => {
    for (const fixture of Object.values(designFixtures)) {
      expect(loadDesignDocument(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
    }
    expect(designFixtures.legacy.metadata.id).toBe("saved-legacy");
    expect(designFixtures.legacy.legacyExtension).toEqual({ retain: "yes" });
    expect(designFixtures.custom.components[0].properties.customFutureProperty).toEqual({ preserved: true });
  });

  it("rejects duplicate identifiers and missing connections rather than dropping them", () => {
    const solar = designFixtures.solar;
    expect(() => loadDesignDocument({ ...solar, components: [...solar.components, solar.components[0]] })).toThrow(/Duplicate component/);
    expect(() => loadDesignDocument({ ...solar, wires: [...solar.wires, solar.wires[0]] })).toThrow(/Duplicate wire/);
    expect(() => loadDesignDocument({ ...solar, components: solar.components.slice(1) })).toThrow(/missing component/);
  });

  it("rejects malformed lengths, positions and unsupported future formats", () => {
    const fixture = designFixtures.solar;
    expect(() => loadDesignDocument({ ...fixture, schemaVersion: 2 })).toThrow();
    expect(() => loadDesignDocument({ ...fixture, components: [{ ...fixture.components[0], x: Infinity }] })).toThrow();
    expect(() => loadDesignDocument({ ...fixture, wires: [{ ...fixture.wires[0], length: -1 }] })).toThrow();
  });

  it("adapts legacy components missing properties and wires missing terminal IDs", () => {
    const document = loadDesignDocument({ components: [{ id: "a", type: "battery", name: "A", x: 0, y: 0 }], wires: [{ id: "w", fromComponentId: "a", toComponentId: "a", polarity: "positive", length: 0 }] });
    expect(document.components[0].properties).toEqual({});
    expect(document.wires[0].fromTerminal).toBe("");
  });

  it("deletes a component and its connected wires in a single immutable transaction", () => {
    const original = designFixtures.solar;
    const next = documentReducer({ document: original, sequence: 7 }, { type: "update", update: document => ({ ...document,
      components: document.components.filter(component => component.id !== "mppt"),
      wires: document.wires.filter(wire => wire.fromComponentId !== "mppt" && wire.toComponentId !== "mppt"),
    }) });
    expect(next.sequence).toBe(8);
    expect(next.document.wires).toHaveLength(0);
    expect(original.wires).toHaveLength(2);
    expect(loadDesignDocument(next.document)).toEqual(next.document);
  });

  it("ignores no-op changes and advances freshness when opening a new document", () => {
    const state = { document: designFixtures.solar, sequence: 2 };
    expect(documentReducer(state, { type: "update", update: document => document })).toBe(state);
    expect(documentReducer(state, { type: "replace", document: designFixtures.incomplete }).sequence).toBe(3);
  });

  it("fingerprints content consistently regardless of object key order", () => {
    const document = designFixtures.solar;
    expect(documentFingerprint({ ...document, metadata: { name: "Simple solar" } })).toBe(documentFingerprint(document));
    expect(documentFingerprint({ ...document, systemVoltage: 24 })).not.toBe(documentFingerprint(document));
  });
});
