// SPDX-License-Identifier: Apache-2.0
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { makeId, safeId, sha256, stableStringify } from "./canonical.mjs";

const RECORD_BUCKETS = new Set(["events", "receipts", "evidence"]);
const SESSION_DIRECTORY_RE = /^session-[a-f0-9]{64}$/;

function sessionRoot(config, sessionId) {
  return path.join(
    config.stateRoot,
    "sessions",
    "session-" + sha256(String(sessionId ?? "unknown")),
  );
}

function sessionsRoot(config) {
  return path.resolve(config.stateRoot, "sessions");
}

export function sessionStatePath(config, sessionId) {
  return sessionRoot(config, sessionId);
}

export async function sessionExists(config, sessionId) {
  try {
    const info = await lstat(sessionRoot(config, sessionId));
    return info.isDirectory() && !info.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary =
    filePath + "." + process.pid + "." + makeId("tmp_", [filePath]) + ".tmp";
  await writeFile(temporary, stableStringify(value) + "\n", {
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
  const directory = path.join(sessionRoot(config, sessionId), bucket);
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
  await Promise.all(
    overflow.map((name) => unlink(path.join(directory, name)).catch(() => {})),
  );
}

export async function readRecords(config, sessionId, bucket) {
  if (!config.persist || !RECORD_BUCKETS.has(bucket)) return [];
  const directory = path.join(sessionRoot(config, sessionId), bucket);
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
      const value = JSON.parse(await readFile(path.join(directory, name), "utf8"));
      records.push(value);
    } catch {
      // Ignore incomplete or externally damaged records.
    }
  }
  return records;
}

export async function readStopState(config, sessionId) {
  if (!config.persist) return null;
  const filePath = path.join(sessionRoot(config, sessionId), "stop-state.json");
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeStopState(config, sessionId, state) {
  if (!config.persist) return;
  const filePath = path.join(sessionRoot(config, sessionId), "stop-state.json");
  await atomicWrite(filePath, state);
  const activeAt = new Date();
  await utimes(sessionRoot(config, sessionId), activeAt, activeAt).catch(() => {});
}

export async function deleteSession(config, sessionId) {
  const root = sessionsRoot(config);
  const target = path.resolve(sessionRoot(config, sessionId));
  if (
    path.dirname(target) !== root ||
    !SESSION_DIRECTORY_RE.test(path.basename(target))
  ) {
    throw new Error("session state path escaped the dedicated state directory");
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("session state target is not a dedicated directory");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
  const root = sessionsRoot(config);
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
    const info = await stat(target);
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
