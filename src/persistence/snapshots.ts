/**
 * Persist canvas snapshots to disk as JSON. Snapshots are observation
 * records, not plans — saving one says "this is what the canvas looked like
 * at T", and loading lets a later session diff against it.
 *
 * Storage layout (POSIX-friendly):
 *   <root>/<name>/snapshot.json
 *   <root>/<name>/blueprint.json   (optional, set when cooked from one)
 *
 * The root defaults to ./packet-tracer-snapshots under the process cwd, but
 * callers can override it for tests or alt locations.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanvasSnapshot } from "../canvas/types.js";
import type { Blueprint } from "../recipes/blueprint.js";

const DEFAULT_ROOT_ENV = "PACKET_TRACER_SNAPSHOT_DIR";
const DEFAULT_ROOT_DIR = "packet-tracer-snapshots";

function rootDir(): string {
  return process.env[DEFAULT_ROOT_ENV] ?? path.resolve(process.cwd(), DEFAULT_ROOT_DIR);
}

const SNAPSHOT_NAME_RE = /^[A-Za-z0-9._-]+$/;

function assertName(name: string): void {
  if (!SNAPSHOT_NAME_RE.test(name)) {
    throw new Error(`snapshot name must match ${SNAPSHOT_NAME_RE} (got '${name}')`);
  }
}

export interface SaveSnapshotInput {
  readonly name: string;
  readonly snapshot: CanvasSnapshot;
  readonly blueprint?: Blueprint;
}

export interface SavedSnapshotMeta {
  readonly name: string;
  readonly capturedAt: string;
  readonly devices: number;
  readonly links: number;
  readonly hasBlueprint: boolean;
  readonly path: string;
}

export async function saveSnapshot(input: SaveSnapshotInput): Promise<SavedSnapshotMeta> {
  assertName(input.name);
  const dir = path.join(rootDir(), input.name);
  await mkdir(dir, { recursive: true });
  const snapshotPath = path.join(dir, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify(input.snapshot, null, 2), "utf-8");
  if (input.blueprint) {
    await writeFile(path.join(dir, "blueprint.json"), JSON.stringify(input.blueprint, null, 2), "utf-8");
  }
  return {
    name: input.name,
    capturedAt: input.snapshot.capturedAt,
    devices: input.snapshot.devices.length,
    links: input.snapshot.links.length,
    hasBlueprint: !!input.blueprint,
    path: dir,
  };
}

export interface LoadedSnapshot {
  readonly name: string;
  readonly snapshot: CanvasSnapshot;
  readonly blueprint?: Blueprint;
}

export async function loadSnapshot(name: string): Promise<LoadedSnapshot> {
  assertName(name);
  const dir = path.join(rootDir(), name);
  const snapshot = JSON.parse(await readFile(path.join(dir, "snapshot.json"), "utf-8")) as CanvasSnapshot;
  let blueprint: Blueprint | undefined;
  try {
    const raw = await readFile(path.join(dir, "blueprint.json"), "utf-8");
    blueprint = JSON.parse(raw) as Blueprint;
  } catch {
    blueprint = undefined;
  }
  return blueprint ? { name, snapshot, blueprint } : { name, snapshot };
}

export async function listSnapshots(): Promise<SavedSnapshotMeta[]> {
  const root = rootDir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const out: SavedSnapshotMeta[] = [];
  for (const name of entries) {
    if (!SNAPSHOT_NAME_RE.test(name)) continue;
    const dir = path.join(root, name);
    const snapshotPath = path.join(dir, "snapshot.json");
    let s;
    try {
      s = await stat(snapshotPath);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    try {
      const snap = JSON.parse(await readFile(snapshotPath, "utf-8")) as CanvasSnapshot;
      let hasBlueprint = false;
      try {
        await stat(path.join(dir, "blueprint.json"));
        hasBlueprint = true;
      } catch {}
      out.push({
        name,
        capturedAt: snap.capturedAt,
        devices: snap.devices.length,
        links: snap.links.length,
        hasBlueprint,
        path: dir,
      });
    } catch {
      // skip unreadable entries
    }
  }
  out.sort((a, b) => a.capturedAt < b.capturedAt ? 1 : -1);
  return out;
}

export function snapshotRoot(): string {
  return rootDir();
}
