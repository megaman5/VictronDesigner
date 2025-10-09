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
 * Calculate orthogonal path between two points with rounded corners
 * Returns an SVG path string for drawing
 */
export function calculateOrthogonalPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius: number = 10
): string {
  // Snap points to grid
  const start = snapPointToGrid(x1, y1);
  const end = snapPointToGrid(x2, y2);
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // If points are aligned horizontally or vertically, draw a straight line
  if (dx === 0 || dy === 0) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }
  
  // Calculate mid-point for the orthogonal turn
  const midX = start.x + dx / 2;
  const midY = start.y + dy / 2;
  
  // Determine the routing direction (horizontal first vs vertical first)
  // For now, use horizontal-first routing
  const useHorizontalFirst = Math.abs(dx) >= Math.abs(dy);
  
  if (useHorizontalFirst) {
    // Route: start -> horizontal -> vertical -> end
    const turnX = end.x;
    const turnY = start.y;
    
    // Calculate actual corner radius (limited by path length)
    const maxRadius = Math.min(
      cornerRadius,
      Math.abs(dx) / 2,
      Math.abs(dy) / 2
    );
    
    if (maxRadius < 2) {
      // Too small for rounded corners, use sharp turns
      return `M ${start.x} ${start.y} L ${turnX} ${turnY} L ${end.x} ${end.y}`;
    }
    
    // Determine corner direction
    const cornerSignX = dx > 0 ? 1 : -1;
    const cornerSignY = dy > 0 ? 1 : -1;
    
    // Calculate corner points
    const cornerStartX = turnX - (maxRadius * cornerSignX);
    const cornerEndY = turnY + (maxRadius * cornerSignY);
    
    // Build path with rounded corner
    return `M ${start.x} ${start.y} 
            L ${cornerStartX} ${turnY} 
            Q ${turnX} ${turnY} ${turnX} ${cornerEndY}
            L ${end.x} ${end.y}`;
  } else {
    // Route: start -> vertical -> horizontal -> end
    const turnX = start.x;
    const turnY = end.y;
    
    // Calculate actual corner radius
    const maxRadius = Math.min(
      cornerRadius,
      Math.abs(dx) / 2,
      Math.abs(dy) / 2
    );
    
    if (maxRadius < 2) {
      return `M ${start.x} ${start.y} L ${turnX} ${turnY} L ${end.x} ${end.y}`;
    }
    
    const cornerSignX = dx > 0 ? 1 : -1;
    const cornerSignY = dy > 0 ? 1 : -1;
    
    const cornerEndX = turnX + (maxRadius * cornerSignX);
    const cornerStartY = turnY - (maxRadius * cornerSignY);
    
    return `M ${start.x} ${start.y} 
            L ${turnX} ${cornerStartY} 
            Q ${turnX} ${turnY} ${cornerEndX} ${turnY}
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
