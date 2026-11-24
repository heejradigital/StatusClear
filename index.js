/**
 * StatusClear - Lossless WhatsApp Status Optimization Bot
 * Single-file, ultra-lightweight implementation (<384MB RAM)
 * 
 * Features:
 * - Direct Automated HitPay Payment Request API (FPX, DuitNow QR, eWallets, Cards)
 * - HMAC-SHA256 Verified Webhook Endpoint (POST /webhook/hitpay)
 * - Auto WhatsApp Welcome, Confirmation & Step-by-Step Tutorial Delivery
 * - Complete Sponsor Referral Notifications (Redemption, Progress 1-2/3 & Free Month Milestone 3/3)
 * - Reliable JID Routing (user.jid & user.altJid saved on interaction)
 * - Railway Ready (process.env.PORT, persistent Volumes, native Linux FFmpeg)
 * - 60 FPS Native Video Encoding (15.2MB Bitrate Passthrough & CAS Sharpening)
 * - 2560px QHD+ Photo Enhancement (CAS Filter & Dynamic Anti-Compression Safe)
 * - Core/Middle Name + 3 Unique Digits Referral System
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const BOT_NAME = "Status Clear By Danial";
const MAX_QUEUE_SIZE = 25;

// Nombor Pentadbir Utama & Senarai Akses Penuh
const ADMIN_NUMBER = (process.env.ADMIN_NUMBER || '601154474066').replace(/\D/g, '');
const ADMIN_IDENTIFIERS = [
    ADMIN_NUMBER,
    '601154474066',
    '60194066718',
    '0194066718',
    '01154474066',
    '194066718',
    '1154474066',
    '68225740046362'
];

// Konfigurasi Storan Kekal Railway (Volume Mounts)
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const AUTH_DIR = path.resolve(process.env.AUTH_DIR || path.join(__dirname, 'auth_info'));
const TEMP_DIR = path.join(__dirname, 'temp');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PERSISTENT_USERS_FILE = path.join(AUTH_DIR, 'users.json');
const PROCESSED_PAYMENTS_FILE = path.join(DATA_DIR, 'hitpay_processed.json');
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

// -------------------------------------------------------------
// KONFIGURASI HITPAY PAYMENT GATEWAY
// -------------------------------------------------------------
const HITPAY_API_KEY = (process.env.HITPAY_API_KEY || '').trim();
const HITPAY_SALT = (process.env.HITPAY_SALT || '').trim();
const HITPAY_ENV = (process.env.HITPAY_ENV || 'live').toLowerCase().trim();
const HITPAY_API_URL = HITPAY_ENV === 'sandbox'
    ? 'https://api.sandbox.hit-pay.com/v1/payment-requests'
    : 'https://api.hit-pay.com/v1/payment-requests';
const WEBHOOK_PUBLIC_URL = (process.env.WEBHOOK_PUBLIC_URL || '').trim();

// -------------------------------------------------------------
// TEMPLAT PAKEJ LANGGANAN RASMI
// -------------------------------------------------------------
const PACKAGES = {
    '1': {
        key: '1',
        title: '1 Bulan (Asas)',
        price: 'RM10',
        amount: '10.00',
        days: 30
    },
    '2': {
        key: '2',
        title: '3 Bulan (Popular)',
        price: 'RM25',
        amount: '25.00',
        days: 90
    },
    '3': {
        key: '3',
        title: '6 Bulan (Pro)',
        price: 'RM48',
        amount: '48.00',
        days: 180
    },
    '4': {
        key: '4',
        title: '1 Tahun (VIP)',
        price: 'RM90',
        amount: '90.00',
        days: 365
    }
};

const PACKAGE_TEMPLATE = 
`*SENARAI PAKEJ LANGGANAN (${BOT_NAME}):*

1️⃣ *1 Bulan (Asas)* — *RM10*
   └ Tempoh Aktif: +30 Hari

2️⃣ *3 Bulan (Popular)* — *RM25* _(Jimat RM5)_
   └ Tempoh Aktif: +90 Hari

3️⃣ *6 Bulan (Pro)* — *RM48* _(Jimat RM12)_
   └ Tempoh Aktif: +180 Hari

4️⃣ *1 Tahun (VIP)* — *RM90* _(Jimat RM30 • Percuma 3 Bulan)_
   └ Tempoh Aktif: +365 Hari

👉 *Balas nombor 1, 2, 3, atau 4* untuk menjana pautan pembayaran selamat (FPX, DuitNow QR, eWallet & Kad).`;

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

function normalizeIdentifier(input) {
    if (!input) return '';
    let clean = input.trim().replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) {
        clean = '60' + clean.substring(1);
    }
    return clean;
}

// -------------------------------------------------------------
// PENGURUSAN DATA PENGGUNA & IDEMPOTENSI PEMBAYARAN
// -------------------------------------------------------------
function loadProcessedPayments() {
    try {
        if (fs.existsSync(PROCESSED_PAYMENTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PROCESSED_PAYMENTS_FILE, 'utf8'));
            if (Array.isArray(data)) return new Set(data);
            if (typeof data === 'object') return new Set(Object.keys(data));
        }
    } catch (e) {
        console.error('Ralat membaca hitpay_processed.json:', e);
    }
    return new Set();
}

function recordProcessedPayment(paymentId) {
    try {
        const set = loadProcessedPayments();
        set.add(paymentId);
        fs.writeFileSync(PROCESSED_PAYMENTS_FILE, JSON.stringify(Array.from(set), null, 2));
    } catch (e) {
        console.error('Ralat simpan hitpay_processed.json:', e);
    }
}

function loadUsers() {
    try {
        let merged = {};

        // 1. Muat dari members.json punca projek jika ada
        if (fs.existsSync(ROOT_MEMBERS_FILE)) {
            try {
                const rootLegacy = JSON.parse(fs.readFileSync(ROOT_MEMBERS_FILE, 'utf8'));
                for (const [k, v] of Object.entries(rootLegacy)) {
                    const p = normalizeIdentifier(v.target || v.phone || k);
                    if (p) {
                        const isAct = v.expiresTimestamp ? v.expiresTimestamp > Date.now() : (v.status === 'ACTIVE');
                        merged[p] = {
                            phone: p,
                            name: v.name || 'Ahli',
                            status: isAct ? 'ACTIVE' : (v.status || 'NEW'),
                            expiredAt: v.expiresTimestamp || v.expiredAt || null,
                            refCode: v.refCode || generateReferralCode(v.name || 'Ahli', merged),
                            referredBy: v.referredBy || null,
                            paidReferrals: v.paidReferrals || 0,
                            totalPaidReferrals: v.totalPaidReferrals || 0,
                            refSentToExisting: !!v.refSentToExisting,
                            reminded3Days: !!v.reminded3Days,
                            lid: v.lid ? normalizeIdentifier(v.lid) : null,
                            jid: v.jid || null,
                            altJid: v.altJid || null
                        };
                        if (v.lid) merged[normalizeIdentifier(v.lid)] = merged[p];
                    }
                }
            } catch {}
        }

        // 2. Muat dari members.json dalam Volume simpanan kekal
        if (fs.existsSync(LEGACY_MEMBERS_FILE)) {
            try {
                const volLegacy = JSON.parse(fs.readFileSync(LEGACY_MEMBERS_FILE, 'utf8'));
                for (const [k, v] of Object.entries(volLegacy)) {
                    const p = normalizeIdentifier(v.target || v.phone || k);
                    if (p) {
                        const isAct = v.expiresTimestamp ? v.expiresTimestamp > Date.now() : (v.status === 'ACTIVE');
                        const exp = v.expiresTimestamp || v.expiredAt || null;
                        if (!merged[p] || (isAct && merged[p].status !== 'ACTIVE') || (exp && (!merged[p].expiredAt || exp > merged[p].expiredAt))) {
                            merged[p] = {
                                phone: p,
                                name: v.name || merged[p]?.name || 'Ahli',
                                status: isAct ? 'ACTIVE' : (v.status || merged[p]?.status || 'NEW'),
                                expiredAt: exp || merged[p]?.expiredAt || null,
                                refCode: v.refCode || merged[p]?.refCode || generateReferralCode(v.name || 'Ahli', merged),
                                referredBy: v.referredBy || merged[p]?.referredBy || null,
                                paidReferrals: v.paidReferrals || merged[p]?.paidReferrals || 0,
                                totalPaidReferrals: v.totalPaidReferrals || merged[p]?.totalPaidReferrals || 0,
                                refSentToExisting: !!v.refSentToExisting,
                                reminded3Days: !!v.reminded3Days,
                                lid: v.lid ? normalizeIdentifier(v.lid) : (merged[p]?.lid || null),
                                jid: v.jid || merged[p]?.jid || null,
                                altJid: v.altJid || merged[p]?.altJid || null
                            };
                            if (v.lid) merged[normalizeIdentifier(v.lid)] = merged[p];
                        }
                    }
                }
            } catch {}
        }

        // 3. Muat dari users.json tempatan
        if (fs.existsSync(USERS_FILE)) {
            try {
                const localUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
                for (const [k, v] of Object.entries(localUsers)) {
                    const p = normalizeIdentifier(v.phone || k);
                    if (p) {
                        merged[p] = { ...merged[p], ...v, phone: p };
                        if (v.lid) merged[normalizeIdentifier(v.lid)] = merged[p];
                    }
                }
            } catch {}
        }

        // 4. Muat dari users.json kekal dalam Volume (sumber utama mutakhir)
        if (fs.existsSync(PERSISTENT_USERS_FILE)) {
            try {
                const persistentUsers = JSON.parse(fs.readFileSync(PERSISTENT_USERS_FILE, 'utf8'));
                for (const [k, v] of Object.entries(persistentUsers)) {
                    const p = normalizeIdentifier(v.phone || k);
                    if (p) {
                        merged[p] = { ...merged[p], ...v, phone: p };
                        if (v.lid) merged[normalizeIdentifier(v.lid)] = merged[p];
                    }
                }
            } catch {}
        }

        return merged;
    } catch (e) {
        console.error('Ralat gabung loadUsers:', e);
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

// -------------------------------------------------------------
// PENETAPAN IDENTITI PINTAR (DWIARAH PHONE <-> LID)
// -------------------------------------------------------------
function findUserRecord(users, remoteJid, altJid) {
    const cleanJid = normalizeIdentifier(remoteJid);
    const cleanAlt = normalizeIdentifier(altJid);

    // 1. Semakan terus pada rekod ACTIVE
    if (cleanJid && users[cleanJid] && users[cleanJid].status === 'ACTIVE' && users[cleanJid].expiredAt > Date.now()) {
        return users[cleanJid];
    }
    if (cleanAlt && users[cleanAlt] && users[cleanAlt].status === 'ACTIVE' && users[cleanAlt].expiredAt > Date.now()) {
        return users[cleanAlt];
    }

    // 2. Semakan melalui pemetaan LID atau telefon bagi akaun ACTIVE
    for (const u of Object.values(users)) {
        if (u.status === 'ACTIVE' && u.expiredAt && u.expiredAt > Date.now()) {
            if (u.phone === cleanJid || u.phone === cleanAlt) return u;
            if (u.lid === cleanJid || u.lid === cleanAlt) return u;
            if (u.jid === remoteJid || u.altJid === altJid) return u;
        }
    }

    // 3. Semakan bagi pengguna biasa (WAITING / NEW)
    if (cleanJid && users[cleanJid]) return users[cleanJid];
    if (cleanAlt && users[cleanAlt]) return users[cleanAlt];

    for (const u of Object.values(users)) {
        if (u.phone === cleanJid || u.phone === cleanAlt) return u;
        if (u.lid === cleanJid || u.lid === cleanAlt) return u;
        if (u.jid === remoteJid || u.altJid === altJid) return u;
    }

    return null;
}

// Penyelarasan Menyeluruh LID Ahli Aktif Menggunakan WhatsApp Server
async function syncAllActiveLids(sock) {
    try {
        const users = loadUsers();
        let updatedCount = 0;
        const uniquePhones = new Set();

        for (const u of Object.values(users)) {
            if (u.status === 'ACTIVE' && u.phone && !uniquePhones.has(u.phone)) {
                uniquePhones.add(u.phone);
                try {
                    const checkJid = u.phone.includes('@') ? u.phone : `${u.phone}@s.whatsapp.net`;
                    const [waUser] = await sock.onWhatsApp(checkJid);
                    if (waUser && waUser.lid) {
                        const cleanLid = normalizeIdentifier(waUser.lid);
                        u.lid = cleanLid;
                        users[cleanLid] = u;
                        updatedCount++;
                        console.log(`[Penyelarasan LID Berjaya] ${u.phone} (${u.name}) -> ${cleanLid}`);
                    }
                } catch {}
            }
        }
        if (updatedCount > 0) saveUsers(users);
        return updatedCount;
    } catch (e) {
        console.error('Ralat syncAllActiveLids:', e);
        return 0;
    }
}

const logger = pino({ level: 'silent' });

// -------------------------------------------------------------
// CACHE PERCUBAAN SEMULA & SIMPANAN MESEJ RINGKAS (ANTI-WAITING)
// -------------------------------------------------------------
const msgRetryCounterCache = {
    _map: new Map(),
    get(key) { return this._map.get(key); },
    set(key, val) { this._map.set(key, val); },
    del(key) { this._map.delete(key); },
    flushAll() { this._map.clear(); },
    get size() { return this._map.size; },
    clear() { this._map.clear(); }
};

const MAX_RECENT_MESSAGES = 250;
const recentMessages = new Map();

function storeRecentMessage(id, message) {
    if (!id || !message) return;
    if (recentMessages.size >= MAX_RECENT_MESSAGES) {
        const oldestKey = recentMessages.keys().next().value;
        recentMessages.delete(oldestKey);
    }

    const stub = {};
    if (message.conversation) stub.conversation = message.conversation;
    if (message.extendedTextMessage) stub.extendedTextMessage = { text: message.extendedTextMessage.text || '' };
    if (message.imageMessage) {
        stub.imageMessage = {
            caption: message.imageMessage.caption || '',
            mimetype: message.imageMessage.mimetype || 'image/jpeg'
        };
    }
    if (message.videoMessage) {
        stub.videoMessage = {
            caption: message.videoMessage.caption || '',
            mimetype: message.videoMessage.mimetype || 'video/mp4'
        };
    }
    if (message.documentMessage) {
        stub.documentMessage = {
            caption: message.documentMessage.caption || '',
            mimetype: message.documentMessage.mimetype || '',
            fileName: message.documentMessage.fileName || ''
        };
    }
    if (Object.keys(stub).length === 0) {
        stub.conversation = '';
    }
    recentMessages.set(id, stub);
}

// -------------------------------------------------------------
// PENYELESAIAN BINARI FFMPEG / FFPROBE
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// ANTRIAN PEMPROSESAN MEDIA SEQUENTIAL
// -------------------------------------------------------------
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
        const position = this.queue.length;
        this.processNext();
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
            }
            this.activeJob = null;
            this.processNext();
        }
    }
}

const videoQueue = new RobustVideoQueue();

async function probeVideo(filePath, binPath) {
    return new Promise((resolve) => {
        const args = [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=duration,r_frame_rate,color_transfer,color_primaries,color_space',
            '-show_entries', 'format=duration',
            '-of', 'json',
            filePath
        ];

        const proc = spawn(binPath, args);
        let stdout = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });

        proc.on('close', (code) => {
            let duration = 30;
            let fps = 30;
            let isHDR = false;

            if (code === 0) {
                try {
                    const info = JSON.parse(stdout);
                    const vStream = info.streams && info.streams[0];
                    const rawDur = vStream?.duration || info.format?.duration;
                    const parsedDur = parseFloat(rawDur);
                    if (!isNaN(parsedDur) && parsedDur > 0) {
                        duration = parsedDur;
                    }

                    if (vStream?.r_frame_rate) {
                        const parts = vStream.r_frame_rate.split('/');
                        if (parts.length === 2) {
                            const num = parseFloat(parts[0]);
                            const den = parseFloat(parts[1]);
                            if (den > 0) fps = num / den;
                        } else {
                            const parsedFps = parseFloat(vStream.r_frame_rate);
                            if (!isNaN(parsedFps) && parsedFps > 0) fps = parsedFps;
                        }
                    }

                    const transfer = (vStream?.color_transfer || '').toLowerCase();
                    const primaries = (vStream?.color_primaries || '').toLowerCase();
                    if (
                        transfer.includes('smpte2084') ||
                        transfer.includes('arib-std-b67') ||
                        primaries.includes('bt2020')
                    ) {
                        isHDR = true;
                    }
                } catch (e) {
                    console.error('[Ralat Parse FFprobe]:', e);
                }
            }
            resolve({ duration, fps, isHDR });
        });

        proc.on('error', () => resolve({ duration: 30, fps: 30, isHDR: false }));
    });
}

async function transcode60fpsVideo(inputPath, outputPath, binPath, vBitrate, targetShortSide, sourceFps, isHDR) {
    return new Promise((resolve, reject) => {
        const isHighFps = sourceFps >= 48;
        const scaleFilter = `scale='if(gt(iw,ih),-2,${targetShortSide})':'if(gt(iw,ih),${targetShortSide},-2)':flags=lanczos`;
        const hasCas = checkCasSupport(binPath);
        const sharpFilter = hasCas ? 'cas=strength=0.35' : 'unsharp=5:5:0.35:5:5:0.0';

        let filterParts = [];
        if (isHDR) {
            const hasZscale = checkZscaleSupport(binPath);
            if (hasZscale) {
                filterParts.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p');
            } else {
                filterParts.push('eq=contrast=1.08:saturation=1.18,format=yuv420p');
            }
        }

        filterParts.push(scaleFilter);
        filterParts.push(sharpFilter);

        if (isHighFps) {
            filterParts.push('setpts=N/(60*TB)');
        }

        const vfChain = filterParts.join(',');

        let args = [
            '-y',
            '-i', inputPath,
            '-t', '60',
            '-vf', vfChain,
            '-c:v', 'libx264',
            '-preset', 'slow',
            '-profile:v', 'high',
            '-level:v', '4.1',
            '-b:v', `${vBitrate}k`,
            '-maxrate', `${Math.floor(vBitrate * 1.15)}k`,
            '-bufsize', `${Math.floor(vBitrate * 1.5)}k`,
            '-pix_fmt', 'yuv420p',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-bf', '0',
            '-refs', '3',
            '-rc-lookahead', '25',
            '-g', '60',
            '-keyint_min', '60',
            '-x264-params', 'deblock=-1,-1:aq-mode=3:aq-strength=1.0:psy-rd=1.0,0.15'
        ];

        if (isHighFps) {
            args.push('-fps_mode', 'cfr', '-r', '60');
        } else {
            args.push('-fps_mode', 'cfr');
        }

        args.push(
            '-c:a', 'aac',
            '-b:a', '96k',
            '-ar', '44100',
            '-ac', '2',
            '-threads', '2',
            '-movflags', '+faststart',
            outputPath
        );

        const proc = spawn(binPath, args);
        let stderr = '';

        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve();
            } else {
                reject(new Error(`FFmpeg ralat (kod ${code}): ${stderr.slice(-400)}`));
            }
        });

        proc.on('error', reject);
    });
}

async function enhanceQhdPhoto(inputPath, outputPath, binPath) {
    const hasCas = checkCasSupport(binPath);
    const sharpFilter = hasCas ? 'cas=strength=0.35' : 'unsharp=5:5:0.35:5:5:0.0';
    const scaleFilter = "scale='if(gt(iw,ih),-2,min(ih,2560))':'if(gt(iw,ih),min(iw,2560),-2)':flags=lanczos";
    const vfChain = `${scaleFilter},${sharpFilter}`;

    const runEncode = async (qValue) => {
        return new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-i', inputPath,
                '-vf', vfChain,
                '-q:v', `${qValue}`,
                outputPath
            ];

            const proc = spawn(binPath, args);
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg imej ralat (kod ${code}): ${stderr.slice(-400)}`));
                }
            });
            proc.on('error', reject);
        });
    };

    let usedQ = 2;
    await runEncode(usedQ);

    let stats = fs.statSync(outputPath);
    const MAX_SAFE_IMAGE_BYTES = Math.floor(1.85 * 1024 * 1024);

    if (stats.size > MAX_SAFE_IMAGE_BYTES) {
        usedQ = 4;
        await runEncode(usedQ);
        stats = fs.statSync(outputPath);
    }

    if (stats.size > MAX_SAFE_IMAGE_BYTES) {
        usedQ = 6;
        await runEncode(usedQ);
        stats = fs.statSync(outputPath);
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

// -------------------------------------------------------------
// PANGGILAN HITPAY PAYMENT REQUEST API (ASLI FETCH)
// -------------------------------------------------------------
async function createHitPayPaymentRequest({ phone, pushName, days, amount }) {
    if (!HITPAY_API_KEY) {
        throw new Error('HITPAY_API_KEY belum dikonfigurasikan di persekitaran (Environment Variables).');
    }

    console.log(`[HITPAY] Creating payment request for ${phone} (${days} days)...`);

    const cleanAmount = parseFloat(amount).toFixed(2);
    const payload = {
        amount: cleanAmount,
        currency: 'MYR',
        name: (pushName || phone || 'Ahli StatusClear').slice(0, 50),
        purpose: `StatusClear (${days} Hari)`,
        reference_number: `${phone}|${days}`,
        redirect_url: 'https://wa.me/' + (process.env.PAIRING_NUMBER || ADMIN_NUMBER),
        send_email: false,
        send_sms: false
    };

    if (WEBHOOK_PUBLIC_URL) {
        payload.webhook = `${WEBHOOK_PUBLIC_URL.replace(/\/+$/, '')}/webhook/hitpay`;
    }

    const response = await fetch(HITPAY_API_URL, {
        method: 'POST',
        headers: {
            'X-BUSINESS-API-KEY': HITPAY_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(payload)
    });

    console.log(`[HITPAY] Response status: ${response.status} ${response.statusText}`);

    const resText = await response.text();
    let resJson = {};
    try {
        resJson = JSON.parse(resText);
    } catch {
        throw new Error(`HitPay API Ralat (${response.status}): ${resText.slice(0, 200)}`);
    }

    if (!response.ok) {
        const errMsg = resJson.message || resJson.error || JSON.stringify(resJson);
        throw new Error(`HitPay Gateway Ralat (${response.status}): ${errMsg}`);
    }

    return resJson;
}

// -------------------------------------------------------------
// PENGESAHAN KESELAMATAN HMAC WEBHOOK HITPAY
// -------------------------------------------------------------
function safeCompareHex(a, b) {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifyHitPaySignature(rawBuffer, headers, parsedBody) {
    if (!HITPAY_SALT) {
        console.warn('[HitPay Webhook] HITPAY_SALT tidak diset; mengabaikan pengesahan tandatangan.');
        return true;
    }

    const hmacInPayload = parsedBody?.hmac;
    if (hmacInPayload) {
        const dataToSign = { ...parsedBody };
        delete dataToSign.hmac;

        const sortedKeys = Object.keys(dataToSign).sort();
        const concatenated = sortedKeys.map(k => `${k}${dataToSign[k]}`).join('');

        const computedBodyHmac = crypto
            .createHmac('sha256', HITPAY_SALT)
            .update(concatenated)
            .digest('hex');

        if (safeCompareHex(computedBodyHmac, hmacInPayload)) {
            return true;
        }
    }

    const hitpaySignatureHeader = headers['x-hitpay-signature'] || headers['hitpay-signature'];
    if (hitpaySignatureHeader) {
        const computedHeaderHmac = crypto
            .createHmac('sha256', HITPAY_SALT)
            .update(rawBuffer)
            .digest('hex');

        if (safeCompareHex(computedHeaderHmac, hitpaySignatureHeader)) {
            return true;
        }
    }

    return false;
}

// -------------------------------------------------------------
// PELAYAN WEB RAILWAY & PENGENDALI WEBHOOK HITPAY
// -------------------------------------------------------------
const PORT = process.env.PORT || process.env.WEBHOOK_PORT || 3000;
let currentSock = null;
let httpServer = null;

function ensureHttpServer() {
    if (httpServer) return httpServer;

    const server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;

        if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                bot: BOT_NAME,
                uptime: Math.floor(process.uptime()),
                hitpayConfigured: !!HITPAY_API_KEY,
                env: HITPAY_ENV
            }));
            return;
        }

        if (req.method === 'POST' && pathname === '/webhook/hitpay') {
            let chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                const rawBuffer = Buffer.concat(chunks);
                const rawBody = rawBuffer.toString('utf8');
                let parsedBody = {};

                const contentType = (req.headers['content-type'] || '').toLowerCase();
                if (contentType.includes('application/json')) {
                    try { parsedBody = JSON.parse(rawBody); } catch {}
                } else {
                    try {
                        const params = new URLSearchParams(rawBody);
                        for (const [key, value] of params.entries()) {
                            parsedBody[key] = value;
                        }
                    } catch {}
                }

                const paymentId = parsedBody.payment_id || parsedBody.id || parsedBody.reference_number;
                const status = (parsedBody.status || '').toLowerCase();
                const referenceNumber = parsedBody.reference_number || '';

                console.log(`[HitPay Webhook] Menerima event: payment_id=${paymentId}, status=${status}, ref=${referenceNumber}`);

                const isSignatureValid = verifyHitPaySignature(rawBuffer, req.headers, parsedBody);
                if (!isSignatureValid) {
                    console.error('[HitPay Webhook] Ralat Keselamatan: Tandatangan HMAC tidak sah!');
                    res.writeHead(401, { 'Content-Type': 'text/plain' });
                    res.end('Invalid signature');
                    return;
                }

                const processed = loadProcessedPayments();
                if (paymentId && processed.has(paymentId)) {
                    console.log(`[HitPay Webhook] Idempotensi: Transaksi ${paymentId} sudah diproses.`);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Already processed');
                    return;
                }

                if (status === 'completed') {
                    console.log(`[HitPay Webhook] Bayaran ${paymentId} disahkan berjaya! Mengaktifkan akaun: ${referenceNumber}...`);
                    if (paymentId) recordProcessedPayment(paymentId);

                    const [rawPhone, rawDays] = referenceNumber.split('|');
                    const targetPhone = normalizeIdentifier(rawPhone);
                    const days = parseInt(rawDays, 10) || 30;

                    if (targetPhone) {
                        try {
                            const users = loadUsers();
                            let targetUser = users[targetPhone];
                            if (!targetUser) {
                                for (const u of Object.values(users)) {
                                    if (u.phone === targetPhone || u.lid === targetPhone) {
                                        targetUser = u;
                                        break;
                                    }
                                }
                            }

                            const customerName = parsedBody.name || targetUser?.name || 'Ahli';

                            if (!targetUser) {
                                targetUser = {
                                    phone: targetPhone,
                                    name: customerName,
                                    status: 'ACTIVE',
                                    expiredAt: Date.now() + days * 24 * 60 * 60 * 1000,
                                    refCode: generateReferralCode(customerName, users),
                                    referredBy: null,
                                    paidReferrals: 0,
                                    totalPaidReferrals: 0,
                                    refSentToExisting: true,
                                    reminded3Days: false,
                                    jid: null,
                                    altJid: null
                                };
                                users[targetPhone] = targetUser;
                            } else {
                                if (customerName && (!targetUser.name || targetUser.name === 'Ahli' || targetUser.name === 'Pengguna')) {
                                    targetUser.name = customerName;
                                }
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

                            if (currentSock) {
                                try {
                                    const checkJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`;
                                    const [waUser] = await currentSock.onWhatsApp(checkJid);
                                    if (waUser && waUser.lid) {
                                        const cleanLid = normalizeIdentifier(waUser.lid);
                                        targetUser.lid = cleanLid;
                                        users[cleanLid] = targetUser;
                                    }
                                } catch {}
                            }

                            let referralRewardMsg = '';
                            if (targetUser.referredBy && !targetUser.referralCredited) {
                                targetUser.referralCredited = true;
                                const referrer = users[targetUser.referredBy] || Object.values(users).find(u => u.phone === targetUser.referredBy);
                                if (referrer) {
                                    referrer.paidReferrals = (referrer.paidReferrals || 0) + 1;
                                    referrer.totalPaidReferrals = (referrer.totalPaidReferrals || 0) + 1;
                                    referralRewardMsg = `\n• Penaja: ${referrer.name} (${referrer.phone}) [+1 Tajaan, Baki: ${referrer.paidReferrals}/3]`;

                                    const refJid = referrer.jid || referrer.altJid || (referrer.phone.includes('@') ? referrer.phone : `${referrer.phone}@s.whatsapp.net`);
                                    const friendDisplayName = targetUser.name || customerName || targetPhone;

                                    if (referrer.paidReferrals >= 3) {
                                        referrer.paidReferrals -= 3;
                                        const refNow = Date.now();
                                        const refBase = (referrer.expiredAt && referrer.expiredAt > refNow) ? referrer.expiredAt : refNow;
                                        referrer.expiredAt = refBase + 30 * 24 * 60 * 60 * 1000;
                                        referrer.status = 'ACTIVE';

                                        const newExpiryStr = new Date(referrer.expiredAt).toLocaleDateString('ms-MY', {
                                            day: '2-digit', month: '2-digit', year: 'numeric'
                                        });

                                        if (currentSock) {
                                            try {
                                                await currentSock.sendMessage(refJid, {
                                                    text:
                                                        `🎉 *TAHNIAH! ANDA MENDAPAT 1 BULAN PERCUMA!*\n\n` +
                                                        `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* (${targetPhone}) telah melengkapkan *3/3 tajaan* menggunakan kod referral anda (*${referrer.refCode}*)!\n\n` +
                                                        `🎁 *Ganjaran Diterima:*\n` +
                                                        `Tempoh langganan akaun anda telah ditambah secara automatik selama *+30 HARI*!\n\n` +
                                                        `⏳ *Tarikh Luput Baharu:* *${newExpiryStr}*\n\n` +
                                                        `Teruskan berkongsi kod anda untuk mendapatkan lebih banyak ganjaran percuma! 🚀`
                                                });
                                                console.log(`[REFERRAL BONUS] Berjaya hantar notifikasi +30 hari ke ${refJid}`);
                                            } catch (refErr) {
                                                console.error(`[REFERRAL BONUS] Gagal hantar notifikasi bonus ke ${refJid}:`, refErr.message);
                                            }
                                        }
                                        referralRewardMsg += ` ➔ BONUS +30 HARI TELAH DIBERIKAN!`;
                                    } else {
                                        const remaining = 3 - referrer.paidReferrals;
                                        if (currentSock) {
                                            try {
                                                await currentSock.sendMessage(refJid, {
                                                    text:
                                                        `🎉 *TAJAAN BERJAYA (+1 RAKAN)!*\n\n` +
                                                        `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* (${targetPhone}) telah berjaya melanggan menggunakan kod referral anda (*${referrer.refCode}*)!\n\n` +
                                                        `📊 *Kemajuan Ganjaran:* *${referrer.paidReferrals}/3 Rakan*\n` +
                                                        `💡 Ajak lagi *${remaining} rakan* sahaja lagi untuk menerima *PERCUMA 1 BULAN (30 Hari)* secara automatik! 🚀`
                                                });
                                                console.log(`[REFERRAL PROGRESS] Berjaya hantar notifikasi kemajuan (${referrer.paidReferrals}/3) ke ${refJid}`);
                                            } catch (refErr) {
                                                console.error(`[REFERRAL PROGRESS] Gagal hantar notifikasi kemajuan ke ${refJid}:`, refErr.message);
                                            }
                                        }
                                    }
                                }
                            }

                            saveUsers(users);

                            const formattedExpiryDate = new Date(targetUser.expiredAt).toLocaleDateString('ms-MY', {
                                day: '2-digit', month: '2-digit', year: 'numeric'
                            });

                            // Resolusi Sasaran JID WhatsApp yang Kebal (user.jid || user.altJid || phone@s.whatsapp.net)
                            const targetJid = targetUser.jid || targetUser.altJid || `${targetPhone}@s.whatsapp.net`;

                            const welcomeTutorialMessage = 
`✅ *PEMBAYARAN BERJAYA & AKAUN AKTIF!*

Selamat datang ke *StatusClear HD*! Langganan anda kini sudah aktif dan sedia digunakan sepenuhnya.

📅 *Tempoh Aktif:* +${days} Hari
⏳ *Tamat Pada:* ${formattedExpiryDate}

━━━━━━━━━━━━━━━━━━━━
📖 *TUTORIAL GUNA BOT (SUPAYA STATUS TAK PECAH):*

1️⃣ Tekan ikon *Klip Kertas / (+)* di ruangan chat ini.
2️⃣ Pilih *Document* (JANGAN pilih Gallery/Photos terus).
3️⃣ Pilih *Video* (maksimum 60 saat) atau *Gambar* asal anda dan tekan *Send*.
4️⃣ Tunggu bot proses sebentar (reaksi ⏳ bertukar ✅) dan muat turun fail HD yang bot pulangkan.
5️⃣ Muat naik fail HD tersebut ke *WhatsApp Status* anda!
━━━━━━━━━━━━━━━━━━━━

🎁 *KOD REFERRAL PERIBADI ANDA:*
👉 *${targetUser.refCode}*

Kongsikan kod ini kepada rakan anda! Setiap *3 rakan* yang melanggan menggunakan kod anda, anda akan dapat *PERCUMA +30 Hari (1 Bulan)* secara automatik! 🎉

_Sila hantar video atau gambar pertama anda sebagai Document sekarang untuk mula!_ 🚀`;

                            if (currentSock) {
                                try {
                                    await currentSock.sendMessage(targetJid, { text: welcomeTutorialMessage });
                                    console.log(`[HITPAY -> WA] Sent welcome & tutorial to ${targetJid}`);
                                } catch (waErr) {
                                    console.error(`[HITPAY -> WA] Ralat penghantaran ke ${targetJid}:`, waErr.message);
                                    if (targetJid !== `${targetPhone}@s.whatsapp.net`) {
                                        try {
                                            await currentSock.sendMessage(`${targetPhone}@s.whatsapp.net`, { text: welcomeTutorialMessage });
                                            console.log(`[HITPAY -> WA] Sent welcome & tutorial fallback to ${targetPhone}@s.whatsapp.net`);
                                        } catch (fallbackErr) {
                                            console.error(`[HITPAY -> WA] Fallback juga gagal ke ${targetPhone}@s.whatsapp.net:`, fallbackErr.message);
                                        }
                                    }
                                }

                                const adminJid = ADMIN_NUMBER.includes('@') ? ADMIN_NUMBER : `${ADMIN_NUMBER}@s.whatsapp.net`;
                                try {
                                    await currentSock.sendMessage(adminJid, {
                                        text:
                                            `💰 *NOTIFIKASI JUALAN HITPAY (AUTOMATIK)*\n\n` +
                                            `• Pelanggan: *${targetUser.name}* (${targetPhone})\n` +
                                            `• Sasaran JID: ${targetJid}\n` +
                                            `• Pakej: +${days} Hari (ID: ${paymentId})\n` +
                                            `• Kaedah: ${parsedBody.payment_type || 'HitPay Online Gateway'}\n` +
                                            `• Tarikh Luput: ${formattedExpiryDate}\n` +
                                            `• Kod Referral: *${targetUser.refCode}*${referralRewardMsg}`
                                    });
                                } catch (adminErr) {
                                    console.error('[HITPAY -> ADMIN] Gagal hantar notifikasi ke admin:', adminErr.message);
                                }
                            }

                        } catch (dbErr) {
                            console.error('[HitPay Webhook] Ralat pengaktifan pangkalan data:', dbErr);
                        }
                    }
                }

                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Webhook received successfully');
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[Pelayan Web] Berjalan pada port ${PORT} (0.0.0.0) untuk Health Checks & HitPay Webhook.`);
    });

    httpServer = server;
    return server;
}

// -------------------------------------------------------------
// FUNGSI UTAMA PELANCARAN BOT BAILEYS
// -------------------------------------------------------------
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const pairingNumber = (process.env.PAIRING_NUMBER || '601157270564').replace(/\D/g, '');

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: !pairingNumber,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        msgRetryCounterCache,
        getMessage: async (key) => {
            if (key && key.id && recentMessages.has(key.id)) {
                return recentMessages.get(key.id);
            }
            return { conversation: '' };
        }
    });

    currentSock = sock;
    ensureHttpServer();

    sock.ev.on('creds.update', saveCreds);

    if (pairingNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(pairingNumber);
                console.log(`\n=============================================`);
                console.log(`🔑 Your WhatsApp 8-Digit Pairing Code: ${code}`);
                console.log(`=============================================\n`);
            } catch (err) {
                console.error('[Pairing Code Error]:', err);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !pairingNumber) {
            console.log('\n[WhatsApp QR] Sila imbas kod QR di bawah:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[Sambungan Terputus] Kod status: ${statusCode}. Memulakan semula: ${shouldReconnect}`);

            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('Sesi log keluar dikesan. Sila padamkan auth_info dan log masuk semula.');
            }
        } else if (connection === 'open') {
            console.log(`\n=================================================`);
            console.log(`🚀 ${BOT_NAME} bersambung secara rasmi ke WhatsApp!`);
            console.log(`=================================================\n`);

            setTimeout(async () => {
                const updated = await syncAllActiveLids(sock);
                if (updated > 0) {
                    console.log(`[Auto-Sync Mula] ${updated} rekod LID ahli aktif telah diselaraskan.`);
                }
            }, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || m.messages.length === 0) return;

        for (const msg of m.messages) {
            if (msg.key && msg.key.id) {
                storeRecentMessage(msg.key.id, unwrapMessage(msg.message) || msg.message);
            }

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

            // Normalisasi Konsisten Identiti Pengirim (@lid & @s.whatsapp.net)
            const rawJid = msg.key.remoteJidAlt || msg.key.remoteJid || '';
            const phone = rawJid.split('@')[0].replace(/\D/g, '');

            const users = loadUsers();
            let user = users[phone] || findUserRecord(users, remoteJid, altJid);

            // Jika mesej datang dari LID yang belum dikenali
            if ((!user || user.status !== 'ACTIVE') && remoteJid.endsWith('@lid')) {
                for (const u of Object.values(users)) {
                    if (u.status === 'ACTIVE' && u.phone) {
                        try {
                            const checkJid = u.phone.includes('@') ? u.phone : `${u.phone}@s.whatsapp.net`;
                            const [waUser] = await sock.onWhatsApp(checkJid);
                            if (waUser && waUser.lid) {
                                const cleanLid = normalizeIdentifier(waUser.lid);
                                u.lid = cleanLid;
                                users[cleanLid] = u;
                                if (cleanLid === phone || cleanLid === normalizeIdentifier(remoteJid)) {
                                    user = u;
                                    saveUsers(users);
                                    console.log(`[LID Dikenalpasti On-The-Fly] ${remoteJid} -> ${u.phone} (${u.name})`);
                                    break;
                                }
                            }
                        } catch {}
                    }
                }
            }

            if (!user && phone) {
                const pushName = msg.pushName || 'Pengguna';
                const refCode = generateReferralCode(pushName, users);
                user = {
                    phone: phone,
                    name: pushName,
                    status: 'NEW',
                    expiredAt: null,
                    refCode: refCode,
                    referredBy: null,
                    paidReferrals: 0,
                    totalPaidReferrals: 0,
                    refSentToExisting: false,
                    reminded3Days: false,
                    jid: remoteJid,
                    altJid: altJid || null
                };
                users[phone] = user;
                if (remoteJid.endsWith('@lid')) {
                    const cleanLid = normalizeIdentifier(remoteJid);
                    if (cleanLid) {
                        user.lid = cleanLid;
                        users[cleanLid] = user;
                    }
                }
                saveUsers(users);
            } else if (user) {
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
            }

            const fromMe = msg.key.fromMe;
            const isAdmin = fromMe || ADMIN_IDENTIFIERS.some(id => remoteJid.includes(id) || phone === id) || phone === ADMIN_NUMBER;
            const isActive = user && user.status === 'ACTIVE' && user.expiredAt && user.expiredAt > Date.now();

            const textContent = (inner.conversation || inner.extendedTextMessage?.text || '').trim();
            const textParts = textContent.split(/\s+/);
            const rawCmd = textParts[0].toLowerCase();
            const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
            const upperText = textContent.toUpperCase();

            // ---------------------------------------------------------
            // 1. PENGENDALIAN ARAHAN PENTADBIR
            // ---------------------------------------------------------
            if (isAdmin && (['tunggu', 'waiting', 'tambah', 'add', 'daftar', 'kod', 'setref', 'hebah', 'broadcast', 'broadcastref', 'semak', 'check', 'padam', 'buang', 'delete', 'senarai', 'ahli', 'list', 'bantuan', 'menu', 'help', 'sync', 'selaras', 'fixsession', 'sesi', 'ram', 'memori'].includes(cmd))) {
                console.log(`[Arahan Pentadbir] ${remoteJid}: "${textContent}"`);

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
                    resp += `Untuk aktifkan ahli secara manual, taip:\n*tambah <nombor> <hari> [nama]*\n\nContoh:\n*tambah ${waitingList[0].phone} 30*`;
                    await sock.sendMessage(remoteJid, { text: resp.trim() }, { quoted: msg });
                    continue;
                }

                if (['tambah', 'add', 'daftar'].includes(cmd)) {
                    const rawTarget = textParts[1];
                    const days = parseInt(textParts[2], 10);
                    const optName = textParts.slice(3).join(' ').trim();

                    if (!rawTarget || isNaN(days) || days <= 0) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `❌ *Format Tidak Sah!*\n\n` +
                                `Gunakan format:\n` +
                                `*tambah <nombor> <hari> [nama]*\n` +
                                `atau */add <nombor> <hari> [nama]*\n\n` +
                                `Contoh:\n` +
                                `*tambah 01113270914 30 Fieya*`
                        }, { quoted: msg });
                        continue;
                    }

                    const targetPhone = normalizeIdentifier(rawTarget);
                    let targetUser = users[targetPhone];
                    if (!targetUser) {
                        for (const u of Object.values(users)) {
                            if (u.phone === targetPhone || u.lid === targetPhone) {
                                targetUser = u;
                                break;
                            }
                        }
                    }

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
                            reminded3Days: false,
                            jid: null,
                            altJid: null
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

                    try {
                        const checkJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`;
                        const [waUser] = await sock.onWhatsApp(checkJid);
                        if (waUser && waUser.lid) {
                            const cleanLid = normalizeIdentifier(waUser.lid);
                            targetUser.lid = cleanLid;
                            users[cleanLid] = targetUser;
                        }
                    } catch (e) {}

                    let referralRewardMsg = '';
                    if (targetUser.referredBy && !targetUser.referralCredited) {
                        targetUser.referralCredited = true;
                        const referrer = users[targetUser.referredBy] || Object.values(users).find(u => u.phone === targetUser.referredBy);
                        if (referrer) {
                            referrer.paidReferrals = (referrer.paidReferrals || 0) + 1;
                            referrer.totalPaidReferrals = (referrer.totalPaidReferrals || 0) + 1;
                            referralRewardMsg = `\n• Penaja: ${referrer.name} (${referrer.phone}) [+1 Tajaan, Baki: ${referrer.paidReferrals}/3]`;

                            const refJid = referrer.jid || referrer.altJid || (referrer.phone.includes('@') ? referrer.phone : `${referrer.phone}@s.whatsapp.net`);
                            const friendDisplayName = targetUser.name || targetPhone;

                            if (referrer.paidReferrals >= 3) {
                                referrer.paidReferrals -= 3;
                                const refNow = Date.now();
                                const refBase = (referrer.expiredAt && referrer.expiredAt > refNow) ? referrer.expiredAt : refNow;
                                referrer.expiredAt = refBase + 30 * 24 * 60 * 60 * 1000;
                                referrer.status = 'ACTIVE';

                                const newExpiryStr = new Date(referrer.expiredAt).toLocaleDateString('ms-MY', {
                                    day: '2-digit', month: '2-digit', year: 'numeric'
                                });

                                try {
                                    await sock.sendMessage(refJid, {
                                        text:
                                            `🎉 *TAHNIAH! ANDA MENDAPAT 1 BULAN PERCUMA!*\n\n` +
                                            `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* (${targetPhone}) telah melengkapkan *3/3 tajaan* menggunakan kod referral anda (*${referrer.refCode}*)!\n\n` +
                                            `🎁 *Ganjaran Diterima:*\n` +
                                            `Tempoh langganan akaun anda telah ditambah secara automatik selama *+30 HARI*!\n\n` +
                                            `⏳ *Tarikh Luput Baharu:* *${newExpiryStr}*\n\n` +
                                            `Teruskan berkongsi kod anda untuk mendapatkan lebih banyak ganjaran percuma! 🚀`
                                    });
                                } catch {}
                                referralRewardMsg += ` ➔ BONUS +30 HARI TELAH DIBERIKAN!`;
                            } else {
                                const remaining = 3 - referrer.paidReferrals;
                                try {
                                    await sock.sendMessage(refJid, {
                                        text:
                                            `🎉 *TAJAAN BERJAYA (+1 RAKAN)!*\n\n` +
                                            `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* (${targetPhone}) telah berjaya melanggan menggunakan kod referral anda (*${referrer.refCode}*)!\n\n` +
                                            `📊 *Kemajuan Ganjaran:* *${referrer.paidReferrals}/3 Rakan*\n` +
                                            `💡 Ajak lagi *${remaining} rakan* sahaja lagi untuk menerima *PERCUMA 1 BULAN (30 Hari)* secara automatik! 🚀`
                                    });
                                } catch {}
                            }
                        }
                    }

                    saveUsers(users);

                    const expDateStr = new Date(targetUser.expiredAt).toLocaleDateString('ms-MY', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });

                    const userJid = targetUser.jid || targetUser.altJid || (targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`);
                    try {
                        await sock.sendMessage(userJid, {
                            text:
                                `🎉 *TAHNIAH! LANGGANAN ANDA TELAH DIAKTIFKAN*\n\n` +
                                `Nama: ${targetUser.name}\n` +
                                `Status: AKTIF (+${days} Hari)\n` +
                                `Tarikh Luput: ${expDateStr}\n` +
                                `Kod Referral Peribadi Anda: *${targetUser.refCode}*\n\n` +
                                `🎁 *Ganjaran Referral Peribadi:*\n` +
                                `Ajak 3 rakan anda melanggan menggunakan kod anda (*${targetUser.refCode}*), dan anda akan menerima *PERCUMA 1 BULAN (30 Hari)* langganan secara automatik!\n\n` +
                                `Sila hantar video atau foto anda sebagai Dokumen untuk memulakan pemprosesan.`
                        });
                    } catch {}

                    await sock.sendMessage(remoteJid, {
                        text:
                            `✅ *PENGAKTIFAN KEAHLIAN BERJAYA*\n\n` +
                            `• Nama: ${targetUser.name}\n` +
                            `• Nombor: ${targetPhone}\n` +
                            `• Status: AKTIF (Diselaraskan)\n` +
                            `• Tempoh: +${days} Hari\n` +
                            `• Tarikh Luput: ${expDateStr}\n` +
                            `• Kod Referral: *${targetUser.refCode}*${referralRewardMsg}`
                    }, { quoted: msg });
                    continue;
                }

                if (['kod', 'setref'].includes(cmd)) {
                    const rawTarget = textParts[1];
                    const customRaw = textParts[2];

                    if (!rawTarget || !customRaw) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `❌ *Format Tidak Sah!*\n\n` +
                                `Gunakan format: *kod <nombor> <KOD_NAMA>*\n` +
                                `atau */setref <nombor> <KOD_NAMA>*\n\n` +
                                `Contoh: *kod 01113270914 FIEYA*`
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

                    const userJid = targetUser.jid || targetUser.altJid || (targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`);
                    try {
                        await sock.sendMessage(userJid, {
                            text:
                                `PENGEMASKINIAN KOD REFERRAL (${BOT_NAME})\n\n` +
                                `Pentadbir telah mengemas kini kod referral peribadi anda kepada: *${cleanCode}*\n\n` +
                                `Kongsi kod baharu ini kepada rakan anda untuk menikmati ganjaran 1 bulan percuma bagi setiap 3 langganan!`
                        });
                    } catch {}

                    await sock.sendMessage(remoteJid, {
                        text: `Kod referral untuk ${targetUser.name} (${targetPhone}) berjaya dikemas kini kepada *${cleanCode}*.`
                    }, { quoted: msg });
                    continue;
                }

                if (['hebah', 'broadcast', 'broadcastref'].includes(cmd)) {
                    const activeUsers = Object.values(users).filter(u => u.status === 'ACTIVE' && u.phone && u.phone !== ADMIN_NUMBER);
                    await sock.sendMessage(remoteJid, {
                        text: `Memulakan hebahan kod referral kepada ${activeUsers.length} ahli aktif...`
                    }, { quoted: msg });

                    let sentCount = 0;
                    for (const u of activeUsers) {
                        try {
                            if (!u.refCode) u.refCode = generateReferralCode(u.name, users);
                            u.refSentToExisting = true;
                            const targetJid = u.jid || u.altJid || (u.phone.includes('@') ? u.phone : `${u.phone}@s.whatsapp.net`);
                            await sock.sendMessage(targetJid, {
                                text:
                                    `MAKLUMAN GANJARAN REFERRAL (${BOT_NAME})\n\n` +
                                    `Hai ${u.name}, nikmati langganan PERCUMA dengan berkongsi kod jemputan anda!\n\n` +
                                    `Kod Referral Peribadi Anda: *${u.refCode}*\n\n` +
                                    `Ganjaran:\n` +
                                    `Setiap kali 3 rakan anda melanggan menggunakan kod anda, akaun anda akan menerima *PERCUMA 1 BULAN (30 Hari)* langganan secara automatik!`
                            });
                            sentCount++;
                            await new Promise(r => setTimeout(r, 1200));
                        } catch (err) {
                            console.error(`Gagal hebah ke ${u.phone}:`, err);
                        }
                    }
                    saveUsers(users);
                    await sock.sendMessage(remoteJid, {
                        text: `Hebahan selesai. Sebanyak ${sentCount} mesej berjaya dihantar.`
                    }, { quoted: msg });
                    continue;
                }

                if (['semak', 'check'].includes(cmd)) {
                    const rawTarget = textParts[1];
                    if (!rawTarget) {
                        await sock.sendMessage(remoteJid, {
                            text: "Sila masukkan nombor telefon yang ingin disemak. Contoh: semak 01113270914"
                        }, { quoted: msg });
                        continue;
                    }

                    const targetPhone = normalizeIdentifier(rawTarget);
                    const targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);

                    if (!targetUser) {
                        await sock.sendMessage(remoteJid, {
                            text: `Akaun bagi nombor ${targetPhone} tidak dijumpai di dalam pangkalan data.`
                        }, { quoted: msg });
                        continue;
                    }

                    const expDateStr = targetUser.expiredAt ? new Date(targetUser.expiredAt).toLocaleDateString('ms-MY') : 'Tiada';
                    const isAct = targetUser.status === 'ACTIVE' && targetUser.expiredAt && targetUser.expiredAt > Date.now();
                    const daysLeft = isAct ? Math.ceil((targetUser.expiredAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

                    await sock.sendMessage(remoteJid, {
                        text:
                            `MAKLUMAT KEAHLIAN (${BOT_NAME})\n\n` +
                            `• Nama: ${targetUser.name}\n` +
                            `• Nombor: ${targetUser.phone}\n` +
                            `• Status: ${isAct ? 'AKTIF' : targetUser.status}\n` +
                            `• Baki Tempoh: ${daysLeft} hari (Luput: ${expDateStr})\n` +
                            `• Kod Referral: *${targetUser.refCode || 'Tiada'}*\n` +
                            `• Dijemput Oleh: ${targetUser.referredBy || 'Tiada'}\n` +
                            `• Bilangan Tajaan Semasa: ${targetUser.paidReferrals || 0}/3\n` +
                            `• Jumlah Keseluruhan Tajaan: ${targetUser.totalPaidReferrals || 0} orang`
                    }, { quoted: msg });
                    continue;
                }

                if (['padam', 'buang', 'delete'].includes(cmd)) {
                    const rawTarget = textParts[1];
                    if (!rawTarget) {
                        await sock.sendMessage(remoteJid, {
                            text: "Sila masukkan nombor yang ingin dipadam. Contoh: padam 01113270914"
                        }, { quoted: msg });
                        continue;
                    }

                    const targetPhone = normalizeIdentifier(rawTarget);
                    if (users[targetPhone]) {
                        delete users[targetPhone];
                        for (const [k, v] of Object.entries(users)) {
                            if (v.phone === targetPhone || v.lid === targetPhone) {
                                delete users[k];
                            }
                        }
                        saveUsers(users);
                        await sock.sendMessage(remoteJid, {
                            text: `Pengguna ${targetPhone} telah berjaya dipadamkan daripada pangkalan data.`
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text: `Nombor ${targetPhone} tidak dijumpai di dalam pangkalan data.`
                        }, { quoted: msg });
                    }
                    continue;
                }

                if (['senarai', 'ahli', 'list'].includes(cmd)) {
                    const activeUsers = Object.values(users).filter(u => u.status === 'ACTIVE' && u.expiredAt && u.expiredAt > Date.now());
                    if (activeUsers.length === 0) {
                        await sock.sendMessage(remoteJid, {
                            text: "Tiada ahli aktif di dalam sistem pada masa ini."
                        }, { quoted: msg });
                        continue;
                    }

                    let resp = `SENARAI AHLI AKTIF (${activeUsers.length} Orang)\n\n`;
                    activeUsers.forEach((u, i) => {
                        const daysLeft = Math.ceil((u.expiredAt - Date.now()) / (1000 * 60 * 60 * 24));
                        const expDateStr = new Date(u.expiredAt).toLocaleDateString('ms-MY');
                        resp += `${i + 1}. *${u.name}* (${u.phone})\n   └ Baki: ${daysLeft} hari (Luput: ${expDateStr}) | Ref: ${u.refCode || '-'}\n\n`;
                    });

                    await sock.sendMessage(remoteJid, { text: resp.trim() }, { quoted: msg });
                    continue;
                }

                if (['sync', 'selaras'].includes(cmd)) {
                    await sock.sendMessage(remoteJid, { text: "Memulakan proses penyelarasan LID ahli aktif..." }, { quoted: msg });
                    const count = await syncAllActiveLids(sock);
                    await sock.sendMessage(remoteJid, {
                        text: `Penyelarasan selesai. Sebanyak ${count} identiti LID ahli berjaya diperbaharui dan disimpan.`
                    }, { quoted: msg });
                    continue;
                }

                if (['fixsession', 'sesi'].includes(cmd)) {
                    const targetRaw = textParts[1];
                    let extraInfo = '';

                    msgRetryCounterCache.flushAll();
                    recentMessages.clear();

                    if (targetRaw) {
                        const targetPhone = normalizeIdentifier(targetRaw);
                        try {
                            const checkJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`;
                            const [waUser] = await sock.onWhatsApp(checkJid);
                            if (waUser && waUser.lid) {
                                const localUsers = loadUsers();
                                const cleanLid = normalizeIdentifier(waUser.lid);
                                if (localUsers[targetPhone]) {
                                    localUsers[targetPhone].lid = cleanLid;
                                    localUsers[cleanLid] = localUsers[targetPhone];
                                    saveUsers(localUsers);
                                }
                                extraInfo = `\n• Sasaran: ${targetPhone} (LID: ${cleanLid})\n• Sesi Signal & identiti LID diperbaharui.`;
                            }
                        } catch (e) {
                            extraInfo = `\n• Ralat semakan sasaran: ${e.message}`;
                        }
                    }

                    const synced = await syncAllActiveLids(sock);

                    await sock.sendMessage(remoteJid, {
                        text:
                            `🔧 *PEMULIHAN SESI SIGNAL BERJAYA (/fixsession)*\n\n` +
                            `• Retry Counter Cache: Dikosongkan (flushAll)\n` +
                            `• Simpanan Mesej Ringkas: Direset\n` +
                            `• Penyelarasan LID Ahli Aktif: ${synced} diselaraskan${extraInfo}\n\n` +
                            `Masalah *"Waiting for this message"* telah dipulihkan. Sila minta pengguna menghantar semula mesej mereka.`
                    }, { quoted: msg });
                    continue;
                }

                if (['ram', 'memori'].includes(cmd)) {
                    const mem = process.memoryUsage();
                    const rssMB = (mem.rss / (1024 * 1024)).toFixed(1);
                    const heapUsedMB = (mem.heapUsed / (1024 * 1024)).toFixed(1);
                    const uptimeSec = Math.floor(process.uptime());
                    const hours = Math.floor(uptimeSec / 3600);
                    const minutes = Math.floor((uptimeSec % 3600) / 60);
                    const percentage = ((parseFloat(rssMB) / 384) * 100).toFixed(1);

                    await sock.sendMessage(remoteJid, {
                        text:
                            `STATUS SISTEM & PRESTASI PELAYAN\n\n` +
                            `Penggunaan Memori:\n` +
                            `• Memori Fizikal (RSS): ${rssMB} MB / 384.0 MB (${percentage}%)\n` +
                            `• Memori Heap Aktif: ${heapUsedMB} MB\n` +
                            `• Simpanan Mesej (recentMessages): ${recentMessages.size}/250 item\n` +
                            `• HitPay Status: ${HITPAY_API_KEY ? 'Aktif (' + HITPAY_ENV + ')' : 'HITPAY_API_KEY Tiada'}\n` +
                            `• Kawalan Memori (GC): Aktif (--expose-gc & 384M Cap)\n\n` +
                            `Status Antrian Pemprosesan:\n` +
                            `• Sedang Diproses: ${videoQueue.activeJob ? '1 Media' : 'Tiada'}\n` +
                            `• Menunggu Dalam Antrian: ${videoQueue.waitingLength} / ${MAX_QUEUE_SIZE} Media\n\n` +
                            `Masa Operasi Pelayan: ${hours} jam ${minutes} minit`
                    }, { quoted: msg });
                    continue;
                }

                if (['bantuan', 'menu', 'help'].includes(cmd)) {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `📋 *PANDUAN PERINTAH PENTADBIR (${BOT_NAME})*\n\n` +
                            `1. *tunggu*\n` +
                            `   └ Lihat senarai pengguna yang belum bayar / hantar resit.\n\n` +
                            `2. *tambah <nombor> <hari> [nama]* (atau */add*)\n` +
                            `   └ Aktifkan ahli baharu atau sambung tempoh.\n` +
                            `   Contoh: tambah 01113270914 30 Fieya\n\n` +
                            `3. *kod <nombor> <nama_khas>* (atau */setref*)\n` +
                            `   └ Tukar kod referral ahli.\n` +
                            `   Contoh: kod 01113270914 FIEYA\n\n` +
                            `4. *hebah* (atau */broadcastref*)\n` +
                            `   └ Hantar kod referral ke semua ahli aktif secara automatik.\n\n` +
                            `5. *semak <nombor>* (atau */check*)\n` +
                            `   └ Semak baki hari dan status referral ahli.\n` +
                            `   Contoh: semak 01113270914\n\n` +
                            `6. *padam <nombor>*\n` +
                            `   └ Batalkan keahlian pengguna.\n\n` +
                            `7. *senarai*\n` +
                            `   └ Paparkan semua ahli aktif dan tarikh luput.\n\n` +
                            `8. *selaras*\n` +
                            `   └ Segerakkan identiti LID WhatsApp ahli aktif.\n\n` +
                            `9. *fixsession [nombor]*\n` +
                            `   └ Pulihkan sesi enkripsi Signal WhatsApp.\n\n` +
                            `10. *ram*\n` +
                            `   └ Semak status memori pelayan & antrian.`
                    }, { quoted: msg });
                    continue;
                }
            }

            // ---------------------------------------------------------
            // 2. PEMILIHAN PAKEJ INTERAKTIF (1, 2, 3, 4) ➔ HITPAY TERUS
            // ---------------------------------------------------------
            const cleanText = textContent.trim();
            const selectedPkg = PACKAGES[cleanText];
            if (selectedPkg && (!isActive || (user && user.status !== 'ACTIVE') || (user && user.expiredAt && user.expiredAt <= Date.now()))) {
                try {
                    await sock.sendMessage(remoteJid, {
                        react: { text: '⏳', key: msg.key }
                    });
                } catch {}

                try {
                    const hitpayRes = await createHitPayPaymentRequest({
                        phone: phone,
                        pushName: msg.pushName || user?.name || phone,
                        days: selectedPkg.days,
                        amount: selectedPkg.amount
                    });

                    await sock.sendMessage(remoteJid, {
                        text:
                            `💳 *PAUTAN PEMBAYARAN RASMI HITPAY*\n\n` +
                            `Pakej: *${selectedPkg.title}* (${selectedPkg.price} - ${selectedPkg.days} Hari)\n\n` +
                            `Sila tekan pautan selamat di bawah untuk membuat bayaran:\n` +
                            `🔗 ${hitpayRes.url}\n\n` +
                            `📌 *Kaedah Pembayaran Disokong:*\n` +
                            `• DuitNow QR (Semua Bank & eWallet)\n` +
                            `• FPX Online Banking (Maybank2u, CIMB Clicks, Bank Islam, dsb.)\n` +
                            `• Touch 'n Go eWallet, GrabPay, ShopeePay\n` +
                            `• Kad Debit / Kredit (Visa & Mastercard)\n\n` +
                            `⚡ *Pengesahan Automatik:*\n` +
                            `Akaun anda akan diaktifkan secara serta-merta sebaik sahaja transaksi selesai tanpa perlu hantar sebarang resit!`
                    }, { quoted: msg });

                    if (user) {
                        user.status = 'WAITING';
                        user.jid = remoteJid;
                        if (altJid) user.altJid = altJid;
                        saveUsers(users);
                    }

                    try {
                        await sock.sendMessage(remoteJid, {
                            react: { text: '🔗', key: msg.key }
                        });
                    } catch {}

                } catch (err) {
                    console.error(`[HITPAY] Ralat semasa memproses pembayaran untuk ${phone}:`, err.message);
                    await sock.sendMessage(remoteJid, {
                        text: `❌ *Ralat Pembayaran HitPay:*\n${err.message}\n\nSila hubungi pentadbir jika masalah berterusan.`
                    }, { quoted: msg });
                }
                continue;
            }

            // ---------------------------------------------------------
            // 3. PENEBUSAN KOD REFERRAL OLEH PENGGUNA
            // ---------------------------------------------------------
            const candidateCode = (cmd === 'ref' && textParts[1]) ? textParts[1].toUpperCase() : upperText;
            const matchedReferrer = Object.values(users).find(u => u.refCode && u.refCode.toUpperCase() === candidateCode);
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
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                const confirmCaption =
                    `✅ *KOD REFERRAL DISAHKAN!*\n\n` +
                    `Anda dijemput oleh *${matchedReferrer.name}* (${matchedReferrer.refCode}).\n\n` +
                    `${PACKAGE_TEMPLATE}`;

                await sock.sendMessage(remoteJid, { text: confirmCaption }, { quoted: msg });

                // Notifikasi Automatik ke Penaja bahawa kod telah ditebus oleh rakan
                const refJid = matchedReferrer.jid || matchedReferrer.altJid || (matchedReferrer.phone.includes('@') ? matchedReferrer.phone : `${matchedReferrer.phone}@s.whatsapp.net`);
                const friendName = msg.pushName || user.name || phone;
                try {
                    await sock.sendMessage(refJid, {
                        text:
                            `🔔 *KOD REFERRAL ANDA DIGUNAKAN!*\n\n` +
                            `Hai *${matchedReferrer.name}*, rakan anda *${friendName}* (${phone}) baru sahaja memasukkan kod referral anda (*${matchedReferrer.refCode}*)!\n\n` +
                            `📌 *Status:* Rakan anda kini sedang memilih pakej langganan.\n` +
                            `⚡ Anda akan menerima notifikasi sebaik sahaja mereka selesai membuat pembayaran. Terima kasih!`
                    });
                    console.log(`[REFERRAL NOTI] Penaja ${matchedReferrer.phone} diberitahu tentang ${phone} menggunakan kod.`);
                } catch (notiErr) {
                    console.error(`[REFERRAL NOTI] Gagal hantar notifikasi ke penaja:`, notiErr.message);
                }

                continue;
            }

            // ---------------------------------------------------------
            // 4. PEMBAYARAN TERUS (BAYAR / PAKEJ)
            // ---------------------------------------------------------
            if (['bayar', '/bayar', 'pakej', 'beli', 'qr'].includes(cmd) || upperText === 'BAYAR' || upperText === 'PAKEJ') {
                user.status = 'WAITING';
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                await sock.sendMessage(remoteJid, {
                    text:
                        `MAKLUMAT PEMBAYARAN LANGGANAN (${BOT_NAME})\n\n` +
                        `${PACKAGE_TEMPLATE}`
                }, { quoted: msg });
                continue;
            }

            // ---------------------------------------------------------
            // 5. ALIRAN START ONBOARDING & STATUS PENGGUNA
            // ---------------------------------------------------------
            if (['start', '/start', 'mula', 'menu', 'bantuan', 'help'].includes(cmd) || upperText === 'START') {
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;

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
                    saveUsers(users);
                    const isExpired = user && user.expiredAt && user.expiredAt <= Date.now();
                    const introText = isExpired
                        ? `STATUS: LANGGANAN TELAH TAMAT\n\nTempoh keahlian anda bagi ${BOT_NAME} telah tamat pada ${new Date(user.expiredAt).toLocaleDateString('ms-MY')}.`
                        : `STATUS: TIADA LANGGANAN AKTIF\n\nSelamat datang ke ${BOT_NAME}. Akaun anda belum mempunyai langganan aktif untuk memproses video 60 FPS & foto WhatsApp Status berkualiti tinggi.`;

                    const welcomeCaption =
                        `${introText}\n\n` +
                        `${PACKAGE_TEMPLATE}\n\n` +
                        `💡 *Cara Mendaftar:*\n` +
                        `1. Balas nombor *1, 2, 3, atau 4* untuk menjana pautan bayaran HitPay automatik (FPX, DuitNow QR, eWallet & Kad).\n` +
                        `2. Atau hantarkan kod referral rakan anda jika ada (contoh: *FIEYANINA482*).`;

                    await sock.sendMessage(remoteJid, { text: welcomeCaption }, { quoted: msg });
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
                            `Sila taip *START* untuk melihat senarai pakej dan memulakan langganan.`
                    }, { quoted: msg });
                }
                continue;
            }

            // ---------------------------------------------------------
            // 6. PENGESANAN MEDIA & SEKATAN KEAHLIAN (MEMBERSHIP GATE)
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
            const isDocVideo = docMime.startsWith('video/');
            const isDocImage = docMime.startsWith('image/');

            if (!isDirectImage && !isDocVideo && !isDocImage) {
                continue;
            }

            if (!isActive) {
                const isWaiting = user && user.status === 'WAITING';
                const msgText = isWaiting
                    ? `AKSES DITANGGUHKAN: MENUNGGU PEMBAYARAN\n\nAkaun anda sedang dalam proses pembayaran. Sila selesaikan pembayaran menggunakan pautan HitPay yang telah diberikan atau taip *START* untuk melihat semula pakej.`
                    : `AKSES DISEKAT: LANGGANAN DIPERLUKAN\n\nFungsi pemprosesan video 60 FPS & foto QHD+ hanya tersedia untuk ahli aktif.\n\nTaip *START* untuk melihat pakej langganan rasmi.`;

                await sock.sendMessage(remoteJid, { text: msgText }, { quoted: msg });
                continue;
            }

            // ---------------------------------------------------------
            // 7. CABANG A: PEMPROSESAN FOTO / IMEJ (Resolusi 2560px HD)
            // ---------------------------------------------------------
            if (isDirectImage || isDocImage) {
                const enqueueResult = videoQueue.enqueue({
                    userId: remoteJid,
                    run: async () => {
                        const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                        const inputPath = path.join(TEMP_DIR, `input_${fileId}.jpg`);
                        const outputPath = path.join(TEMP_DIR, `status_clear_photo_${fileId}.jpg`);

                        try {
                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '⏳', key: msg.key }
                                });
                            } catch {}

                            console.log(`\n[Pemprosesan Imej Bermula] Memuat turun foto dari ${remoteJid}...`);
                            const mediaStream = await downloadMediaMessage(msg, 'stream', {}, { logger, reuploadRequest: sock.updateMediaMessage });
                            await pipeline(mediaStream, fs.createWriteStream(inputPath));

                            console.log(`[FFmpeg Imej] Meningkatkan foto ke 2560px QHD+ dengan penapis Lanczos & CAS...`);
                            const { sizeBytes, hasCas, usedQ } = await enhanceQhdPhoto(inputPath, outputPath, ffmpegPath);

                            const sizeKB = (sizeBytes / 1024).toFixed(1);
                            const sharpNote = hasCas ? 'CAS 0.35 (Kontras Adaptif)' : 'Lanczos Sharp Resample';

                            await sock.sendMessage(remoteJid, {
                                image: { stream: fs.createReadStream(outputPath) },
                                caption:
                                    `PENGOPTIMUMAN FOTO SELESAI\n\n` +
                                    `Foto anda telah ditingkatkan ke resolusi 2560px (QHD+) dengan penalaan tajam ${sharpNote} & kawalan anti-mampatan WhatsApp Status.\n\n` +
                                    `• Saiz Fail: ${sizeKB} KB (Zon Selamat)\n` +
                                    `• Profil Kualiti: JPEG Q=${usedQ}\n\n` +
                                    `Sila muat naik foto ini terus ke WhatsApp Status anda!`
                            }, { quoted: msg });

                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '✅', key: msg.key }
                                });
                            } catch {}

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

                            console.log(`[Selesai] Foto HD (${sizeKB} KB) berjaya dihantar ke ${remoteJid}.`);

                        } catch (err) {
                            console.error('[Ralat Pemprosesan Imej]', err);
                            try {
                                await sock.sendMessage(remoteJid, {
                                    text: `Ralat: Proses penambahbaikan foto gagal dilaksanakan. (${err.message})`
                                }, { quoted: msg });
                            } catch {}
                        } finally {
                            if (fs.existsSync(inputPath)) { try { fs.unlinkSync(inputPath); } catch {} }
                            if (fs.existsSync(outputPath)) { try { fs.unlinkSync(outputPath); } catch {} }
                            if (global.gc) {
                                try {
                                    global.gc();
                                    const mem = process.memoryUsage();
                                    console.log(`[GC Imej Selesai] RAM aktif: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
                                } catch {}
                            }
                        }
                    }
                });

                if (!enqueueResult.success) {
                    if (enqueueResult.reason === 'full') {
                        await sock.sendMessage(remoteJid, {
                            text: `MAKLUMAN: Kapasiti antrian pemprosesan sedang penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE} media). Sila tunggu beberapa minit sebelum menghantar semula.`
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
            // 8. CABANG B: PEMPROSESAN DOKUMEN VIDEO (Gred 4K 60 FPS)
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
                            if (global.gc) {
                                try {
                                    global.gc();
                                    const mem = process.memoryUsage();
                                    console.log(`[GC Video Selesai] RAM aktif: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
                                } catch {}
                            }
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