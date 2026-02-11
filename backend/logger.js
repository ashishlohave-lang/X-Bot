const pino = require("pino");

function createLogger() {
  const level = process.env.NODE_ENV === "production" ? "info" : "debug";
  return pino({
    level,
    base: {
      service: "x-oauth-bot-backend",
      env: process.env.NODE_ENV || "development",
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.access_token",
        "*.refresh_token",
        "*.clientSecret",
      ],
      remove: true,
    },
  });
}

module.exports = { createLogger };