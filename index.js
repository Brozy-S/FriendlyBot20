"use strict";
// -------------------------------------------------------------
// DEBUG LOGGING - FIRST LINES
// -------------------------------------------------------------
console.log(">>> [BOOT] Application process group starting...");
process.stdout.write(">>> [BOOT] Purity check: Stdout is writeable.\n");
console.error(">>> [BOOT] Purity check: Stderr is writeable.");

process.on('unhandledRejection', (reason, promise) => {
    console.error('>>> [BOOT] UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('>>> [BOOT] UNCAUGHT EXCEPTION:', err);
    console.error(err.stack);
});

console.log(">>> [BOOT] Loading dependencies...");
require('dotenv').config();
const ultimateFix = require('./ultimate_fix'); // High priority fix
const networkFix = require('./network_fix');

const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType, MessageFlags, ChannelType } = require('discord.js');
console.log(">>> [BOOT] Discord.js loaded.");
const storage = require('./storage');
console.log(">>> [BOOT] Storage loaded.");
const roleStorage = require('./roleStorage');
console.log(">>> [BOOT] RoleStorage loaded.");
const server = require('./server');
console.log(">>> [BOOT] Server module loaded.");

const { createLineupAttachment } = require('./lineupRenderer');
const { createProfileAttachment } = require('./profileRenderer');
const { UI } = require('./NewBotStyle');

console.log(`[SYSTEM] Starting FriendlyBot v4.0 (Watchdog Relaxed: ${new Date().toISOString()})`);

process.on('unhandledRejection', (reason, promise) => {
    console.error('[!] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[!] Uncaught Exception:', err);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    rest: {
        timeout: 120_000,
        agent: ultimateFix.dispatcher,
    },
    ws: {
        agent: require('https').globalAgent
    }
});

const DISCORD_ENDPOINTS = [
    'https://discord.com/api',
    'https://canary.discord.com/api',
    'https://ptb.discord.com/api',
    'https://discordapp.com/api'
];
let currentEndpointIndex = 0;

// Increased to 240s (4 minutes) for extremely slow HF cold-starts + multiple endpoint retries
let connectionTimeout = setTimeout(() => {
    if (!client.isReady()) {
        console.error(">>> [CONNECTION WATCHDOG] Still offline after 240s or blocked. Attempting final emergency refresh...");
        process.exit(1);
    }
}, 240000);

console.log(`[*] Discord Client Initialized with Canary Failover + 90s Watchdog.`);

// Load Emergency Response Handler (Fix for bot not replying)
require('./emergency_handler')(client);
client.on('error', (err) => console.error('[Discord client]', err?.message || err));
client.on('shardError', (err, id) => console.error(`[Discord shard ${id}]`, err?.message || err));
client.on('shardDisconnect', (ev, id) => console.warn(`[Discord] Shard ${id} disconnected (code ${ev?.code}). Will auto-reconnect.`));
client.on('shardReconnecting', (id) => console.log(`[Discord] Shard ${id} reconnecting...`));
client.on('invalidated', () => {
    console.error('[Discord] Session invalidated! Restarting process...');
    process.exit(1);
});

client.commands = new Collection();

