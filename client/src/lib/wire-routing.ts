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

/**
 * Calculate orthogonal path with terminal orientations
 * Returns path string and label position
 */
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
  // Snap points to grid
  const start = snapPointToGrid(x1, y1);
  const end = snapPointToGrid(x2, y2);
  
  const offsetAmount = wireOffset * GRID_SIZE;
  
  // Minimum exit distance from terminals (shorter for better routing)
  const MIN_EXIT = GRID_SIZE * 2; // 40px minimum exit (reduced from 60px)
  
  // Calculate exit points with smart direction logic
  // For top/bottom orientations, choose direction based on destination
  let exitPoint = { ...start };
  switch (startOrientation) {
    case "left":
      exitPoint.x = start.x - MIN_EXIT;
      exitPoint.y = start.y + offsetAmount;
      break;
    case "right":
      exitPoint.x = start.x + MIN_EXIT;
      exitPoint.y = start.y + offsetAmount;
      break;
    case "top":
    case "bottom":
      // For vertical orientations, always route toward the destination
      exitPoint.x = start.x + offsetAmount;
      if (end.y > start.y) {
        // Destination is below - exit downward
        exitPoint.y = start.y + MIN_EXIT;
      } else if (end.y < start.y) {
        // Destination is above - exit upward
        exitPoint.y = start.y - MIN_EXIT;
      } else {
        // Same Y level - use default for orientation
        exitPoint.y = startOrientation === "top" ? start.y - MIN_EXIT : start.y + MIN_EXIT;
      }
      break;
  }
  
  // Calculate entry points with smart direction logic
  let entryPoint = { ...end };
  switch (endOrientation) {
    case "left":
      entryPoint.x = end.x - MIN_EXIT;
      entryPoint.y = end.y + offsetAmount;
      break;
    case "right":
      entryPoint.x = end.x + MIN_EXIT;
      entryPoint.y = end.y + offsetAmount;
      break;
    case "top":
    case "bottom":
      // For vertical orientations, always enter from the source direction
      entryPoint.x = end.x + offsetAmount;
      if (start.y > end.y) {
        // Source is below - enter from below
        entryPoint.y = end.y + MIN_EXIT;
      } else if (start.y < end.y) {
        // Source is above - enter from above
        entryPoint.y = end.y - MIN_EXIT;
      } else {
        // Same Y level - use default for orientation
        entryPoint.y = endOrientation === "top" ? end.y - MIN_EXIT : end.y + MIN_EXIT;
      }
      break;
  }
  
  // Build path points
  const points: Array<{x: number, y: number}> = [start];
  
  // Add exit segment
  points.push(exitPoint);
  
  // Improved middle segment routing that maintains offset throughout
  // Determine which orientations we're dealing with
  const isStartVertical = startOrientation === "top" || startOrientation === "bottom";
  const isEndVertical = endOrientation === "top" || endOrientation === "bottom";
  
  // Calculate middle routing based on terminal orientations
  if (isStartVertical && isEndVertical) {
    // Both terminals are vertical (top/bottom) - maintain X offset in vertical segments
    const midY = (exitPoint.y + entryPoint.y) / 2;
    
    if (exitPoint.x !== entryPoint.x) {
      // Need horizontal segment to transition between different X positions
      points.push({ x: exitPoint.x, y: midY });
      points.push({ x: entryPoint.x, y: midY });
    }
    // Else: X positions are the same, vertical segment directly connects exit to entry
    
  } else if (!isStartVertical && !isEndVertical) {
    // Both terminals are horizontal (left/right) - maintain Y offset in horizontal segments
    const midX = (exitPoint.x + entryPoint.x) / 2;
    
    if (exitPoint.y !== entryPoint.y) {
      // Need vertical segment to transition between different Y positions
      points.push({ x: midX, y: exitPoint.y });
      points.push({ x: midX, y: entryPoint.y });
    }
    // Else: Y positions are the same, horizontal segment directly connects exit to entry
    
  } else {
    // Mixed orientations (one vertical, one horizontal)
    // Use the standard routing that prioritizes based on distance
    if (Math.abs(exitPoint.x - entryPoint.x) > Math.abs(exitPoint.y - entryPoint.y)) {
      // Horizontal routing dominant
      if (exitPoint.y !== entryPoint.y) {
        points.push({ x: entryPoint.x, y: exitPoint.y });
      }
    } else {
      // Vertical routing dominant
      if (exitPoint.x !== entryPoint.x) {
        points.push({ x: exitPoint.x, y: entryPoint.y });
      }
    }
  }
  
  // Add entry segment
  if (points[points.length - 1].x !== entryPoint.x || points[points.length - 1].y !== entryPoint.y) {
    points.push(entryPoint);
  }
  
  // Add final destination
  points.push(end);
  
  // Create path
  const path = createPathWithCorners(points, cornerRadius);
  
  // Calculate label position - use midpoint of the longest straight segment
  let labelX = (start.x + end.x) / 2;
  let labelY = (start.y + end.y) / 2;
  
  if (points.length >= 3) {
    // Find longest segment for label placement
    let maxLength = 0;
    let bestMidX = labelX;
    let bestMidY = labelY;
    
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const length = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      
      if (length > maxLength) {
        maxLength = length;
        bestMidX = (p1.x + p2.x) / 2;
        bestMidY = (p1.y + p2.y) / 2;
      }
    }
    
    labelX = bestMidX;
    labelY = bestMidY;
  }
  
  return { path, labelX, labelY };
}

