// Grid snapping utilities and orthogonal wire routing
import type { TerminalOrientation } from './terminal-config';

export const GRID_SIZE = 20;

/**
 * Snap a coordinate to the nearest grid point
 */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a point to the grid
 */
export function snapPointToGrid(x: number, y: number, gridSize: number = GRID_SIZE): { x: number; y: number } {
  return {
    x: snapToGrid(x, gridSize),
    y: snapToGrid(y, gridSize),
  };
}

// A* Node
interface Node {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic to end
  f: number; // Total cost
  parent: Node | null;
}

// Obstacle definition
export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculate route using A* algorithm
 */
export function calculateRoute(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  obstacles: Obstacle[],
  gridWidth: number = 2400,
  gridHeight: number = 1600,
  occupiedNodes: Set<string> = new Set(), // Nodes occupied by other wires
  startOrientation?: TerminalOrientation,
  endOrientation?: TerminalOrientation
): { path: string; labelX: number; labelY: number; labelRotation: number; pathNodes: string[]; pathPoints: Array<{ x: number; y: number }> } {

  const start = snapPointToGrid(startX, startY);
  const end = snapPointToGrid(endX, endY);

  // Grid dimensions in nodes
  const cols = Math.ceil(gridWidth / GRID_SIZE);
  const rows = Math.ceil(gridHeight / GRID_SIZE);

  // Helper to get node key
  const getKey = (x: number, y: number) => `${x},${y}`;

  // Initialize open and closed sets
  const openSet: Node[] = [];
  const closedSet = new Set<string>();

  // Start node
  const startNode: Node = {
    x: start.x,
    y: start.y,
    g: 0,
    h: heuristic(start, end),
    f: heuristic(start, end),
    parent: null
  };
  openSet.push(startNode);

  // Obstacle map for fast lookup
  // We map grid coordinates to obstacle cost
  // 0 = free, Infinity = blocked, High = discouraged
  const obstacleMap = new Map<string, number>();

  // Mark obstacles
  obstacles.forEach(obs => {
    // Expand obstacle slightly to provide buffer
    const buffer = GRID_SIZE;
    const minX = snapToGrid(obs.x - buffer);
    const maxX = snapToGrid(obs.x + obs.width + buffer);
    const minY = snapToGrid(obs.y - buffer);
    const maxY = snapToGrid(obs.y + obs.height + buffer);

    for (let x = minX; x <= maxX; x += GRID_SIZE) {
      for (let y = minY; y <= maxY; y += GRID_SIZE) {
        // Don't block start or end points
        if ((x === start.x && y === start.y) || (x === end.x && y === end.y)) continue;
        obstacleMap.set(getKey(x, y), Infinity);
      }
    }
  });

  // Helper to unblock a path from a point in a specific direction until it clears obstacles
  const unblockExitPath = (startNode: { x: number, y: number }, orientation: TerminalOrientation | undefined) => {
    if (!orientation) return;

    let currentX = startNode.x;
    let currentY = startNode.y;

    // Unblock the start node itself first
    obstacleMap.delete(getKey(currentX, currentY));

    // Determine step direction
    let dx = 0;
    let dy = 0;
    switch (orientation) {
      case 'top': dy = -GRID_SIZE; break;
      case 'bottom': dy = GRID_SIZE; break;
      case 'left': dx = -GRID_SIZE; break;
      case 'right': dx = GRID_SIZE; break;
    }

    // March forward until we are not in an obstacle (or hit a limit to prevent infinite loops)
    // We check if the *current* position was in an obstacle. 
    // Actually, we just need to march a sufficient distance to clear any reasonable component.
    // Most components are < 200px. 10 steps (200px) should be plenty.
    // A better approach is to check if we are currently inside any obstacle definition.

    for (let i = 0; i < 20; i++) { // Increased max steps to 20 (400px)
      currentX += dx;
      currentY += dy;

      const key = getKey(currentX, currentY);

      // Always unblock the path we are walking
      if (obstacleMap.has(key)) {
        obstacleMap.delete(key);
      }

      // Check if we are still inside ANY obstacle
      const isInsideObstacle = obstacles.some(obs => {
        const buffer = GRID_SIZE;
        return currentX >= obs.x - buffer && currentX <= obs.x + obs.width + buffer &&
          currentY >= obs.y - buffer && currentY <= obs.y + obs.height + buffer;
      });

      if (!isInsideObstacle) {
        // We are out! But let's take one more step to be safe
        const nextX = currentX + dx;
        const nextY = currentY + dy;
        const nextKey = getKey(nextX, nextY);
        if (obstacleMap.has(nextKey)) obstacleMap.delete(nextKey);
        break;
      }
    }
  };

  // Apply tunneling for start and end
  unblockExitPath(start, startOrientation);
  unblockExitPath(end, endOrientation);

  // Main A* loop
  while (openSet.length > 0) {
    // Get node with lowest f score
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;

    const currentKey = getKey(current.x, current.y);
    if (current.x === end.x && current.y === end.y) {
      return reconstructPath(current);
    }

    closedSet.add(currentKey);

    // Neighbors (Up, Down, Left, Right)
    const neighbors = [
      { x: current.x, y: current.y - GRID_SIZE },
      { x: current.x, y: current.y + GRID_SIZE },
      { x: current.x - GRID_SIZE, y: current.y },
      { x: current.x + GRID_SIZE, y: current.y }
    ];

    for (const neighbor of neighbors) {
      const neighborKey = getKey(neighbor.x, neighbor.y);

      // Check bounds
      if (neighbor.x < 0 || neighbor.x > gridWidth || neighbor.y < 0 || neighbor.y > gridHeight) continue;

      // Check closed set
      if (closedSet.has(neighborKey)) continue;

      // Calculate cost
      let cost = current.g + GRID_SIZE;

      // Obstacle penalty
      const obstacleCost = obstacleMap.get(neighborKey) || 0;
      if (obstacleCost === Infinity) continue; // Blocked

      // Occupied node penalty (wires crossing)
      if (occupiedNodes.has(neighborKey)) {
        cost += GRID_SIZE * 50; // High penalty for crossing other wires
      }

      // Turn penalty (encourage straight lines)
      if (current.parent) {
        const prevDx = current.x - current.parent.x;
        const prevDy = current.y - current.parent.y;
        const currDx = neighbor.x - current.x;
        const currDy = neighbor.y - current.y;

        if (prevDx !== currDx || prevDy !== currDy) {
          cost += GRID_SIZE * 2; // Penalty for turning
        }
      }

      const existingNode = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);

      if (!existingNode || cost < existingNode.g) {
        const h = heuristic(neighbor, end);
        const newNode: Node = {
          x: neighbor.x,
          y: neighbor.y,
          g: cost,
          h: h,
          f: cost + h,
          parent: current
        };

        if (!existingNode) {
          openSet.push(newNode);
        } else {
          existingNode.g = cost;
          existingNode.f = cost + h;
          existingNode.parent = current;
        }
      }
    }
  }

  // Fallback if no path found: Use simple Manhattan routing (L-shape)
  // This ensures orthogonal lines even if A* fails
  const midX = (start.x + end.x) / 2;

  // Create an L-shaped path
  // Try to respect orientation if possible, but keep it simple
  let points: { x: number, y: number }[] = [];

  if (Math.abs(start.x - end.x) > Math.abs(start.y - end.y)) {
    // Horizontal dominant
    points = [
      { x: start.x, y: start.y },
      { x: midX, y: start.y },
      { x: midX, y: end.y },
      { x: end.x, y: end.y }
    ];
  } else {
    // Vertical dominant
    points = [
      { x: start.x, y: start.y },
      { x: start.x, y: (start.y + end.y) / 2 },
      { x: end.x, y: (start.y + end.y) / 2 },
      { x: end.x, y: end.y }
    ];
  }

  const path = createPathWithCorners(points, 0);

  return {
    path,
    labelX: (start.x + end.x) / 2,
    labelY: (start.y + end.y) / 2,
    labelRotation: 0,
    pathNodes: [],
    pathPoints: points
  };
}