// --- 1. CONFIG ---
let RAW_TOKEN = process.env.BOT_TOKEN || process.env.TOKEN || process.env.DISCORD_TOKEN;
const TOKEN = RAW_TOKEN ? RAW_TOKEN.trim().replace(/['"]+/g, '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/^Bot\s+/i, '') : null;

if (!TOKEN) {
    console.error("[!] CRITICAL: No Discord token found in environment variables.");
} else {
    console.log(`[*] Token Found (Length: ${TOKEN.length}, Pattern: ${TOKEN.substring(0, 4)}...${TOKEN.substring(TOKEN.length - 4)})`);
}

// --- 2. COMMAND REGISTRATION ---
const commandsData = [
    { name: 'ping', description: 'Check bot latency' },
    { name: 'friendly', description: 'Start a friendly match poll', options: [{ name: 'needed', type: 4, description: 'Players needed', required: false }] },
    {
        name: 'leaguematch', description: 'Schedule a league match', options: [
            { name: 'home', type: 3, description: 'Home team', required: true },
            { name: 'away', type: 3, description: 'Away team', required: true },
            { name: 'link', type: 3, description: 'Match link', required: true },
            { name: 'time', type: 3, description: 'Time (e.g. 5pm)', required: false }
        ]
    },
    { name: 'lineup', description: 'Show current lineup board' },
    { name: 'clear', description: 'Clear messages', options: [{ name: 'amount', type: 4, description: 'Number of messages', required: true }] },
    { name: 'lock', description: 'Lock the current channel' },
    { name: 'unlock', description: 'Unlock the current channel' },
    { name: 'post', description: 'Broadcast a message to all servers', options: [{ name: 'message', type: 3, description: 'The message to send', required: true }] },
    {
        name: 'win', description: 'Record a win', options: [
            { name: 'result', type: 3, description: 'The score (e.g. 3-0)', required: true },
            { name: 'scorers', type: 3, description: 'Mentions and goals', required: false }
        ]
    },
    {
        name: 'loss', description: 'Record a loss', options: [
            { name: 'result', type: 3, description: 'The score', required: true },
            { name: 'scorers', type: 3, description: 'Mentions and goals', required: false }
        ]
    },
    {
        name: 'draw', description: 'Record a draw', options: [
            { name: 'result', type: 3, description: 'The score', required: true },
            { name: 'scorers', type: 3, description: 'Mentions and goals', required: false }
        ]
    },
    { name: 'top', description: 'View leaderboard' },
    { name: 'record', description: 'View server record' },
    { name: 'addrole', description: 'Whitelist a role', options: [{ name: 'role', type: 8, description: 'The role', required: true }] },
    { name: 'removerole', description: 'Remove role from whitelist', options: [{ name: 'role', type: 8, description: 'The role', required: true }] },
    { name: 'setup', description: 'Configure bot features (Admin)' },
    { name: 'friendlybotsettings', description: 'View bot status and whitelist' },
    { name: 'managerlineup', description: 'Open the GUI editor to draft players interactively' },
    { name: 'lineupimage', description: 'Generate a high-quality visual representation of the lineup' },
    { name: 'sendlink', description: 'Send a match link publicly', options: [{ name: 'link', type: 3, description: 'The link to send', required: true }] },
    { name: 'profile', description: 'Generate a custom profile card', options: [{ name: 'user', type: 6, description: 'The user to check', required: false }] },
    { name: 'profileimage', description: 'Generate a high-quality visual profile card', options: [{ name: 'user', type: 6, description: 'The user to check', required: false }] },
    { name: 'giverole', description: 'Give a role to members (Admin)', options: [{ name: 'role', type: 8, description: 'The role', required: true }] },
    { name: 'uptime', description: 'Show how long the bot has been online' },
    { name: 'motm', description: 'Award Man of the Match to a player', options: [{ name: 'player', type: 6, description: 'The player to award', required: true }] }
];

client.once('ready', async () => {
    console.log(`[SYSTEM] ##########################################`);
    console.log(`[SYSTEM] FriendlyBot is ONLINE as ${client.user.tag}`);
    console.log(`[SYSTEM] Connected to ${client.guilds.cache.size} servers`);
    console.log(`[SYSTEM] ##########################################`);

    try {
        const guildCount = client.guilds.cache.size;
        if (guildCount === 0) {
            console.log('[*] Bot is in no servers yet — registering global slash commands...');
            await client.application.commands.set(commandsData);
        } else {
            // Per-guild registration so / commands show up immediately (global can take up to ~1 hour).
            console.log(`[*] Syncing slash commands to ${guildCount} server(s)...`);
            await client.application.commands.set([]).catch(() => { });
            for (const guild of client.guilds.cache.values()) {
                await guild.commands.set(commandsData).catch((err) => {
                    console.error(`[!] Slash sync failed for "${guild.name}" (${guild.id}):`, err.message);
                });
            }
        }
        console.log('[*] Slash commands synchronized.');
    } catch (e) {
        console.error(`[!] Command Sync Error: ${e.message}`);
    }

    // Auto-Scan Pending Polls & Cleanup
    for (const guild of client.guilds.cache.values()) {
        const backupChannel = guild.channels.cache.find(c => c.name === 'friendlybot-storage');
        if (backupChannel) {
            backupChannel.delete().catch(() => { });
        }
    }

    // Auto-Friendly Background Loop
    setInterval(async () => {
        const now = Date.now();
        for (const guild of client.guilds.cache.values()) {
            const config = storage.data.config[guild.id];
            if (config?.autoFriendlyEnabled && config?.autoFriendlyChannel) {
                const intervalMs = (config.autoFriendlyInterval || 40) * 60000;
                const lastRun = config.lastAutoFriendly || 0;

                if (now - lastRun >= intervalMs) {
                    try {
                        const channel = await guild.channels.fetch(config.autoFriendlyChannel).catch(() => null);
                        if (channel && channel.isTextBased()) {
                            const needed = 7;
                            const content = `⭐▬▬▬▬▬ **FRIENDLY** ▬▬▬▬▬⭐\n🤝 Session\n🟩 I'm In\n🟥 Busy\n⭐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⭐\n🗳️ Needed: ${needed}\n@everyone`;
                            const msg = await channel.send({ content, allowedMentions: { parse: ['everyone'] } });
                            await msg.react('🟩');
                            await msg.react('🟥');
                            storage.data.active_polls[guild.id] = msg.id;
                            config.lastAutoFriendly = now;
                            storage.save('config');
                            storage.save('active_polls');
                        }
                    } catch (err) {
                        console.error(`Auto-friendly error in ${guild.name}:`, err);
                    }
                }
            }
        }
    }, 60000); // Check every minute
});


const inviteCache = new Map();

async function logTransaction(client, commandName, user, guild, member) {
    try {
        const logChannelId = '1495044946107961364';
        const channel = await client.channels.fetch(logChannelId).catch(() => null);
        if (channel) {
            let inviteUrl = null;
            if (guild) {
                if (inviteCache.has(guild.id)) {
                    inviteUrl = inviteCache.get(guild.id);
                } else {
                    try {
                        let sysChannel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has('CreateInstantInvite'));
                        if (sysChannel) {
                            const invites = await sysChannel.fetchInvites().catch(() => new Map());
                            if (invites.size > 0) {
                                inviteUrl = invites.first().url;
                            } else {
                                const inv = await sysChannel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
                                if (inv) inviteUrl = inv.url;
                            }
                            if (inviteUrl) inviteCache.set(guild.id, inviteUrl);
                        }
                    } catch (e) { }
                }
            }

            let worked = true;
            let isWhiteListed = guild && member ? roleStorage.isWhitelisted(guild.id, member) : false;
            let isAdmin = member && member.permissions ? member.permissions.has('Administrator') : false;
            const app = await client.application.fetch().catch(() => null);
            let isOwner = app && app.owner ? (user.id === app.owner.ownerId || user.id === app.owner.id) : false;

            const whitelistCmds = ['friendly', 'lineup', 'win', 'loss', 'draw', 'leaguematch', 'clear', 'lock', 'unlock', 'sendlink', 'lineupimage', 'managerlineup'];
            const adminCmds = ['setup', 'post', 'addrole', 'removerole', 'sync', 'sync_cmds'];
            const ownerCmds = ['reboot', 'grantservers'];

            if (whitelistCmds.includes(commandName) && !isWhiteListed && !isAdmin) worked = false;
            if (adminCmds.includes(commandName) && !isAdmin) worked = false;
            if (ownerCmds.includes(commandName) && !isOwner) worked = false;
            if (commandName === 'servers' && !isOwner && user.id !== storage.data.settings?.serverViewer) worked = false;

            const statusStr = worked ? "✅ Success" : "❌ Failed (No Permission)";
            const serverField = guild ? (inviteUrl ? `[${guild.name}](${inviteUrl})` : guild.name) : 'DM';

            const embed = new EmbedBuilder()
                .setTitle(`Command Executed: ${commandName}`)
                .addFields(
                    { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                    { name: 'Server', value: serverField, inline: true },
                    { name: 'Status', value: statusStr, inline: false }
                )
                .setColor(worked ? 0x5865F2 : 0xED4245)
                .setTimestamp();
            await channel.send({ embeds: [embed] }).catch(() => { });
        }
    } catch (e) {
        console.error("Log Transaction Error:", e);
    }
}

// --- 3. EVENT HANDLERS ---

// Message Command Handler (Prefix Support)
client.on('messageCreate', async (message) => {
    const prefix = storage.getPrefix(message.guildId);
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const allCommands = [...commandsData.map(c => c.name), 'sync', 'sync_cmds', 'reboot', 'grantservers', 'servers', 'help', 'motm', 'profileimage'];
    if (allCommands.includes(commandName)) {
        logTransaction(client, commandName, message.author, message.guild, message.member);
    }

    if (commandName === 'ping') {
        const msg = await message.reply('Pinging...');
        msg.edit(`Pong! Latency: ${msg.createdTimestamp - message.createdTimestamp}ms`);
    }

    if (commandName === 'friendly') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const needed = parseInt(args[0]) || 7;
        const content = `⭐▬▬▬▬▬ **FRIENDLY** ▬▬▬▬▬⭐\n🤝 Session\n🟩 I'm In\n🟥 Busy\n⭐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⭐\n🗳️ Needed: ${needed}\n@everyone`;
        const msg = await message.channel.send({ content, allowedMentions: { parse: ['everyone'] } });
        await msg.react('🟩');
        await msg.react('🟥');
        storage.data.active_polls[message.guildId] = msg.id;
        storage.save('active_polls');
    }

    if (commandName === 'lineup') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const formOptions = Object.keys(FORMATIONS).slice(0, 25).map(k => ({ label: k, value: k }));
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('formation_select_initial')
                .setPlaceholder('Step 1: Select Formation...')
                .addOptions(formOptions)
        );
        const embed = UI.createEmbed("📋 Initialize Lineup", "Please select a formation to create the lineup board.", UI.colors.primary);
        await message.channel.send({ embeds: [embed], components: [row] });
    }

    if (commandName === 'top') {
        const sorted = Object.entries(storage.data.stats).sort((a, b) => (b[1].matches || 0) - (a[1].matches || 0)).slice(0, 10);
        let text = sorted.map(([id, data], i) => `**#${i + 1}** <@${id}> — \`${data.matches || 0}\` matches | ⭐ \`${data.mvps || 0}\` MVPs`).join('\n');
        await message.reply({ embeds: [UI.createEmbed("🏆 Most Active Players", text || "No data yet.")] });
    }

    if (commandName === 'motm') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const target = message.mentions.users.first();
        if (!target) return message.reply("❌ Please mention the player! (e.g. `!motm @User`)");

        storage.addStat(target.id, 'mvps');
        const embed = UI.createEmbed("🌟 MAN OF THE MATCH", `The MVP award has been granted to <@${target.id}>!`, UI.colors.success);
        await message.channel.send({ embeds: [embed] });
    }

    if (commandName === 'record') {
        const r = storage.getRecord(message.guildId);
        await message.reply({ embeds: [UI.createEmbed("📊 Server Match Record", `✅ Wins: \`${r.wins}\`\n🟥 Losses: \`${r.losses}\`\n🤝 Draws: \`${r.draws}\``)] });
    }

    if (commandName === 'friendlybotsettings') {
        const roles = roleStorage.roles[message.guildId] || [];
        const rInfo = roles.length > 0 ? roles.map(r => `<@&${r}>`).join(', ') : "Only administrator.";
        await message.reply(`🟢 **Online**\nWhitelist: ${rInfo}`);
    }

    if (commandName === 'win' || commandName === 'loss' || commandName === 'draw') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const type = commandName;
        const res = args[0] || "?-?";
        const scorers = args.slice(1).join(" ");
        const record = storage.getRecord(message.guildId);

        if (type === 'win') record.wins++;
        else if (type === 'loss') record.losses++;
        else record.draws++;

        // Auto-increment matches for everyone on the lineup board
        const lineup = getGuildLineup(message.guildId);
        const playersOnBoard = new Set();
        for (const players of lineup.values()) {
            players.forEach(p => playersOnBoard.add(p));
        }
        playersOnBoard.forEach(uid => storage.addStat(uid, 'matches'));

        const mentions = scorers.match(/<@!?(\d+)>/g) || [];
        mentions.forEach(m => storage.addStat(m.replace(/[<@!>]/g, ''), 'goals'));

        storage.save('records');
        const embed = UI.createEmbed(`⭐ ${type.toUpperCase()} RECORDED`, `🏟️ **Result**: ${res}\n\n⚽ **Scorers**:\n${scorers || "None"}\n\n📊 *Matches have been recorded for everyone on the current lineup board.*`, type === 'win' ? UI.colors.success : UI.colors.danger);
        await message.channel.send({ embeds: [embed] });
    }

    if (commandName === 'leaguematch') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const home = args[0] || "Home";
        const away = args[1] || "Away";
        const link = args[2] || "TBA";
        const timeInput = args.slice(3).join(" ");

        if (!timeInput) return message.reply("❌ Please provide a time (e.g. `!leaguematch Home Away Link 9 PM`)!");

        const matchId = `match_${Date.now()}`;
        pendingMatches.set(matchId, { home, away, link, timeInput, channelId: message.channelId });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`tz_select_${matchId}`)
                .setPlaceholder('Select YOUR current timezone...')
                .addOptions(TIMEZONE_OPTIONS)
        );

        await message.reply({ content: "🌍 **One last step!** Please select your timezone below so I can set the exact time for everyone:", components: [row] });
    }

    if (commandName === 'setup') {
        if (!message.member.permissions.has('Administrator')) return message.reply("❌ Admin Only");
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('settings_select')
                .setPlaceholder('Configure bot features...')
                .addOptions([
                    { label: 'Cloud Backup', description: 'Enable/Disable Discord Cloud Backup', value: 'toggle_backup' },
                    { label: 'Auto Friendly', description: 'Configure automated friendly polls', value: 'auto_friendly_settings' }
                ])
        );
        await message.channel.send({ content: "⚙️ **Settings**", components: [row] });
    }

    if (commandName === 'clear') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const amount = parseInt(args[0]);
        if (amount) {
            await message.channel.bulkDelete(amount, true);
            const msg = await message.channel.send(`✅ Cleared ${amount} messages.`);
            setTimeout(() => msg.delete(), 3000);
        }
    }

    if (commandName === 'lock') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        await message.reply("🔒 Channel Locked.");
    }

    if (commandName === 'unlock') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        await message.reply("🔓 Channel Unlocked.");
    }

    if (commandName === 'post') {
        if (!message.member.permissions.has('Administrator')) return message.reply("❌ Admin Only");
        const text = args.join(' ');
        let count = 0;
        const notifyMsg = await message.reply("📢 Broadcasting...");
        for (const guild of client.guilds.cache.values()) {
            const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());
            if (channel) { await channel.send(text).catch(() => { }); count++; }
        }
        await notifyMsg.edit(`📢 Broadcasted to ${count} servers.`);
    }

    if (commandName === 'sync' || commandName === 'sync_cmds') {
        if (!message.member.permissions.has('Administrator')) return;
        const count = client.guilds.cache.size;
        const notifyMsg = await message.reply(`🔄 **Purging duplicates & Syncing** to all **${count}** proxy servers...`);

        // Nuke global commands to clear duplicates
        await client.application.commands.set([]);

        // Sync locally
        for (const guild of client.guilds.cache.values()) {
            await guild.commands.set(commandsData).catch(() => { });
        }

        await notifyMsg.edit(`✅ Done! Purged duplicate global commands and force-synchronized ALL missing commands to ALL **${count}** servers! (Please press Ctrl+R to refresh your Discord App.)`);
    }

    if (commandName === 'reboot') {
        const app = await client.application.fetch();
        const ownerId = app.owner?.ownerId || app.owner?.id;
        if (message.author.id !== ownerId) return message.reply("❌ Owner Only");
        await message.reply("🔄 Rebooting process... Hugging Face will restart me automatically.");
        setTimeout(() => process.exit(1), 1000);
    }

    if (commandName === 'sendlink') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        await message.channel.send(`Link : ${args[0] || 'None'}`);
    }

    if (commandName === 'grantservers') {
        const app = await client.application.fetch();
        const ownerId = app.owner?.ownerId || app.owner?.id;

        if (message.author.id !== ownerId) return message.reply("❌ Only the Bot Owner can grant access to the `!servers` command.");

        const targetUser = message.mentions.users.first();
        if (!targetUser) return message.reply("❌ Please mention the user you want to grant access to! (e.g. `!grantservers @Brozy`)");

        storage.data.settings.serverViewer = targetUser.id;
        storage.save('settings');
        await message.reply(`✅ Granted global **Server Viewer** permission to ${targetUser.username}! They can now use the \`!servers\` command exclusively.`);
    }

    if (commandName === 'servers') {
        const app = await client.application.fetch();
        const ownerId = app.owner?.ownerId || app.owner?.id;
        const grantedViewer = storage.data.settings?.serverViewer;

        if (message.author.id !== ownerId && message.author.id !== grantedViewer) {
            return message.reply("❌ This is a highly restricted command. Only the Official Bot Owner or the designated Authorized Viewer can use this!");
        }

        const statusMsg = await message.reply("🔍 Scanning all servers and generating invite links... This may take a moment.");

        const guildsInfoRaw = await Promise.all(client.guilds.cache.map(async g => {
            let invite = null;
            try {
                let channel = g.systemChannel || g.channels.cache.find(c => c.isTextBased() && c.permissionsFor(g.members.me).has('CreateInstantInvite'));
                if (channel) {
                    const inv = await channel.createInvite({ maxAge: 0, maxUses: 0 });
                    invite = inv.url;
                }
            } catch (e) { }
            return { name: g.name, count: g.memberCount, link: invite };
        }));

        guildsInfoRaw.sort((a, b) => b.count - a.count);

        let desc = "";
        guildsInfoRaw.forEach((g, i) => {
            const serverName = g.link ? `[${g.name}](${g.link})` : g.name;
            let line = `**${i + 1}.** ${serverName} — \`${g.count}\` members\n`;
            if (desc.length + line.length < 4000) desc += line; // Embed safety cap
        });
        desc += `\nTotal servers: ${client.guilds.cache.size}`;

        const embed = new EmbedBuilder()
            .setTitle(`🌐 Serving ${client.guilds.cache.size} Servers`)
            .setDescription(desc)
            .setColor('#5865F2');

        await statusMsg.edit({ content: null, embeds: [embed] });
    }

    if (commandName === 'uptime') {
        const up = process.uptime();
        const d = Math.floor(up / 86400);
        const h = Math.floor(up / 3600) % 24;
        const m = Math.floor(up / 60) % 60;
        await message.reply(`⏱️ **Uptime**: ${d}d ${h}h ${m}m ${Math.floor(up % 60)}s`);
    }

    if (commandName === 'addrole' || commandName === 'removerole') {
        if (!message.member.permissions.has('Administrator')) return message.reply("❌ Admin Only");
        const role = message.mentions.roles.first();
        if (!role) return message.reply("❌ Please mention a role! (e.g. `!addrole @Staff`)");

        const gid = message.guildId;

        if (commandName === 'addrole') {
            roleStorage.addRole(gid, role.id);
        } else {
            roleStorage.removeRole(gid, role.id);
        }

        await message.reply(`✅ Updated whitelist for ${role.name}`);
    }

    if (commandName === 'help') {
        const h = `⭐ FRIENDLYBOT OFFICIAL COMMANDS ⭐\n\n--- ⚽ MATCH & LINEUP MANAGEMENT ---\n!friendly /friendly         - Start a standard lineup vote for players to join.\n!leaguematch /leaguematch      - Schedule a professional league match with an opponent, link, and optional time.\n!lineup /lineup           - (Admin/Staff) Generate the standard interactive lineup board.\n!managerlineup /managerlineup    - (Admin/Staff) Open the GUI editor to draft players interactively.\n!lineupimage /lineupimage      - Generate a high-quality visual representation of the current starting lineup.\n!sendlink /sendlink         - Send a link publicly in the current channel as \`Link : [link]\`.\n\n--- 📈 COMPETITION & STATS ---\n!top /top              - 🏆 Show the Top 10 most active players in the server.\n!profile /profile          - 🎴 Generate a custom FIFA-style profile card with player stats.\n!record /record           - 📊 View the server's global Win/Loss/Draw record.\n!win /win              - (Admin/Staff) Record a victory into the server record.\n!loss /loss             - (Admin/Staff) Record a defeat into the server record.\n!draw /draw             - (Admin/Staff) Record a draw into the server record.\n\n--- ⚙️ SYSTEM & STAFF SETUP ---\n!setup /setup            - (Admin Only) Opens the interactive settings dropdown panel (Configure Auto Friendly, Cloud Backups, etc).\n!addrole /addrole          - (Admin Only) Add a role to the bot staff whitelist.\n!removerole /removerole       - (Admin Only) Remove a role from the bot staff whitelist.\n!giverole /giverole         - (Admin Only) Give a role to every member who already has the required roles.\n!friendlybotsettings /friendlybotsettings - View bot status and permitted roles.\n!sync /sync             - (Admin Only) Synchronize slash commands.\n!sync_cmds /sync_cmds        - Alias for /sync.\n!reboot /reboot           - (Owner Only) Restart the bot.\n!ping /ping             - Check bot latency.\n!uptime /uptime           - Show how long the bot has been online.`;
        await message.reply(`\`\`\`\n${h}\n\`\`\``);
    }

    if (commandName === 'lineupimage') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const waitMsg = await message.reply('⏳ **Generating lineup image...**');
        try {
            const lineup = getGuildLineup(message.guildId);
            const formKey = guildSelectedFormation.get(message.guildId) || 'default';
            const formation = FORMATIONS[formKey];
            const attachment = await createLineupAttachment(lineup, formKey, formation, client);
            const embed = UI.createEmbed(`⚽ Lineup — ${formKey}`, 'Current starting lineup positions');
            embed.setImage('attachment://lineup.png');
            await waitMsg.edit({ content: null, embeds: [embed], files: [attachment] });
        } catch (e) {
            console.error('Lineup image error:', e);
            await waitMsg.edit('❌ Failed to generate lineup image. Make sure a lineup has been set up first!');
        }
    }

    if (commandName === 'profile') {
        const target = message.mentions.users.first() || message.author;
        const stats = storage.data.stats[target.id] || { matches: 0, goals: 0, mvps: 0 };

        const embed = new EmbedBuilder()
            .setTitle(`🎴 PLAYER PROFILE — ${target.username.toUpperCase()}`)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🏟️ Matches', value: `\`${stats.matches || 0}\``, inline: true },
                { name: '⚽ Goals', value: `\`${stats.goals || 0}\``, inline: true },
                { name: '🌟 MOTM Awards', value: `\`${stats.mvps || 0}\``, inline: true }
            )
            .setColor(UI.colors.primary)
            .setFooter({ text: 'FriendlyBot Pro Stats' });

        await message.reply({ embeds: [embed] });
    }

    if (commandName === 'profileimage') {
        const target = message.mentions.users.first() || message.author;
        const stats = storage.data.stats[target.id] || { matches: 0, goals: 0, mvps: 0 };
        const waitMsg = await message.reply('⏳ **Generating profile card...**');
        try {
            const attachment = await createProfileAttachment(target, stats);
            await waitMsg.edit({ content: null, files: [attachment] });
        } catch (e) {
            console.error('Profile image error:', e);
            await waitMsg.edit('❌ Failed to generate profile image.');
        }
    }

    if (commandName === 'giverole') {
        await message.reply(`🖌️ **Feature Migration in Progress!**\nThe \`${commandName}\` feature is currently being updated to Next-Gen graphics. Check back shortly!`);
    }

    if (commandName === 'managerlineup') {
        if (!roleStorage.isWhitelisted(message.guildId, message.member)) return message.reply("❌ No Permission");
        const formOptions = Object.keys(FORMATIONS).slice(0, 25).map(k => ({ label: k, value: k }));
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('manager_formation_select')
                .setPlaceholder('Step 1: Select Formation...')
                .addOptions(formOptions)
        );
        await message.channel.send({ content: "📋 **Step 1: Choose Formation for GUI Editor**", components: [row] });
    }
});

