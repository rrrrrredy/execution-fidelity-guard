import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  deleteSession,
  readStopState,
  sessionStatePath,
  transitionStopState,
  writeStopState,
} from "../plugins/execution-fidelity-guard/src/store.mjs";
import { makeConfig, temporaryState } from "../test-support/helpers.mjs";

test("state storage accepts a non-link Windows 8.3 directory alias", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows 8.3 aliases are platform-specific");
    return;
  }
  const temporaryRoot = path.resolve(tmpdir());
  const canonicalTemporaryRoot = path.resolve(await realpath(temporaryRoot));
  if (temporaryRoot.toLowerCase() === canonicalTemporaryRoot.toLowerCase()) {
    t.skip("this Windows runner does not expose TEMP through an 8.3 alias");
    return;
  }
  const base = await mkdtemp(path.join(temporaryRoot, "efg-short-alias-"));
  t.after(async () => {
    const resolved = path.resolve(base);
    assert.equal(
      resolved.toLowerCase().startsWith((temporaryRoot + path.sep).toLowerCase()),
      true,
      "cleanup must stay under the configured TEMP directory",
    );
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  });

  const config = makeConfig(path.join(base, "state"));
  await writeStopState(config, "short-alias-session", { attempts: 1 });
  assert.deepEqual(await readStopState(config, "short-alias-session"), {
    attempts: 1,
  });
});

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

test("concurrent contenders linearize one stale-lock takeover", async (t) => {
  const base = await temporaryState(t);
  const config = makeConfig(path.join(base, "state"));
  const contenders = 20;

  for (let round = 0; round < 10; round += 1) {
    const sessionId = "stale-lock-contention-" + round;
    await writeStopState(config, sessionId, { attempts: 0 });
    const lockPath = path.join(
      sessionStatePath(config, sessionId),
      "stop-state.lock",
    );
    await writeFile(lockPath, JSON.stringify({
      schema_version: "1.0",
      token: "lock_stale_owner_" + round,
      pid: 2147483646,
      host: hostname(),
    }) + "\n", { flag: "wx" });
    const staleTime = new Date(Date.now() - 60000);
    await utimes(lockPath, staleTime, staleTime);

    let active = 0;
    let maxConcurrent = 0;
    const values = await Promise.all(
      Array.from({ length: contenders }, () =>
        transitionStopState(config, sessionId, async (prior) => {
          active += 1;
          maxConcurrent = Math.max(maxConcurrent, active);
          try {
            await delay(2);
            const attempts = (prior?.attempts ?? 0) + 1;
            return {
              state: { attempts },
              value: attempts,
            };
          } finally {
            active -= 1;
          }
        }),
      ),
    );

    assert.equal(maxConcurrent, 1);
    assert.deepEqual(
      values.toSorted((left, right) => left - right),
      Array.from({ length: contenders }, (_, index) => index + 1),
    );
    assert.deepEqual(await readStopState(config, sessionId), {
      attempts: contenders,
    });
    await assert.rejects(access(lockPath));
  }
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

test("interrupted owner preparation never occupies the public Stop lock", async (t) => {
  const config = makeConfig(await temporaryState(t));
  const id = "interrupted-owner";
  await writeStopState(config, id, { attempts: 0 });
  const directory = sessionStatePath(config, id);
  // Interrupt an actual writer after exclusive create, before its first owner byte.
  const storeUrl = new URL("../plugins/execution-fidelity-guard/src/store.mjs", import.meta.url).href;
  const interrupted = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    const original = fs.open;
    fs.open = async (name, flags, ...rest) => {
      const handle = await original(name, flags, ...rest);
      if (flags === "wx" && /stop-owner-|stop-state[.]lock$/.test(String(name))) process.exit(71);
      return handle;
    };
    syncBuiltinESMExports();
    const { transitionStopState } = await import(${JSON.stringify(storeUrl)});
    await transitionStopState(${JSON.stringify(config)}, ${JSON.stringify(id)}, async () => ({}));
  `], { encoding: "utf8" });
  assert.equal(interrupted.status, 71, interrupted.stderr);
  await assert.rejects(access(path.join(directory, "stop-state.lock")), { code: "ENOENT" });
  const value = await transitionStopState(config, id, async prior => {
    const owner = JSON.parse(await readFile(path.join(directory, "stop-state.lock"), "utf8"));
    assert.equal(owner.pid, process.pid);
    assert.ok(owner.token);
    return { state: { attempts: prior.attempts + 1 }, value: "updated" };
  });
  assert.equal(value, "updated");
  assert.deepEqual(await readStopState(config, id), { attempts: 1 });
  await assert.rejects(access(path.join(directory, "stop-state.lock")), { code: "ENOENT" });
});