function heuristic(a: { x: number, y: number }, b: { x: number, y: number }): number {
  // Manhattan distance
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(endNode: Node): { path: string; labelX: number; labelY: number; labelRotation: number; pathNodes: string[] } {
  const points: { x: number, y: number }[] = [];
  let current: Node | null = endNode;
  const pathNodes: string[] = [];

  while (current) {
    points.unshift({ x: current.x, y: current.y });
    pathNodes.unshift(`${current.x},${current.y}`);
    current = current.parent;
  }

  // Simplify path (remove collinear points)
  const simplifiedPoints: { x: number, y: number }[] = [];
  if (points.length > 0) simplifiedPoints.push(points[0]);

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // If direction changes, keep the point
    if (dx1 !== dx2 || dy1 !== dy2) {
      simplifiedPoints.push(curr);
    }
  }

  if (points.length > 1) simplifiedPoints.push(points[points.length - 1]);

  const path = createPathWithCorners(simplifiedPoints, 0);

  // Calculate label position (midpoint of longest segment)
  let labelX = points[0].x;
  let labelY = points[0].y;
  let labelRotation = 0;
  let maxLength = 0;

  for (let i = 1; i < simplifiedPoints.length; i++) {
    const p1 = simplifiedPoints[i - 1];
    const p2 = simplifiedPoints[i];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (len > maxLength) {
      maxLength = len;
      labelX = (p1.x + p2.x) / 2;
      labelY = (p1.y + p2.y) / 2;

      // Determine rotation
      if (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y)) {
        labelRotation = 0; // Horizontal
      } else {
        labelRotation = 90; // Vertical
      }
    }
  }

  return { path, labelX, labelY, labelRotation, pathNodes, pathPoints: simplifiedPoints };
}