async function safeReply(interaction, options) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (e) {
        console.error(`[!] Reply Failed: ${e.message}`);
    }
}

// Interaction Handler
client.on('interactionCreate', async (interaction) => {
    // Only defer ChatInputCommands to prevent conflict with Button/Menu deferUpdate()
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName !== 'ping') {
            await interaction.deferReply().catch(() => { });
        }
    }
    if (interaction.isChatInputCommand()) {
        logTransaction(client, interaction.commandName, interaction.user, interaction.guild, interaction.member);

        if (interaction.commandName === 'ping') {
            await safeReply(interaction, `Latency: ${client.ws.ping}ms`);
        }

        if (interaction.commandName === 'friendly') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const needed = interaction.options.getInteger('needed') || 7;
            const content = `⭐▬▬▬▬▬ **FRIENDLY** ▬▬▬▬▬⭐\n🤝 Session\n🟩 I'm In\n🟥 Busy\n⭐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⭐\n🗳️ Needed: ${needed}\n@everyone`;
            const msg = await safeReply(interaction, { content, fetchReply: true, allowedMentions: { parse: ['everyone'] } });
            if (msg) {
                await msg.react('🟩').catch(() => { });
                await msg.react('🟥').catch(() => { });
                storage.data.active_polls[interaction.guildId] = msg.id;
                storage.save('active_polls');
            }
        }

        if (interaction.commandName === 'leaguematch') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const home = interaction.options.getString('home');
            const away = interaction.options.getString('away');
            const link = interaction.options.getString('link');
            const timeInput = interaction.options.getString('time');

            const matchId = `match_${Date.now()}`;
            pendingMatches.set(matchId, { home, away, link, timeInput, channelId: interaction.channelId });

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`tz_select_${matchId}`)
                    .setPlaceholder('Select YOUR current timezone...')
                    .addOptions(TIMEZONE_OPTIONS)
            );

            await safeReply(interaction, { content: "🌍 **Select your timezone** to finalize the match schedule:", components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.commandName === 'win' || interaction.commandName === 'loss' || interaction.commandName === 'draw') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });

            const type = interaction.commandName;
            const res = interaction.options.getString('result');
            const scorers = interaction.options.getString('scorers') || "";

            const record = storage.getRecord(interaction.guildId);
            if (type === 'win') record.wins++;
            else if (type === 'loss') record.losses++;
            else record.draws++;

            // Auto-increment matches for everyone on the lineup board
            const lineup = getGuildLineup(interaction.guildId);
            const playersOnBoard = new Set();
            for (const players of lineup.values()) {
                players.forEach(p => playersOnBoard.add(p));
            }
            playersOnBoard.forEach(uid => storage.addStat(uid, 'matches'));

            // Process scorers
            const mentions = scorers.match(/<@!?(\d+)>/g) || [];
            mentions.forEach(m => {
                const uid = m.replace(/[<@!>]/g, '');
                storage.addStat(uid, 'goals');
            });

            storage.save('records');
            const embed = UI.createEmbed(`⭐ ${type.toUpperCase()} RECORDED`, `🏟️ **Result**: ${res}\n\n⚽ **Scorers**:\n${scorers || "None"}\n\n📊 *Matches have been recorded for everyone on the current lineup board.*`, type === 'win' ? UI.colors.success : UI.colors.danger);
            await safeReply(interaction, { embeds: [embed] });
        }

        if (interaction.commandName === 'top') {
            const sorted = Object.entries(storage.data.stats)
                .sort((a, b) => (b[1].matches || 0) - (a[1].matches || 0))
                .slice(0, 10);

            let text = "";
            sorted.forEach(([id, data], i) => {
                text += `**#${i + 1}** <@${id}> — \`${data.matches || 0}\` matches | ⭐ \`${data.mvps || 0}\` MVPs\n`;
            });

            const embed = UI.createEmbed("🏆 Most Active Players", text || "No data yet.");
            await safeReply(interaction, { embeds: [embed] });
        }

        if (interaction.commandName === 'motm') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const target = interaction.options.getUser('player');
            storage.addStat(target.id, 'mvps');
            const embed = UI.createEmbed("🌟 MAN OF THE MATCH", `The MVP award has been granted to <@${target.id}>!`, UI.colors.success);
            await safeReply(interaction, { embeds: [embed] });
        }

        if (interaction.commandName === 'record') {
            const r = storage.getRecord(interaction.guildId);
            const embed = UI.createEmbed("📊 Server Match Record", `✅ Wins: \`${r.wins}\`\n🟥 Losses: \`${r.losses}\`\n🤝 Draws: \`${r.draws}\``);
            await safeReply(interaction, { embeds: [embed] });
        }
        if (interaction.commandName === 'setup') {
            if (!interaction.member.permissions.has('Administrator')) return safeReply(interaction, { content: "❌ Admin Only", ephemeral: true });

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_select')
                    .setPlaceholder('Configure bot features...')
                    .addOptions([
                        { label: 'Cloud Backup', description: 'Enable/Disable Discord Cloud Backup', value: 'toggle_backup' },
                        { label: 'Auto Friendly', description: 'Configure automated friendly polls', value: 'auto_friendly_settings' }
                    ])
            );
            await safeReply(interaction, { content: "⚙️ **Settings**", components: [row] });
        }

        if (interaction.commandName === 'friendlybotsettings') {
            const roles = roleStorage.roles[interaction.guildId] || [];
            const rInfo = roles.length > 0 ? roles.map(r => `<@&${r}>`).join(', ') : "Only administrator.";
            await safeReply(interaction, { content: `🟢 **Online**\nWhitelist: ${rInfo}` });
        }

        if (interaction.commandName === 'lineup') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const formOptions = Object.keys(FORMATIONS).slice(0, 25).map(k => ({ label: k, value: k }));
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('formation_select_initial')
                    .setPlaceholder('Step 1: Select Formation...')
                    .addOptions(formOptions)
            );
            const embed = UI.createEmbed("📋 Initialize Lineup", "Please select a formation to create the lineup board.", UI.colors.primary);
            await safeReply(interaction, { embeds: [embed], components: [row] });
        }

        if (interaction.commandName === 'clear') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const amount = interaction.options.getInteger('amount');
            await interaction.channel.bulkDelete(amount, true);
            await safeReply(interaction, { content: `✅ Cleared ${amount} messages.`, ephemeral: true });
        }

        if (interaction.commandName === 'lock') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            await safeReply(interaction, { content: "🔒 Channel Locked." });
        }

        if (interaction.commandName === 'unlock') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
            await safeReply(interaction, { content: "🔓 Channel Unlocked." });
        }

        if (interaction.commandName === 'post') {
            if (!interaction.member.permissions.has('Administrator')) return safeReply(interaction, { content: "❌ Admin Only", ephemeral: true });
            const text = interaction.options.getString('message');
            let count = 0;
            for (const guild of client.guilds.cache.values()) {
                const config = storage.data.config[guild.id] || {};

                // Check if this guild has disabled broadcasts
                if (config.postEnabled === false) continue;

                try {
                    // Check if a specific channel is set for broadcasts
                    let channel = null;
                    if (config.postChannelId) {
                        channel = await guild.channels.fetch(config.postChannelId).catch(() => null);
                    }

                    // Fallback to system channel or first text channel
                    if (!channel) {
                        channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());
                    }

                    if (channel) {
                        await channel.send(text).catch(() => { });
                        count++;
                    }
                } catch (err) {
                    console.error(`Post error in ${guild.name}:`, err);
                }
            }
            await interaction.editReply({ content: `📢 Broadcasted to ${count} servers.` });
        }

        if (interaction.commandName === 'sendlink') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const link = interaction.options.getString('link');
            await safeReply(interaction, `Link : ${link}`);
        }

        if (interaction.commandName === 'uptime') {
            const up = process.uptime();
            const d = Math.floor(up / 86400);
            const h = Math.floor(up / 3600) % 24;
            const m = Math.floor(up / 60) % 60;
            await safeReply(interaction, `⏱️ **Uptime**: ${d}d ${h}h ${m}m ${Math.floor(up % 60)}s`);
        }

        if (interaction.commandName === 'addrole' || interaction.commandName === 'removerole') {
            if (!interaction.member.permissions.has('Administrator')) return safeReply(interaction, { content: "❌ Admin Only", ephemeral: true });
            const role = interaction.options.getRole('role');
            if (!role) return safeReply(interaction, { content: "❌ Please select a role!", ephemeral: true });

            const gid = interaction.guildId;

            if (interaction.commandName === 'addrole') {
                roleStorage.addRole(gid, role.id);
            } else {
                roleStorage.removeRole(gid, role.id);
            }

            await safeReply(interaction, `✅ Updated whitelist for <@&${role.id}>`);
        }

        if (interaction.commandName === 'managerlineup') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return interaction.reply({ content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const formOptions = Object.keys(FORMATIONS).slice(0, 25).map(k => ({ label: k, value: k }));
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('manager_formation_select')
                    .setPlaceholder('Step 1: Select Formation...')
                    .addOptions(formOptions)
            );
            await safeReply(interaction, { content: "📋 **Step 1: Choose Formation for GUI Editor**", components: [row] });
        }

        if (interaction.commandName === 'lineupimage') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return safeReply(interaction, { content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            try {
                const lineup = getGuildLineup(interaction.guildId);
                const formKey = guildSelectedFormation.get(interaction.guildId) || 'default';
                const formation = FORMATIONS[formKey];
                const attachment = await createLineupAttachment(lineup, formKey, formation, client);
                const embed = UI.createEmbed(`⚽ Lineup — ${formKey}`, 'Current starting lineup positions');
                embed.setImage('attachment://lineup.png');
                await safeReply(interaction, { embeds: [embed], files: [attachment] });
            } catch (e) {
                console.error('Lineup image error:', e);
                await safeReply(interaction, '❌ Failed to generate lineup image.');
            }
        }

        if (interaction.commandName === 'profile') {
            const target = interaction.options.getUser('user') || interaction.user;
            const stats = storage.data.stats[target.id] || { matches: 0, goals: 0, mvps: 0 };

            const embed = new EmbedBuilder()
                .setTitle(`🎴 PLAYER PROFILE — ${target.username.toUpperCase()}`)
                .setThumbnail(target.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🏟️ Matches', value: `\`${stats.matches || 0}\``, inline: true },
                    { name: '⚽ Goals', value: `\`${stats.goals || 0}\``, inline: true },
                    { name: '🌟 MOTM Awards', value: `\`${stats.mvps || 0}\``, inline: true }
                )
                .setColor(UI.colors.primary)
                .setFooter({ text: 'FriendlyBot Pro Stats' });

            await safeReply(interaction, { embeds: [embed] });
        }

        if (interaction.commandName === 'profileimage') {
            const target = interaction.options.getUser('user') || interaction.user;
            const stats = storage.data.stats[target.id] || { matches: 0, goals: 0, mvps: 0 };
            try {
                const attachment = await createProfileAttachment(target, stats);
                await safeReply(interaction, { files: [attachment] });
            } catch (e) {
                console.error('Profile image error:', e);
                await safeReply(interaction, '❌ Failed to generate profile image.');
            }
        }

        if (interaction.commandName === 'giverole') {
            await safeReply(interaction, { content: `🖌️ **Feature Migration in Progress!**\nThe \`${interaction.commandName}\` feature is currently being updated to Next-Gen graphics. Check back shortly!`, ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'settings_select') {
            await interaction.deferUpdate().catch(() => { });
            const value = interaction.values[0];
            if (value === 'auto_friendly_settings') {
                await showAutoFriendlyPanel(interaction);
            } else {
                await safeReply(interaction, { content: "✅ Settings interaction acknowledged.", ephemeral: true });
            }
        }
    }

    if (interaction.isChannelSelectMenu()) {
        if (interaction.customId === 'auto_friendly_channel_select') {
            if (!interaction.member.permissions.has('Administrator')) return safeReply(interaction, { content: "❌ Admin Only", ephemeral: true });
            const channelId = interaction.values[0];
            const config = storage.data.config[interaction.guildId] || {};
            config.autoFriendlyChannel = channelId;
            storage.data.config[interaction.guildId] = config;
            storage.save('config');
            await interaction.deferUpdate();
            await showAutoFriendlyPanel(interaction);
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'toggle_auto_friendly') {
            if (!interaction.member.permissions.has('Administrator')) return safeReply(interaction, { content: "❌ Admin Only", ephemeral: true });
            const config = storage.data.config[interaction.guildId] || {};
            config.autoFriendlyEnabled = !config.autoFriendlyEnabled;
            storage.data.config[interaction.guildId] = config;
            storage.save('config');
            await interaction.deferUpdate();
            await showAutoFriendlyPanel(interaction);
        }
        if (interaction.customId === 'open_interval_modal') {
            if (!interaction.member.permissions.has('Administrator')) return safeReply(interaction, { content: "❌ Admin Only", ephemeral: true });
            const modal = new ModalBuilder()
                .setCustomId('auto_friendly_interval_modal')
                .setTitle('Auto Friendly Interval');
            const intervalInput = new TextInputBuilder()
                .setCustomId('interval_input')
                .setLabel("Interval in minutes (e.g. 40)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('40');
            modal.addComponents(new ActionRowBuilder().addComponents(intervalInput));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'auto_friendly_interval_modal') {
            const interval = parseInt(interaction.fields.getTextInputValue('interval_input'));
            if (isNaN(interval) || interval < 1) {
                return safeReply(interaction, { content: "❌ Please enter a valid number of minutes.", ephemeral: true });
            }
            const config = storage.data.config[interaction.guildId] || {};
            config.autoFriendlyInterval = interval;
            storage.data.config[interaction.guildId] = config;
            storage.save('config');
            await safeReply(interaction, { content: `✅ Auto Friendly interval set to **${interval}** minutes.`, ephemeral: true });
        }
    }

    if (interaction.isSelectMenu() && interaction.customId === 'formation_select_initial') {
        if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return interaction.reply({ content: "❌ No Permission.", ephemeral: true });
        const guildId = interaction.guildId;
        guildSelectedFormation.set(guildId, interaction.values[0]);
        guildLineups.set(guildId, new Map());
        await interaction.update(createLineupView(guildId));
        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'formation_select') {
        if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return interaction.reply({ content: "❌ No Permission to change formations.", flags: [MessageFlags.Ephemeral] });
        const guildId = interaction.guildId;
        guildSelectedFormation.set(guildId, interaction.values[0]);
        const map = new Map();
        guildLineups.set(guildId, map);
        await interaction.update(createLineupView(guildId));
        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'manager_formation_select') {
        const guildId = interaction.guildId;
        guildSelectedFormation.set(guildId, interaction.values[0]);
        const map = new Map();
        guildLineups.set(guildId, map);

        const editor = createManagerEditor(guildId, client);
        await interaction.update(editor);

        managerBoards.set(guildId, { channelId: interaction.channelId, messageId: interaction.message.id });
        return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('man_pick_')) {
        const posKey = interaction.customId.replace('man_pick_', '');
        const targetUser = interaction.values[0];
        const guildId = interaction.guildId;

        const lineup = getGuildLineup(guildId);
        lineup.set(posKey, [targetUser]);

        await interaction.update({ content: `✅ Assigned <@${targetUser}> to **${posKey}**`, components: [] });

        const boardInfo = managerBoards.get(guildId);
        if (boardInfo) {
            try {
                const channel = await client.channels.fetch(boardInfo.channelId);
                const msg = await channel.messages.fetch(boardInfo.messageId);
                if (msg) await msg.edit(createManagerEditor(guildId, client));
            } catch (e) { console.error("Could not update manager board live", e); }
        }
        return;
    }

    const lineupGuildId = interaction.guildId;
    const lineupBoard = getGuildLineup(lineupGuildId);

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('man_edit_')) {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return interaction.reply({ content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            const posKey = interaction.customId.replace('man_edit_', '');
            const row = new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`man_pick_${posKey}`)
                    .setPlaceholder(`Select player for ${posKey}...`)
            );
            await interaction.reply({ content: `👤 Pick a player for **${posKey}**`, components: [row], flags: [MessageFlags.Ephemeral] });
            return;
        }

        if (interaction.customId.startsWith('join_')) {
            await interaction.deferUpdate().catch(() => { });

            const pos = interaction.customId.replace('join_', '');
            const userId = interaction.user.id;
            let wasInCurrentPos = false;
            const currentQ = lineupBoard.get(pos) || [];
            if (currentQ.includes(userId)) wasInCurrentPos = true;

            for (const [p, players] of lineupBoard) {
                lineupBoard.set(p, players.filter(id => id !== userId));
            }

            if (!wasInCurrentPos) {
                if (!lineupBoard.get(pos)) lineupBoard.set(pos, []);
                lineupBoard.get(pos).push(userId);
            }
            await interaction.editReply(createLineupView(lineupGuildId));
            return;
        }

        if (interaction.customId === 'lineup_clear') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return interaction.reply({ content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            lineupBoard.clear();
            await interaction.update(createLineupView(lineupGuildId));
            return;
        }

        if (interaction.customId === 'lineup_done') {
            if (!roleStorage.isWhitelisted(interaction.guildId, interaction.member)) return interaction.reply({ content: "❌ No Permission", flags: [MessageFlags.Ephemeral] });
            await interaction.deferReply();
            const formKey = guildSelectedFormation.get(lineupGuildId) || 'default';
            const attachment = await createLineupAttachment(lineupBoard, formKey, FORMATIONS[formKey], client);
            const embed = UI.createEmbed(`⚽ Final Lineup — ${formKey}`, "Here is the visual representation of the starting lineup.");
            embed.setImage('attachment://lineup.png');
            await interaction.editReply({ embeds: [embed], files: [attachment] });
            return;
        }
    }

    if (interaction.customId && interaction.customId.startsWith('tz_select_')) {
        try {
            await interaction.deferUpdate();
            console.log(`[TZ] Handling selection for ${interaction.customId}`);

            const matchId = interaction.customId.replace('tz_select_', '');
            const matchData = pendingMatches.get(matchId);

            if (!matchData) {
                console.warn(`[TZ] Match data not found for ${matchId}`);
                return interaction.followUp({ content: "❌ Match session expired or bot restarted. Please try the command again.", flags: [MessageFlags.Ephemeral] });
            }

            const offset = parseFloat(interaction.values[0]);
            const baseTs = parseMatchTime(matchData.timeInput);

            if (!baseTs) {
                return interaction.followUp({ content: "❌ Could not parse your time input. Use `9 PM` or `4/23 9 PM`.", flags: [MessageFlags.Ephemeral] });
            }

            const finalTs = baseTs - (offset * 3600);
            const content = `⭐▬▬ 🏆 **LEAGUE MATCH** 🏆 ▬▬⭐\n🏟️ **${matchData.home}** vs **${matchData.away}**\n🔗 ${matchData.link}\n🕒 **Time**: <t:${finalTs}:F> (<t:${finalTs}:R>)\n🤝 Session\n⭐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⭐\n@everyone`;

            console.log(`[TZ] Attempting to send message to channel ${matchData.channelId}`);
            const channel = await client.channels.fetch(matchData.channelId).catch(e => {
                console.error("[TZ] Failed to fetch channel:", e);
                return null;
            });

            if (!channel) {
                return interaction.followUp({ content: "❌ Could not find the original channel. Please try again in a public channel.", flags: [MessageFlags.Ephemeral] });
            }

            const msg = await channel.send({ content, allowedMentions: { parse: ['everyone'] } });
            await msg.react('🟩').catch(() => { });
            await msg.react('🟥').catch(() => { });

            storage.data.active_polls[interaction.guildId] = msg.id;
            storage.save('active_polls');

            pendingMatches.delete(matchId);
            await interaction.editReply({ content: "✅ Match scheduled! I have posted it in the channel.", components: [] });
            console.log(`[TZ] Successfully completed match scheduling.`);

        } catch (err) {
            console.error("[TZ] Critical Error:", err);
            try {
                await interaction.followUp({ content: "❌ A system error occurred while processing your selection.", flags: [MessageFlags.Ephemeral] });
            } catch (e) { }
        }
        return;
    }
});

