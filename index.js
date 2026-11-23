const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const BOT_NAME = "Status Clear By Danial";
const MAX_QUEUE_SIZE = 25;

// Nombor Pentadbir Utama (Danial Full Access)
const ADMIN_NUMBER = (process.env.ADMIN_NUMBER || '60194066718').replace(/\D/g, '');
const ADMIN_IDENTIFIERS = [
    ADMIN_NUMBER,
    '60194066718',
    '0194066718',
    '194066718',
    '68225740046362'
];

const TEMP_DIR = path.join(__dirname, 'temp');
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
const ASSETS_DIR = path.join(__dirname, 'assets');
const QR_PAYMENT_PATH = path.join(ASSETS_DIR, 'qr-payment.jpg');
const GITKEEP_PATH = path.join(ASSETS_DIR, '.gitkeep');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PERSISTENT_USERS_FILE = path.join(AUTH_DIR, 'users.json');
const LEGACY_MEMBERS_FILE = path.join(AUTH_DIR, 'members.json');
const ROOT_MEMBERS_FILE = path.join(__dirname, 'members.json');

// Pembersihan Direktori Sementara Semasa Pelancaran Bot
if (fs.existsSync(TEMP_DIR)) {
    try {
        const leftoverFiles = fs.readdirSync(TEMP_DIR);
        for (const file of leftoverFiles) {
            try { fs.unlinkSync(path.join(TEMP_DIR, file)); } catch {}
        }
        if (leftoverFiles.length > 0) {
            console.log(`[Pembersihan Mula] ${leftoverFiles.length} fail sementara terbiar telah dipadamkan.`);
        }
    } catch (e) {
        console.error('Ralat pembersihan direktori sementara:', e);
    }
} else {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
if (!fs.existsSync(QR_PAYMENT_PATH) && !fs.existsSync(GITKEEP_PATH)) {
    try { fs.writeFileSync(GITKEEP_PATH, ''); } catch {}
}

// -------------------------------------------------------------
// TEMPLAT PAKEJ LANGGANAN RASMI
// -------------------------------------------------------------
const PACKAGE_TEMPLATE = 
`*SENARAI PAKEJ LANGGANAN:*

1️⃣ *1 Bulan (Asas)* — *RM10*
   └ Tempoh Aktif: +30 Hari

2️⃣ *3 Bulan (Popular)* — *RM25* _(Jimat RM5)_
   └ Tempoh Aktif: +90 Hari

3️⃣ *6 Bulan (Pro)* — *RM48* _(Jimat RM12)_
   └ Tempoh Aktif: +180 Hari

4️⃣ *1 Tahun (VIP)* — *RM90* _(Jimat RM30 • Percuma 3 Bulan)_
   └ Tempoh Aktif: +365 Hari`;

// -------------------------------------------------------------
// SISTEM PENJANAAN KOD REFERRAL PINTAR (CORE NAME + 3 DIGITS)
// -------------------------------------------------------------
const NAME_PREFIXES = new Set([
    'kak', 'abang', 'abg', 'adik', 'sis', 'bro',
    'encik', 'en', 'puan', 'pn', 'cik',
    'ustaz', 'ustazah', 'dato', 'datin',
    'dr', 'mr', 'mrs', 'ms', 'hj', 'hjh',
    'muhammad', 'mohd', 'mohamad', 'nur', 'siti'
]);

function extractCoreName(rawName) {
    if (!rawName || typeof rawName !== 'string') return 'AHLI';
    const words = rawName.trim().split(/[\s._\-–—,]+/);
    const filtered = words.filter(w => {
        const cleanW = w.toLowerCase().replace(/[^a-z]/g, '');
        return cleanW && !NAME_PREFIXES.has(cleanW);
    });

    let chosen = '';
    if (filtered.length > 0) {
        chosen = filtered[0].replace(/[^a-zA-Z]/g, '').toUpperCase();
    } else if (words.length > 0) {
        chosen = words[words.length - 1].replace(/[^a-zA-Z]/g, '').toUpperCase();
    }

    if (!chosen || chosen.length < 2) chosen = 'AHLI';
    return chosen.substring(0, 12);
}

function generateReferralCode(rawName, existingUsers = {}) {
    const coreName = extractCoreName(rawName);
    const existingCodes = new Set(
        Object.values(existingUsers)
            .map(u => (u.refCode || '').toUpperCase())
            .filter(Boolean)
    );

    let code = '';
    let attempts = 0;
    do {
        const digits = Math.floor(100 + Math.random() * 900);
        code = `${coreName}${digits}`;
        attempts++;
        if (attempts > 500) {
            code = `${coreName}${Math.floor(1000 + Math.random() * 9000)}`;
            break;
        }
    } while (existingCodes.has(code));

    return code;
}

// -------------------------------------------------------------
// PENGURUSAN DATA PENGGUNA (users.json + Persistent Volume Sync)
// -------------------------------------------------------------
function loadUsers() {
    try {
        let data = {};
        if (fs.existsSync(USERS_FILE)) {
            data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        } else if (fs.existsSync(PERSISTENT_USERS_FILE)) {
            data = JSON.parse(fs.readFileSync(PERSISTENT_USERS_FILE, 'utf8'));
            fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
        }

        // Migrasi automatik ahli lama sekiranya ada
        if (Object.keys(data).length === 0) {
            const oldSource = fs.existsSync(LEGACY_MEMBERS_FILE) ? LEGACY_MEMBERS_FILE : (fs.existsSync(ROOT_MEMBERS_FILE) ? ROOT_MEMBERS_FILE : null);
            if (oldSource) {
                try {
                    const legacy = JSON.parse(fs.readFileSync(oldSource, 'utf8'));
                    for (const [key, val] of Object.entries(legacy)) {
                        const phone = normalizeIdentifier(val.target || key);
                        if (!phone || data[phone]) continue;
                        const refCode = generateReferralCode(val.name || 'Ahli', data);
                        data[phone] = {
                            phone: phone,
                            name: val.name || 'Ahli',
                            status: (val.expiresTimestamp && val.expiresTimestamp > Date.now()) ? 'ACTIVE' : 'NEW',
                            expiredAt: val.expiresTimestamp || null,
                            refCode: refCode,
                            referredBy: null,
                            paidReferrals: 0,
                            totalPaidReferrals: 0,
                            refSentToExisting: false,
                            reminded3Days: false
                        };
                    }
                    saveUsers(data);
                    console.log(`[Migrasi Ahli] Berjaya menyelaraskan ${Object.keys(data).length} ahli ke dalam ./data/users.json.`);
                } catch (e) {
                    console.error('Ralat migrasi members lama:', e);
                }
            }
        }
        return data;
    } catch {
        return {};
    }
}

function saveUsers(data) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
        if (AUTH_DIR && fs.existsSync(AUTH_DIR)) {
            try { fs.writeFileSync(PERSISTENT_USERS_FILE, JSON.stringify(data, null, 2)); } catch {}
        }
    } catch (err) {
        console.error('Ralat simpan users.json:', err);
    }
}

function normalizeIdentifier(input) {
    if (!input) return '';
    let clean = input.trim().replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) {
        clean = '60' + clean.substring(1);
    }
    return clean;
}

function findUserRecord(users, remoteJid, altJid) {
    const cleanJid = normalizeIdentifier(remoteJid);
    const cleanAlt = normalizeIdentifier(altJid);

    if (cleanJid && users[cleanJid]) return users[cleanJid];
    if (cleanAlt && users[cleanAlt]) return users[cleanAlt];

    for (const u of Object.values(users)) {
        if (u.phone === cleanJid || u.phone === cleanAlt) return u;
        if (u.lid === cleanJid || u.lid === cleanAlt) return u;
    }
    return null;
}

const logger = pino({ level: 'silent' });

