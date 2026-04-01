// physics.ts — Spatial hash grid for efficient neighbor queries.

import type { Mote, SpatialGrid } from "./types";
import { CELL_SIZE } from "./constants";

// Re-export for backward compatibility
export type { SpatialGrid };

export function createGrid(width: number): SpatialGrid {
  return {
    cells: new Map(),
    cols: Math.ceil(width / CELL_SIZE),
  };
}

function cellKey(cols: number, cx: number, cy: number): number {
  return cy * cols + cx;
}

export function buildGrid(grid: SpatialGrid, motes: Mote[]): void {
  grid.cells.clear();
  for (const m of motes) {
    const cx = Math.floor(m.x / CELL_SIZE);
    const cy = Math.floor(m.y / CELL_SIZE);
    const key = cellKey(grid.cols, cx, cy);
    const cell = grid.cells.get(key);
    if (cell) cell.push(m);
    else grid.cells.set(key, [m]);
  }
}

export function getNeighbors(
  grid: SpatialGrid,
  x: number,
  y: number,
  radius: number,
  self?: Mote,
): Mote[] {
  const r2 = radius * radius;
  const result: Mote[] = [];

  const minCx = Math.floor((x - radius) / CELL_SIZE);
  const maxCx = Math.floor((x + radius) / CELL_SIZE);
  const minCy = Math.floor((y - radius) / CELL_SIZE);
  const maxCy = Math.floor((y + radius) / CELL_SIZE);

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cell = grid.cells.get(cellKey(grid.cols, cx, cy));
      if (!cell) continue;
      for (const m of cell) {
        if (m === self) continue;
        const dx = m.x - x;
        const dy = m.y - y;
        if (dx * dx + dy * dy <= r2) result.push(m);
      }
    }
  }

  return result;
}

/** Find clusters of bonded motes via flood-fill */
export function findClusters(motes: Mote[]): Mote[][] {
  const visited = new Set<Mote>();
  const clusters: Mote[][] = [];

  for (const m of motes) {
    if (visited.has(m) || m.bonds.length === 0) continue;

    const cluster: Mote[] = [];
    const stack: Mote[] = [m];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);
      for (const bonded of current.bonds) {
        if (!visited.has(bonded)) stack.push(bonded);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }

  return clusters;
}
