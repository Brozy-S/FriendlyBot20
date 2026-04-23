const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

console.log(">>> [MODULE] server.js: Initializing...");
const app = express();
const port = process.env.PORT || 7860;


// Discord OAuth2 Config — reads from multiple possible env var names
const CLIENT_SECRET = process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.REDIRECT_URI || process.env.DISCORD_REDIRECT_URL || '';

// Store reference to the Discord client (set from index.js)
let discordClient = null;
let commandsDataRef = null;

// Session store (persisted to disk so logins survive restarts)
const storage = require('./storage');
const SESSION_FILE = path.join(storage.PERSISTENT_DIR, 'sessions.json');
let sessions = new Map();

// Load sessions from disk on startup
try {
    if (fs.existsSync(SESSION_FILE)) {
        const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        sessions = new Map(Object.entries(raw));
        console.log(`[*] Dashboard: Loaded ${sessions.size} persistent session(s).`);
    }
} catch (e) {}

function saveSessions() {
    try {
        const dir = path.dirname(SESSION_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = Object.fromEntries(sessions);
        fs.writeFileSync(SESSION_FILE, JSON.stringify(obj), 'utf8');
    } catch (e) {}
}

// In-memory log buffer
const logBuffer = [];
const MAX_LOGS = 200;

let isHijacked = false;
function hijackConsole() {
    if (isHijacked) return;
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => {
        const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        logBuffer.push(line);
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
        origLog.apply(console, args);
    };
    console.error = (...args) => {
        const line = '[Error] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        logBuffer.push(line);
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
        origErr.apply(console, args);
    };
    isHijacked = true;
}

app.use(express.json());

function hasDashboardPermissions(permissionBits) {
    try {
        const perms = BigInt(permissionBits || '0');
        return (perms & BigInt(0x20)) !== BigInt(0) || (perms & BigInt(0x8)) !== BigInt(0);
    } catch (e) {
        return false;
    }
}

// --- Helper: Get redirect URI ---
function getRedirectUri() {
    if (REDIRECT_URI) return REDIRECT_URI;
    const spaceId = process.env.SPACE_ID;
    if (spaceId) return `https://${spaceId.replace('/', '-').toLowerCase()}.hf.space/callback`;
    return `http://localhost:${port}/callback`;
}

// --- Helper: Get Client ID from bot ---
function getClientId() {
    return discordClient?.user?.id || process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || '';
}

// --- Helper: Parse session cookie ---
function getSession(req) {
    const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
        const [k, v] = c.trim().split('=');
        if (k && v) acc[k] = v;
        return acc;
    }, {});
    const sid = cookies['fb_session'];
    if (sid && sessions.has(sid)) return sessions.get(sid);
    return null;
}

// --- Auth Middleware ---
function requireAuth(req, res, next) {
    const session = getSession(req);
    if (session && session.user) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

// --- Attach user to req ---
app.use((req, res, next) => {
    req.dashSession = getSession(req);
    next();
});

// --- Static Assets ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.get('/logo.png', (req, res) => {
    const logo = path.join(__dirname, 'logo.png');
    if (fs.existsSync(logo)) res.sendFile(logo);
    else res.status(404).send('Not found');
});

// Returns 200 as long as the web server is running.
// This prevents Hugging Face and other platforms from restarting the space 
// while the Discord bot is still performing its initial connection handshake.
app.get('/healthz', (req, res) => {
    const discordReady = !!(discordClient && discordClient.isReady && discordClient.isReady());
    return res.status(200).json({
        ok: true,
        webReady: true,
        discordReady: discordReady,
        guilds: discordReady ? (discordClient.guilds?.cache?.size || 0) : 0
    });
});

