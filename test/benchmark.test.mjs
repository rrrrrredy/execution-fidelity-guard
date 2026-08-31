import assert from "node:assert/strict";
import test from "node:test";
import {
  benchmarkEventName,
  percentile,
} from "../scripts/benchmark-hook.mjs";

test("benchmark percentile uses nearest-rank semantics", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(
    benchmarkEventName({ hook_event_name: "PostToolUse" }),
    "PostToolUse",
  );
  assert.throws(() => benchmarkEventName({}), /hook_event_name/);
});