// Global Reaction Handler (Triggers Lineup)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    if (reaction.emoji.name === '🟩') {
        const guildId = reaction.message.guildId;
        const activePollId = storage.data.active_polls[guildId];

        if (reaction.message.id === activePollId) {
            const needed = 6;
            const count = reaction.count - (reaction.me ? 1 : 0);

            if (count >= needed) {
                const embed = UI.createEmbed(`${UI.icons.success} Friendly Ready!`, `We have **${count}** players! Starting lineup board...`, UI.colors.success);
                await reaction.message.channel.send({ embeds: [embed] });

                // Show interactive lineup board
                await reaction.message.channel.send(createLineupView(guildId));

                delete storage.data.active_polls[guildId];
                storage.save('active_polls');
            }
        }
    }
});

const TIMEZONE_MAP = {
    'EST': -5, 'EDT': -4, 'CST': -6, 'CDT': -5, 'MST': -7, 'MDT': -6,
    'PST': -8, 'PDT': -7, 'GMT': 0, 'UTC': 0, 'BST': 1, 'CET': 1,
    'CEST': 2, 'EET': 2, 'EEST': 3, 'MSK': 3, 'IST': 5.5, 'KST': 9, 'JST': 9
};

const pendingMatches = new Map();
const TIMEZONE_OPTIONS = [
    { label: 'UTC -11 (Midway)', value: '-11' },
    { label: 'UTC -10 (Hawaii)', value: '-10' },
    { label: 'UTC -9 (Alaska)', value: '-9' },
    { label: 'UTC -8 (Pacific Time)', value: '-8' },
    { label: 'UTC -7 (Mountain Time)', value: '-7' },
    { label: 'UTC -6 (Central Time)', value: '-6' },
    { label: 'UTC -5 (Eastern Time)', value: '-5' },
    { label: 'UTC -4 (Atlantic Time)', value: '-4' },
    { label: 'UTC -3 (Brazil/Argentina)', value: '-3' },
    { label: 'UTC -2 (Mid-Atlantic)', value: '-2' },
    { label: 'UTC -1 (Azores)', value: '-1' },
    { label: 'UTC +0 (GMT / London)', value: '0' },
    { label: 'UTC +1 (Central Europe)', value: '1' },
    { label: 'UTC +2 (Eastern Europe / Egypt)', value: '2' },
    { label: 'UTC +3 (Moscow / Saudi / Iraq / EEST)', value: '3' },
    { label: 'UTC +4 (Dubai / Baku)', value: '4' },
    { label: 'UTC +5 (Pakistan / Uzbekistan)', value: '5' },
    { label: 'UTC +5:30 (India / IST)', value: '5.5' },
    { label: 'UTC +6 (Bangladesh)', value: '6' },
    { label: 'UTC +7 (Thailand / Vietnam)', value: '7' },
    { label: 'UTC +8 (China / Singapore / Perth)', value: '8' },
    { label: 'UTC +9 (Japan / Korea)', value: '9' },
    { label: 'UTC +10 (Sydney / Guam)', value: '10' },
    { label: 'UTC +11 (Solomon Islands)', value: '11' },
    { label: 'UTC +12 (New Zealand / Fiji)', value: '12' }
];

