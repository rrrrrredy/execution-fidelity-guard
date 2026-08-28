#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { readJsonStdin } from "./canonical.mjs";
import { handleHook } from "./runtime.mjs";

let input;
try {
  input = await readJsonStdin();
  const output = await handleHook(input);
  if (output && Object.keys(output).length) {
    process.stdout.write(JSON.stringify(output));
  } else if (input.hook_event_name === "Stop") {
    process.stdout.write("{}");
  }
} catch {
  if (input?.hook_event_name === "Stop") process.stdout.write("{}");
  process.stderr.write(
    "Execution Fidelity Guard failed open; no policy decision was applied.\n",
  );
}
