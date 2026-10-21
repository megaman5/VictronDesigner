import { useCallback, useReducer } from "react";
import type { SetStateAction } from "react";
import { loadDesignDocument, type DesignDocument } from "@shared/design-document";
import type { SchematicComponent, Wire } from "@shared/schema";

const HISTORY_LIMIT = 100;
const HISTORY_BYTES = 8 * 1024 * 1024;
interface HistoryEntry { document: DesignDocument; label: string; bytes: number }
export interface DocumentState {
  document: DesignDocument; sequence: number;
  past?: HistoryEntry[]; future?: HistoryEntry[];
  transaction?: { document: DesignDocument; label: string };
  lastGroup?: { key: string; time: number };
}
export interface EditOptions { label?: string; group?: string; recordHistory?: boolean }
export type DocumentAction =
  | ({ type: "update"; update: (document: DesignDocument) => DesignDocument; time?: number } & EditOptions)
  | { type: "replace"; document: DesignDocument }
  | { type: "begin"; label: string }
  | { type: "end" }
  | { type: "undo" }
  | { type: "redo" };

function entry(document: DesignDocument, label: string): HistoryEntry {
  return { document, label, bytes: JSON.stringify(document).length * 2 };
}
function bounded(entries: HistoryEntry[]): HistoryEntry[] {
  let bytes = entries.reduce((total, value) => total + value.bytes, 0);
  while (entries.length > HISTORY_LIMIT || (bytes > HISTORY_BYTES && entries.length > 1)) bytes -= entries.shift()!.bytes;
  return entries;
}
function finish(state: DocumentState): DocumentState {
  if (!state.transaction) return state;
  const { document, label } = state.transaction;
  return { ...state, transaction: undefined, lastGroup: undefined,
    ...(document !== state.document ? { past: bounded([...(state.past ?? []), entry(document, label)]), future: [] } : {}) };
}
export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  if (action.type === "replace") return { document: action.document, sequence: state.sequence + 1, past: [], future: [] };
  if (action.type === "begin") return state.transaction ? state : { ...state, transaction: { document: state.document, label: action.label }, lastGroup: undefined };
  if (action.type === "end") return finish(state);
  if (action.type === "undo" || action.type === "redo") {
    state = finish(state);
    const source = action.type === "undo" ? state.past ?? [] : state.future ?? [];
    const selected = source[source.length - 1];
    if (!selected) return state;
    const inverse = entry(state.document, selected.label);
    return { ...state, document: { ...selected.document, metadata: state.document.metadata }, sequence: state.sequence + 1, lastGroup: undefined,
      past: action.type === "undo" ? source.slice(0, -1) : bounded([...(state.past ?? []), inverse]),
      future: action.type === "redo" ? source.slice(0, -1) : bounded([...(state.future ?? []), inverse]) };
  }
  const document = action.update(state.document);
  if (document === state.document || JSON.stringify(document) === JSON.stringify(state.document)) return state;
  if (action.recordHistory === false) return { ...state, document, sequence: state.sequence + 1 };
  const time = action.time ?? Date.now();
  const coalesced = action.group && state.lastGroup && state.lastGroup.key === action.group && time - state.lastGroup.time < 750;
  return { ...state, document, sequence: state.sequence + 1, future: [],
    past: state.transaction || coalesced ? state.past : bounded([...(state.past ?? []), entry(state.document, action.label ?? "edit design")]),
    lastGroup: action.group ? { key: action.group, time } : undefined };
}

/** Persistent editor content uses this boundary; selection and panel state remain local UI state. */
export function useDesignDocument(initial: unknown | (() => unknown), normalize?: (next: DesignDocument, previous: DesignDocument) => DesignDocument) {
  const [state, dispatch] = useReducer(documentReducer, initial, input => ({ document: loadDesignDocument(typeof input === "function" ? input() : input), sequence: 0, past: [], future: [] }));
  const updateDocument = useCallback((update: (document: DesignDocument) => DesignDocument, options: EditOptions = {}) => dispatch({ type: "update", ...options,
    update: previous => { const next = update(previous); return normalize ? normalize(next, previous) : next; } }), [normalize]);
  const replaceDocument = useCallback((input: unknown) => dispatch({ type: "replace", document: loadDesignDocument(input) }), []);
  const setComponents = useCallback((value: SetStateAction<SchematicComponent[]>, options: EditOptions = {}) => updateDocument(document => {
    const components = typeof value === "function" ? value(document.components) : value;
    return components === document.components ? document : { ...document, components };
  }, { label: "edit components", ...options }), [updateDocument]);
  const setWires = useCallback((value: SetStateAction<Wire[]>, options: EditOptions = {}) => updateDocument(document => {
    const wires = typeof value === "function" ? value(document.wires) : value;
    return wires === document.wires ? document : { ...document, wires };
  }, { label: "edit wires", ...options }), [updateDocument]);
  const setSystemVoltage = useCallback((value: SetStateAction<number>) => updateDocument(document => {
    const systemVoltage = typeof value === "function" ? value(document.systemVoltage) : value;
    return systemVoltage === document.systemVoltage ? document : { ...document, systemVoltage };
  }, { label: "change system voltage" }), [updateDocument]);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const beginTransaction = useCallback((label: string) => dispatch({ type: "begin", label }), []);
  const endTransaction = useCallback(() => dispatch({ type: "end" }), []);
  return { ...state, setComponents, setWires, setSystemVoltage, replaceDocument, updateDocument, undo, redo, beginTransaction, endTransaction,
    canUndo: !!state.past?.length || !!state.transaction && state.transaction.document !== state.document,
    canRedo: !!state.future?.length, undoLabel: state.past?.[state.past.length - 1]?.label, redoLabel: state.future?.[state.future.length - 1]?.label };
}