function parseMatchTime(timeInput) {
    if (!timeInput) return null;
    const now = new Date();
    let targetDate = new Date();

    // Support formats like "9 PM", "4/23 9 PM", "4-23 9PM"
    const regex = /(?:(\d+)[/-](\d+)\s+)?(\d+)\s*(am|pm)/i;
    const match = timeInput.match(regex);
    if (match) {
        const month = match[1];
        const day = match[2];
        let hours = parseInt(match[3]);
        const ampm = match[4].toLowerCase();
        if (month && day) {
            targetDate.setMonth(parseInt(month) - 1);
            targetDate.setDate(parseInt(day));
        }
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        targetDate.setHours(hours, 0, 0, 0);
        return Math.floor(targetDate.getTime() / 1000);
    }
    return null;
}

// --- 4. LINEUP LOGIC ---
const FORMATIONS = {
    "default": [["GK", "GK"], ["CB", "CB"], ["LB", "LB"], ["RB", "RB"], ["CM", "CM"], ["RW", "RW"], ["LW", "LW"]],
    "3-1-2": [["GK", "GK"], ["CB", "CB"], ["LB", "LB"], ["RB", "RB"], ["CM", "CM"], ["ST1", "ST"], ["ST2", "ST"]],
    "3-0-3": [["GK", "GK"], ["CB", "CB"], ["LB", "LB"], ["RB", "RB"], ["LW", "LW"], ["ST", "ST"], ["RW", "RW"]],
    "3-2-1": [["GK", "GK"], ["CB", "CB"], ["LB", "LB"], ["RB", "RB"], ["CM1", "CM"], ["CM2", "CM"], ["ST", "ST"]],
    "2-3-1": [["GK", "GK"], ["CB1", "CB"], ["CB2", "CB"], ["LCM", "LCM"], ["CM", "CM"], ["RCM", "RCM"], ["ST", "ST"]],
    "2-2-2": [["GK", "GK"], ["CB1", "CB"], ["CB2", "CB"], ["CM1", "CM"], ["CM2", "CM"], ["ST1", "ST"], ["ST2", "ST"]],
    "4-1-1": [["GK", "GK"], ["LCB", "LCB"], ["RCB", "RCB"], ["LB", "LB"], ["RB", "RB"], ["CDM", "CDM"], ["ST", "ST"]],
    "3-3-0": [["GK", "GK"], ["CB", "CB"], ["LB", "LB"], ["RB", "RB"], ["LCM", "LCM"], ["CM", "CM"], ["RCM", "RCM"]],
    "2-1-3": [["GK", "GK"], ["CB1", "CB"], ["CB2", "CB"], ["CM", "CM"], ["LW", "LW"], ["ST", "ST"], ["RW", "RW"]],
    "1-4-1": [["GK", "GK"], ["CB", "CB"], ["LM", "LM"], ["LCM", "LCM"], ["RCM", "RCM"], ["RM", "RM"], ["ST", "ST"]],
    "4-2-0": [["GK", "GK"], ["LCB", "LCB"], ["RCB", "RCB"], ["LB", "LB"], ["RB", "RB"], ["LCM", "LCM"], ["RCM", "RCM"]],
    "3-1-3": [["GK", "GK"], ["CB", "CB"], ["LW", "LW"], ["ST", "ST"], ["RW", "RW"], ["ST1", "ST"], ["ST2", "ST"]],
    "5-0-1": [["GK", "GK"], ["LCB", "LCB"], ["CB", "CB"], ["RCB", "RCB"], ["LB", "LB"], ["RB", "RB"], ["ST", "ST"]],
    "3-1-1-1": [["GK", "GK"], ["CB", "CB"], ["LB", "LB"], ["RB", "RB"], ["CDM", "CDM"], ["CAM", "CAM"], ["ST", "ST"]],
    "2-2-1-1": [["GK", "GK"], ["CB1", "CB"], ["CB2", "CB"], ["LCM", "LCM"], ["RCM", "RCM"], ["CAM", "CAM"], ["ST", "ST"]],
    "4-1-2": [["GK", "GK"], ["LCB", "LCB"], ["RCB", "RCB"], ["CDM", "CDM"], ["LB", "LB"], ["RB", "RB"], ["ST", "ST"]],
    "2-3-2": [["GK", "GK"], ["CB1", "CB"], ["CB2", "CB"], ["CM", "CM"], ["CAM", "CAM"], ["ST1", "ST"], ["ST2", "ST"]]
};

