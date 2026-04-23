/**
 * lineupRenderer.js - Football Pitch Lineup Image Generator
 * Uses @napi-rs/canvas to render a professional football pitch
 * with player Discord avatars and position labels.
 */
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const https = require('https');
const http = require('http');

// Position coordinates on a 900x600 pitch for each formation
// Coordinates are [x, y] as percentage of canvas width/height
const POSITION_COORDS = {
    // Goalkeeper
    'GK':  [50, 90],
    // Defenders
    'CB':  [50, 72], 'CB1': [38, 72], 'CB2': [62, 72],
    'LCB': [35, 72], 'RCB': [65, 72],
    'LB':  [15, 65], 'RB':  [85, 65],
    // Midfielders
    'CM':  [50, 50], 'CM1': [35, 50], 'CM2': [65, 50],
    'LCM': [30, 50], 'RCM': [70, 50],
    'CDM': [50, 58], 'CAM': [50, 38],
    'LM':  [15, 50], 'RM':  [85, 50],
    // Forwards
    'LW':  [18, 30], 'RW':  [82, 30],
    'ST':  [50, 20], 'ST1': [38, 20], 'ST2': [62, 20],
};

/**
 * Download an image from a URL and return as a Buffer
 */
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { timeout: 5000 }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadImage(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Draw a rounded rectangle
 */
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Draw the football pitch background
 */
function drawPitch(ctx, W, H) {
    // Main grass gradient
    const grassGrad = ctx.createLinearGradient(0, 0, 0, H);
    grassGrad.addColorStop(0, '#1a7a3a');
    grassGrad.addColorStop(0.5, '#1e8c42');
    grassGrad.addColorStop(1, '#1a7a3a');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, 0, W, H);

    // Grass stripe pattern
    const stripeCount = 12;
    const stripeH = H / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(0, i * stripeH, W, stripeH);
        }
    }

    // Pitch outline
    const pad = 30;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

    // Center line
    ctx.beginPath();
    ctx.moveTo(pad, H / 2);
    ctx.lineTo(W - pad, H / 2);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 60, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    // Top penalty box (attacking end)
    const boxW = 220;
    const boxH = 80;
    ctx.strokeRect((W - boxW) / 2, pad, boxW, boxH);

    // Top small box
    const sBoxW = 120;
    const sBoxH = 35;
    ctx.strokeRect((W - sBoxW) / 2, pad, sBoxW, sBoxH);

    // Top penalty arc
    ctx.beginPath();
    ctx.arc(W / 2, pad + boxH, 35, 0, Math.PI);
    ctx.stroke();

    // Bottom penalty box (GK end)
    ctx.strokeRect((W - boxW) / 2, H - pad - boxH, boxW, boxH);

    // Bottom small box
    ctx.strokeRect((W - sBoxW) / 2, H - pad - sBoxH, sBoxW, sBoxH);

    // Bottom penalty arc
    ctx.beginPath();
    ctx.arc(W / 2, H - pad - boxH, 35, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Corner arcs
    const corners = [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]];
    const cornerAngles = [[0, Math.PI / 2], [Math.PI / 2, Math.PI], [3 * Math.PI / 2, 2 * Math.PI], [Math.PI, 3 * Math.PI / 2]];
    corners.forEach(([cx, cy], i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 12, cornerAngles[i][0], cornerAngles[i][1]);
        ctx.stroke();
    });
}

