/**
 * emergency_handler.js
 * A lightweight, high-priority command listener to ensure the bot responds.
 */
console.log(">>> [DEBUG] Emergency Handler loading...");

module.exports = function(client) {
    client.on('messageCreate', async (message) => {
        // Ignore bots
        if (message.author.bot) return;

        const content = message.content.toLowerCase();

        // 1. Simple word-match test (No prefix needed)
        if (content === 'ping') {
            console.log(`[DEBUG] Received 'ping' from ${message.author.tag}`);
            return message.reply('pong! I am alive and listening. 🚀');
        }

        // 2. Simple prefix test (!test)
        if (content === '!test') {
            console.log(`[DEBUG] Received '!test' from ${message.author.tag}`);
            return message.reply('✅ Success! The emergency prefix handler is working.');
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'ping') {
            console.log(`[DEBUG] Received Slash Command /ping from ${interaction.user.tag}`);
            await interaction.reply('🚀 Slash commands are working! Latency: ' + client.ws.ping + 'ms');
        }
    });

    console.log(">>> [DEBUG] Emergency Handler active. Try typing 'ping' in Discord.");
};
