import { describe, it, expect } from 'vitest';
import { snapToGrid, snapPointToGrid, calculateRoute } from '../../client/src/lib/wire-routing';
import type { Obstacle } from '../../client/src/lib/wire-routing';

describe('Wire Routing', () => {
  describe('snapToGrid', () => {
    it('should snap to nearest grid point', () => {
      expect(snapToGrid(23)).toBe(20);
      expect(snapToGrid(27)).toBe(20);
      expect(snapToGrid(33)).toBe(40);
      expect(snapToGrid(50)).toBe(60); // 50 rounds to 60, not 40
    });

    it('should handle custom grid size', () => {
      expect(snapToGrid(23, 10)).toBe(20);
      expect(snapToGrid(27, 10)).toBe(30);
    });

    it('should handle exact grid points', () => {
      expect(snapToGrid(20)).toBe(20);
      expect(snapToGrid(40)).toBe(40);
      expect(snapToGrid(0)).toBe(0);
    });
  });

  describe('snapPointToGrid', () => {
    it('should snap both coordinates', () => {
      const result = snapPointToGrid(23, 37);
      expect(result.x).toBe(20);
      expect(result.y).toBe(40);
    });

    it('should handle negative coordinates', () => {
      const result = snapPointToGrid(-23, -37);
      expect(result.x).toBe(-20);
      expect(result.y).toBe(-40);
    });
  });

  describe('calculateRoute', () => {
    it('should calculate direct route when no obstacles', () => {
      const result = calculateRoute(0, 0, 100, 100, [], 1000, 1000);
      
      expect(result).toBeDefined();
      expect(result.path).toBeDefined();
      expect(result.pathNodes).toBeDefined();
      expect(Array.isArray(result.pathNodes)).toBe(true);
      expect(result.pathNodes.length).toBeGreaterThan(0);
    });

    it('should route around obstacles', () => {
      const obstacles: Obstacle[] = [
        { x: 40, y: 40, width: 20, height: 20 },
      ];

      const result = calculateRoute(0, 0, 100, 100, obstacles, 1000, 1000);
      
      expect(result).toBeDefined();
      expect(result.pathNodes.length).toBeGreaterThan(2);
      // Route should not pass through obstacle (check pathNodes)
      const passesThroughObstacle = result.pathNodes.some(node => {
        const [x, y] = node.split(',').map(Number);
        return x >= 40 && x <= 60 && y >= 40 && y <= 60;
      });
      expect(passesThroughObstacle).toBe(false);
    });

    it('should handle multiple obstacles', () => {
      const obstacles: Obstacle[] = [
        { x: 40, y: 40, width: 20, height: 20 },
        { x: 60, y: 60, width: 20, height: 20 },
      ];

      const result = calculateRoute(0, 0, 100, 100, obstacles, 1000, 1000);
      
      expect(result).toBeDefined();
      expect(result.pathNodes.length).toBeGreaterThan(2);
    });

    it('should return valid result for out of bounds coordinates', () => {
      const result = calculateRoute(-100, -100, 2000, 2000, [], 1000, 1000);
      // Should return valid result object
      expect(result).toBeDefined();
      expect(result.path).toBeDefined();
    });

    it('should handle same start and end point', () => {
      const result = calculateRoute(50, 50, 50, 50, [], 1000, 1000);
      expect(result).toBeDefined();
      expect(result.pathNodes.length).toBeGreaterThanOrEqual(1);
    });
  });
});