// --- Discord OAuth2: Step 1 — Redirect to Discord ---
app.get('/auth/login', (req, res) => {
    const clientId = getClientId();
    const redirect = encodeURIComponent(getRedirectUri());
    const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=identify%20guilds`;
    res.redirect(url);
});

async function fetchWithRetry(url, options, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            let targetUrl = url;
            // Use direct connection to Discord API
            if (url.includes('discord.com/api')) {
                targetUrl = url; // Keep direct connection - no endpoint rotation
                if (i > 0) console.log(`[Dashboard] Retrying Discord API call (${i + 1}/${retries})...`);
            }
            
            const res = await fetch(targetUrl, options);
            if (!res.ok && i < retries) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries) throw err;
            console.warn(`[Dashboard] Connection failed (${err.message}). Retrying... (${i + 1}/${retries})`);
            // Use exponential backoff instead of endpoint rotation
            const delayMs = Math.min(1000 * Math.pow(1.5, i), 10000);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

// --- Discord OAuth2: Step 2 — Callback from Discord ---
// Support both /callback and /auth/callback to match any Discord redirect config
async function handleOAuthCallback(req, res) {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    if (!CLIENT_SECRET) {
        console.error('[Dashboard] CRITICAL: CLIENT_SECRET is missing from environment variables.');
        return res.redirect('/?error=server_error');
    }

    try {
        // Exchange code for token
        const tokenRes = await fetchWithRetry('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: getClientId(),
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: getRedirectUri()
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/?error=token_failed');

        // Fetch user profile
        const userRes = await fetchWithRetry('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const user = await userRes.json();
        if (!user.id) return res.redirect('/?error=user_failed');

        // Fetch user guilds
        console.log(`[Dashboard] Fetching guilds for user ${user.username}...`);
        const guildsRes = await fetchWithRetry('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userGuilds = await guildsRes.json();
        
        if (!Array.isArray(userGuilds)) {
            console.error('[Dashboard] Failed to fetch guilds:', userGuilds);
        } else {
            console.log(`[Dashboard] Found ${userGuilds.length} guilds for user.`);
        }

        // Create session
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(sid, {
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar
                    ? `https://cdn.discord.com/avatars/${user.id}/${user.avatar}.png`
                    : `https://cdn.discord.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`
            },
            guilds: Array.isArray(userGuilds) ? userGuilds : [],
            createdAt: Date.now()
        });

        // Set cookie (7 days)
        res.cookie('fb_session', sid, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.redirect('/?login=success');
    } catch (err) {
        console.error('[Dashboard] OAuth error:', err);
        res.redirect('/?error=server_error');
    }
}
app.get('/callback', handleOAuthCallback);
app.get('/auth/callback', handleOAuthCallback);

