/**
 * NewBotStyle.js - Branding and UI Definitions
 * Contains the premium design tokens and layout logic for the Node.js port.
 */
const { EmbedBuilder, Colors } = require('discord.js');

const UI = {
    colors: {
        primary: 0x5865F2,
        success: 0x57F287,
        danger: 0xED4245,
        neutral: 0x2B2D31
    },
    
    icons: {
        success: "✅",
        error: "❌",
        loading: "⏳",
        match: "⚽"
    },

    createEmbed(title, description, color = 0x5865F2) {
        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
    }
};

module.exports = { UI };
