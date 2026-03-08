// terrain.ts — Re-export barrel for backward compatibility.
// Real code lives in terrain-gen.ts, terrain-query.ts, terrain-render.ts.

export { Tile } from "./types";
export type { Terrain } from "./types";
export { generateTerrain } from "./terrain-gen";
export { getSurfaceY, getTile, isSolid, isWalkable, getTileEnergy, modifyTile, placeSettlement } from "./terrain-query";
export { renderTerrain, applyHeatHaze, applyVolcanicAsh, renderRainPuddles } from "./terrain-render";