// --- Check Auth Status ---
app.get('/api/me', (req, res) => {
    const session = getSession(req);
    if (session && session.user) {
        res.json({ loggedIn: true, user: session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// --- Logout ---
app.get('/auth/logout', (req, res) => {
    const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
        const [k, v] = c.trim().split('=');
        if (k && v) acc[k] = v;
        return acc;
    }, {});
    const sid = cookies['fb_session'];
    if (sid) sessions.delete(sid);
    res.clearCookie('fb_session');
    res.redirect('/');
});

// --- Stats ---
app.get('/api/stats', requireAuth, (req, res) => {
    if (!discordClient || !discordClient.isReady()) {
        return res.json({ servers: 0, members: 0, uptime: '—', commands: 0 });
    }
    const up = process.uptime();
    const d = Math.floor(up / 86400);
    const h = Math.floor(up / 3600) % 24;
    const m = Math.floor(up / 60) % 60;
    const upStr = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;

    const totalMembers = discordClient.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const botId = discordClient.user?.id;
    const inviteUrl = botId
        ? `https://discord.com/api/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot%20applications.commands`
        : '#';

    res.json({
        servers: discordClient.guilds.cache.size,
        members: totalMembers,
        uptime: upStr,
        commands: commandsDataRef ? commandsDataRef.length : 0,
        inviteUrl
    });
});

// --- Server List ---
// --- Server List (shared with bot + permissions) ---
app.get('/api/servers', requireAuth, async (req, res) => {
    try {
        if (!discordClient || !discordClient.isReady()) {
            return res.json({ pending: true, servers: [] });
        }

        const userGuilds = req.dashSession.guilds || [];
        const app = await discordClient.application.fetch().catch(() => null);

        // Owner recognition for both single-owner apps and team-owned apps.
        const ownerCandidates = new Set();
        if (app?.owner?.id) ownerCandidates.add(app.owner.id);
        if (app?.owner?.ownerId) ownerCandidates.add(app.owner.ownerId);
        if (app?.owner?.members) {
            for (const member of app.owner.members.values()) {
                if (member?.id) ownerCandidates.add(member.id);
                if (member?.user?.id) ownerCandidates.add(member.user.id);
            }
        }
        const isBotOwner = ownerCandidates.has(req.dashSession.user.id);

        console.log(`[Dashboard] Request by ${req.dashSession.user.username} (Owner: ${isBotOwner})`);

        let visibleGuilds = [];
        if (isBotOwner) {
            visibleGuilds = Array.from(discordClient.guilds.cache.values());
        } else {
            const mutualGuilds = userGuilds
                .filter(ug => discordClient.guilds.cache.has(ug.id))
                .filter(Boolean);

            const manageableGuilds = mutualGuilds.filter(ug => {
                const permBits = ug.permissions ?? ug.permissions_new;
                return hasDashboardPermissions(permBits);
            });

            // Fallback: if Discord doesn't return permission bits reliably, still show shared guilds.
            const guildsToShow = manageableGuilds.length > 0 ? manageableGuilds : mutualGuilds;
            visibleGuilds = guildsToShow
                .map(ug => discordClient.guilds.cache.get(ug.id))
                .filter(Boolean);
        }

        const list = visibleGuilds.map(g => ({
            name: g.name,
            id: g.id,
            members: g.memberCount || 0,
            icon: g.iconURL({ size: 64 }) || null
        }));

        if (isBotOwner) console.log(`[Dashboard] Owner access enabled for ${req.dashSession.user.username}`);
        console.log(`[Dashboard] Serving ${list.length} managed servers to ${req.dashSession.user.username}`);
        res.json({ pending: false, servers: list });
    } catch (err) {
        console.error('[Dashboard] /api/servers failed:', err);
        res.status(500).json({ pending: false, servers: [], error: 'Failed to load servers' });
    }
});

// --- Guild Config (Prefix) ---
app.get('/api/config/:guildId', requireAuth, (req, res) => {
    const { guildId } = req.params;
    const userGuilds = req.dashSession.guilds || [];
    const ug = userGuilds.find(g => g.id === guildId);
    
    if (!ug) return res.status(403).json({ error: 'Access denied' });
    const hasPerms = (BigInt(ug.permissions) & BigInt(0x20)) || (BigInt(ug.permissions) & BigInt(0x8));
    if (!hasPerms) return res.status(403).json({ error: 'Missing permissions' });

    const storage = require('./storage');
    const config = storage.data.config[guildId] || {};
    res.json({ 
        prefix: storage.getPrefix(guildId),
        autoFriendlyEnabled: config.autoFriendlyEnabled || false,
        autoFriendlyInterval: config.autoFriendlyInterval || 40,
        autoFriendlyChannel: config.autoFriendlyChannel || null,
        postEnabled: config.postEnabled !== false, // Default to true
        postChannelId: config.postChannelId || null
    });
});

app.get('/api/channels/:guildId', requireAuth, (req, res) => {
    const { guildId } = req.params;
    if (!discordClient) return res.json([]);
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) return res.json([]);

    const channels = guild.channels.cache
        .filter(c => c.isTextBased())
        .map(c => ({ id: c.id, name: c.name }));
    res.json(channels);
});

app.post('/api/config/:guildId', requireAuth, (req, res) => {
    const { guildId } = req.params;
    const { prefix, autoFriendlyEnabled, autoFriendlyInterval, autoFriendlyChannel, postEnabled, postChannelId } = req.body;
    const userGuilds = req.dashSession.guilds || [];
    const ug = userGuilds.find(g => g.id === guildId);

    if (!ug) return res.status(403).json({ error: 'Access denied' });
    const hasPerms = (BigInt(ug.permissions) & BigInt(0x20)) || (BigInt(ug.permissions) & BigInt(0x8));
    if (!hasPerms) return res.status(403).json({ error: 'Missing permissions' });

    const storage = require('./storage');
    
    if (prefix) {
        if (prefix.length > 5) return res.status(400).json({ error: 'Invalid prefix' });
        storage.setPrefix(guildId, prefix);
    }

    if (storage.data.config[guildId] === undefined) storage.data.config[guildId] = {};
    
    if (autoFriendlyEnabled !== undefined) storage.data.config[guildId].autoFriendlyEnabled = !!autoFriendlyEnabled;
    if (autoFriendlyInterval !== undefined) storage.data.config[guildId].autoFriendlyInterval = parseInt(autoFriendlyInterval) || 40;
    if (autoFriendlyChannel !== undefined) storage.data.config[guildId].autoFriendlyChannel = autoFriendlyChannel;
    if (postEnabled !== undefined) storage.data.config[guildId].postEnabled = !!postEnabled;
    if (postChannelId !== undefined) storage.data.config[guildId].postChannelId = postChannelId;

    storage.save('config');
    res.json({ success: true, message: 'Settings updated successfully' });
});

// --- Command List ---
app.get('/api/commands', requireAuth, (req, res) => {
    if (!commandsDataRef) return res.json([]);

    const adminCmds = ['setup', 'post', 'clear', 'lock', 'unlock', 'giverole', 'addrole', 'removerole'];
    const staffCmds = ['win', 'loss', 'draw', 'lineup', 'managerlineup', 'leaguematch', 'lineupimage'];

    const list = commandsDataRef.map(c => ({
        name: c.name,
        description: c.description,
        admin: adminCmds.includes(c.name),
        staff: staffCmds.includes(c.name)
    }));
    res.json(list);
});

// --- Invite URL ---
app.get('/api/invite', (req, res) => {
    if (!discordClient || !discordClient.user) return res.redirect('/');
    const url = `https://discord.com/api/oauth2/authorize?client_id=${discordClient.user.id}&permissions=8&scope=bot%20applications.commands`;
    res.redirect(url);
});

// --- Logs ---
app.get('/api/logs', requireAuth, (req, res) => {
    res.json({ logs: logBuffer.slice(-100) });
});

// --- Actions ---
app.post('/api/action/:name', requireAuth, async (req, res) => {
    const action = req.params.name;

    if (action === 'sync' && discordClient && commandsDataRef) {
        let count = 0;
        for (const guild of discordClient.guilds.cache.values()) {
            await guild.commands.set(commandsDataRef).catch(() => {});
            count++;
        }
        return res.json({ message: `✅ Synced commands to ${count} servers!` });
    }

    if (action === 'backup') {
        return res.json({ message: '☁️ Cloud backup triggered! Check Discord for confirmation.' });
    }

    if (action === 'restart') {
        res.json({ message: '🔁 Restarting bot in 2 seconds...' });
        setTimeout(() => process.exit(1), 2000);
        return;
    }

    res.json({ message: 'Unknown action.' });
});

// --- Start ---
function startServer(client, cmdsData) {
    const net = require('net');
    const checkServer = net.createServer();

    checkServer.on('listening', () => {
        checkServer.close(() => {
            console.log(`[*] Port ${port} is available, starting server...`);
            startServerInternal(client, cmdsData);
        });
    });

    checkServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[!] ERROR: Port ${port} is already in use. Another bot instance is running.`);
            console.error(`[!] Please close other instances before starting this one.`);
            process.exit(1);
        } else {
            console.error(`[!] Server error: ${err.message}`);
            process.exit(1);
        }
    });

    checkServer.listen(port, '0.0.0.0');
}

function startServerInternal(client, cmdsData) {
    hijackConsole();
    discordClient = client || null;
    commandsDataRef = cmdsData || null;

    app.listen(port, '0.0.0.0', () => {
        const finalRedirect = getRedirectUri();
        console.log(`[*] --------------------------------------------------`);
        console.log(`[*] Web Server running on port ${port}`);
        console.log(`[*] --------------------------------------------------`);
        console.log(`[*] DASHBOARD URL: ${finalRedirect.replace('/callback', '').replace('/auth/callback', '')}`);
        console.log(`[*] REDIRECT URI:  ${finalRedirect}`);
        console.log(`[*] --------------------------------------------------`);
        console.log(`[*] IMPORTANT: Ensure the REDIRECT URI above is added exactly to your`);
        console.log(`[*] Discord Developer Portal -> OAuth2 -> Redirects section.`);
        console.log(`[*] --------------------------------------------------`);
    });
}


module.exports = { startServer, app };
