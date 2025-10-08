import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { Command } from "commander";

/**
 * Auto-loads all command modules in this folder (compiled to .js),
 * finds any exported function whose name starts with "register",
 * and calls it with (program).
 *
 * Convention:
 *   export function registerFooCommand(program: Command) { ... }
 * or export default (program: Command) => { ... }
 */
export async function registerAllCommands(program: Command) {
  const here = fileURLToPath(new URL(".", import.meta.url)); // .../dist/commands/
  const files = fs
    .readdirSync(here)
    .filter(
      (f) =>
        f.endsWith(".js") && // compiled files
        !f.startsWith("_") && // skip registry itself
        !f.endsWith(".d.ts") &&
        !f.endsWith(".map"),
    )
    .sort();

  for (const file of files) {
    const full = path.join(here, file);
    const mod = await import(pathToFileURL(full).href);

    // If module exports a default function, call it
    if (typeof mod.default === "function") {
      mod.default(program);
      continue;
    }

    // Otherwise call any exported function starting with "register"
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function" && /^register[A-Z]/.test(name)) {
        value(program);
      }
    }
  }
}
