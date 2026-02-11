const { AppError } = require("../errors");
const { refreshTokens } = require("../oauth/xOAuth");

function createTokenService({ config, tokenStore, logger }) {
  async function getValidAccessToken() {
    const t = await tokenStore.readTokens();
    if (!t || t.connected === false) {
      throw new AppError("Not connected. Run /auth/start", 401, "NOT_CONNECTED");
    }

    const marginMs = 60 * 1000;
    const isExpired = !t.expires_at || (Date.now() + marginMs) >= Number(t.expires_at);

    if (!isExpired) return t.access_token;

    if (!t.refresh_token) {
      await tokenStore.markDisconnected("NO_REFRESH_TOKEN");
      throw new AppError("Missing refresh_token", 401, "NO_REFRESH_TOKEN");
    }

    logger.info("Access token expired/near-expiry. Refreshing...");

    const data = await refreshTokens({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: t.refresh_token,
      logger,
    });

    const next = {
      ...t,
      connected: true,
      token_type: data.token_type || t.token_type,
      scope: data.scope || t.scope,
      access_token: data.access_token,
      // IMPORTANT: X rotates refresh tokens
      refresh_token: data.refresh_token || t.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };

    await tokenStore.writeTokens(next);
    return next.access_token;
  }

  return { getValidAccessToken };
}

module.exports = { createTokenService };