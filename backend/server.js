const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { v4: uuidv4 } = require("uuid");

const { createLogger } = require("./logger");
const { getConfig } = require("./config");
const { AppError } = require("./errors");

const { createPkceStore } = require("./oauth/pkceStore");
const { generatePKCE, buildAuthorizeUrl, exchangeCodeForTokens } = require("./oauth/xOAuth");

const { createTokenStore } = require("./tokens/tokenStore");
const { createTokenService } = require("./tokens/tokenService");

const { createXApiClient } = require("./xapi/client");
const { createWebhookRouter } = require("./webhooks/webhookHandler");
const replyLogic = require("./bot/replyLogic");

const logger = createLogger();
const config = getConfig();

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: config.corsOrigin === "*" ? true : config.corsOrigin,
    credentials: true,
  })
);

app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || uuidv4();
  res.setHeader("x-request-id", req.id);
  next();
});

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

// Resolve files to absolute paths so working directory doesn't break persistence
const pkceFileAbs = path.isAbsolute(config.pkceFile) ? config.pkceFile : path.join(__dirname, config.pkceFile);
const tokenFileAbs = path.isAbsolute(config.tokenFile) ? config.tokenFile : path.join(__dirname, config.tokenFile);

const pkceStore = createPkceStore({ file: pkceFileAbs, logger });
const tokenStore = createTokenStore({ file: tokenFileAbs, encryptionKey: config.encryptionKey, logger });
const tokenService = createTokenService({ config, tokenStore, logger });

const xapiClient = createXApiClient({ tokenService, logger });
const webhookRouter = createWebhookRouter({
  config,
  tokenService,
  xapiClient,
  replyLogic,
  logger,
});
// Webhook before rate limit so X's GET (CRC) and POST (events) are not blocked
app.use(config.webhookPath, webhookRouter);

app.use(
  rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

setInterval(() => pkceStore.cleanupExpired().catch(() => {}), 60_000);

// Health
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.get("/readyz", async (req, res) => {
  const t = await tokenStore.readTokens();
  res.json({ ok: true, connected: !!t && t.connected !== false });
});

// OAuth start
app.get("/auth/start", async (req, res, next) => {
  try {
    const state = uuidv4();
    const { codeVerifier, codeChallenge } = generatePKCE();
    await pkceStore.put(state, codeVerifier);

    const url = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
      codeChallenge,
    });

    req.log.info({ state, redirectUri: config.redirectUri }, "Redirecting to X OAuth authorize");
    res.redirect(url);
  } catch (e) {
    next(e);
  }
});

// OAuth callback
app.get("/callback", async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      throw new AppError(`OAuth error: ${error}`, 400, "OAUTH_ERROR", error_description || null);
    }
    if (!code || !state) {
      throw new AppError("Missing code/state", 400, "OAUTH_BAD_CALLBACK");
    }

    const codeVerifier = await pkceStore.getAndDelete(state);
    if (!codeVerifier) {
      throw new AppError("Invalid/expired state (PKCE missing)", 400, "OAUTH_STATE_INVALID");
    }

    const data = await exchangeCodeForTokens({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
      codeVerifier,
      logger,
    });

    const tokens = {
      connected: true,
      token_type: data.token_type,
      scope: data.scope,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await tokenStore.writeTokens(tokens);
    req.log.info({ scope: tokens.scope }, "OAuth connected; tokens stored");

    res.status(200).send("✅ Connected to X successfully. You can close this window.");
  } catch (e) {
    next(e);
  }
});

// Status (safe)
app.get("/status", async (req, res) => {
  const t = await tokenStore.readTokens();
  if (!t) return res.json({ connected: false });

  res.json({
    connected: t.connected !== false,
    expires_at: t.expires_at || null,
    scope: t.scope || null,
    updated_at: t.updated_at || t.created_at || null,
    reason: t.reason || null,
    disconnected_at: t.disconnected_at || null,
  });
});

// Token check (safe)
app.get("/access-token", async (req, res, next) => {
  try {
    await tokenService.getValidAccessToken();
    res.json({ ok: true, accessToken: "[REDACTED]" });
  } catch (e) {
    next(e);
  }
});

// Global error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  const code = err.code || "UNHANDLED_ERROR";

  req.log.error({ code, status, details: err.details || null, err }, "Request failed");

  res.status(status).json({
    ok: false,
    code,
    message: err.message || "Internal Server Error",
    request_id: req.id,
    ...(process.env.NODE_ENV !== "production" ? { details: err.details || null } : {}),
  });
});

// Graceful shutdown
function shutdown(signal) {
  logger.info({ signal }, "Shutting down...");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(config.port, () => {
  logger.info({ port: config.port }, "Backend started");
});