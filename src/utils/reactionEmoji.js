// Single source of truth for permitted reaction emojis (posts + comments).
const ALLOWED_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🎉', '🙏', '🔥', '💯', '🫶', '👏', '🥳', '😍', '🤣', '😭', '💪', '🎂', '🌟', '👀', '🤔', '💔'];
// The 6 shown first in the iMessage-style quick bar.
const QUICK_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const isAllowedEmoji = (e) => ALLOWED_EMOJI.includes(e);
module.exports = { ALLOWED_EMOJI, QUICK_EMOJI, isAllowedEmoji };