const guildLineups = new Map();
const guildSelectedFormation = new Map();

function getGuildLineup(guildId) {
    if (!guildLineups.get(guildId)) guildLineups.set(guildId, new Map());
    return guildLineups.get(guildId);
}

function createLineupView(guildId) {
    const lineup = getGuildLineup(guildId);
    const formKey = guildSelectedFormation.get(guildId) || 'default';
    const formation = FORMATIONS[formKey];

    let text = "";
    for (const [posKey, posLabel] of formation) {
        const players = lineup.get(posKey) || [];
        if (players.length > 0) {
            text += `🟩 **${posLabel}** ➔ ` + players.map(p => `<@${p}>`).join(', ') + "\n\n";
        } else {
            text += `⬛ **${posLabel}** ➔ *Open*\n\n`;
        }
    }

    const embed = UI.createEmbed(`⚽ MATCH LINEUP — ${formKey}`, text, UI.colors.primary);
    embed.setFooter({ text: "Click a position below to join/leave! Use the dropdown to change formation." });

    const rows = [];

    // Formation Dropdown
    const formOptions = Object.keys(FORMATIONS).slice(0, 25).map(k => ({ label: k, value: k }));
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('formation_select')
            .setPlaceholder(`Current Formation: ${formKey} (Click to change)`)
            .addOptions(formOptions)
    ));

    // Position Buttons
    let currentRow = new ActionRowBuilder();
    let currentPosCount = 0;

    formation.forEach(([posKey, posLabel]) => {
        if (currentPosCount === 4) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            currentPosCount = 0;
        }
        const players = lineup.get(posKey) || [];
        const btnLabel = posLabel;

        const btn = new ButtonBuilder()
            .setCustomId(`join_${posKey}`)
            .setLabel(players.length > 0 ? `${btnLabel}: ✅` : btnLabel)
            .setStyle(players.length > 0 ? ButtonStyle.Secondary : ButtonStyle.Primary);

        if (players.length > 0) {
            btn.setEmoji("✅");
        }
        currentRow.addComponents(btn);
        currentPosCount++;
    });
    if (currentPosCount > 0) rows.push(currentRow);

    // Clear and Done Buttons
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lineup_done').setLabel('Show Final Image').setStyle(ButtonStyle.Success).setEmoji("🖼️"),
        new ButtonBuilder().setCustomId('lineup_clear').setLabel('Clear Board').setStyle(ButtonStyle.Danger)
    ));

    return { content: "@everyone\n**Lineup Session Active!**", embeds: [embed], components: rows, allowedMentions: { parse: ['everyone'] } };
}

