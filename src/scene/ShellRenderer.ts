/**
 * ShellRenderer — render-layer mirror of the logic-owned shell projectiles
 * (Phase 5.1). The RaceController owns shell state (pure, headless); this class
 * only positions a small pool of emissive spheres to match `race.shells()` each
 * frame. No simulation math here.
 *
 * Shells travel in the XZ plane at a fixed spawn height (see ShellProjectile),
 * so the mesh just copies `shell.pos` — no terrain sampling needed.
 */

import { MeshBuilder, StandardMaterial, type Mesh, type Scene } from "@babylonjs/core";
import type { ShellKind, ShellState } from "../items/ShellProjectile.js";

/** Max concurrent shells rendered (4 karts × a few live shells is well under this). */
const POOL_SIZE = 8;
/** Shell diameter in meters. */
const SHELL_DIAMETER = 0.6;

/** Per-kind colors: diffuse (lit) + emissive (glow so the shell reads at speed). */
const KIND_COLORS: Record<ShellKind, { diffuse: [number, number, number]; emissive: [number, number, number] }> = {
  green: { diffuse: [0.25, 0.75, 0.25], emissive: [0.1, 0.35, 0.1] },
  red: { diffuse: [0.88, 0.24, 0.24], emissive: [0.4, 0.08, 0.08] },
  blue: { diffuse: [0.24, 0.43, 0.88], emissive: [0.08, 0.15, 0.4] },
};

export class ShellRenderer {
  private readonly meshes: Mesh[] = [];
  private readonly materials: Record<ShellKind, StandardMaterial>;

  constructor(scene: Scene) {
    this.materials = {
      green: this.makeMaterial(scene, "shell-green", KIND_COLORS.green),
      red: this.makeMaterial(scene, "shell-red", KIND_COLORS.red),
      blue: this.makeMaterial(scene, "shell-blue", KIND_COLORS.blue),
    };
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = MeshBuilder.CreateSphere(`shell-${i}`, { diameter: SHELL_DIAMETER, segments: 12 }, scene);
      mesh.setEnabled(false);
      this.meshes.push(mesh);
    }
  }

  private makeMaterial(
    scene: Scene,
    name: string,
    colors: { diffuse: [number, number, number]; emissive: [number, number, number] },
  ): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor.set(colors.diffuse[0], colors.diffuse[1], colors.diffuse[2]);
    mat.emissiveColor.set(colors.emissive[0], colors.emissive[1], colors.emissive[2]);
    mat.specularColor.set(0.6, 0.6, 0.6);
    return mat;
  }

  /** Position the pool to mirror the live shells; hide the surplus. */
  update(shells: ReadonlyArray<ShellState>): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const shell = shells[i];
      if (!shell) {
        if (mesh.isEnabled()) mesh.setEnabled(false);
        continue;
      }
      mesh.material = this.materials[shell.kind];
      mesh.position.set(shell.pos.x, shell.pos.y, shell.pos.z);
      if (!mesh.isEnabled()) mesh.setEnabled(true);
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
    for (const mat of Object.values(this.materials)) mat.dispose();
  }
}
