const { AppError } = require("./errors");

function required(name) {
  const v = process.env[name];
  if (!v) throw new AppError(`Missing env: ${name}`, 500, "CONFIG_MISSING");
  return v;
}

function getConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    clientId: required("CLIENT_ID"),
    clientSecret: required("CLIENT_SECRET"),
    redirectUri: required("REDIRECT_URI"),
    scopes: (process.env.SCOPES || "").trim(),

    tokenFile: process.env.TOKEN_FILE || "./tokens.json",
    pkceFile: process.env.PKCE_FILE || "./pkce.json",
    encryptionKey: (process.env.TOKEN_ENCRYPTION_KEY || "").trim(),

    corsOrigin: process.env.CORS_ORIGIN || "*",
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 120),
  };
}

module.exports = { getConfig };