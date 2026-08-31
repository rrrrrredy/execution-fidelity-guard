import assert from "node:assert/strict";
import {
  access,
  mkdir,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteSession,
  sessionStatePath,
  transitionStopState,
  writeStopState,
} from "../plugins/execution-fidelity-guard/src/store.mjs";
import { makeConfig, temporaryState } from "../test-support/helpers.mjs";

test("deleteSession rejects a sessions junction before touching its target", async (t) => {
  const base = await temporaryState(t);
  const stateRoot = path.join(base, "state");
  const outside = path.join(base, "outside");
  await mkdir(stateRoot, { recursive: true });
  await mkdir(outside, { recursive: true });
  const config = makeConfig(stateRoot);
  const sessionName = path.basename(sessionStatePath(config, "escape-attempt"));
  const outsideSession = path.join(outside, sessionName);
  await mkdir(outsideSession, { recursive: true });
  const sentinel = path.join(outsideSession, "keep.txt");
  await writeFile(sentinel, "keep");
  const sessionsLink = path.join(stateRoot, "sessions");
  try {
    await symlink(outside, sessionsLink, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip("directory links are unavailable on this runner");
      return;
    }
    throw error;
  }
  try {
    await assert.rejects(
      deleteSession(config, "escape-attempt"),
      /link|dedicated path/,
    );
    await access(sentinel);
  } finally {
    await unlink(sessionsLink).catch(() => {});
  }
});

test("stop lock reclaims only a stale owner known to be dead on this host", async (t) => {
  const base = await temporaryState(t);
  const config = makeConfig(path.join(base, "state"));
  const sessionId = "stale-lock-trial";
  await writeStopState(config, sessionId, { attempts: 1 });
  const lockPath = path.join(sessionStatePath(config, sessionId), "stop-state.lock");
  await writeFile(lockPath, JSON.stringify({
    schema_version: "1.0",
    token: "lock_stale_owner",
    pid: 2147483646,
    host: hostname(),
  }) + "\n", { flag: "wx" });
  const staleTime = new Date(Date.now() - 60000);
  await utimes(lockPath, staleTime, staleTime);

  const result = await transitionStopState(config, sessionId, async (prior) => ({
    state: { attempts: prior.attempts + 1 },
    value: prior.attempts + 1,
  }));
  assert.equal(result, 2);
  await assert.rejects(access(lockPath));
});

test("stop lock never reclaims a stale owner process that is still alive", async (t) => {
  const base = await temporaryState(t);
  const config = makeConfig(path.join(base, "state"));
  const sessionId = "live-lock-trial";
  await writeStopState(config, sessionId, { attempts: 1 });
  const lockPath = path.join(sessionStatePath(config, sessionId), "stop-state.lock");
  await writeFile(lockPath, JSON.stringify({
    schema_version: "1.0",
    token: "lock_live_owner",
    pid: process.pid,
    host: hostname(),
  }) + "\n", { flag: "wx" });
  const staleTime = new Date(Date.now() - 60000);
  await utimes(lockPath, staleTime, staleTime);

  await assert.rejects(
    transitionStopState(config, sessionId, async () => ({
      state: { attempts: 2 },
      value: 2,
    })),
    /lock timed out/,
  );
  await access(lockPath);
});
