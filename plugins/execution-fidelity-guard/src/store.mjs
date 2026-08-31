// SPDX-License-Identifier: Apache-2.0
import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { makeId, safeId, sha256, stableStringify } from "./canonical.mjs";

const RECORD_BUCKETS = new Set(["events", "receipts", "evidence"]);
const SESSION_DIRECTORY_RE = /^session-[a-f0-9]{64}$/;
const STOP_LOCK_STALE_MS = 30000;
const STOP_LOCK_ATTEMPTS = 50;
const STOP_LOCK_MAX_BYTES = 4096;
const STOP_LOCK_HOST = hostname();
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_STOP_STATE_BYTES = 64 * 1024;

function sessionRoot(config, sessionId) {
  const value = String(sessionId ?? "unknown");
  const reference = value.match(/^session:([a-f0-9]{64})$/);
  return path.join(
    sessionsRoot(config),
    "session-" + (reference ? reference[1] : sha256(value)),
  );
}

function sessionsRoot(config) {
  return path.resolve(config.stateRoot, "sessions");
}

function comparablePath(value) {
  const normalized = path.resolve(value).replace(/^\\\\\?\\/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function inspectDirectoryChain(directory, label) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  const segments = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(label + " contains a link or non-directory component");
    }
  }
  const canonical = await realpath(resolved);
  if (comparablePath(canonical) !== comparablePath(resolved)) {
    throw new Error(label + " resolves outside its dedicated path");
  }
  return true;
}

async function validatedDirectory(directory, label) {
  return (await inspectDirectoryChain(directory, label))
    ? path.resolve(directory)
    : null;
}

async function ensureDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const exists = await inspectDirectoryChain(resolved, label);
  if (!exists) {
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    if (!(await inspectDirectoryChain(resolved, label))) {
      throw new Error(label + " could not be created safely");
    }
  }
  return resolved;
}

async function validatedSessionsRoot(config) {
  const state = await validatedDirectory(path.resolve(config.stateRoot), "state root");
  if (!state) return null;
  return validatedDirectory(path.join(state, "sessions"), "sessions root");
}

async function ensureSessionsRoot(config) {
  const state = await ensureDirectory(path.resolve(config.stateRoot), "state root");
  return ensureDirectory(path.join(state, "sessions"), "sessions root");
}

async function validatedSessionRoot(config, sessionId) {
  const root = await validatedSessionsRoot(config);
  if (!root) return null;
  const target = path.resolve(sessionRoot(config, sessionId));
  if (
    path.dirname(target) !== root ||
    !SESSION_DIRECTORY_RE.test(path.basename(target))
  ) {
    throw new Error("session state path escaped the dedicated state directory");
  }
  return validatedDirectory(target, "session state directory");
}

async function ensureSessionRoot(config, sessionId) {
  const root = await ensureSessionsRoot(config);
  const target = path.resolve(sessionRoot(config, sessionId));
  if (
    path.dirname(target) !== root ||
    !SESSION_DIRECTORY_RE.test(path.basename(target))
  ) {
    throw new Error("session state path escaped the dedicated state directory");
  }
  return ensureDirectory(target, "session state directory");
}

export function sessionStatePath(config, sessionId) {
  return sessionRoot(config, sessionId);
}

export async function sessionExists(config, sessionId) {
  return Boolean(await validatedSessionRoot(config, sessionId));
}

