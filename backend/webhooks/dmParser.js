/**
 * Parse X Account Activity API webhook payload into incoming DM objects.
 * Input: raw JSON body from POST.
 * Output: [{ sender_id, text, event_id }].
 * Handles direct_message_events / message_create shape; returns [] on unknown/missing fields.
 */
function parseIncomingDMs(body, logger) {
  if (!body || typeof body !== "object") {
    if (logger) logger.debug({ body: !!body }, "parseIncomingDMs: no body or not object");
    return [];
  }

  const events = body.direct_message_events;
  if (!Array.isArray(events)) {
    if (logger) logger.debug({ keys: Object.keys(body) }, "parseIncomingDMs: no direct_message_events array");
    return [];
  }

  const out = [];
  for (const ev of events) {
    if (ev.type !== "message_create") continue;
    const mc = ev.message_create;
    if (!mc || typeof mc.sender_id !== "string") continue;
    const text = mc.message_data?.text;
    const senderId = mc.sender_id;
    const eventId = ev.id;
    out.push({ sender_id: senderId, text: typeof text === "string" ? text : "", event_id: eventId });
  }

  return out;
}

module.exports = { parseIncomingDMs };
