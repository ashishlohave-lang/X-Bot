const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

async function safeRead(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function safeWrite(file, txt) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, txt);
}

function deriveKey(keyString) {
  // Ensure 32 bytes
  return crypto.createHash("sha256").update(keyString).digest();
}

function encryptJson(obj, keyString) {
  const key = deriveKey(keyString);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64"),
  };
}

function decryptJson(payload, keyString) {
  const key = deriveKey(keyString);
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const data = Buffer.from(payload.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

function createTokenStore({ file, encryptionKey, logger }) {
  async function readTokens() {
    const txt = await safeRead(file);
    if (!txt) return null;

    try {
      const parsed = JSON.parse(txt);

      if (parsed && parsed.encrypted === true) {
        if (!encryptionKey) return null;
        return decryptJson(parsed.payload, encryptionKey);
      }
      return parsed;
    } catch (e) {
      logger.error({ err: e }, "Failed to parse token file");
      return null;
    }
  }

  async function writeTokens(tokens) {
    const toWrite = { ...tokens, updated_at: new Date().toISOString() };

    if (encryptionKey) {
      const payload = encryptJson(toWrite, encryptionKey);
      await safeWrite(file, JSON.stringify({ encrypted: true, payload }, null, 2));
      return;
    }

    await safeWrite(file, JSON.stringify(toWrite, null, 2));
  }

  async function markDisconnected(reason) {
    const t = (await readTokens()) || {};
    t.connected = false;
    t.reason = reason || "DISCONNECTED";
    t.disconnected_at = new Date().toISOString();
    await writeTokens(t);
  }

  return { readTokens, writeTokens, markDisconnected };
}

module.exports = { createTokenStore };