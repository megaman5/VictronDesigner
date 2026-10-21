import { describe, expect, it } from "vitest";
import { documentReducer, type DocumentState } from "./use-design-document";
import { loadDesignDocument } from "@shared/design-document";
import { act, renderHook } from '@testing-library/react';
import { useDesignDocument } from './use-design-document';

function initial(): DocumentState {
  return { document: loadDesignDocument({ id: "project", name: "Test", systemVoltage: 12,
    components: [{ id: "battery", type: "battery", name: "Battery", x: 20, y: 20, properties: { voltage: 12 } },
      { id: "load", type: "dc-load", name: "Load", x: 100, y: 20, properties: { watts: 60 } }],
    wires: [{ id: "wire", fromComponentId: "battery", toComponentId: "load", fromTerminal: "positive", toTerminal: "positive", polarity: "positive", length: 10 }] }), sequence: 0 };
}
const move = (state: DocumentState, x: number, group?: string, time = 0) => documentReducer(state, {
  type: "update", label: "move components", group, time,
  update: document => ({ ...document, components: document.components.map(component => ({ ...component, x })) }),
});

describe("document history", () => {
  it('renders and updates history labels in browsers without Array.at', () => {
    const originalAt = Array.prototype.at;
    try {
      Array.prototype.at = undefined as any;
      const { result } = renderHook(() => useDesignDocument(initial().document));
      act(() => result.current.setSystemVoltage(24));
      expect(result.current.undoLabel).toBe('change system voltage');
      act(() => result.current.undo());
      expect(result.current.redoLabel).toBe('change system voltage');
    } finally { Array.prototype.at = originalAt; }
  });
  it("restores deleted components, their original IDs, wires, and electrical settings in one undo", () => {
    const original = initial();
    const deleted = documentReducer(original, { type: "update", label: "delete components", update: document => ({ ...document, components: [], wires: [], systemVoltage: 24 }) });
    const undone = documentReducer(deleted, { type: "undo" });
    expect(undone.document).toEqual(original.document);
    expect(documentReducer(undone, { type: "redo" }).document).toEqual(deleted.document);
    expect(undone.sequence).toBeGreaterThan(deleted.sequence);
  });
  it("groups a multi-component drag and continuous typing until commit", () => {
    const original = initial();
    let state = documentReducer(original, { type: "begin", label: "move selection" });
    state = move(move(state, 40), 80);
    expect(state.past ?? []).toHaveLength(0);
    state = documentReducer(state, { type: "end" });
    expect(state.past).toHaveLength(1);
    expect(state.past?.[0].label).toBe("move selection");
    expect(documentReducer(state, { type: "undo" }).document).toEqual(original.document);
  });
  it("clears redo when another user edit follows undo", () => {
    const undone = documentReducer(move(initial(), 40), { type: "undo" });
    const edited = move(undone, 60);
    expect(edited.future).toHaveLength(0);
    expect(documentReducer(edited, { type: "redo" })).toBe(edited);
  });
  it("keeps cloud identity outside history and retains identity after reversible clear", () => {
    let state = move(initial(), 40);
    state = documentReducer(state, { type: "update", recordHistory: false,
      update: document => ({ ...document, metadata: { id: "saved-project", name: "Saved design" } }) });
    expect(state.past).toHaveLength(1);
    state = documentReducer(state, { type: "undo" });
    expect(state.document.metadata).toEqual({ id: "saved-project", name: "Saved design" });
    expect(state.document.components[0].x).toBe(20);
  });
  it("resets history on project load and does not record no-op edits", () => {
    const state = move(initial(), 40);
    const loaded = documentReducer(state, { type: "replace", document: initial().document });
    expect(loaded.past).toHaveLength(0);
    expect(loaded.future).toHaveLength(0);
    expect(documentReducer(loaded, { type: "undo" })).toBe(loaded);
    expect(move(initial(), 20).past).toHaveLength(1); // second component also changes position
    const original = initial();
    expect(documentReducer(original, { type: "update", update: document => ({ ...document }) })).toBe(original);
  });
  it("bounds history and merges nearby edits only within the same group", () => {
    let state = initial();
    for (let x = 0; x < 130; x++) state = move(state, x);
    expect(state.past).toHaveLength(100);
    state = move(move(initial(), 50, "position", 100), 60, "position", 200);
    expect(state.past).toHaveLength(1);
    state = move(state, 70, "position", 1000);
    expect(state.past).toHaveLength(2);
  });
  it("undo commits an active field edit and cancelled empty transactions add no history", () => {
    let state = documentReducer(initial(), { type: "begin", label: "edit properties" });
    state = move(state, 60);
    expect(documentReducer(state, { type: "undo" }).document).toEqual(initial().document);
    state = documentReducer(initial(), { type: "begin", label: "empty drag" });
    expect(documentReducer(state, { type: "end" }).past ?? []).toHaveLength(0);
  });
});