/**
 * Calculate orthogonal path between two points with rounded corners and smart lane-based routing
 * Returns an SVG path string for drawing
 */
export function calculateOrthogonalPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius: number = 15,
  wireOffset: number = 0 // Lane offset for parallel wires
): string {
  // Snap points to grid
  const start = snapPointToGrid(x1, y1);
  const end = snapPointToGrid(x2, y2);
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // No offset needed for single wires
  if (wireOffset === 0) {
    return simpleOrthogonalPath(start.x, start.y, end.x, end.y, cornerRadius);
  }
  
  // Calculate offset amount based on lane
  const offsetAmount = wireOffset * GRID_SIZE;
  
  // Minimum distance required for offset routing (need space for exit + offset lane + entry)
  const minDistanceForOffset = GRID_SIZE * 6; // 120px minimum
  
  // If distance is too small, use simple routing
  if (Math.abs(dx) < minDistanceForOffset && Math.abs(dy) < minDistanceForOffset) {
    return simpleOrthogonalPath(start.x, start.y, end.x, end.y, cornerRadius);
  }
  
  // Determine primary routing direction
  const isHorizontalDominant = Math.abs(dx) >= Math.abs(dy);
  
  // Use early offset strategy: apply offset immediately from source
  // This keeps wires separated throughout their entire path
  
  if (isHorizontalDominant) {
    // Horizontal-first routing with vertical offset lane
    const maxExit = Math.abs(dx) / 3; // Use 1/3 of distance for exit
    const exitDistance = Math.min(GRID_SIZE * 2, maxExit);
    const entryDistance = Math.min(GRID_SIZE * 2, maxExit);
    
    const x1_exit = start.x + (dx > 0 ? exitDistance : -exitDistance);
    const y1_offset = start.y + offsetAmount;
    const x2_entry = end.x - (dx > 0 ? entryDistance : -entryDistance);
    
    return createPathWithCorners([
      { x: start.x, y: start.y },
      { x: x1_exit, y: start.y },
      { x: x1_exit, y: y1_offset },
      { x: x2_entry, y: y1_offset },
      { x: x2_entry, y: end.y },
      { x: end.x, y: end.y },
    ], cornerRadius);
    
  } else {
    // Vertical-first routing with horizontal offset lane
    const maxExit = Math.abs(dy) / 3; // Use 1/3 of distance for exit
    const exitDistance = Math.min(GRID_SIZE * 2, maxExit);
    const entryDistance = Math.min(GRID_SIZE * 2, maxExit);
    
    const y1_exit = start.y + (dy > 0 ? exitDistance : -exitDistance);
    const x1_offset = start.x + offsetAmount;
    const y2_entry = end.y - (dy > 0 ? entryDistance : -entryDistance);
    
    return createPathWithCorners([
      { x: start.x, y: start.y },
      { x: start.x, y: y1_exit },
      { x: x1_offset, y: y1_exit },
      { x: x1_offset, y: y2_entry },
      { x: end.x, y: y2_entry },
      { x: end.x, y: end.y },
    ], cornerRadius);
  }
}

/**
 * Simple orthogonal path without offset (direct routing)
 */
function simpleOrthogonalPath(x1: number, y1: number, x2: number, y2: number, cornerRadius: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  // Straight line
  if (dx === 0 || dy === 0) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  
  const useHorizontalFirst = Math.abs(dx) >= Math.abs(dy);
  
  if (useHorizontalFirst) {
    const midX = x1 + dx / 2;
    return createPathWithCorners([
      { x: x1, y: y1 },
      { x: midX, y: y1 },
      { x: midX, y: y2 },
      { x: x2, y: y2 },
    ], cornerRadius);
  } else {
    const midY = y1 + dy / 2;
    return createPathWithCorners([
      { x: x1, y: y1 },
      { x: x1, y: midY },
      { x: x2, y: midY },
      { x: x2, y: y2 },
    ], cornerRadius);
  }
}

/**
 * Create SVG path with rounded corners through a series of points
 */
function createPathWithCorners(points: Array<{x: number, y: number}>, cornerRadius: number): string {
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
 * Assumes 1 pixel = 1 inch in real world (configurable)
 */
export function calculateWireLength(x1: number, y1: number, x2: number, y2: number, pixelsPerInch: number = 1): number {
  const distancePixels = calculateDistance(x1, y1, x2, y2);
  const distanceInches = distancePixels / pixelsPerInch;
  const distanceFeet = distanceInches / 12;
  
  // Add 20% for routing and connections
  return Math.ceil(distanceFeet * 1.2);
}
