/**
 * Plain-record vector types for game logic (01-architecture.md §4).
 * Logic modules use these — never Babylon vectors. Rendering converts at the boundary.
 */

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
