const fs = require('fs');
const path = require('path');

console.log(">>> [MODULE] storage.js: Initializing...");

// --- File Paths ---
// --- Persistence Configuration (Hugging Face Buckets) ---
// The bucket should be mounted at /home/node/app/data (as seen in Space settings)
const PERSISTENT_DIR = path.isAbsolute(process.env.DATA_PATH || "") 
    ? process.env.DATA_PATH 
    : path.join(__dirname, 'data');

console.log(`[STORAGE] Using persistent directory: ${PERSISTENT_DIR}`);

if (!fs.existsSync(PERSISTENT_DIR)) {
    console.log(`[STORAGE] Creating persistent directory...`);
    fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
}

const GUILD_SETTINGS_FILE = path.join(PERSISTENT_DIR, "guild_settings.json");
const CONFIG_FILE = path.join(PERSISTENT_DIR, "lineup_access.json");
const PLAYER_STATS_FILE = path.join(PERSISTENT_DIR, "player_stats.json");
const STATE_FILE = path.join(PERSISTENT_DIR, "state.json");

function loadJson(path, defaultValue = {}) {
    if (fs.existsSync(path)) {
        try {
            const data = fs.readFileSync(path, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.warn(`[STORAGE] Failed to load ${path}:`, e.message);
        }
    }
    return defaultValue;
}

function saveJson(path, data) {
    try {
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`[STORAGE] Failed to save ${path}:`, e.message);
    }
}

class StorageManager {
    constructor() {
        this.data = {
            config: {},           // Guild settings
            roles: {},            // Lineup roles
            stats: {},            // Player stats
            active_polls: {},     // Active poll messages
            processed_messages: new Set(), // Processed message IDs
            settings: {}          // Global bot settings
        };
        this.loadAll();
    }

    loadAll() {
        // Load Guild Settings
        const guildSettings = loadJson(GUILD_SETTINGS_FILE, {});
        this.data.config = Object.fromEntries(
            Object.entries(guildSettings).map(([k, v]) => [parseInt(k), v])
        );

        // Load Roles
        const roles = loadJson(CONFIG_FILE, {});
        this.data.roles = Object.fromEntries(
            Object.entries(roles).map(([k, v]) => [parseInt(k), new Set(v)])
        );

        // Load Stats
        const stats = loadJson(PLAYER_STATS_FILE, {});
        this.data.stats = Object.fromEntries(
            Object.entries(stats).map(([k, v]) => [parseInt(k), v])
        );

        // Load State
        const state = loadJson(STATE_FILE, {});
        this.data.active_polls = Object.fromEntries(
            Object.entries(state.polls || {}).map(([k, v]) => [parseInt(k), v])
        );
        this.data.processed_messages = new Set(state.processed || []);

        console.log('[STORAGE] Data loaded successfully');
    }

    save(type) {
        switch (type) {
            case 'config':
                saveJson(GUILD_SETTINGS_FILE, this.data.config);
                break;
            case 'roles':
                saveJson(CONFIG_FILE, Object.fromEntries(
                    Object.entries(this.data.roles).map(([k, v]) => [k, Array.from(v)])
                ));
                break;
            case 'stats':
                saveJson(PLAYER_STATS_FILE, this.data.stats);
                break;
            case 'active_polls':
                this.saveState();
                break;
            default:
                console.warn(`[STORAGE] Unknown save type: ${type}`);
        }
    }

    saveState() {
        saveJson(STATE_FILE, {
            polls: this.data.active_polls,
            processed: Array.from(this.data.processed_messages)
        });
    }

    saveAll() {
        this.save('config');
        this.save('roles');
        this.save('stats');
        this.saveState();
    }

    getPrefix(guildId) {
        return this.data.config[guildId]?.prefix || '!';
    }

    setPrefix(guildId, prefix) {
        if (!this.data.config[guildId]) this.data.config[guildId] = {};
        this.data.config[guildId].prefix = prefix;
        this.save('config');
    }

    getRecord(guildId) {
        if (!this.data.config[guildId]) this.data.config[guildId] = {};
        if (!this.data.config[guildId].record) {
            this.data.config[guildId].record = { wins: 0, losses: 0, draws: 0 };
        }
        return this.data.config[guildId].record;
    }

    addStat(userId, statType, amount = 1) {
        const userIdNum = parseInt(userId);
        if (!this.data.stats[userIdNum]) {
            this.data.stats[userIdNum] = {
                matches: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                goals: 0,
                assists: 0,
                mvps: 0
            };
        }
        this.data.stats[userIdNum][statType] = (this.data.stats[userIdNum][statType] || 0) + amount;
        this.save('stats');
    }
}

const storage = new StorageManager();

storage.PERSISTENT_DIR = PERSISTENT_DIR;
module.exports = storage;