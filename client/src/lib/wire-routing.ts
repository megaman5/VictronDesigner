// Grid snapping utilities and orthogonal wire routing

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
 * Calculate orthogonal path between two points with rounded corners and collision avoidance
 * Returns an SVG path string for drawing
 */
export function calculateOrthogonalPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius: number = 15,
  wireOffset: number = 0 // Offset for parallel wires to prevent overlap
): string {
  // Snap points to grid
  const start = snapPointToGrid(x1, y1);
  const end = snapPointToGrid(x2, y2);
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // Apply wire offset for parallel wire separation
  const offsetAmount = wireOffset * GRID_SIZE;
  
  // For straight lines, maintain offset in parallel segment then return to axis near terminal
  if (dx === 0) {
    // Vertical line - run parallel with offset, return to axis near end
    if (offsetAmount === 0) {
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
    const signY = dy > 0 ? 1 : -1;
    const nearEnd = end.y - (signY * GRID_SIZE); // One grid unit before terminal
    return `M ${start.x} ${start.y} 
            L ${start.x} ${start.y + (signY * GRID_SIZE)}
            L ${start.x + offsetAmount} ${start.y + (signY * GRID_SIZE)}
            L ${start.x + offsetAmount} ${nearEnd}
            L ${end.x} ${nearEnd}
            L ${end.x} ${end.y}`;
  }
  
  if (dy === 0) {
    // Horizontal line - run parallel with offset, return to axis near end
    if (offsetAmount === 0) {
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
    const signX = dx > 0 ? 1 : -1;
    const nearEnd = end.x - (signX * GRID_SIZE); // One grid unit before terminal
    return `M ${start.x} ${start.y} 
            L ${start.x + (signX * GRID_SIZE)} ${start.y}
            L ${start.x + (signX * GRID_SIZE)} ${start.y + offsetAmount}
            L ${nearEnd} ${start.y + offsetAmount}
            L ${nearEnd} ${end.y}
            L ${end.x} ${end.y}`;
  }
  
  // Determine routing direction based on distance
  const useHorizontalFirst = Math.abs(dx) >= Math.abs(dy);
  
  // Use 5-segment routing with offset in middle to avoid overlaps while keeping endpoints connected
  if (useHorizontalFirst) {
    // Route: start -> horizontal -> vertical (with offset) -> horizontal -> end
    const midX = start.x + dx / 2;
    const midY = start.y + dy / 2 + offsetAmount;
    
    const maxRadius = Math.min(
      cornerRadius,
      Math.abs(dx) / 6,
      Math.abs(dy) / 6
    );
    
    if (maxRadius < 2) {
      return `M ${start.x} ${start.y} 
              L ${midX} ${start.y} 
              L ${midX} ${midY}
              L ${midX} ${end.y}
              L ${end.x} ${end.y}`;
    }
    
    const signX = dx > 0 ? 1 : -1;
    const signY1 = (midY - start.y) > 0 ? 1 : -1;
    const signY2 = (end.y - midY) > 0 ? 1 : -1;
    
    return `M ${start.x} ${start.y} 
            L ${midX - maxRadius * signX} ${start.y} 
            Q ${midX} ${start.y} ${midX} ${start.y + maxRadius * signY1}
            L ${midX} ${midY - maxRadius * signY2}
            Q ${midX} ${midY} ${midX + maxRadius * signX} ${midY}
            L ${end.x - maxRadius * signX} ${midY}
            Q ${end.x} ${midY} ${end.x} ${midY + maxRadius * signY2}
            L ${end.x} ${end.y}`;
  } else {
    // Route: start -> vertical -> horizontal (with offset) -> vertical -> end  
    const midX = start.x + dx / 2 + offsetAmount;
    const midY = start.y + dy / 2;
    
    const maxRadius = Math.min(
      cornerRadius,
      Math.abs(dy) / 6,
      Math.abs(dx) / 6
    );
    
    if (maxRadius < 2) {
      return `M ${start.x} ${start.y} 
              L ${start.x} ${midY} 
              L ${midX} ${midY}
              L ${end.x} ${midY}
              L ${end.x} ${end.y}`;
    }
    
    const signY = dy > 0 ? 1 : -1;
    const signX1 = (midX - start.x) > 0 ? 1 : -1;
    const signX2 = (end.x - midX) > 0 ? 1 : -1;
    
    return `M ${start.x} ${start.y} 
            L ${start.x} ${midY - maxRadius * signY}
            Q ${start.x} ${midY} ${start.x + maxRadius * signX1} ${midY}
            L ${midX - maxRadius * signX2} ${midY}
            Q ${midX} ${midY} ${midX} ${midY + maxRadius * signY}
            L ${midX} ${end.y - maxRadius * signY}
            Q ${midX} ${end.y} ${midX + maxRadius * signX2} ${end.y}
            L ${end.x} ${end.y}`;
  }
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
