const fs = require("fs").promises;
const path = require("path");

function now() {
  return Date.now();
}

async function safeReadJson(file) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return { items: {} };
  }
}

async function safeWriteJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2));
}

function createPkceStore({ file, logger, ttlMs = 10 * 60 * 1000 }) {
  async function put(state, codeVerifier) {
    const db = await safeReadJson(file);
    db.items[state] = { codeVerifier, expiresAt: now() + ttlMs };
    await safeWriteJson(file, db);
    logger.debug({ state }, "PKCE saved");
  }

  async function getAndDelete(state) {
    const db = await safeReadJson(file);
    const item = db.items[state];
    if (!item) return null;

    delete db.items[state];
    await safeWriteJson(file, db);

    if (item.expiresAt && item.expiresAt < now()) return null;
    return item.codeVerifier;
  }

  async function cleanupExpired() {
    const db = await safeReadJson(file);
    let changed = false;
    for (const [k, v] of Object.entries(db.items || {})) {
      if (v.expiresAt && v.expiresAt < now()) {
        delete db.items[k];
        changed = true;
      }
    }
    if (changed) await safeWriteJson(file, db);
  }

  return { put, getAndDelete, cleanupExpired };
}

module.exports = { createPkceStore };