const axios = require("axios");
const crypto = require("crypto");
const { AppError } = require("../errors");

const AUTH_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generatePKCE() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

function buildAuthorizeUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTH_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId, clientSecret) {
  const token = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${token}`;
}

async function exchangeCodeForTokens({
  clientId,
  clientSecret,
  redirectUri,
  code,
  codeVerifier,
  logger,
}) {
  try {
    if (!clientSecret) {
      throw new AppError("CLIENT_SECRET missing", 500, "CONFIG_MISSING_CLIENT_SECRET");
    }

    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", redirectUri);
    body.set("code_verifier", codeVerifier);
    body.set("client_id", clientId);

    logger.info(
      { clientIdPrefix: String(clientId).slice(0, 6) },
      "OAuth exchange: authorization_code"
    );

    const res = await axios.post(TOKEN_URL, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(clientId, clientSecret),
      },
      timeout: 20000,
    });

    return res.data;
  } catch (e) {
    logger.error(
      { status: e.response?.status, data: e.response?.data },
      "Token exchange failed"
    );
    throw new AppError(
      "Token exchange failed",
      400,
      "OAUTH_EXCHANGE_FAILED",
      e.response?.data || e.message
    );
  }
}

async function refreshTokens({
  clientId,
  clientSecret,
  refreshToken,
  logger,
}) {
  try {
    if (!clientSecret) {
      throw new AppError("CLIENT_SECRET missing", 500, "CONFIG_MISSING_CLIENT_SECRET");
    }

    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("client_id", clientId);

    logger.info(
      { clientIdPrefix: String(clientId).slice(0, 6) },
      "OAuth refresh: refresh_token"
    );

    const res = await axios.post(TOKEN_URL, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(clientId, clientSecret),
      },
      timeout: 20000,
    });

    return res.data;
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;

    if (status === 400) {
      throw new AppError(
        "Refresh token invalid or expired",
        401,
        "REFRESH_TOKEN_INVALID",
        data || e.message
      );
    }

    logger.error({ status, data }, "Refresh failed");
    throw new AppError("Refresh failed", 502, "REFRESH_FAILED", data || e.message);
  }
}

module.exports = {
  generatePKCE,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
};