/**
 * Render the lineup as a PNG image buffer
 * @param {Map} lineup - Map of posKey -> [userId, ...]
 * @param {string} formKey - Formation key (e.g. "3-1-2")
 * @param {Array} formation - Array of [posKey, posLabel]
 * @param {object} client - Discord client for fetching user data
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function renderLineupImage(lineup, formKey, formation, client) {
    const PITCH_W = 900;
    const SIDEBAR_W = 280;
    const W = PITCH_W + SIDEBAR_W;
    const H = 620;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 1. Draw the sidebar background
    ctx.fillStyle = '#2B2D31'; // Discord dark gray
    ctx.fillRect(0, 0, SIDEBAR_W, H);
    
    // Draw sidebar header
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SUBSTITUTES', SIDEBAR_W / 2, 30);
    
    ctx.strokeStyle = '#5865F2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 45);
    ctx.lineTo(SIDEBAR_W - 20, 45);
    ctx.stroke();

    // 2. Draw the pitch on the right
    ctx.save();
    ctx.translate(SIDEBAR_W, 0);
    drawPitch(ctx, PITCH_W, H);
    ctx.restore();

    // 3. Draw title bar over the pitch
    ctx.save();
    ctx.translate(SIDEBAR_W, 0);
    const titleGrad = ctx.createLinearGradient(0, 0, PITCH_W, 0);
    titleGrad.addColorStop(0, 'rgba(0,0,0,0.7)');
    titleGrad.addColorStop(0.5, 'rgba(0,0,0,0.85)');
    titleGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = titleGrad;
    ctx.fillRect(0, 0, PITCH_W, 36);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`LINEUP — ${formKey.toUpperCase()}`, PITCH_W / 2, 24);
    ctx.restore();

    // Extract subs and draw them
    const subs = [];
    for (const [posKey, posLabel] of formation) {
        const players = lineup.get(posKey) || [];
        if (players.length > 1) {
            for (let i = 1; i < players.length; i++) {
                subs.push({ userId: players[i], posLabel });
            }
        }
    }

    // Draw subs list
    let subY = 70;
    for (const sub of subs) {
        if (subY > H - 50) break; // prevent overflowing
        
        // Avatar
        const avatarSize = 32;
        const avatarRadius = avatarSize / 2;
        const x = 20;
        const y = subY;
        
        ctx.save();
        if (client) {
            try {
                const user = await client.users.fetch(sub.userId);
                const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 64 });
                const imgBuf = await downloadImage(avatarUrl);
                const img = await loadImage(imgBuf);

                ctx.beginPath();
                ctx.arc(x + avatarRadius, y + avatarRadius, avatarRadius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(img, x, y, avatarSize, avatarSize);
            } catch (e) {
                ctx.beginPath();
                ctx.arc(x + avatarRadius, y + avatarRadius, avatarRadius, 0, Math.PI * 2);
                ctx.fillStyle = '#5865F2';
                ctx.fill();
            }
        }
        ctx.restore();

        // Border ring
        ctx.beginPath();
        ctx.arc(x + avatarRadius, y + avatarRadius, avatarRadius + 1, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Username
        let displayName = "Player";
        if (client) {
            try {
                const user = await client.users.fetch(sub.userId);
                displayName = user.globalName || user.username;
            } catch(e) {}
        }
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        const truncated = displayName.length > 13 ? displayName.slice(0, 12) + '…' : displayName;
        ctx.fillText(truncated, x + avatarSize + 12, y + avatarRadius);

        // Position pill
        ctx.font = 'bold 11px Arial, sans-serif';
        const posTextW = ctx.measureText(sub.posLabel).width + 10;
        const pillX = SIDEBAR_W - 15 - posTextW;
        
        roundRect(ctx, pillX, y + avatarRadius - 8, posTextW, 16, 4);
        ctx.fillStyle = 'rgba(88,101,242,0.9)';
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(sub.posLabel, pillX + posTextW / 2, y + avatarRadius);

        subY += 45; // Space for next sub
    }
    if (subs.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = 'italic 14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No substitutes yet', SIDEBAR_W / 2, subY + 20);
    }

    // 4. Draw players at their positions
    const avatarSize = 48;
    const avatarRadius = avatarSize / 2;

    for (const [posKey, posLabel] of formation) {
        const coords = POSITION_COORDS[posKey];
        if (!coords) continue;

        // Shift X by SIDEBAR_W
        const x = SIDEBAR_W + (coords[0] / 100) * PITCH_W;
        const y = (coords[1] / 100) * H;
        const players = lineup.get(posKey) || [];

        // Draw position marker (glow ring)
        if (players.length > 0) {
            // Filled slot glow
            ctx.save();
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(x, y, avatarRadius + 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,255,136,0.3)';
            ctx.fill();
            ctx.restore();
        }

        // Draw avatar or empty slot
        if (players.length > 0 && client) {
            const userId = players[0];
            try {
                const user = await client.users.fetch(userId);
                const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                const imgBuf = await downloadImage(avatarUrl);
                const img = await loadImage(imgBuf);

                // Clip circle for avatar
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, avatarRadius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(img, x - avatarRadius, y - avatarRadius, avatarSize, avatarSize);
                ctx.restore();

                // Border ring
                ctx.beginPath();
                ctx.arc(x, y, avatarRadius + 2, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.5;
                ctx.stroke();

            } catch (e) {
                // Fallback: draw a filled circle with initials
                ctx.beginPath();
                ctx.arc(x, y, avatarRadius, 0, Math.PI * 2);
                ctx.fillStyle = '#5865F2';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 16px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('?', x, y);
            }

            // Username label below avatar
            try {
                const user = await client.users.fetch(players[0]);
                const displayName = user.globalName || user.username;
                const truncated = displayName.length > 10 ? displayName.slice(0, 9) + '…' : displayName;

                // Label background pill
                const labelY = y + avatarRadius + 14;
                ctx.font = 'bold 11px Arial, sans-serif';
                ctx.textAlign = 'center';
                const textWidth = ctx.measureText(truncated).width;
                const pillW = textWidth + 12;
                const pillH = 16;

                roundRect(ctx, x - pillW / 2, labelY - pillH / 2, pillW, pillH, 4);
                ctx.fillStyle = 'rgba(0,0,0,0.75)';
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.textBaseline = 'middle';
                ctx.fillText(truncated, x, labelY);
            } catch (e) {}

        } else {
            // Empty slot: dashed circle
            ctx.beginPath();
            ctx.arc(x, y, avatarRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fill();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Position label (always shown)
        const posLabelY = players.length > 0 ? y - avatarRadius - 10 : y - avatarRadius - 8;
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Position tag background
        const posTextW = ctx.measureText(posLabel).width + 10;
        roundRect(ctx, x - posTextW / 2, posLabelY - 8, posTextW, 16, 3);
        ctx.fillStyle = players.length > 0 ? 'rgba(88,101,242,0.9)' : 'rgba(100,100,100,0.8)';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(posLabel, x, posLabelY);
    }

    // 4. Footer watermark
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, H - 22, W, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Generated by FriendlyBot', W / 2, H - 11);

    // Convert to PNG buffer
    const buffer = canvas.toBuffer('image/png');
    return buffer;
}

/**
 * Create a Discord AttachmentBuilder from the rendered lineup
 */
async function createLineupAttachment(lineup, formKey, formation, client) {
    const buffer = await renderLineupImage(lineup, formKey, formation, client);
    return new AttachmentBuilder(buffer, { name: 'lineup.png' });
}

module.exports = { renderLineupImage, createLineupAttachment };
