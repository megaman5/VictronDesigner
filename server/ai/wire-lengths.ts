/** Match physical cables after terminal repair, retaining parallel-wire multiplicity. */
export function restoreWireLengths(wires: any[], originals: any[], allowChanges = false) {
  const used = new Set<any>();
  for (const wire of wires) {
    const original = originals.find(w => !used.has(w) && (
      (w.fromComponentId === wire.fromComponentId && w.toComponentId === wire.toComponentId && w.fromTerminal === wire.fromTerminal && w.toTerminal === wire.toTerminal) ||
      (w.fromComponentId === wire.toComponentId && w.toComponentId === wire.fromComponentId && w.fromTerminal === wire.toTerminal && w.toTerminal === wire.fromTerminal)
    ));
    if (original && Number(original.length) > 0) {
      used.add(original);
      if (!allowChanges || !(Number(wire.length) > 0)) wire.length = original.length;
      wire.lengthEstimated = Number(wire.length) === Number(original.length) ? original.lengthEstimated ?? false : true;
    } else wire.lengthEstimated = true;
  }
}