async function atomicWrite(filePath, value) {
  const serialized = stableStringify(value) + "\n";
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
    throw new Error("state record exceeds the 1 MiB safety limit");
  }
  const temporary =
    filePath + "." + process.pid + "." + makeId("tmp_", [filePath]) + ".tmp";
  await writeFile(temporary, serialized, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function writeRecord(config, sessionId, bucket, record) {
  if (!config.persist) return null;
  if (!RECORD_BUCKETS.has(bucket)) throw new Error("unsupported record bucket");
  const id =
    record.event_id ??
    record.receipt_id ??
    record.evidence_ref ??
    makeId("record_", [sessionId, bucket]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionDirectory = await ensureSessionRoot(config, sessionId);
  const directory = await ensureDirectory(
    path.join(sessionDirectory, bucket),
    "record bucket",
  );
  const filePath = path.join(directory, timestamp + "-" + safeId(id) + ".json");
  await atomicWrite(filePath, record);
  await pruneBucket(directory, config.maxRecordsPerBucket);
  const activeAt = new Date();
  await utimes(sessionRoot(config, sessionId), activeAt, activeAt).catch(() => {});
  return filePath;
}

async function pruneBucket(directory, maximum) {
  let entries;
  try {
    entries = (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return;
  }
  const overflow = entries.slice(0, Math.max(0, entries.length - maximum));
  for (const name of overflow) {
    const target = path.join(directory, name);
    const info = await lstat(target).catch(() => null);
    if (!info || info.isSymbolicLink() || !info.isFile()) continue;
    await unlink(target).catch(() => {});
  }
}

export async function readRecords(config, sessionId, bucket) {
  if (!config.persist || !RECORD_BUCKETS.has(bucket)) return [];
  const sessionDirectory = await validatedSessionRoot(config, sessionId);
  if (!sessionDirectory) return [];
  const directory = await validatedDirectory(
    path.join(sessionDirectory, bucket),
    "record bucket",
  );
  if (!directory) return [];
  let entries;
  try {
    entries = (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(-config.maxRecordsPerBucket);
  } catch {
    return [];
  }
  const records = [];
  for (const name of entries) {
    try {
      const recordPath = path.join(directory, name);
      const info = await lstat(recordPath);
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size > MAX_RECORD_BYTES
      ) continue;
      const value = JSON.parse(await readFile(recordPath, "utf8"));
      records.push(value);
    } catch {
      // Ignore incomplete or externally damaged records.
    }
  }
  return records;
}

export async function readStopState(config, sessionId) {
  if (!config.persist) return null;
  const directory = await validatedSessionRoot(config, sessionId);
  if (!directory) return null;
  const filePath = path.join(directory, "stop-state.json");
  try {
    const info = await lstat(filePath);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size > MAX_STOP_STATE_BYTES
    ) return null;
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeStopState(config, sessionId, state) {
  if (!config.persist) return;
  const directory = await ensureSessionRoot(config, sessionId);
  const filePath = path.join(directory, "stop-state.json");
  await atomicWrite(filePath, state);
  const activeAt = new Date();
  await utimes(sessionRoot(config, sessionId), activeAt, activeAt).catch(() => {});
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function readStopLockOwner(lockPath) {
  const info = await lstat(lockPath);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.size > STOP_LOCK_MAX_BYTES
  ) {
    throw new Error("stop state lock is not a valid regular owner file");
  }
  if (info.size <= 0) {
    const error = new Error("stop state lock owner is being initialized");
    error.code = "ELOCKUNREADY";
    throw error;
  }
  let owner;
  try {
    owner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    const error = new Error("stop state lock owner is being initialized");
    error.code = "ELOCKUNREADY";
    throw error;
  }
  if (
    owner?.schema_version !== "1.0" ||
    typeof owner.token !== "string" ||
    !owner.token ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.host !== "string" ||
    !owner.host
  ) {
    const error = new Error("stop state lock owner is being initialized");
    error.code = "ELOCKUNREADY";
    throw error;
  }
  return { info, owner };
}

async function withStopStateLock(config, sessionId, operation) {
  const directory = await ensureSessionRoot(config, sessionId);
  const lockPath = path.join(directory, "stop-state.lock");
  const owner = {
    schema_version: "1.0",
    token: makeId("lock_", [
      sessionId,
      process.pid,
      Date.now(),
      process.hrtime.bigint().toString(),
    ]),
    pid: process.pid,
    host: STOP_LOCK_HOST,
  };
  let handle = null;
  for (let attempt = 0; attempt < STOP_LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(owner) + "\n", "utf8");
      await handle.sync();
      break;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        handle = null;
        await unlink(lockPath).catch(() => {});
      }
      if (error?.code !== "EEXIST") throw error;
      try {
        const current = await readStopLockOwner(lockPath);
        const stale = Date.now() - current.info.mtimeMs > STOP_LOCK_STALE_MS;
        const knownDeadLocalOwner =
          current.owner.host === STOP_LOCK_HOST &&
          !processIsAlive(current.owner.pid);
        if (stale && knownDeadLocalOwner) {
          const stalePath =
            lockPath + ".stale-" + safeId(owner.token);
          await rename(lockPath, stalePath);
          await unlink(stalePath).catch(() => {});
          continue;
        }
      } catch (lockError) {
        if (!["ENOENT", "ELOCKUNREADY"].includes(lockError?.code)) {
          throw lockError;
        }
      }
      await delay(10);
    }
  }
  if (!handle) throw new Error("stop state lock timed out");
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    try {
      const current = await readStopLockOwner(lockPath);
      if (current.owner.token === owner.token) {
        const releasedPath =
          lockPath + ".released-" + safeId(owner.token);
        await rename(lockPath, releasedPath);
        await unlink(releasedPath).catch(() => {});
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        // Fail closed: never remove a lock whose current owner is uncertain.
      }
    }
  }
}

export async function transitionStopState(config, sessionId, transition) {
  if (!config.persist) {
    const result = await transition(null);
    return result?.value;
  }
  return withStopStateLock(config, sessionId, async () => {
    const prior = await readStopState(config, sessionId);
    const result = await transition(prior);
    if (result && Object.hasOwn(result, "state") && result.state !== undefined) {
      await writeStopState(config, sessionId, result.state);
    }
    return result?.value;
  });
}

export async function deleteSession(config, sessionId) {
  const root = await validatedSessionsRoot(config);
  if (!root) return false;
  const target = path.resolve(sessionRoot(config, sessionId));
  if (
    path.dirname(target) !== root ||
    !SESSION_DIRECTORY_RE.test(path.basename(target))
  ) {
    throw new Error("session state path escaped the dedicated state directory");
  }
  if (!(await validatedDirectory(target, "session state target"))) return false;
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
  return true;
}

export async function pruneExpiredSessions(config, now = new Date()) {
  if (!config.persist) return 0;
  const root = await validatedSessionsRoot(config);
  if (!root) return 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  const retentionDays = Number.isFinite(config.retentionDays)
    ? config.retentionDays
    : 30;
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_DIRECTORY_RE.test(entry.name)) continue;
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) continue;
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    await validatedDirectory(target, "session state target");
    if (info.mtimeMs >= cutoff) continue;
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    removed += 1;
  }
  return removed;
}

export async function bestEffort(operation) {
  try {
    return await operation();
  } catch {
    return null;
  }
}
