const axios = require("axios");
const { AppError } = require("../errors");

const BASE = "https://api.twitter.com/2";

function createXApiClient({ tokenService, logger }) {
  async function getAccessToken() {
    return tokenService.getValidAccessToken();
  }

  /**
   * GET /2/users/:id
   * Returns the user data object (v2 user object).
   */
  async function getUser(id) {
    if (!id) throw new AppError("getUser: id required", 400, "XAPI_BAD_INPUT");
    const token = await getAccessToken();
    try {
      const res = await axios.get(`${BASE}/users/${id}`, {
        params: { "user.fields": "username,name,profile_image_url" },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      return res.data?.data || null;
    } catch (e) {
      const status = e.response?.status;
      const data = e.response?.data;
      logger?.error({ status, data, userId: id }, "X API getUser failed");
      if (status === 429) throw new AppError("X API rate limit", 429, "XAPI_RATE_LIMIT", data);
      throw new AppError(
        data?.detail || e.message || "getUser failed",
        status || 502,
        "XAPI_GET_USER_FAILED",
        data
      );
    }
  }

  /**
   * POST /2/dm_conversations/with/:participant_id/messages
   * Sends a one-to-one DM. participant_id = sender_id for replying.
   */
  async function sendDM(participantId, text) {
    if (!participantId || typeof text !== "string") {
      throw new AppError("sendDM: participantId and text required", 400, "XAPI_BAD_INPUT");
    }
    const token = await getAccessToken();
    try {
      const res = await axios.post(
        `${BASE}/dm_conversations/with/${participantId}/messages`,
        { text },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      return res.data?.data || res.data;
    } catch (e) {
      const status = e.response?.status;
      const data = e.response?.data;
      logger?.error({ status, data, participantId }, "X API sendDM failed");
      if (status === 429) throw new AppError("X API rate limit", 429, "XAPI_RATE_LIMIT", data);
      throw new AppError(
        data?.detail || e.message || "sendDM failed",
        status || 502,
        "XAPI_SEND_DM_FAILED",
        data
      );
    }
  }

  return { getUser, sendDM };
}

module.exports = { createXApiClient };
