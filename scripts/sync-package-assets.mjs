// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = path.join(root, "plugins", "execution-fidelity-guard");
const assets = ["LICENSE", "NOTICE"];
const mode = process.argv[2];

if (!["--write", "--check"].includes(mode)) {
  throw new Error("use --write or --check");
}

await mkdir(pluginRoot, { recursive: true });
for (const name of assets) {
  const source = path.join(root, name);
  const target = path.join(pluginRoot, name);
  if (mode === "--write") {
    await copyFile(source, target);
  } else {
    const [left, right] = await Promise.all([readFile(source), readFile(target)]);
    if (!left.equals(right)) throw new Error(name + " is out of sync");
  }
}

process.stdout.write(
  mode === "--write"
    ? "Synchronized plugin LICENSE and NOTICE.\n"
    : "Plugin LICENSE and NOTICE are synchronized.\n",
);
