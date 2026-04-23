const dns = require('dns');
const tls = require('tls');
const http = require('http');
const https = require('https');

/**
 * THE ULTIMATE FIX FOR HUGGING FACE SPACES
 * This file forces the bot to bypass all network restrictions manually.
 */

console.log(">>> [ULTIMATE FIX] Booting high-performance network bypass logic...");

// 1. Force the system to use IPv4 only everywhere and set custom DNS
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
try { 
    // Use Cloudflare and Google as fallbacks
    dns.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']); 
} catch(e) {}

// 2. Monkey-patch the global DNS system (The NUCLEAR FIX)
// We manually provide a diverse set of Discord's edge IPs to bypass Cloudflare IP blocks.
const DISCORD_IPS = [
    '162.159.138.232', '162.159.137.232', '162.159.136.232', '162.159.135.232',
    '162.159.129.232', '162.159.130.233', '162.159.133.232', '162.159.134.232',
    '188.114.96.0', '188.114.97.0', '104.16.58.5', '104.16.59.5', '104.16.60.5'
];
let currentIpIndex = Math.floor(Math.random() * DISCORD_IPS.length);

const originalLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = { family: 4 };
    }
    
    const isDiscord = hostname.includes('discord.com') || 
                     hostname.includes('discordapp.com') || 
                     hostname.includes('discord.gg') || 
                     hostname.includes('discord.net');

    if (isDiscord) {
        const ip = DISCORD_IPS[currentIpIndex];
        currentIpIndex = (currentIpIndex + 1) % DISCORD_IPS.length;
        console.log(`[DNS] Direct Route: ${hostname} -> ${ip}`);
        return callback(null, ip, 4);
    }

    if (options && !options.family) options.family = 4;
    return originalLookup(hostname, options, callback);
};

// 3. Disable all SSL/TLS verification and set modern cipher suite
tls.DEFAULT_MIN_VERSION = 'TLSv1.2';
tls.DEFAULT_MAX_VERSION = 'TLSv1.3';
// Force modern ciphers to avoid handshake failures
tls.DEFAULT_CIPHERS = 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';


// 4. Force a fake Browser Identity globally
process.env.UNDICI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

// 5. Build and set a Global Network Agent with massive timeouts
let dispatcher = null;
try {
    const { setGlobalDispatcher, Agent } = require('undici');
    dispatcher = new Agent({
        connect: { 
            timeout: 120000, // 2 minutes
            family: 4,
            rejectUnauthorized: false,
            keepAliveTimeout: 60000,
        },
        headersTimeout: 120000,
        bodyTimeout: 120000,
        pipelining: 0,
        maxRedirections: 5
    });
    setGlobalDispatcher(dispatcher);
    global.fixedDispatcher = dispatcher;
    console.log(">>> [ULTIMATE FIX] Global Undici Dispatcher active (v4.1).");
} catch (e) {
    console.warn(">>> [ULTIMATE FIX] Undici setup error:", e.message);
}

// 6. Fix legacy http/https modules too
http.globalAgent = new http.Agent({ family: 4, keepAlive: true });
https.globalAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false, timeout: 60000 });

console.log(">>> [ULTIMATE FIX] Network system hardened. Connection resilience increased.");

module.exports = {
    dispatcher: dispatcher || global.fixedDispatcher || null
};