function resolveBinaries() {
    let ffmpegPath = 'ffmpeg';
    let ffprobePath = 'ffprobe';

    const isAvailableInPath = (bin) => {
        try {
            const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
            execSync(cmd, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    };

    if (!isAvailableInPath('ffmpeg')) {
        try {
            const ffmpegStatic = require('ffmpeg-static');
            if (ffmpegStatic && fs.existsSync(ffmpegStatic)) ffmpegPath = ffmpegStatic;
        } catch {}
    }

    if (!isAvailableInPath('ffprobe')) {
        try {
            const ffprobeStatic = require('ffprobe-static');
            if (ffprobeStatic && ffprobeStatic.path && fs.existsSync(ffprobeStatic.path)) ffprobePath = ffprobeStatic.path;
        } catch {}
    }

    return { ffmpegPath, ffprobePath };
}

const { ffmpegPath, ffprobePath } = resolveBinaries();

let zscaleSupported = null;
function checkZscaleSupport(binPath) {
    if (zscaleSupported !== null) return zscaleSupported;
    try {
        const output = execSync(`"${binPath}" -filters`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
        zscaleSupported = output.includes('zscale');
    } catch {
        zscaleSupported = false;
    }
    return zscaleSupported;
}

let casSupported = null;
function checkCasSupport(binPath) {
    if (casSupported !== null) return casSupported;
    try {
        const output = execSync(`"${binPath}" -filters`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
        casSupported = output.includes('cas');
    } catch {
        casSupported = false;
    }
    return casSupported;
}

class RobustVideoQueue {
    constructor(maxQueueSize = MAX_QUEUE_SIZE) {
        this.queue = [];
        this.activeJob = null;
        this.maxQueueSize = maxQueueSize;
        this.activeUsers = new Set();
    }

    get waitingLength() {
        return this.queue.length;
    }

    hasActiveUser(userId) {
        return this.activeUsers.has(userId);
    }

    enqueue(jobData) {
        if (this.queue.length >= this.maxQueueSize) {
            return { success: false, reason: 'full' };
        }
        if (this.activeUsers.has(jobData.userId)) {
            return { success: false, reason: 'duplicate' };
        }

        this.activeUsers.add(jobData.userId);
        this.queue.push(jobData);
        const position = this.queue.length + (this.activeJob ? 1 : 0);

        setImmediate(() => this.processNext());
        return { success: true, position };
    }

    async processNext() {
        if (this.activeJob || this.queue.length === 0) return;

        this.activeJob = this.queue.shift();
        try {
            await this.activeJob.run();
        } catch (err) {
            console.error('[Ralat Antrian]:', err);
        } finally {
            if (this.activeJob) {
                this.activeUsers.delete(this.activeJob.userId);
                this.activeJob = null;
            }

            if (global.gc) {
                try {
                    global.gc();
                    const mem = process.memoryUsage();
                    console.log(`[Pembersihan Memori GC] RAM aktif: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
                } catch {}
            }

            this.processNext();
        }
    }
}

const videoQueue = new RobustVideoQueue(MAX_QUEUE_SIZE);

function probeVideo(filePath, binPath) {
    return new Promise((resolve) => {
        const args = [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=r_frame_rate,duration,color_transfer,color_primaries,color_space:format=duration',
            '-of', 'json',
            filePath
        ];

        const proc = spawn(binPath, args);
        let stdout = '';
        let timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch {}
            resolve({ duration: 30.0, fps: 30.0, isHDR: false });
        }, 120000);

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                try {
                    const parsed = JSON.parse(stdout);
                    const stream = parsed.streams?.[0] || {};
                    const format = parsed.format || {};

                    let duration = parseFloat(stream.duration || format.duration);
                    if (isNaN(duration) || duration <= 0) duration = 30.0;

                    let fps = 30.0;
                    if (stream.r_frame_rate) {
                        const [num, den] = stream.r_frame_rate.split('/').map(Number);
                        if (den && num) {
                            fps = num / den;
                        } else if (!isNaN(parseFloat(stream.r_frame_rate))) {
                            fps = parseFloat(stream.r_frame_rate);
                        }
                    }

                    const colorTransfer = (stream.color_transfer || '').toLowerCase();
                    const colorPrimaries = (stream.color_primaries || '').toLowerCase();
                    const colorSpace = (stream.color_space || '').toLowerCase();

                    const isHDR = colorTransfer.includes('smpte2084') ||
                                  colorTransfer.includes('arib-std-b67') ||
                                  colorPrimaries.includes('bt2020') ||
                                  colorSpace.includes('bt2020');

                    return resolve({ duration, fps, isHDR });
                } catch {}
            }
            resolve({ duration: 30.0, fps: 30.0, isHDR: false });
        });
        proc.on('error', () => {
            clearTimeout(timer);
            resolve({ duration: 30.0, fps: 30.0, isHDR: false });
        });
    });
}

function transcode60fpsVideo(inputPath, outputPath, binPath, vBitrate, targetShortSide, sourceFps, isHDR) {
    return new Promise((resolve, reject) => {
        const isHighFps = sourceFps >= 48;
        const maxRate = Math.floor(vBitrate * 1.2);
        const bufSize = Math.floor(vBitrate * 2.4);

        const scaleFilter = `scale='if(gt(iw,ih),-2,min(${targetShortSide},iw))':'if(gt(iw,ih),min(${targetShortSide},ih),-2)':flags=lanczos`;

        let colorFilter = '';
        if (isHDR) {
            const hasZscale = checkZscaleSupport(binPath);
            if (hasZscale) {
                colorFilter = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
            } else {
                colorFilter = 'eq=contrast=1.08:saturation=1.18,format=yuv420p';
            }
        }

        const hasCas = checkCasSupport(binPath);
        const casFilter = hasCas ? 'cas=strength=0.35' : 'unsharp=5:5:0.35:5:5:0.0';

        const filterParts = [];
        if (colorFilter) filterParts.push(colorFilter);
        filterParts.push(scaleFilter);
        filterParts.push(casFilter);
        if (isHighFps) {
            filterParts.push('setpts=N/(60*TB)');
        }
        const vfFilter = filterParts.join(',');

        const args = [
            '-y',
            '-i', inputPath,
            '-t', '60',
            '-fps_mode', 'cfr'
        ];

        if (isHighFps) {
            args.push('-r', '60');
        }

        args.push(
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-profile:v', 'high',
            '-level', '4.2',
            '-pix_fmt', 'yuv420p',
            '-refs', '3',
            '-rc-lookahead', '30',
            '-vf', vfFilter,
            '-b:v', `${vBitrate}k`,
            '-maxrate', `${maxRate}k`,
            '-bufsize', `${bufSize}k`,
            '-g', '60',
            '-keyint_min', '60',
            '-sc_threshold', '0',
            '-x264-params', 'deblock=-1:-1:aq-mode=3:aq-strength=1.05:psy-rd=1.05:0.15:bframes=0',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-c:a', 'aac',
            '-b:a', '96k',
            '-ar', '44100',
            '-threads', '2',
            '-movflags', '+faststart',
            outputPath
        );

        const proc = spawn(binPath, args);
        let stderr = '';
        let timeoutTriggered = false;

        const timer = setTimeout(() => {
            timeoutTriggered = true;
            try { proc.kill('SIGKILL'); } catch {}
            reject(new Error('Masa transcode melebihi had maksimum (120 saat).'));
        }, 120000);

        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (timeoutTriggered) return;
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg error: ${stderr.slice(-300)}`));
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Ralat pelancaran FFmpeg: ${err.message}`));
        });
    });
}

async function processUltraSharpImage(inputPath, outputPath, binPath) {
    const hasCas = checkCasSupport(binPath);
    const sharpFilter = hasCas ? 'cas=strength=0.45' : 'unsharp=5:5:0.45:5:5:0.0';
    const scaleFilter = "scale='if(gt(iw,ih),min(2560,iw),-2)':'if(gt(iw,ih),-2,min(2560,ih))':flags=lanczos";
    const vfFilter = `${scaleFilter},${sharpFilter}`;

    const executeEncode = (qval) => {
        return new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-i', inputPath,
                '-vf', vfFilter,
                '-map_metadata', '-1',
                '-pix_fmt', 'yuvj420p',
                '-colorspace', 'bt709',
                '-color_primaries', 'bt709',
                '-color_trc', 'bt709',
                '-q:v', String(qval),
                outputPath
            ];

            const proc = spawn(binPath, args);
            let stderr = '';
            let timeoutTriggered = false;

            const timer = setTimeout(() => {
                timeoutTriggered = true;
                try { proc.kill('SIGKILL'); } catch {}
                reject(new Error('Masa pemprosesan imej melebihi had (60 saat).'));
            }, 60000);

            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (timeoutTriggered) return;
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg image error: ${stderr.slice(-300)}`));
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    };

    await executeEncode(2);

    let stats = fs.statSync(outputPath);
    const MAX_SAFE_BYTES = 1.85 * 1024 * 1024;
    let usedQ = 2;

    if (stats.size > MAX_SAFE_BYTES) {
        console.log(`[Kawalan Saiz Imej] Saiz JPEG (${(stats.size / 1024 / 1024).toFixed(2)} MB) melebihi siling 1.85 MB. Mengekod semula pada -q:v 5...`);
        await executeEncode(5);
        stats = fs.statSync(outputPath);
        usedQ = 5;
    }

    return {
        sizeBytes: stats.size,
        hasCas,
        usedQ
    };
}

function unwrapMessage(msg) {
    if (!msg) return null;
    let m = msg;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    return m;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        auth: state,
        logger: logger,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        shouldIgnoreJid: (jid) => jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter'),
        browser: Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
    });

    sock.ev.on('creds.update', saveCreds);

    const pairingNumber = (process.env.PAIRING_NUMBER || '601157270564').replace(/\D/g, '');

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !pairingNumber) {
            console.log('\nImbas Kod QR di WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 3000);
        } else if (connection === 'open') {
            console.log('\n======================================================');
            console.log(`Pelayan ${BOT_NAME} telah beroperasi.`);
            console.log(`Pentadbir Utama (Full Access): ${ADMIN_NUMBER}`);
            console.log(`Enjin Video: 4K-Grade CAS Sharpening 60 FPS (15.2MB Max Bitrate & aq-mode 3)`);
            console.log(`Enjin Foto: 2560px QHD+ CAS Sharpening (Anti-Compression Safe)`);
            console.log(`Pangkalan Data: ./data/users.json (NAME+3DIGIT Referral Aktif)`);
            console.log(`Kapasiti Antrian: Maksimum ${MAX_QUEUE_SIZE} Media`);
            console.log('======================================================\n');
        }
    });

    if (pairingNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(pairingNumber);
                console.log('\n======================================================');
                console.log(`🔑 KOD PAIRING WHATSAPP ANDA: ${code}`);
                console.log('======================================================');
                console.log(`1. Buka WhatsApp di telefon anda (${pairingNumber})`);
                console.log('2. Tekan Settings > Linked Devices > Link a Device');
                console.log('3. Tekan "Link with phone number instead"');
                console.log(`4. Masukkan kod 8-digit ini: ${code}\n`);
            } catch (err) {
                console.error('[Ralat Mohon Kod Pairing]:', err);
            }
        }, 3500);
    }

    // Peringatan Pembaharuan Automatik Setiap 6 Jam (Bagi Tempoh <= 72 Jam)
    setInterval(async () => {
        try {
            const users = loadUsers();
            const now = Date.now();
            const SEVENTY_TWO_HOURS = 72 * 60 * 60 * 1000;
            let updated = false;

            for (const user of Object.values(users)) {
                if (user.status === 'ACTIVE' && user.expiredAt && user.expiredAt > now) {
                    const timeLeft = user.expiredAt - now;
                    if (timeLeft <= SEVENTY_TWO_HOURS && !user.reminded3Days) {
                        user.reminded3Days = true;
                        updated = true;
                        const targetJid = user.phone.includes('@') ? user.phone : `${user.phone}@s.whatsapp.net`;
                        const expDateStr = new Date(user.expiredAt).toLocaleDateString('ms-MY', {
                            day: '2-digit', month: '2-digit', year: 'numeric'
                        });

                        try {
                            await sock.sendMessage(targetJid, {
                                text:
                                    `⚠️ *PERINGATAN PEMBAHARUAN LANGGANAN (${BOT_NAME})*\n\n` +
                                    `Hai ${user.name}, tempoh langganan keahlian anda akan tamat pada *${expDateStr}* (kurang 3 hari lagi).\n\n` +
                                    `Untuk mengelakkan sebarang gangguan terhadap pemprosesan video 60 FPS & foto QHD+, sila perbaharui langganan anda:\n\n` +
                                    `${PACKAGE_TEMPLATE}\n\n` +
                                    `Taip *BAYAR* untuk mendapatkan kod QR pembayaran secara langsung.`
                            });
                        } catch {}
                    }
                }
            }
            if (updated) saveUsers(users);
        } catch (e) {
            console.error('[Ralat Peringatan Pembaharuan]:', e);
        }
    }, 6 * 60 * 60 * 1000);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg || !msg.message) continue;

            const remoteJid = msg.key.remoteJid || '';
            const altJid = msg.key.remoteJidAlt || msg.key.participantAlt || '';

            if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) {
                continue;
            }

            const inner = unwrapMessage(msg.message);
            if (!inner) continue;

            // Keselamatan Anti-Loop
            if (msg.key.fromMe) {
                const caption = inner.videoMessage?.caption || inner.imageMessage?.caption || inner.documentMessage?.caption || '';
                const text = inner.conversation || inner.extendedTextMessage?.text || caption;

                if (
                    text.includes(BOT_NAME) ||
                    text.includes('Sistem pengoptimuman') ||
                    text.includes('AKSES') ||
                    text.includes('PENTADBIR') ||
                    text.includes('PENGOPTIMUMAN') ||
                    text.includes('SENARAI PAKEJ') ||
                    text.startsWith('STATUS') ||
                    text.startsWith('MAKLUMAN') ||
                    text.startsWith('PERINGATAN')
                ) {
                    continue;
                }

                const myJid = sock.user?.id ? sock.user.id.split(':')[0] : '';
                if (!remoteJid.includes(myJid)) {
                    continue;
                }
            }

            const users = loadUsers();
            const cleanPhone = normalizeIdentifier(remoteJid);
            let user = findUserRecord(users, remoteJid, altJid);

            if (!user && cleanPhone) {
                const pushName = msg.pushName || 'Pengguna';
                const refCode = generateReferralCode(pushName, users);
                user = {
                    phone: cleanPhone,
                    name: pushName,
                    status: 'NEW',
                    expiredAt: null,
                    refCode: refCode,
                    referredBy: null,
                    paidReferrals: 0,
                    totalPaidReferrals: 0,
                    refSentToExisting: false,
                    reminded3Days: false
                };
                users[cleanPhone] = user;
                saveUsers(users);
            }

            const fromMe = msg.key.fromMe;
            const isAdmin = fromMe || ADMIN_IDENTIFIERS.some(id => remoteJid.includes(id) || cleanPhone === id) || cleanPhone === ADMIN_NUMBER;
            const isActive = user && user.status === 'ACTIVE' && user.expiredAt && user.expiredAt > Date.now();

            const textContent = (inner.conversation || inner.extendedTextMessage?.text || '').trim();
            const textParts = textContent.split(/\s+/);
            const rawCmd = textParts[0].toLowerCase();
            const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
            const upperText = textContent.toUpperCase();

            // ---------------------------------------------------------
            // 1. PENGENDALIAN ARAHAN PENTADBIR (BAHASA MELAYU RINGKAS)
            // ---------------------------------------------------------
            if (isAdmin && (['tunggu', 'waiting', 'tambah', 'add', 'daftar', 'kod', 'setref', 'hebah', 'broadcast', 'broadcastref', 'semak', 'check', 'padam', 'buang', 'delete', 'senarai', 'ahli', 'list', 'bantuan', 'menu'].includes(cmd))) {
                console.log(`[Arahan Pentadbir Danial] ${remoteJid}: "${textContent}"`);

                // 1.1 TUNGGU: Lihat senarai menunggu bayaran
                if (['tunggu', 'waiting'].includes(cmd)) {
                    const waitingList = Object.values(users).filter(u => u.status === 'WAITING');
                    if (waitingList.length === 0) {
                        await sock.sendMessage(remoteJid, {
                            text: "Tiada pengguna di dalam Senarai Menunggu (*Waiting List*) pada masa ini."
                        }, { quoted: msg });
                        continue;
                    }

                    let resp = `📋 *SENARAI MENUNGGU RESIT (${waitingList.length} Orang)*\n\n`;
                    waitingList.forEach((u, i) => {
                        const refInfo = u.referredBy ? `Dijemput oleh: ${u.referredBy}` : `Bayaran Terus (Direct)`;
                        resp += `${i + 1}. *${u.name}* (${u.phone})\n   └ Status: ${refInfo}\n\n`;
                    });
                    resp += `Untuk aktifkan ahli selepas semak resit, taip:\n*tambah <nombor> <hari> [nama]*\n\nContoh:\n*tambah ${waitingList[0].phone} 30*`;
                    await sock.sendMessage(remoteJid, { text: resp.trim() }, { quoted: msg });
                    continue;
                }

                // 1.2 TAMBAH: Aktifkan ahli baharu / tambah hari
                if (['tambah', 'add', 'daftar'].includes(cmd)) {
                    const rawTarget = textParts[1];
                    const days = parseInt(textParts[2], 10);
                    const optName = textParts.slice(3).join(' ').trim();

                    if (!rawTarget || isNaN(days) || days <= 0) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `❌ *Format Tidak Sah!*\n\n` +
                                `Gunakan format ringkas:\n` +
                                `*tambah <nombor> <hari> [nama]*\n\n` +
                                `Contoh:\n` +
                                `*tambah 01113270914 30 Fieya*`
                        }, { quoted: msg });
                        continue;
                    }

                    const targetPhone = normalizeIdentifier(rawTarget);
                    let targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);

                    if (!targetUser) {
                        const fallbackName = optName || 'Ahli';
                        targetUser = {
                            phone: targetPhone,
                            name: fallbackName,
                            status: 'ACTIVE',
                            expiredAt: Date.now() + days * 24 * 60 * 60 * 1000,
                            refCode: generateReferralCode(fallbackName, users),
                            referredBy: null,
                            paidReferrals: 0,
                            totalPaidReferrals: 0,
                            refSentToExisting: true,
                            reminded3Days: false
                        };
                        users[targetPhone] = targetUser;
                    } else {
                        if (optName) targetUser.name = optName;
                        const now = Date.now();
                        const baseTime = (targetUser.expiredAt && targetUser.expiredAt > now) ? targetUser.expiredAt : now;
                        targetUser.expiredAt = baseTime + days * 24 * 60 * 60 * 1000;
                        targetUser.status = 'ACTIVE';
                        targetUser.reminded3Days = false;
                        targetUser.refSentToExisting = true;
                        if (!targetUser.refCode) {
                            targetUser.refCode = generateReferralCode(targetUser.name, users);
                        }
                    }

                    // Ganjaran Penaja (Referral Reward)
                    let referralRewardMsg = '';
                    if (targetUser.referredBy && !targetUser.referralCredited) {
                        targetUser.referralCredited = true;
                        const referrer = users[targetUser.referredBy] || Object.values(users).find(u => u.phone === targetUser.referredBy);
                        if (referrer) {
                            referrer.paidReferrals = (referrer.paidReferrals || 0) + 1;
                            referrer.totalPaidReferrals = (referrer.totalPaidReferrals || 0) + 1;
                            referralRewardMsg = `\n• Penaja: ${referrer.name} (${referrer.phone}) [+1 Tajaan, Baki: ${referrer.paidReferrals}/3]`;

                            if (referrer.paidReferrals >= 3) {
                                referrer.paidReferrals -= 3;
                                const refNow = Date.now();
                                const refBase = (referrer.expiredAt && referrer.expiredAt > refNow) ? referrer.expiredAt : refNow;
                                referrer.expiredAt = refBase + 30 * 24 * 60 * 60 * 1000;
                                referrer.status = 'ACTIVE';

                                const refJid = referrer.phone.includes('@') ? referrer.phone : `${referrer.phone}@s.whatsapp.net`;
                                try {
                                    await sock.sendMessage(refJid, {
                                        text:
                                            `🎉 *TAHNIAH! ANDA MENDAPAT 1 BULAN PERCUMA!*\n\n` +
                                            `Hai ${referrer.name}, anda telah berjaya mengumpul 3 rakan yang melanggan menggunakan kod referral anda (*${referrer.refCode}*).\n\n` +
                                            `Tempoh langganan akaun anda telah ditambah secara automatik selama *+30 HARI*!\n` +
                                            `Tarikh Luput Baharu: ${new Date(referrer.expiredAt).toLocaleDateString('ms-MY')}`
                                    });
                                } catch {}
                                referralRewardMsg += ` ➔ BONUS +30 HARI TELAH DIBERIKAN!`;
                            }
                        }
                    }

                    saveUsers(users);

                    const expDateStr = new Date(targetUser.expiredAt).toLocaleDateString('ms-MY', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });

                    // Notifikasi Pengaktifan Terus kepada Ahli
                    const userJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`;
                    try {
                        await sock.sendMessage(userJid, {
                            text:
                                `🎉 *TAHNIAH! LANGGANAN ANDA TELAH DIAKTIFKAN*\n\n` +
                                `Nama: ${targetUser.name}\n` +
                                `Status: AKTIF (+${days} Hari)\n` +
                                `Tarikh Luput: ${expDateStr}\n` +
                                `Kod Referral Peribadi Anda: *${targetUser.refCode}*\n\n` +
                                `🎁 *Ganjaran Referral Peribadi:*\n` +
                                `Ajak 3 rakan anda melanggan menggunakan kod anda (*${targetUser.refCode}*), dan anda akan menerima *PERCUMA 1 BULAN (30 Hari)* langganan tambahan secara automatik!\n\n` +
                                `Sila hantar video atau foto anda sebagai Dokumen untuk memulakan pemprosesan.`
                        });
                    } catch {}

                    await sock.sendMessage(remoteJid, {
                        text:
                            `✅ *PENGAKTIFAN KEAHLIAN BERJAYA*\n\n` +
                            `• Nama: ${targetUser.name}\n` +
                            `• Nombor: ${targetPhone}\n` +
                            `• Tempoh: +${days} Hari\n` +
                            `• Tarikh Luput: ${expDateStr}\n` +
                            `• Kod Referral: *${targetUser.refCode}*${referralRewardMsg}`
                    }, { quoted: msg });
                    continue;
                }

                // 1.3 KOD: Tukar kod referral ahli
                if (['kod', 'setref'].includes(cmd)) {
                    const rawTarget = textParts[1];
                    const customRaw = textParts[2];

                    if (!rawTarget || !customRaw) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `❌ *Format Tidak Sah!*\n\n` +
                                `Gunakan format ringkas:\n` +
                                `*kod <nombor> <KOD_NAMA>*\n\n` +
                                `Contoh:\n` +
                                `*kod 01113270914 FIEYA*`
                        }, { quoted: msg });
                        continue;
                    }

                    const targetPhone = normalizeIdentifier(rawTarget);
                    const targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);

                    if (!targetUser) {
                        await sock.sendMessage(remoteJid, {
                            text: `Akaun ${targetPhone} tidak dijumpai di dalam pangkalan data.`
                        }, { quoted: msg });
                        continue;
                    }

                    let cleanCode = customRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (!/\d{3}$/.test(cleanCode)) {
                        const digits = Math.floor(100 + Math.random() * 900);
                        cleanCode = `${cleanCode.replace(/\d/g, '')}${digits}`;
                    }

                    targetUser.refCode = cleanCode;
                    saveUsers(users);

                    const userJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`;
                    try {
                        await sock.sendMessage(userJid, {
                            text:
                                `PENGEMASKINIAN KOD REFERRAL (${BOT_NAME})\n\n` +
                                `Pentadbir telah mengemas kini kod referral peribadi anda kepada: *${cleanCode}*\n\n` +
                                `Kongsi kod baharu ini kepada rakan anda untuk menikmati ganjaran 1 bulan percuma bagi setiap 3 langganan!`
                        });
                    } catch {}

                    await sock.sendMessage(remoteJid, {
                        text: `✅ Kod referral bagi *${targetUser.name}* (${targetPhone}) berjaya ditukar kepada *${cleanCode}*.`
                    }, { quoted: msg });
                    continue;
                }

                // 1.4 HEBAH: Hantar kod referral ke semua ahli aktif
                if (['hebah', 'broadcast', 'broadcastref'].includes(cmd)) {
                    const activeMembers = Object.values(users).filter(u => u.status === 'ACTIVE' && u.expiredAt > Date.now());
                    await sock.sendMessage(remoteJid, {
                        text: `Memulakan hebahan kod referral kepada ${activeMembers.length} ahli aktif dengan sela masa 2 saat...`
                    }, { quoted: msg });

                    let sentCount = 0;
                    for (const m of activeMembers) {
                        if (!m.refCode) m.refCode = generateReferralCode(m.name, users);
                        m.refSentToExisting = true;
                        const targetJid = m.phone.includes('@') ? m.phone : `${m.phone}@s.whatsapp.net`;

                        try {
                            await sock.sendMessage(targetJid, {
                                text:
                                    `🎁 *KOD REFERRAL PERIBADI ANDA: ${m.refCode}*\n\n` +
                                    `Hai ${m.name}, sebagai ahli aktif ${BOT_NAME}, anda layak menikmati ganjaran bulanan percuma!\n\n` +
                                    `Ajak 3 rakan anda melanggan menggunakan kod referral peribadi anda (*${m.refCode}*), dan akaun anda akan menerima *PERCUMA 1 BULAN (30 Hari)* langganan secara automatik! 🚀`
                            });
                            sentCount++;
                        } catch {}
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    saveUsers(users);

                    await sock.sendMessage(remoteJid, {
                        text: `✅ Hebahan selesai! Kod referral dihantar kepada ${sentCount} orang ahli aktif.`
                    }, { quoted: msg });
                    continue;
                }

                // 1.5 SEMAK: Semak profil langganan ahli
                if (['semak', 'check'].includes(cmd)) {
                    const targetPhone = normalizeIdentifier(textParts[1]);
                    const targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);

                    if (!targetUser) {
                        await sock.sendMessage(remoteJid, {
                            text: `Akaun ${targetPhone || 'tersebut'} tidak dijumpai di dalam pangkalan data.`
                        }, { quoted: msg });
                        continue;
                    }

                    const isAct = targetUser.status === 'ACTIVE' && targetUser.expiredAt && targetUser.expiredAt > Date.now();
                    const daysLeft = isAct ? Math.ceil((targetUser.expiredAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
                    const expStr = targetUser.expiredAt ? new Date(targetUser.expiredAt).toLocaleDateString('ms-MY') : 'Tiada';

                    await sock.sendMessage(remoteJid, {
                        text:
                            `🔍 *MAKLUMAT KEAHLIAN PENGGUNA*\n\n` +
                            `• Nama: *${targetUser.name}*\n` +
                            `• Nombor: ${targetUser.phone}\n` +
                            `• Status: ${isAct ? 'AKTIF' : targetUser.status}\n` +
                            `• Baki Tempoh: ${daysLeft} hari (Luput: ${expStr})\n` +
                            `• Kod Referral: *${targetUser.refCode || 'Tiada'}*\n` +
                            `• Kemajuan Referral: ${targetUser.paidReferrals || 0}/3 (Jumlah Terkumpul: ${targetUser.totalPaidReferrals || 0})\n` +
                            `• Dijemput Oleh: ${targetUser.referredBy || 'Tiada'}`
                    }, { quoted: msg });
                    continue;
                }

                // 1.6 PADAM: Batalkan keahlian ahli
                if (['padam', 'buang', 'delete'].includes(cmd)) {
                    const targetPhone = normalizeIdentifier(textParts[1]);
                    const targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);

                    if (!targetUser) {
                        await sock.sendMessage(remoteJid, {
                            text: `Akaun ${targetPhone || 'tersebut'} tidak dijumpai.`
                        }, { quoted: msg });
                        continue;
                    }

                    delete users[targetUser.phone];
                    saveUsers(users);

                    await sock.sendMessage(remoteJid, {
                        text: `✅ PENGESAHAN: Akses bagi ${targetUser.name} (${targetUser.phone}) telah dipadamkan daripada sistem.`
                    }, { quoted: msg });
                    continue;
                }

                // 1.7 SENARAI: Senarai ahli aktif
                if (['senarai', 'ahli', 'list'].includes(cmd)) {
                    const activeMembers = Object.values(users).filter(u => u.status === 'ACTIVE' && u.expiredAt > Date.now());
                    if (activeMembers.length === 0) {
                        await sock.sendMessage(remoteJid, {
                            text: "Tiada ahli berdaftar yang aktif pada masa ini."
                        }, { quoted: msg });
                        continue;
                    }

                    let resp = `👥 *SENARAI AHLI AKTIF (${activeMembers.length} Orang)*\n\n`;
                    activeMembers.forEach((m, i) => {
                        const daysLeft = Math.ceil((m.expiredAt - Date.now()) / (1000 * 60 * 60 * 24));
                        resp += `${i + 1}. *${m.name}* (${m.phone})\n   └ Baki: ${daysLeft} hari (Luput: ${new Date(m.expiredAt).toLocaleDateString('ms-MY')})\n   └ Kod: ${m.refCode}\n\n`;
                    });
                    await sock.sendMessage(remoteJid, { text: resp.trim() }, { quoted: msg });
                    continue;
                }

                // 1.8 BANTUAN / MENU PENTADBIR
                if (['bantuan', 'menu', 'help'].includes(cmd)) {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `📋 *PANDUAN PERINTAH PENTADBIR (${BOT_NAME})*\n\n` +
                            `1. *tunggu*\n` +
                            `   └ Lihat senarai pengguna yang belum bayar / hantar resit.\n\n` +
                            `2. *tambah <nombor> <hari> [nama]*\n` +
                            `   └ Aktifkan ahli baharu atau sambung tempoh.\n` +
                            `   Contoh: tambah 01113270914 30 Fieya\n\n` +
                            `3. *kod <nombor> <nama_khas>*\n` +
                            `   └ Tukar kod referral ahli.\n` +
                            `   Contoh: kod 01113270914 FIEYA\n\n` +
                            `4. *hebah*\n` +
                            `   └ Hantar kod referral ke semua ahli aktif secara automatik.\n\n` +
                            `5. *semak <nombor>*\n` +
                            `   └ Semak baki hari dan status referral ahli.\n` +
                            `   Contoh: semak 01113270914\n\n` +
                            `6. *padam <nombor>*\n` +
                            `   └ Batalkan keahlian pengguna.\n\n` +
                            `7. *senarai*\n` +
                            `   └ Paparkan semua ahli aktif dan tarikh luput.\n\n` +
                            `8. *ram*\n` +
                            `   └ Semak status memori pelayan & antrian.`
                    }, { quoted: msg });
                    continue;
                }
            }

            // ---------------------------------------------------------
            // 2. PENEBUSAN KOD REFERRAL OLEH PENGGUNA
            // ---------------------------------------------------------
            const matchedReferrer = Object.values(users).find(u => u.refCode && u.refCode.toUpperCase() === upperText);
            if (matchedReferrer) {
                if (user && (user.phone === matchedReferrer.phone || user.refCode === matchedReferrer.refCode)) {
                    await sock.sendMessage(remoteJid, {
                        text: "Ralat: Anda tidak boleh menggunakan kod referral peribadi anda sendiri."
                    }, { quoted: msg });
                    continue;
                }

                if (isActive) {
                    await sock.sendMessage(remoteJid, {
                        text: `Akaun anda sudah berstatus AKTIF sehingga ${new Date(user.expiredAt).toLocaleDateString('ms-MY')}. Kod referral hanya sah untuk pendaftaran atau pembaharuan langganan.`
                    }, { quoted: msg });
                    continue;
                }

                user.referredBy = matchedReferrer.phone;
                user.status = 'WAITING';
                saveUsers(users);

                const confirmCaption =
                    `✅ *KOD REFERRAL DISAHKAN!*\n\n` +
                    `Anda dijemput oleh *${matchedReferrer.name}* (${matchedReferrer.refCode}).\n\n` +
                    `${PACKAGE_TEMPLATE}\n\n` +
                    `💳 *Nama Penerima:* MUHAMMAD DANIAL BIN MOHAMMAD NASIR\n` +
                    `📌 *Cara Pembayaran:*\n` +
                    `1. Imbas kod QR DuitNow di atas menggunakan mana-mana aplikasi Bank atau eWallet anda.\n` +
                    `2. Masukkan jumlah mengikut pakej pilihan anda.\n` +
                    `3. Hantarkan resit atau tangkap layar pembayaran di sini.\n\n` +
                    `Anda telah dimasukkan ke dalam Senarai Menunggu (*Waiting List*). Pentadbir akan mengaktifkan akaun anda serta-merta selepas semakan resit.`;

                if (fs.existsSync(QR_PAYMENT_PATH)) {
                    await sock.sendMessage(remoteJid, {
                        image: fs.readFileSync(QR_PAYMENT_PATH),
                        caption: confirmCaption
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: confirmCaption
                    }, { quoted: msg });
                }

                // Alert Pentadbir (Danial 0194066718)
                const adminJid = ADMIN_NUMBER.includes('@') ? ADMIN_NUMBER : `${ADMIN_NUMBER}@s.whatsapp.net`;
                try {
                    await sock.sendMessage(adminJid, {
                        text:
                            `🔔 *NOTIFIKASI RESIT (KOD REFERRAL)*\n\n` +
                            `• Nama: *${user.name}*\n` +
                            `• Nombor: ${user.phone}\n` +
                            `• Dijemput Oleh: ${matchedReferrer.name} (${matchedReferrer.phone} - ${matchedReferrer.refCode})\n` +
                            `• Status: Menunggu Resit Pembayaran\n\n` +
                            `Selepas semak resit, aktifkan menggunakan:\n` +
                            `*tambah ${user.phone} <hari> [nama]*\n\n` +
                            `Contoh:\n` +
                            `tambah ${user.phone} 30`
                    });
                } catch {}
                continue;
            }

            // ---------------------------------------------------------
            // 3. PEMBAYARAN TERUS (BAYAR)
            // ---------------------------------------------------------
            if (['bayar', '/bayar', 'qr'].includes(cmd) || upperText === 'BAYAR') {
                if (isActive) {
                    await sock.sendMessage(remoteJid, {
                        text: `Akaun anda masih berstatus AKTIF sehingga ${new Date(user.expiredAt).toLocaleDateString('ms-MY')}. Anda tidak perlu membuat pembayaran sekarang.`
                    }, { quoted: msg });
                    continue;
                }

                user.status = 'WAITING';
                saveUsers(users);

                const payCaption =
                    `MAKLUMAT PEMBAYARAN LANGGANAN (${BOT_NAME})\n\n` +
                    `${PACKAGE_TEMPLATE}\n\n` +
                    `💳 *Nama Penerima:* MUHAMMAD DANIAL BIN MOHAMMAD NASIR\n` +
                    `📌 *Cara Pembayaran:*\n` +
                    `1. Imbas kod QR DuitNow di atas menggunakan mana-mana aplikasi Bank atau eWallet anda.\n` +
                    `2. Masukkan jumlah bayaran mengikut pakej pilihan anda.\n` +
                    `3. Hantarkan resit atau tangkap layar pembayaran di sini.\n\n` +
                    `Anda telah dimasukkan ke dalam Senarai Menunggu (*Waiting List*). Akaun anda akan diaktifkan sebaik sahaja resit disahkan oleh pentadbir!`;

                if (fs.existsSync(QR_PAYMENT_PATH)) {
                    await sock.sendMessage(remoteJid, {
                        image: fs.readFileSync(QR_PAYMENT_PATH),
                        caption: payCaption
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: payCaption
                    }, { quoted: msg });
                }

                const adminJid = ADMIN_NUMBER.includes('@') ? ADMIN_NUMBER : `${ADMIN_NUMBER}@s.whatsapp.net`;
                try {
                    await sock.sendMessage(adminJid, {
                        text:
                            `🔔 *NOTIFIKASI RESIT (BAYARAN TERUS)*\n\n` +
                            `• Nama: *${user.name}*\n` +
                            `• Nombor: ${user.phone}\n` +
                            `• Status: Menunggu Resit Pembayaran\n\n` +
                            `Selepas semak resit, aktifkan menggunakan:\n` +
                            `*tambah ${user.phone} <hari> [nama]*\n\n` +
                            `Contoh:\n` +
                            `tambah ${user.phone} 30`
                    });
                } catch {}
                continue;
            }

            // ---------------------------------------------------------
            // 4. ALIRAN START ONBOARDING & STATUS PENGGUNA
            // ---------------------------------------------------------
            if (['start', '/start', 'mula', 'menu', 'bantuan', 'help'].includes(cmd) || upperText === 'START') {
                if (isActive) {
                    if (!user.refCode) user.refCode = generateReferralCode(user.name, users);
                    user.refSentToExisting = true;
                    saveUsers(users);

                    const expDateStr = new Date(user.expiredAt).toLocaleDateString('ms-MY', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });

                    await sock.sendMessage(remoteJid, {
                        text:
                            `SELAMAT KEMBALI KE ${BOT_NAME}!\n\n` +
                            `Status Keahlian: *AKTIF*\n` +
                            `Tarikh Luput: ${expDateStr}\n` +
                            `Kod Referral Peribadi Anda: *${user.refCode}*\n\n` +
                            `Panduan Penggunaan:\n` +
                            `• Video 60 FPS: Sila hantar video anda sebagai fail Dokumen (Lampiran > Dokumen > Galeri) bagi mengekalkan kualiti tanpa mampatan.\n` +
                            `• Foto QHD+: Hantar foto anda untuk diproses ke resolusi 2560px dengan ketajaman CAS.\n\n` +
                            `🎁 *Ganjaran Referral Peribadi:*\n` +
                            `Ajak 3 rakan anda melanggan menggunakan kod anda (*${user.refCode}*), dan anda akan menerima *PERCUMA 1 BULAN (30 Hari)* secara automatik!`
                    }, { quoted: msg });
                } else {
                    const isExpired = user && user.expiredAt && user.expiredAt <= Date.now();
                    const introText = isExpired
                        ? `STATUS: LANGGANAN TELAH TAMAT\n\nTempoh keahlian anda bagi ${BOT_NAME} telah tamat pada ${new Date(user.expiredAt).toLocaleDateString('ms-MY')}.`
                        : `STATUS: TIADA LANGGANAN AKTIF\n\nSelamat datang ke ${BOT_NAME}. Akaun anda belum mempunyai langganan aktif untuk memproses video 60 FPS & foto WhatsApp Status berkualiti tinggi.`;

                    const welcomeCaption =
                        `${introText}\n\n` +
                        `${PACKAGE_TEMPLATE}\n\n` +
                        `💳 *Nama Penerima:* MUHAMMAD DANIAL BIN MOHAMMAD NASIR\n\n` +
                        `Cara Mendaftar:\n` +
                        `1. Imbas kod QR di atas untuk pembayaran terus.\n` +
                        `2. Atau balas dengan kod referral rakan jika ada (contoh: FIEYANINA482).\n` +
                        `3. Hantarkan resit pembayaran di sini untuk pengesahan segera.`;

                    if (fs.existsSync(QR_PAYMENT_PATH)) {
                        await sock.sendMessage(remoteJid, {
                            image: fs.readFileSync(QR_PAYMENT_PATH),
                            caption: welcomeCaption
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text: welcomeCaption
                        }, { quoted: msg });
                    }
                }
                continue;
            }

            if (['status', 'baki', 'langganan'].includes(cmd)) {
                if (isActive) {
                    const daysLeft = Math.ceil((user.expiredAt - Date.now()) / (1000 * 60 * 60 * 24));
                    await sock.sendMessage(remoteJid, {
                        text:
                            `STATUS KEAHLIAN ANDA\n\n` +
                            `• Nama: *${user.name}*\n` +
                            `• Status: Aktif (${daysLeft} hari lagi)\n` +
                            `• Tarikh Luput: ${new Date(user.expiredAt).toLocaleDateString('ms-MY')}\n` +
                            `• Kod Referral: *${user.refCode}*\n` +
                            `• Kemajuan Ganjaran: ${user.paidReferrals || 0}/3 rakan melanggan\n\n` +
                            `Ajak rakan anda melanggan menggunakan kod referral anda untuk menerima 1 bulan langganan percuma!`
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `STATUS: TIADA LANGGANAN AKTIF\n\n` +
                            `Akaun anda belum berdaftar sebagai ahli aktif ${BOT_NAME}.\n\n` +
                            `Sila taip *START* untuk melihat pakej dan memulakan langganan.`
                    }, { quoted: msg });
                }
                continue;
            }

            if (['ram', 'memori'].includes(cmd)) {
                const mem = process.memoryUsage();
                const rssMB = (mem.rss / (1024 * 1024)).toFixed(1);
                const heapUsedMB = (mem.heapUsed / (1024 * 1024)).toFixed(1);
                const uptimeSec = Math.floor(process.uptime());
                const hours = Math.floor(uptimeSec / 3600);
                const minutes = Math.floor((uptimeSec % 3600) / 60);
                const percentage = ((parseFloat(rssMB) / 256) * 100).toFixed(1);

                await sock.sendMessage(remoteJid, {
                    text:
                        `STATUS SISTEM & PRESTASI PELAYAN\n\n` +
                        `Penggunaan Memori:\n` +
                        `• Memori Fizikal (RSS): ${rssMB} MB / 256.0 MB (${percentage}%)\n` +
                        `• Memori Heap Aktif: ${heapUsedMB} MB\n` +
                        `• Kawalan Memori (GC): Aktif (--expose-gc)\n` +
                        `• Status: Cemerlang & Terkawal\n\n` +
                        `Status Antrian Pemprosesan:\n` +
                        `• Sedang Diproses: ${videoQueue.activeJob ? '1 Media' : 'Tiada'}\n` +
                        `• Menunggu Dalam Antrian: ${videoQueue.waitingLength} / ${MAX_QUEUE_SIZE} Media\n\n` +
                        `Masa Operasi Pelayan: ${hours} jam ${minutes} minit`
                }, { quoted: msg });
                continue;
            }

            // ---------------------------------------------------------
            // 5. PENGESANAN MEDIA & SEKATAN KEAHLIAN (MEMBERSHIP GATE)
            // ---------------------------------------------------------
            if (inner.videoMessage) {
                await sock.sendMessage(remoteJid, {
                    text:
                        `PERINGATAN FORMAT PENGHANTARAN VIDEO\n\n` +
                        `Fail video dikesan dihantar melalui mod biasa. Aplikasi WhatsApp memampatkan kualiti video biasa sebelum penghantaran.\n\n` +
                        `Sila hantar semula video sebagai Dokumen:\n` +
                        `1. Tekan ikon Lampiran (+ atau klip kertas)\n` +
                        `2. Pilih Dokumen > Pilih daripada galeri\n` +
                        `3. Hantar video anda sebagai fail dokumen.`
                }, { quoted: msg });
                continue;
            }

            const isDirectImage = !!inner.imageMessage;
            const docMsg = inner.documentMessage || inner.documentWithCaptionMessage?.message?.documentMessage;
            const docMime = (docMsg?.mimetype || '').toLowerCase();
            const docFileName = (docMsg?.fileName || '').toLowerCase();

            const isDocImage = !!docMsg && (docMime.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff|heic|heif)$/i.test(docFileName));
            const isDocVideo = !!docMsg && (docMime.startsWith('video/') || /\.(mp4|mov|mkv|avi|3gp|webm|m4v)$/i.test(docFileName));

            if (!isDirectImage && !isDocImage && !isDocVideo) {
                if (textContent && !isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `Selamat kembali ke ${BOT_NAME}.\n\n` +
                            `Sila hantar foto atau lampirkan video sebagai Dokumen untuk memulakan pengoptimuman WhatsApp Status.\n\n` +
                            `Taip *START* untuk melihat panduan pakej atau *status* untuk menyemak baki keahlian anda.`
                    }, { quoted: msg });
                }
                continue;
            }

            if (!isAdmin && !isActive) {
                console.log(`[Media Ditolak] Penghantaran media oleh bukan ahli aktif: ${remoteJid}`);
                await sock.sendMessage(remoteJid, {
                    text:
                        `AKSES PEMPROSESAN DISEKAT\n\n` +
                        `Fungsi pengoptimuman video 60 FPS & foto QHD+ dikhaskan untuk ahli aktif sahaja.\n\n` +
                        `Sila taip *START* untuk melihat senarai pakej dan memulakan langganan.`
                }, { quoted: msg });
                continue;
            }

            // ---------------------------------------------------------
            // 6. CABANG A: PEMPROSESAN FOTO QHD+ 2560px CAS SHARPENING
            // ---------------------------------------------------------
            if (isDirectImage || isDocImage) {
                const enqueueResult = videoQueue.enqueue({
                    userId: remoteJid,
                    run: async () => {
                        const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                        const inputPath = path.join(TEMP_DIR, `input_img_${fileId}.jpg`);
                        const outputPath = path.join(TEMP_DIR, `status_clear_qhd_${fileId}.jpg`);

                        try {
                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '⏳', key: msg.key }
                                });
                            } catch {}

                            console.log(`\n[Pemprosesan Imej Bermula] Memuat turun foto dari ${remoteJid}...`);

                            const mediaStream = await downloadMediaMessage(msg, 'stream', {}, { logger, reuploadRequest: sock.updateMediaMessage });
                            await pipeline(mediaStream, fs.createWriteStream(inputPath));

                            console.log(`[FFmpeg Imej] Mengoptimumkan ke 2560px QHD+ dengan CAS Sharpening...`);
                            const result = await processUltraSharpImage(inputPath, outputPath, ffmpegPath);

                            const sizeMB = (result.sizeBytes / (1024 * 1024)).toFixed(2);
                            const sharpEngine = result.hasCas ? 'Contrast Adaptive Sharpening (CAS)' : 'Unsharp Masking';

                            const imageCaption =
                                `PENGOPTIMUMAN FOTO SELESAI (2560px QHD+)\n\n` +
                                `Sila tekan Forward ➔ My Status (Status Saya) untuk memuat naik foto ini terus ke Status WhatsApp anda.\n\n` +
                                `Peringatan Kualiti:\n` +
                                `Jangan potong (crop) atau tambah pelekat/teks di dalam editor WhatsApp Status agar resolusi 2560px HD kekal tajam tanpa dimampatkan semula.\n\n` +
                                `Spesifikasi Output:\n` +
                                `• Resolusi: 2560px QHD+ (Lanczos Scaling)\n` +
                                `• Penalaan: ${sharpEngine}\n` +
                                `• Ruang Warna: sRGB / BT.709 (Metadata Stripped)\n` +
                                `• Saiz Fail: ${sizeMB} MB (Anti-Compression Safe)`;

                            await sock.sendMessage(remoteJid, {
                                image: { stream: fs.createReadStream(outputPath) },
                                caption: imageCaption
                            }, { quoted: msg });

                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '✅', key: msg.key }
                                });
                            } catch {}

                            // Hantar kod referral secara automatik kepada ahli aktif yang belum terima
                            if (user && user.status === 'ACTIVE' && (!user.refSentToExisting || !user.refCode)) {
                                if (!user.refCode) user.refCode = generateReferralCode(user.name, users);
                                user.refSentToExisting = true;
                                saveUsers(users);

                                await sock.sendMessage(remoteJid, {
                                    text:
                                        `🎁 *KOD REFERRAL PERIBADI ANDA: ${user.refCode}*\n\n` +
                                        `Sebagai ahli aktif ${BOT_NAME}, anda layak menikmati ganjaran percuma!\n\n` +
                                        `Ajak 3 rakan anda melanggan menggunakan kod referral anda (*${user.refCode}*), dan akaun anda akan menerima *PERCUMA 1 BULAN (30 Hari)* langganan tambahan secara automatik! 🚀`
                                });
                            }

                            console.log(`[Selesai] Foto 2560px QHD+ berjaya dihantar ke ${remoteJid}.`);

                        } catch (err) {
                            console.error('[Ralat Pemprosesan Imej]', err);
                            try {
                                await sock.sendMessage(remoteJid, {
                                    text: `Ralat: Proses pengoptimuman foto gagal dilaksanakan. (${err.message})`
                                }, { quoted: msg });
                            } catch {}
                        } finally {
                            if (fs.existsSync(inputPath)) { try { fs.unlinkSync(inputPath); } catch {} }
                            if (fs.existsSync(outputPath)) { try { fs.unlinkSync(outputPath); } catch {} }
                        }
                    }
                });

                if (!enqueueResult.success) {
                    if (enqueueResult.reason === 'full') {
                        await sock.sendMessage(remoteJid, {
                            text: `MAKLUMAN: Kapasiti antrian pemprosesan sedang penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE} media). Sila tunggu beberapa minit sebelum menghantar semula foto anda.`
                        }, { quoted: msg });
                    } else if (enqueueResult.reason === 'duplicate') {
                        await sock.sendMessage(remoteJid, {
                            text: `PERINGATAN: Anda sudah mempunyai satu media yang sedang menunggu atau diproses dalam antrian. Sila tunggu media semasa selesai sebelum menghantar media baharu.`
                        }, { quoted: msg });
                    }
                } else {
                    if (enqueueResult.position > 1) {
                        await sock.sendMessage(remoteJid, {
                            text: `Foto diterima. Anda berada di giliran ke-${enqueueResult.position} dalam antrian pemprosesan. Sistem akan memaklumkan anda sebaik sahaja pemprosesan bermula.`
                        }, { quoted: msg });
                    }
                }
                continue;
            }

            // ---------------------------------------------------------
            // 7. CABANG B: PEMPROSESAN DOKUMEN VIDEO (Gred 4K 60 FPS)
            // ---------------------------------------------------------
            if (isDocVideo) {
                const fileLength = Number(docMsg.fileLength || 0);
                const sizeMB = (fileLength / (1024 * 1024)).toFixed(1);

                const enqueueResult = videoQueue.enqueue({
                    userId: remoteJid,
                    run: async () => {
                        const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                        const inputPath = path.join(TEMP_DIR, `input_${fileId}.mp4`);
                        const outputPath = path.join(TEMP_DIR, `status_clear_60fps_${fileId}.mp4`);

                        try {
                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '⏳', key: msg.key }
                                });
                            } catch {}

                            console.log(`\n[Pemprosesan Video Bermula] Memuat turun video (${sizeMB} MB) dari ${remoteJid}...`);

                            const mediaStream = await downloadMediaMessage(msg, 'stream', {}, { logger, reuploadRequest: sock.updateMediaMessage });
                            await pipeline(mediaStream, fs.createWriteStream(inputPath));

                            const { duration: durationSec, fps: sourceFps, isHDR } = await probeVideo(inputPath, ffprobePath);

                            const effectiveDuration = Math.min(durationSec, 60);
                            const rawBitrate = Math.floor(((15.2 * 8192) / effectiveDuration) - 96);
                            const vBitrate = Math.max(3500, Math.min(11500, rawBitrate));
                            const targetShortSide = vBitrate >= 4600 ? 1080 : 720;
                            const isTrimmed = durationSec > 60;
                            const isHighFps = sourceFps >= 48;

                            const resLabel = targetShortSide === 1080 ? (isHighFps ? '1080p (60 FPS)' : '1080p (HD)') : (isHighFps ? '720p (60 FPS)' : '720p (HD)');
                            const fpsStatus = isHighFps ? '60.0 FPS Malar (True 60fps Native)' : `${sourceFps.toFixed(1)} FPS Malar (True Native CFR)`;

                            console.log(`[FFmpeg Transcode] ${resLabel} @ ${vBitrate} kbps | CAS: 0.35 | Sumber: ${sourceFps.toFixed(1)} FPS (${isHDR ? 'HDR Tone-Mapped' : 'SDR Asal'}) | Mod: ${isHighFps ? 'True 60fps Native' : 'Native CFR'} | Durasi: ${durationSec.toFixed(1)}s`);
                            await transcode60fpsVideo(inputPath, outputPath, ffmpegPath, vBitrate, targetShortSide, sourceFps, isHDR);

                            await sock.sendMessage(remoteJid, {
                                video: { stream: fs.createReadStream(outputPath) },
                                mimetype: 'video/mp4'
                            }, { quoted: msg });

                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '✅', key: msg.key }
                                });
                            } catch {}

                            const hasCas = checkCasSupport(ffmpegPath);
                            const casNote = hasCas ? 'CAS 0.35 (Gred 4K)' : 'Unsharp Adaptive';
                            const trimNote = isTrimmed ? '\n• Catatan: Video telah dipotong kepada 60 saat pertama mengikut had WhatsApp Status.' : '';
                            const motionNote = isHighFps ? ' (True 60fps Native)' : ' (True Native CFR)';
                            const colorNote = isHDR ? 'BT.709 (HDR Tone-Mapped Sinematik)' : 'BT.709 Asal (SDR True Colors)';

                            await sock.sendMessage(remoteJid, {
                                text:
                                    `PENGOPTIMUMAN VIDEO SELESAI\n\n` +
                                    `Sila majukan (forward) video di atas terus ke Status WhatsApp anda tanpa melakukan sebarang suntingan atau pemotongan (trim) bagi mengekalkan kestabilan dan kualiti video.\n\n` +
                                    `Spesifikasi Output:\n` +
                                    `• Resolusi: ${resLabel}${motionNote}\n` +
                                    `• Kadar Bingkai: ${fpsStatus}\n` +
                                    `• Bitrate: ${vBitrate} kbps (Sasaran ~15.2 MB Passthrough)\n` +
                                    `• Penalaan: ${casNote} | aq-mode 3 | Audio 96k\n` +
                                    `• Profil Warna: ${colorNote}${trimNote}`
                            });

                            if (user && user.status === 'ACTIVE' && (!user.refSentToExisting || !user.refCode)) {
                                if (!user.refCode) user.refCode = generateReferralCode(user.name, users);
                                user.refSentToExisting = true;
                                saveUsers(users);

                                await sock.sendMessage(remoteJid, {
                                    text:
                                        `🎁 *KOD REFERRAL PERIBADI ANDA: ${user.refCode}*\n\n` +
                                        `Sebagai ahli aktif ${BOT_NAME}, anda layak menikmati ganjaran percuma!\n\n` +
                                        `Ajak 3 rakan anda melanggan menggunakan kod referral anda (*${user.refCode}*), dan akaun anda akan menerima *PERCUMA 1 BULAN (30 Hari)* langganan tambahan secara automatik! 🚀`
                                });
                            }

                            console.log(`[Selesai] Video berjaya dihantar ke ${remoteJid}.`);

                        } catch (err) {
                            console.error('[Ralat Pemprosesan Video]', err);
                            try {
                                await sock.sendMessage(remoteJid, {
                                    text: `Ralat: Proses pengoptimuman video gagal dilaksanakan. (${err.message})`
                                }, { quoted: msg });
                            } catch {}
                        } finally {
                            if (fs.existsSync(inputPath)) { try { fs.unlinkSync(inputPath); } catch {} }
                            if (fs.existsSync(outputPath)) { try { fs.unlinkSync(outputPath); } catch {} }
                        }
                    }
                });

                if (!enqueueResult.success) {
                    if (enqueueResult.reason === 'full') {
                        await sock.sendMessage(remoteJid, {
                            text: `MAKLUMAN: Kapasiti antrian pemprosesan sedang penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE} video). Sila tunggu beberapa minit sebelum menghantar semula video anda.`
                        }, { quoted: msg });
                    } else if (enqueueResult.reason === 'duplicate') {
                        await sock.sendMessage(remoteJid, {
                            text: `PERINGATAN: Anda sudah mempunyai satu media yang sedang menunggu atau diproses dalam antrian. Sila tunggu video semasa selesai sebelum menghantar video baharu.`
                        }, { quoted: msg });
                    }
                } else {
                    if (enqueueResult.position > 1) {
                        await sock.sendMessage(remoteJid, {
                            text: `Video diterima. Anda berada di giliran ke-${enqueueResult.position} dalam antrian pemprosesan. Sistem akan memaklumkan anda sebaik sahaja pemprosesan bermula.`
                        }, { quoted: msg });
                    }
                }
            }
        }
    });
}

startBot();