/**
 * Create SVG path with rounded corners through a series of points
 */
function createPathWithCorners(points: Array<{ x: number, y: number }>, cornerRadius: number): string {
  if (points.length < 2) return '';

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    const maxRadius = Math.min(cornerRadius, dist1 / 2, dist2 / 2);

    if (maxRadius < 2) {
      path += ` L ${curr.x} ${curr.y}`;
    } else {
      const ratio1 = maxRadius / dist1;
      const ratio2 = maxRadius / dist2;

      const beforeX = curr.x - dx1 * ratio1;
      const beforeY = curr.y - dy1 * ratio1;
      const afterX = curr.x + dx2 * ratio2;
      const afterY = curr.y + dy2 * ratio2;

      path += ` L ${beforeX} ${beforeY}`;
      path += ` Q ${curr.x} ${curr.y} ${afterX} ${afterY}`;
    }
  }

  path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  return path;
}

/**
 * Calculate the Euclidean distance between two points
 */
export function calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate wire length in feet based on pixel distance
 * Assumes ~10 pixels per inch (realistic for schematic diagrams)
 * Canvas is 2400x1600px, typical RV/boat systems are 20-30ft, so ~80-120px per foot
 */
export function calculateWireLength(x1: number, y1: number, x2: number, y2: number, pixelsPerFoot: number = 80): number {
  const distancePixels = calculateDistance(x1, y1, x2, y2);
  const distanceFeet = distancePixels / pixelsPerFoot;

  // Add 25% for routing, connections, and service loops
  return Math.round(distanceFeet * 1.25 * 10) / 10; // Round to 1 decimal place
}

/**
 * Calculate wire length from path segments (for actual routed paths)
 */
export function calculateWireLengthFromPath(pathSegments: Array<{x: number, y: number}>): number {
  if (pathSegments.length < 2) return 0;
  
  let totalPixels = 0;
  for (let i = 1; i < pathSegments.length; i++) {
    const prev = pathSegments[i - 1];
    const curr = pathSegments[i];
    totalPixels += calculateDistance(prev.x, prev.y, curr.x, curr.y);
  }
  
  const pixelsPerFoot = 80; // ~80px per foot for schematic scale
  const distanceFeet = totalPixels / pixelsPerFoot;
  
  // Add 10% for connections and service loops (routing already accounted for)
  return Math.round(distanceFeet * 1.1 * 10) / 10;
}

// Keep the old function signature for compatibility, but forward to new router if needed
// Or just keep it as a fallback?
// For now, let's export the old one too if we need it, but we'll try to use calculateRoute
export function calculateOrthogonalPathWithOrientation(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startOrientation: TerminalOrientation,
  endOrientation: TerminalOrientation,
  wireOffset: number = 0,
  cornerRadius: number = 15
): { path: string; labelX: number; labelY: number } {
  // Simple wrapper that calls the new router with empty obstacles
  // This is just to satisfy existing imports if any
  return calculateRoute(x1, y1, x2, y2, []);
}
