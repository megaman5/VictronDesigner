/**
 * Linear resistor-network solver (nodal analysis). Given resistors and the
 * current injected into each node, returns the current through every resistor
 * from Kirchhoff's laws - how parallel cables and parallel batteries share
 * current follows from their resistances, not from an assumed split.
 */
export interface Resistor { id: string; a: string; b: string; ohms: number }

export interface NetworkSolution {
  /** Current through each resistor, positive when flowing from `a` to `b`. */
  current: Map<string, number>;
  /** Node potentials; each connected part is shifted so its lowest node is 0. */
  potential: Map<string, number>;
}

/**
 * Solve every connected part of the network independently. A part whose
 * injected currents do not sum to zero has no steady state (current with
 * nowhere to go - e.g. a load with no battery in its circuit); its resistors
 * and nodes are left out of the solution rather than given invented values.
 */
export function solveResistorNetwork(resistors: Resistor[], injections: Map<string, number>): NetworkSolution {
  const solution: NetworkSolution = { current: new Map(), potential: new Map() };
  const nodes = new Set<string>(Array.from(injections.keys()));
  for (const r of resistors) { nodes.add(r.a); nodes.add(r.b); }
  const parent = new Map<string, string>(Array.from(nodes).map(n => [n, n]));
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const r of resistors) parent.set(find(r.a), find(r.b));
  const parts = new Map<string, string[]>();
  for (const n of Array.from(nodes)) { const root = find(n); parts.set(root, [...(parts.get(root) ?? []), n]); }

  for (const members of Array.from(parts.values())) {
    const total = members.reduce((sum, n) => sum + (injections.get(n) ?? 0), 0);
    const scale = members.reduce((sum, n) => sum + Math.abs(injections.get(n) ?? 0), 0);
    if (Math.abs(total) > 1e-9 * Math.max(1, scale)) continue;
    // Node 0 is the reference; solve G v = i for the rest.
    const index = new Map(members.map((n, i) => [n, i - 1]));
    const size = members.length - 1;
    const g: number[][] = Array.from({ length: size }, () => new Array(size + 1).fill(0));
    const own = resistors.filter(r => index.has(r.a));
    for (const r of own) {
      const c = 1 / r.ohms, i = index.get(r.a)!, j = index.get(r.b)!;
      if (i >= 0) g[i][i] += c;
      if (j >= 0) g[j][j] += c;
      if (i >= 0 && j >= 0) { g[i][j] -= c; g[j][i] -= c; }
    }
    for (const n of members) { const i = index.get(n)!; if (i >= 0) g[i][size] = injections.get(n) ?? 0; }
    const v = gaussianSolve(g, size);
    if (!v) continue;
    const at = (n: string) => { const i = index.get(n)!; return i < 0 ? 0 : v[i]; };
    const low = Math.min(...members.map(at));
    for (const n of members) solution.potential.set(n, at(n) - low);
    for (const r of own) solution.current.set(r.id, (at(r.a) - at(r.b)) / r.ohms);
  }
  return solution;
}

/** Gaussian elimination with partial pivoting on an augmented matrix. */
function gaussianSolve(m: number[][], n: number): number[] | undefined {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-15) return undefined;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = col + 1; row < n; row++) {
      const f = m[row][col] / m[col][col];
      if (f) for (let k = col; k <= n; k++) m[row][k] -= f * m[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * x[k];
    x[row] = sum / m[row][row];
  }
  return x;
}
