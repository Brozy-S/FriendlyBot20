const dns = require('dns');

/**
 * Connection Patience Fix.
 * Increases the timeout to 120 seconds to prevent the "Connect Timeout Error".
 */
function applyAdvancedFixes() {
    console.log(`[NETWORK] Increasing connection patience to 120s...`);
    
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }

    try {
        const { setGlobalDispatcher, Agent } = require('undici');
        const agent = new Agent({
            connect: { 
                timeout: 120000, // 2 minutes!
                family: 4
            }
        });
        setGlobalDispatcher(agent);
        this._dispatcher = agent;
    } catch (e) {}
}

function getDispatcher() { return this._dispatcher; }
function rotateEndpoint() {}
function getTargetDomain() { return 'discord.com'; }

module.exports = { applyAdvancedFixes, rotateEndpoint, getTargetDomain, getDispatcher };
