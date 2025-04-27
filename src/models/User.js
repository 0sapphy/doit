const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  discordId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  name: { type: String, },
  discriminator: { type: String },
  avatar: { type: String },
});

/**
 * @param {import("passport-discord").Profile} profile
 */
function generateUserObject(profile) {
    return {
        discordId: profile.id,
        username: profile.username,
        name: profile.global_name,
        discriminator: profile.discriminator,
        avatar: profile.avatar
    }
}

module.exports = {
    User: mongoose.model("User", userSchema),
    generateUserObject
}