// --- 5. MANAGER GUI LOGIC ---
const managerBoards = new Map();

function createManagerEditor(guildId, client) {
    const lineup = getGuildLineup(guildId);
    const formKey = guildSelectedFormation.get(guildId) || 'default';
    const formation = FORMATIONS[formKey];

    let text = "🛠️ **LINEUP GUI EDITOR**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n";
    for (const [posKey, posLabel] of formation) {
        const players = lineup.get(posKey) || [];
        const userStr = players.length > 0 ? `<@${players[0]}>` : "---";
        text += `📦 **${posLabel}**: ${userStr}\n`;
    }
    text += "▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*Click a box below to edit a position!*";

    const rows = [];
    let currentRow = new ActionRowBuilder();
    let currentPosCount = 0;

    formation.forEach(([posKey, posLabel]) => {
        if (currentPosCount === 4) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            currentPosCount = 0;
        }
        const players = lineup.get(posKey) || [];
        let valTitle = "---";
        if (players.length > 0 && client) {
            const tempUser = client.users.cache.get(players[0]);
            valTitle = tempUser ? tempUser.username : "Player";
        } else if (players.length > 0) { valTitle = "Player"; }

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`man_edit_${posKey}`)
                .setLabel(`${posLabel}: ${valTitle}`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🛠️")
        );
        currentPosCount++;
    });
    if (currentPosCount > 0) rows.push(currentRow);

    // Add a Done/Submit button at the bottom
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lineup_done').setLabel('Generate Final Image').setStyle(ButtonStyle.Success).setEmoji("🖼️")
    ));

    return { content: text, components: rows };
}

