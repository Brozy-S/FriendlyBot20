/**
 * profileRenderer.js - Visual Profile Card Generator
 * Uses @napi-rs/canvas to render a professional FIFA-style player card
 */
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const https = require('https');
const http = require('http');

/**
 * Download an image from a URL and return as a Buffer
 */
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { timeout: 5000 }, (res) => {
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
 * Create a Discord AttachmentBuilder from the rendered profile
 */
async function createProfileAttachment(user, stats) {
    const W = 600;
    const H = 350;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 1. Background Gradient
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0a0a1a');
    grad.addColorStop(1, '#1a1a3a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 2. Abstract Shapes (Decorations)
    ctx.fillStyle = 'rgba(88, 101, 242, 0.05)';
    ctx.beginPath();
    ctx.arc(W, 0, 200, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(0, H, 150, 0, Math.PI * 2);
    ctx.fill();

    // 3. Draw Card Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    // 4. Draw User Avatar
    const avatarSize = 140;
    const avatarX = 50;
    const avatarY = (H - avatarSize) / 2;

    try {
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
        const imgBuf = await downloadImage(avatarUrl);
        const img = await loadImage(imgBuf);

        // Circular clip
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
        ctx.restore();

        // Glow ring
        ctx.strokeStyle = '#5865F2';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 4, 0, Math.PI * 2);
        ctx.stroke();
    } catch (e) {
        ctx.fillStyle = '#5865F2';
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.fill();
    }

    // 5. Draw Username
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(user.username.toUpperCase(), 220, 80);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '16px Arial, sans-serif';
    ctx.fillText('PRO PLAYER', 220, 105);

    // 6. Draw Stats Grid
    const statsData = [
        { label: 'MATCHES', value: stats.matches || 0, icon: '🏟️' },
        { label: 'GOALS', value: stats.goals || 0, icon: '⚽' },
        { label: 'MVPs', value: stats.mvps || 0, icon: '⭐' }
    ];

    let statX = 220;
    let statY = 160;

    statsData.forEach((s, i) => {
        // Stat Box
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        const boxW = 110;
        const boxH = 90;
        const currX = statX + (i * (boxW + 15));
        
        // Draw rounded box (simple version)
        ctx.fillRect(currX, statY, boxW, boxH);
        
        // Value
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.value, currX + boxW/2, statY + 45);
        
        // Label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.fillText(s.label, currX + boxW/2, statY + 75);
    });

    // 7. Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.font = '12px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('FRIENDLYBOT NEXT-GEN GRAPHICS', W - 40, H - 40);

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'profile.png' });
}

module.exports = { createProfileAttachment };
