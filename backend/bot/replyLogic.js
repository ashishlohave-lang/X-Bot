/**
 * Placeholder reply logic for incoming DMs.
 * Input: { text, user } (user = v2 user object from X API).
 * Output: string to send as DM.
 * Replace with real business logic (commands, NLU, external APIs) later.
 */
function generateReply(text, user) {
  const name = user?.name || user?.username || "there";
  return `You said: ${text || "(empty)"}. Hi ${name}!`;
}

module.exports = { generateReply };
