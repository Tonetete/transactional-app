import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const src = resolve(__dirname, "../src");
const components = join(src, "components");
const layers = ["atoms", "molecules", "organisms", "templates"] as const;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Resolves an import specifier to a path under src/, or null for packages. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join(src, spec.slice(2));
  if (spec.startsWith(".")) return resolve(dirname(file), spec);
  return null;
}

describe("atomic design layering (S2)", () => {
  layers.forEach((layer, rank) => {
    it(`${layer} import only from their own or lower layers and never from lib/app`, () => {
      for (const file of files(join(components, layer))) {
        for (const m of readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)) {
          const t = target(file, m[1]!);
          if (!t) continue;
          const [top, sub] = relative(src, t).split(sep);
          expect(["components"], `${file} imports ${m[1]}`).toContain(top);
          expect(layers.indexOf(sub as (typeof layers)[number]), `${file} imports ${m[1]}`).toBeLessThanOrEqual(rank);
        }
      }
    });
  });
});
