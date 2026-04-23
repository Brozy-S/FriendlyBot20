const fs = require('fs');
const path = require('path');

console.log(">>> [MODULE] roleStorage.js: Initializing...");

const storage = require('./storage');

class RoleManager {
    constructor() {
        this.file = path.join(storage.PERSISTENT_DIR, 'roles.json');
        this.roles = {};
        this.load();
    }

    load() {
        if (fs.existsSync(this.file)) {
            try {
                this.roles = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            } catch (e) {
                this.roles = {};
            }
        }
    }

    save() {
        // Ensure data directory exists
        const dir = path.dirname(this.file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        fs.writeFileSync(this.file, JSON.stringify(this.roles, null, 2));
    }

    addRole(guildId, roleId) {
        if (!this.roles[guildId]) this.roles[guildId] = [];
        if (!this.roles[guildId].includes(roleId)) {
            this.roles[guildId].push(roleId);
            this.save();
        }
    }

    removeRole(guildId, roleId) {
        if (!this.roles[guildId]) return;
        this.roles[guildId] = this.roles[guildId].filter(id => id !== roleId);
        this.save();
    }

    isWhitelisted(guildId, member) {
        if (!member || !member.permissions) return false;
        if (member.permissions.has('Administrator')) return true;
        const allowedRoles = this.roles[guildId] || [];
        // No roles whitelisted yet: allow everyone until an admin uses /addrole (then list restricts access).
        if (allowedRoles.length === 0) return true;
        return member.roles.cache.some(r => allowedRoles.includes(r.id));
    }
}

module.exports = new RoleManager();
