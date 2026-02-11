const crypto = require("crypto");
const { parseIncomingDMs } = require("./dmParser");

function createWebhookRouter({ config, tokenService, xapiClient, replyLogic, logger }) {
  const router = require("express").Router();

  // GET: CRC validation (X sends ?crc_token=...)
  router.get("/", (req, res) => {
    const crcToken = req.query.crc_token;
    if (!crcToken || typeof crcToken !== "string") {
      req.log?.warn("Webhook CRC: missing crc_token");
      return res.status(400).json({ error: "missing crc_token" });
    }
    const consumerSecret = config.consumerSecret;
    if (!consumerSecret) {
      req.log?.error("Webhook CRC: consumerSecret not configured");
      return res.status(500).json({ error: "CRC not configured" });
    }
    const digest = crypto
      .createHmac("sha256", consumerSecret)
      .update(crcToken)
      .digest("base64");
    const responseToken = `sha256=${digest}`;
    res.status(200).json({ response_token: responseToken });
  });

  // POST: Account Activity events (DM events)
  router.post("/", async (req, res) => {
    const body = req.body || {};
    const dms = parseIncomingDMs(body, req.log || logger);

    // Always respond 200 quickly so X does not retry; log failures
    res.status(200).json({ ok: true });

    if (dms.length === 0) return;

    const accessToken = await tokenService.getValidAccessToken().catch((e) => {
      req.log?.error({ err: e }, "Webhook: getValidAccessToken failed");
      return null;
    });
    if (!accessToken) return;

    for (const dm of dms) {
      try {
        const user = await xapiClient.getUser(dm.sender_id);
        const replyText = replyLogic.generateReply(dm.text, user);
        await xapiClient.sendDM(dm.sender_id, replyText);
        req.log?.info({ sender_id: dm.sender_id, event_id: dm.event_id }, "Webhook: DM reply sent");
      } catch (e) {
        req.log?.error(
          { err: e, sender_id: dm.sender_id, event_id: dm.event_id },
          "Webhook: DM pipeline failed"
        );
      }
    }
  });

  return router;
}

module.exports = { createWebhookRouter };