// --- 5. 24/7 HEARTBEAT & RECOVERY ---
const fetch = require('node-fetch');

/** Public Space URL for keep-alive pings (HF injects these at runtime). */
function getSpacePublicUrl() {
    const host = (process.env.SPACE_HOST || '').trim();
    if (host) return host.startsWith('http') ? host : `https://${host}`;
    const spaceId = (process.env.SPACE_ID || '').trim();
    if (spaceId) return `https://${spaceId.replace('/', '-').toLowerCase()}.hf.space`;
    const author = (process.env.SPACE_AUTHOR_NAME || '').trim();
    const repo = (process.env.SPACE_REPO_NAME || '').trim();
    if (author && repo) return `https://${author}-${repo}`.toLowerCase().replace(/\s+/g, '') + '.hf.space';
    return '';
}

setInterval(async () => {
    const url = getSpacePublicUrl();
    if (url) {
        fetch(url, { method: 'GET' }).catch(() => { });
    }

    // Recovery Check: If client is not ready or WS is dead
    if (client.isReady()) {
        if (client.ws.status !== 0) {
            console.log("[!] Gateway issues detected. Status:", client.ws.status);
            console.log("[*] Performing emergency network rotation and restart...");
            networkFix.rotateEndpoint();

            // Attempt to keep session alive or force a new login if really dead
            if (client.ws.status === 7 || client.ws.status === 9) { // DISCONNECTED or INVALID_SESSION
                process.exit(1); // Force a full container restart by PM2/HuggingFace
            }
        }
    }
}, 2 * 60 * 1000); // Every 2 minutes

async function showAutoFriendlyPanel(interaction) {
    const guildId = interaction.guildId;
    const config = storage.data.config[guildId] || {};
    const enabled = config.autoFriendlyEnabled || false;
    const interval = config.autoFriendlyInterval || 40;
    const channelId = config.autoFriendlyChannel;

    const embed = UI.createEmbed("🤖 Auto Friendly Settings",
        `Configure the bot to automatically start friendly polls.\n\n` +
        `**Status**: ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
        `**Interval**: \`${interval}\` minutes\n` +
        `**Target Channel**: ${channelId ? `<#${channelId}>` : '`Not Set`'}`,
        enabled ? UI.colors.success : UI.colors.primary
    );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('toggle_auto_friendly')
            .setLabel(enabled ? 'Disable Auto Friendly' : 'Enable Auto Friendly')
            .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('open_interval_modal')
            .setLabel('Set Interval')
            .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('auto_friendly_channel_select')
            .setPlaceholder('Select target channel...')
            .addChannelTypes(ChannelType.GuildText)
    );

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [row1, row2] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
    }
}

/**
 * Application Entry Point
 */
async function initialize() {
    let retryCount = 0;
    const maxRetryDelay = 60000; // Cap at 1 minute between retries

    // STEP 1: Start the web server FIRST.
    // HF will kill the container if port 7860 doesn't respond quickly.
    console.log("[*] Starting Web Dashboard...");
    server.startServer(client, commandsData);

    // STEP 2: Give the container's network stack a moment to settle.
    // On HF cold-starts, the outbound network may not be ready immediately.
    console.log("[*] Waiting 3s for network stack to stabilize...");
    await new Promise(r => setTimeout(r, 3000));

    // STEP 3: Start the Discord login loop.
    login();

    async function login() {
        if (!TOKEN || TOKEN.length < 10) {
            console.error("[CRITICAL] Discord Token is missing or malformed.");
            process.exit(1);
        }

        retryCount++;
        try {
            const currentApi = DISCORD_ENDPOINTS[currentEndpointIndex];
            console.log(`[*] Pre-validating token on ${currentApi}...`);
            client.rest.setAgent(ultimateFix.dispatcher);
            client.options.rest.api = currentApi;
            
            // Add a timeout to fetch to prevent hanging forever on a blocked IP
            const abort = new AbortController();
            const timeout = setTimeout(() => abort.abort(), 10000); // 10s timeout
            
            const testRes = await fetch(`${currentApi}/v10/users/@me`, {
                headers: { 
                    Authorization: `Bot ${TOKEN}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                },
                signal: abort.signal
            }).catch(() => null);
            clearTimeout(timeout);
            
            if (testRes && testRes.status === 401) {
                console.error("[CRITICAL] The provided BOT_TOKEN is INVALID (Discord returned 401). Please check your HF Secrets!");
                return;
            } else if (testRes && testRes.ok) {
                console.log(`[*] Token is VALID on ${currentApi}. Proceeding to WebSocket handshake...`);
            } else {
                const reason = testRes ? `HTTP ${testRes.status}` : "Connection Timeout";
                console.log(`[*] ${currentApi} skipped: ${reason}. Rotating endpoint...`);
                currentEndpointIndex = (currentEndpointIndex + 1) % DISCORD_ENDPOINTS.length;
                
                // If we've tried all endpoints, wait a bit before the next loop
                if (currentEndpointIndex === 0) {
                    const waitTime = 5000 + (Math.random() * 5000);
                    console.log(`[!] ALL endpoints blocked. Waiting ${Math.round(waitTime/1000)}s before next cycle...`);
                    await new Promise(r => setTimeout(r, waitTime));
                }
                throw new Error("Endpoint verification failed");
            }

            console.log(`[*] Attempting connection to Discord (Attempt ${retryCount}) using ${currentApi}...`);

            
            // Destroy any stale connection before retrying
            if (retryCount > 1) {
                try { client.destroy(); } catch (_) {}
                await new Promise(r => setTimeout(r, 1000));
            }

            await client.login(TOKEN);
            console.log('[*] Discord login() resolved successfully.');
            if (connectionTimeout) clearTimeout(connectionTimeout);
            retryCount = 0; // Reset on success

        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(`[ERROR] Discord login failed: ${msg}`);

            if (/intent|disallowed|4014|privileg/i.test(msg)) {
                console.error('[HINT] https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents: turn ON "Server Members Intent" and "Message Content Intent", then restart this Space.');
            }

            // Token errors are fatal — don't retry forever
            if (/token|unauthorized|authentication|403|401/i.test(msg) && retryCount >= 3) {
                console.error('[CRITICAL] Token appears invalid after 3 attempts. Stopping retries.');
                return;
            }

            const delay = Math.min(1000 * Math.pow(2, retryCount), maxRetryDelay);
            console.log(`[*] Retrying in ${delay / 1000}s... (attempt ${retryCount})`);
            setTimeout(login, delay);
        }
    }

    // --- 24/7 Heartbeat + Self-Healing ---
    // Runs every 5 minutes (not hourly!) for faster detection of problems.
    let disconnectedSince = null;

    setInterval(() => {
        const up = process.uptime();
        const h = Math.floor(up / 3600);
        const m = Math.floor(up / 60) % 60;
        const connected = client.isReady();

        console.log(`[24/7 HEARTBEAT] Uptime: ${h}h ${m}m | Discord: ${connected ? 'CONNECTED ✓' : 'DISCONNECTED ✗'}`);

        // Track how long we've been disconnected
        if (!connected) {
            if (!disconnectedSince) disconnectedSince = Date.now();
            const disconnectedMs = Date.now() - disconnectedSince;

            // If disconnected for over 10 minutes, force restart so HF rebuilds the container
            if (disconnectedMs > 10 * 60 * 1000) {
                console.error(`[!] Bot disconnected for ${Math.round(disconnectedMs / 60000)} minutes. Forcing process exit for container restart...`);
                process.exit(1);
            }
        } else {
            disconnectedSince = null;
        }

        // Ping own public URL to prevent HF from sleeping the Space
        const spaceHost = process.env.SPACE_HOST;
        if (spaceHost) {
            fetch(`https://${spaceHost}/healthz`).catch(() => {});
        }
        // Also ping localhost as fallback
        fetch(`http://0.0.0.0:${process.env.PORT || 7860}/healthz`).catch(() => {});
    }, 5 * 60 * 1000); // Every 5 minutes
}

initialize().catch(err => {
    console.error(">>> [BOOT] CRITICAL INITIALIZATION ERROR:", err);
    process.exit(1);
});

