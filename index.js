/**
 * StatusClear - Lossless WhatsApp Status Optimization Bot & PWA Admin Monitor
 * Single-file, ultra-lightweight implementation (<384MB RAM)
 * 
 * Features:
 * - Installable PWA Admin Monitor Dashboard (Dark Obsidian + Electric Lime Sans-Serif)
 * - Telemetry Endpoints: GET / (PWA), GET /manifest.json, GET /sw.js, GET /api/stats, POST /api/action
 * - Direct Automated HitPay Payment Request API (FPX, DuitNow QR, eWallets, Cards)
 * - Triple-Layer Bulletproof HitPay Engine (Webhook, Direct API Fallback, 60s Auto-Sync Poller)
 * - Auto WhatsApp Welcome, Confirmation & Step-by-Step Tutorial Delivery
 * - Complete Sponsor Referral Notifications (Redemption, Progress 1-2/3 & Free Month Milestone 3/3)
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
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { spawn, execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { pipeline } = require('stream/promises');
const heicConvert = require('heic-convert');

const BOT_NAME = "Status Clear By Danial";
const MAX_QUEUE_SIZE = 25;
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

// Primary Super Admin ('60194066718') & Additional Admins
const PRIMARY_ADMIN = '60194066718';
const EXTRA_ADMINS = (process.env.ADMIN_NUMBER || '')
    .split(',')
    .map(s => s.trim().replace(/[^0-9]/g, '').replace(/^0/, '60'))
    .filter(Boolean);
const ADMIN_NUMBER = PRIMARY_ADMIN;
const ADMIN_PIN = (process.env.ADMIN_PIN || '406618').trim();
const ADMIN_IDENTIFIERS = Array.from(new Set([
    PRIMARY_ADMIN,
    '0194066718',
    '194066718',
    ...EXTRA_ADMINS,
    '601154474066',
    '01154474066',
    '1154474066',
    '68225740046362'
]));

function isPrimaryAdmin(phone, remoteJid = '') {
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    return cleanPhone === PRIMARY_ADMIN || cleanPhone === '0194066718' || cleanPhone === '194066718' || String(remoteJid || '').includes(PRIMARY_ADMIN);
}

function isAnyAdmin(phone, remoteJid = '', fromMe = false) {
    if (fromMe || isPrimaryAdmin(phone, remoteJid)) return true;
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    return ADMIN_IDENTIFIERS.some(id => id && (String(remoteJid || '').includes(id) || cleanPhone === id));
}

function getPrimaryAdminJid() {
    return `${PRIMARY_ADMIN}@s.whatsapp.net`;
}

async function notifyAdmins(sock, text) {
    if (!sock || !text) return;
    const primaryJid = getPrimaryAdminJid();
    try {
        await sendCachedMessage(sock, primaryJid, { text });
    } catch (err) {
        console.error(`[ADMIN -> PRIMARY ${PRIMARY_ADMIN}] Gagal hantar notifikasi:`, err.message);
    }
    for (const extra of EXTRA_ADMINS) {
        if (extra && extra !== PRIMARY_ADMIN) {
            const extraJid = extra.includes('@') ? extra : `${extra}@s.whatsapp.net`;
            try {
                await sendCachedMessage(sock, extraJid, { text });
            } catch {}
        }
    }
}

// Konfigurasi Storan Kekal Railway (Volume Mounts)
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const AUTH_DIR = path.resolve(process.env.AUTH_DIR || path.join(__dirname, 'auth_info'));
const TEMP_DIR = path.join(__dirname, 'temp');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PERSISTENT_USERS_FILE = path.join(AUTH_DIR, 'users.json');
const PROCESSED_PAYMENTS_FILE = path.join(DATA_DIR, 'hitpay_processed.json');
const LEGACY_MEMBERS_FILE = path.join(AUTH_DIR, 'members.json');
const ROOT_MEMBERS_FILE = path.join(__dirname, 'members.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

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
// PENORMALAN NAMA (TITLE CASE) & PENGIRAAN YURAN HITPAY
// -------------------------------------------------------------
function formatTitleCaseName(rawName, fallbackPhone = '') {
    const cleaned = String(rawName || '')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .replace(/[^\p{L}\p{N}\s'.-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || /^(undefined|null|none|-)$/i.test(cleaned)) {
        const digits = String(fallbackPhone || '0000').replace(/\D/g, '');
        return 'User ' + (digits.slice(-4) || '0000');
    }
    return cleaned
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

function computeHitPayFeeAndNet(grossAmount, explicitFee = null) {
    const gross = Number((parseFloat(grossAmount) || 0).toFixed(2));
    const feePercent = parseFloat(process.env.HITPAY_FEE_PERCENT || '1.5');
    const fee = (explicitFee != null && explicitFee !== '' && !isNaN(parseFloat(explicitFee)))
        ? Number(parseFloat(explicitFee).toFixed(2))
        : Number(((gross * feePercent) / 100).toFixed(2));
    const net = Number(Math.max(0, gross - fee).toFixed(2));
    return {
        gross: gross.toFixed(2),
        fee: fee.toFixed(2),
        net: net.toFixed(2),
        grossNum: gross,
        feeNum: fee,
        netNum: net
    };
}

// -------------------------------------------------------------
// PENGURUSAN STATISTIK & KONFIGURASI TELEMETRI (PWA)
// -------------------------------------------------------------
function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        videosProcessed: 0,
        imagesProcessed: 0,
        transactions: []
    };
}

function saveStats(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {}
}

function incrementStat(key) {
    try {
        const stats = loadStats();
        stats[key] = (stats[key] || 0) + 1;
        saveStats(stats);
    } catch (e) {}
}

function recordTransaction(tx) {
    try {
        const stats = loadStats();
        if (!stats.transactions) stats.transactions = [];
        if (tx.paymentId && stats.transactions.some(t => t.paymentId === tx.paymentId)) return;
        const fin = computeHitPayFeeAndNet(tx.amount, tx.feeAmount ?? tx.fees);
        const normalizedTx = {
            ...tx,
            buyerName: formatTitleCaseName(tx.buyerName, tx.buyerPhone),
            amount: fin.gross,
            feeAmount: fin.fee,
            netAmount: fin.net
        };
        stats.transactions.unshift(normalizedTx);
        if (stats.transactions.length > 100) stats.transactions = stats.transactions.slice(0, 100);
        saveStats(stats);
    } catch (e) {}
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        railwayRenewDate: (process.env.RAILWAY_RENEW_DATE || '').trim()
    };
}

function saveConfig(cfg) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    } catch (e) {}
}

// -------------------------------------------------------------
// KONFIGURASI CHIP ASIA & HITPAY PAYMENT GATEWAY
// -------------------------------------------------------------
const CHIP_BRAND_ID = (process.env.CHIP_BRAND_ID || '').trim();
const CHIP_API_KEY = (process.env.CHIP_API_KEY || '').trim();
const CHIP_API_URL = 'https://gate.chip-in.asia/api/v1/purchases/';

const HITPAY_API_KEY = (process.env.HITPAY_API_KEY || '').trim();
const HITPAY_SALT = (process.env.HITPAY_SALT || '').trim();
const HITPAY_ENV = (process.env.HITPAY_ENV || 'live').toLowerCase().trim();
const HITPAY_BASE_URL = HITPAY_ENV === 'sandbox'
    ? 'https://api.sandbox.hit-pay.com/v1'
    : 'https://api.hit-pay.com/v1';
const HITPAY_API_URL = `${HITPAY_BASE_URL}/payment-requests`;

// Pengecaman Automatik Domain Railway Public
const WEBHOOK_PUBLIC_URL = (
    process.env.WEBHOOK_PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : '')
).trim();

const PUBLIC_BASE_URL = (
    process.env.PUBLIC_BASE_URL ||
    WEBHOOK_PUBLIC_URL ||
    'https://statusclear-production.up.railway.app'
).replace(/\/+$/, '').trim();

// -------------------------------------------------------------
// TEMPLAT PAKEJ LANGGANAN RASMI (WA, TT, COMBO & UPGRADE)
// -------------------------------------------------------------
const START_BANNER_PATH = path.join(__dirname, 'assets', 'start-banner.jpg');

const PACKAGES = {
    '1': { key: '1', planCode: 'WA', title: 'WhatsApp Status HD Sahaja', price: 'RM11.99', amount: '11.99', days: 30 },
    '2': { key: '2', planCode: 'TT', title: 'TikTok 1080p 60fps HD Sahaja', price: 'RM15.99', amount: '15.99', days: 30 },
    '3': { key: '3', planCode: 'COMBO', title: 'Combo WhatsApp + TikTok HD', price: 'RM20.99', amount: '20.99', days: 30 },
    '4': { key: '4', planCode: 'UPGRADE_TT', title: 'Upgrade Tambah TikTok HD (Ahli WA Aktif)', price: 'RM12.99', amount: '12.99', days: 30, requiresWa: true }
};

function calculateProratedUpgrade(waExpiredAt) {
    const now = Date.now();
    const remainingDays = (waExpiredAt && waExpiredAt > now)
        ? Math.max(1, Math.ceil((waExpiredAt - now) / 86400000))
        : 30;
    const proratedNum = Math.max(3.00, Number(((remainingDays / 30) * 12.99).toFixed(2)));
    return {
        remainingDays,
        amount: proratedNum.toFixed(2),
        priceLabel: `RM${proratedNum.toFixed(2)}`,
        isShortRemaining: remainingDays < 5
    };
}

const PACKAGE_TEMPLATE =
`*SENARAI PELAN LANGGANAN (${BOT_NAME}):*

*1. WhatsApp Status HD Sahaja* — *RM11.99 / 30 Hari*
   └ Video 60fps & Foto 2560px QHD+ untuk WhatsApp Status.

*2. TikTok 1080p 60fps HD Sahaja* — *RM15.99 / 30 Hari*
   └ Video 1080p 60fps CRF 18 tajam untuk muat naik TikTok.

*3. Combo WhatsApp + TikTok HD* — *RM20.99 / 30 Hari*
   └ Akses penuh untuk kedua-dua mod WhatsApp & TikTok HD.

*4. Upgrade Tambah TikTok HD* — *RM12.99 / 30 Hari (Prorata ikut baki hari WA)*
   └ Khas untuk ahli WhatsApp HD active; caj dikira ikut baki hari WA anda (min RM3.00) supaya tamat serentak.

Balas nombor *1, 2, 3, atau 4* untuk jana link pembayaran HitPay (FPX, DuitNow QR, eWallet & Kad).`;

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

function isGenericDisplayName(rawName) {
    const cleaned = String(rawName || '').trim();
    if (!cleaned) return true;
    return /^(ahli|pengguna|member|customer|hitpay payment|user\s*\d*)$/i.test(cleaned);
}

function normalizeUserTiers(u) {
    if (!u || typeof u !== 'object') return u;
    if (u.waExpiredAt === undefined && u.expiredAt) {
        u.waExpiredAt = u.expiredAt;
    }
    u.waExpiredAt = u.waExpiredAt || null;
    u.ttExpiredAt = u.ttExpiredAt || null;
    const maxExp = Math.max(u.waExpiredAt || 0, u.ttExpiredAt || 0);
    u.expiredAt = maxExp > 0 ? maxExp : (u.expiredAt || null);
    u.preferredMode = (u.preferredMode === 'TT') ? 'TT' : 'WA';
    u.telegramChatId = u.telegramChatId || null;
    if (u.realName) u.realName = formatTitleCaseName(u.realName, u.phone);
    if (u.waName) u.waName = formatTitleCaseName(u.waName, u.phone);
    u.name = formatTitleCaseName(u.realName || u.name, u.phone);
    if (!u.createdAt || typeof u.createdAt !== 'number' || isNaN(u.createdAt)) {
        const regParsed = u.registeredAt ? new Date(u.registeredAt).getTime() : NaN;
        u.createdAt = !isNaN(regParsed) ? regParsed : Date.now();
    }
    return u;
}

function migrateNamesAndFinancialsOnStartup() {
    try {
        const users = loadUsers();
        let usersChanged = false;
        for (const u of Object.values(users)) {
            if (!u || typeof u !== 'object') continue;
            const prevName = u.name;
            const prevCreatedAt = u.createdAt;
            normalizeUserTiers(u);
            if (u.name !== prevName || u.createdAt !== prevCreatedAt) {
                usersChanged = true;
            }
        }
        if (usersChanged) {
            saveUsers(users);
            console.log('[Startup Migration] Nama pengguna (Title Case) & createdAt dikemaskini dalam users.json.');
        }

        const stats = loadStats();
        let statsChanged = false;
        if (Array.isArray(stats.transactions)) {
            stats.transactions = stats.transactions.map(tx => {
                const fin = computeHitPayFeeAndNet(tx.amount, tx.feeAmount ?? tx.fees);
                const formattedBuyer = formatTitleCaseName(tx.buyerName, tx.buyerPhone);
                if (tx.buyerName !== formattedBuyer || tx.feeAmount == null || tx.netAmount == null || String(tx.amount) !== fin.gross) {
                    statsChanged = true;
                }
                return {
                    ...tx,
                    buyerName: formattedBuyer,
                    amount: fin.gross,
                    feeAmount: fin.fee,
                    netAmount: fin.net
                };
            });
            if (statsChanged) {
                saveStats(stats);
                console.log('[Startup Migration] Rekod transaksi HitPay (Title Case & Net/Fee) dikemaskini dalam stats.json.');
            }
        }
    } catch (err) {
        console.error('[Startup Migration Error]:', err.message);
    }
}

function hasWaAccess(user, isSuperAdmin = false) {
    if (isSuperAdmin) return true;
    return !!(user && user.waExpiredAt && user.waExpiredAt > Date.now());
}

function hasTtAccess(user, isSuperAdmin = false) {
    if (isSuperAdmin) return true;
    return !!(user && user.ttExpiredAt && user.ttExpiredAt > Date.now());
}

function hasAnyAccess(user, isSuperAdmin = false) {
    return hasWaAccess(user, isSuperAdmin) || hasTtAccess(user, isSuperAdmin);
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

        for (const [k, v] of Object.entries(merged)) {
            if (v && typeof v === 'object') normalizeUserTiers(v);
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
    if (cleanJid && users[cleanJid] && hasAnyAccess(users[cleanJid], false)) {
        return users[cleanJid];
    }
    if (cleanAlt && users[cleanAlt] && hasAnyAccess(users[cleanAlt], false)) {
        return users[cleanAlt];
    }

    // 2. Semakan melalui pemetaan LID atau telefon bagi akaun ACTIVE
    for (const u of Object.values(users)) {
        if (hasAnyAccess(u, false)) {
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
            if (hasAnyAccess(u, false) && u.phone && !String(u.phone).startsWith('tg_') && !uniquePhones.has(u.phone)) {
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
// CACHE PERCUBAAN SEMULA, SIMPANAN MESEJ (500) & HUMAN TYPING DELAY
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

const MSG_CACHE_FILE = path.join(DATA_DIR, 'msg_cache.json');
const MAX_CACHED_MESSAGES = 300;
const cachedMessages = new Map();
let msgCacheSaveTimer = null;
let isShuttingDown = false;

function loadMsgCache() {
    try {
        if (!fs.existsSync(MSG_CACHE_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(MSG_CACHE_FILE, 'utf8'));
        if (!raw || typeof raw !== 'object') return;
        const entries = Object.entries(raw).slice(-MAX_CACHED_MESSAGES);
        for (const [id, msgObj] of entries) {
            if (!id || !msgObj) continue;
            try {
                const hydrated = (proto && proto.Message && typeof proto.Message.fromObject === 'function')
                    ? proto.Message.fromObject(msgObj)
                    : msgObj;
                cachedMessages.set(id, hydrated);
            } catch {
                cachedMessages.set(id, msgObj);
            }
        }
        console.log(`[MsgCache] Loaded ${cachedMessages.size} cached messages from disk.`);
    } catch (err) {
        console.error('[MsgCache Load Error]:', err.message);
    }
}

function flushMsgCache() {
    if (msgCacheSaveTimer) {
        clearTimeout(msgCacheSaveTimer);
        msgCacheSaveTimer = null;
    }
    try {
        const obj = {};
        for (const [k, v] of cachedMessages.entries()) {
            obj[k] = v;
        }
        fs.writeFileSync(MSG_CACHE_FILE, JSON.stringify(obj));
    } catch (err) {
        console.error('[MsgCache Flush Error]:', err.message);
    }
}

function scheduleMsgCacheSave() {
    if (msgCacheSaveTimer) return;
    msgCacheSaveTimer = setTimeout(() => {
        msgCacheSaveTimer = null;
        flushMsgCache();
    }, 3000);
    if (msgCacheSaveTimer.unref) msgCacheSaveTimer.unref();
}

loadMsgCache();

function storeCachedMessage(id, message) {
    if (!id || !message) return;
    if (cachedMessages.has(id)) cachedMessages.delete(id);
    while (cachedMessages.size >= MAX_CACHED_MESSAGES) {
        const oldestKey = cachedMessages.keys().next().value;
        cachedMessages.delete(oldestKey);
    }
    cachedMessages.set(id, message);
    scheduleMsgCacheSave();
}

function getCachedProtoMessage(id) {
    if (!id || !cachedMessages.has(id)) return undefined;
    return cachedMessages.get(id);
}

function isSignalSessionError(err) {
    const msg = String(err?.message || err || '');
    return /bad mac|messagecountererror|no matching sessions|sessionerror|invalid mac|failed to decrypt/i.test(msg);
}

function purgeUserSignalSessions(targetIdentifier) {
    if (!AUTH_DIR || !fs.existsSync(AUTH_DIR)) return 0;
    const raw = String(targetIdentifier || '').split('@')[0].split(':')[0].trim();
    const cleanPhone = normalizeIdentifier(raw) || raw.replace(/\D/g, '');
    if (!cleanPhone) return 0;

    const prefixes = new Set([cleanPhone]);
    try {
        const users = loadUsers();
        const u = users[cleanPhone] || Object.values(users).find(x => x.phone === cleanPhone || x.lid === cleanPhone);
        if (u) {
            if (u.phone) prefixes.add(String(u.phone).replace(/\D/g, ''));
            if (u.lid) prefixes.add(String(u.lid).replace(/\D/g, ''));
        }
    } catch {}

    let deleted = 0;
    try {
        const files = fs.readdirSync(AUTH_DIR);
        for (const f of files) {
            if (!/^session-.*\.json$/i.test(f)) continue;
            const matchesTarget = Array.from(prefixes).some(p => p && f.includes(`session-${p}`));
            if (matchesTarget) {
                try {
                    fs.unlinkSync(path.join(AUTH_DIR, f));
                    deleted++;
                } catch {}
            }
        }
    } catch (err) {
        console.error('[Purge Signal Session Error]:', err.message);
    }
    if (deleted > 0) {
        console.log(`[Signal Recovery] Purged ${deleted} corrupted session file(s) for ${cleanPhone}.`);
    }
    return deleted;
}

async function safeSendMessage(sock, jid, content, options = {}) {
    try {
        return await sock.sendMessage(jid, content, options);
    } catch (err) {
        if (isSignalSessionError(err)) {
            console.warn(`[Signal Send Error] ${jid}: ${err.message} — purging session and retrying once...`);
            purgeUserSignalSessions(jid);
            try { msgRetryCounterCache.del(jid); } catch {}
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await sock.sendMessage(jid, content, options);
        }
        throw err;
    }
}

async function sendCachedMessage(sock, jid, content, options = {}) {
    const sent = await safeSendMessage(sock, jid, content, options);
    if (sent && sent.key && sent.key.id && sent.message) {
        storeCachedMessage(sent.key.id, sent.message);
    }
    return sent;
}

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Shutdown] Received ${signal}. Flushing msg_cache.json and closing WhatsApp socket...`);
    flushMsgCache();
    try {
        if (currentSock) currentSock.end(undefined);
    } catch {}
    try {
        if (httpServer) httpServer.close();
    } catch {}
    const forceExit = setTimeout(() => process.exit(0), 1500);
    if (forceExit.unref) forceExit.unref();
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

async function sendHumanReply(sock, targetJid, content, options = {}) {
    if (!sock || !targetJid) return null;
    if (isPrimaryAdmin(null, targetJid)) {
        return sendCachedMessage(sock, targetJid, content, options);
    }
    try { await sock.sendPresenceUpdate('composing', targetJid); } catch {}
    const delayMs = 4000 + Math.floor(Math.random() * 1001);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    try { await sock.sendPresenceUpdate('paused', targetJid); } catch {}
    return sendCachedMessage(sock, targetJid, content, options);
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
        const isPriority = !!jobData.priority;
        if (!isPriority && this.queue.length >= this.maxQueueSize) {
            return { success: false, reason: 'full' };
        }
        if (!isPriority && this.activeUsers.has(jobData.userId)) {
            return { success: false, reason: 'duplicate' };
        }

        this.activeUsers.add(jobData.userId);
        let position;
        if (isPriority) {
            let insertIdx = 0;
            while (insertIdx < this.queue.length && this.queue[insertIdx].priority) {
                insertIdx++;
            }
            this.queue.splice(insertIdx, 0, jobData);
            position = insertIdx + 1;
        } else {
            this.queue.push(jobData);
            position = this.queue.length;
        }
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

        execFile(binPath, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
            let duration = 30;
            let fps = 30;
            let isHDR = false;

            if (!err && stdout) {
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
                        transfer.includes('bt2020') ||
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
    });
}

function computeWaTargetBitrate(clipDuration) {
    const effectiveDuration = Math.min(Math.max(1, clipDuration || 30), 60);
    return Math.max(3500, Math.min(11500, Math.floor(((15.2 * 8192) / effectiveDuration) - 96)));
}

async function transcode60fpsVideo(inputPath, outputPath, binPath, vBitrate, sourceFps, isHDR, startSec = 0, clipDuration = 60) {
    return new Promise((resolve, reject) => {
        const segDuration = Math.min(60, Math.max(1, clipDuration));
        const targetShortSide = vBitrate >= 4600 ? 1080 : 720;
        const isHighFps = sourceFps >= 48;
        const hasCas = checkCasSupport(binPath);
        const scaleFilter = `scale='if(gt(iw,ih),-2,min(${targetShortSide},iw))':'if(gt(iw,ih),min(${targetShortSide},ih),-2)'`;
        const sharpFilter = hasCas ? 'cas=strength=0.35' : 'unsharp=5:5:0.35:5:5:0.0';

        const filterParts = [];
        if (isHDR) {
            const hasZscale = checkZscaleSupport(binPath);
            if (hasZscale) {
                filterParts.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p');
            } else {
                filterParts.push('eq=contrast=1.08:saturation=1.18,format=yuv420p');
            }
        }

        filterParts.push(scaleFilter, sharpFilter);
        if (isHighFps) {
            filterParts.push('setpts=N/(60*TB)');
        }

        const vfChain = filterParts.join(',');
        const args = ['-y'];
        if (startSec > 0) {
            args.push('-ss', String(startSec));
        }
        args.push(
            '-i', inputPath,
            '-t', String(segDuration),
            '-vf', vfChain,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-profile:v', 'high',
            '-level:v', '4.2',
            '-pix_fmt', 'yuv420p'
        );

        if (!isHDR) {
            args.push(
                '-colorspace', 'bt709',
                '-color_primaries', 'bt709',
                '-color_trc', 'bt709',
                '-color_range', 'tv'
            );
        }

        args.push(
            '-refs', '3',
            '-rc-lookahead', '30',
            '-g', '60',
            '-keyint_min', '60',
            '-x264-params', 'deblock=-1:-1:aq-mode=3:aq-strength=1.05:psy-rd=1.05:0.15:bframes=0',
            '-b:v', `${vBitrate}k`,
            '-maxrate', `${Math.floor(vBitrate * 1.2)}k`,
            '-bufsize', `${Math.floor(vBitrate * 2.4)}k`
        );

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

        const proc = spawn(binPath, args, { timeout: 120000 });
        let stderr = '';

        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                incrementStat('videosProcessed');
                resolve();
            } else {
                reject(new Error(`FFmpeg ralat (kod ${code}): ${stderr.slice(-400)}`));
            }
        });

        proc.on('error', reject);
    });
}

async function transcodeTikTokVideo(inputPath, outputPath, binPath, sourceFps, isHDR, maxDurationSec = 90) {
    return new Promise((resolve, reject) => {
        const hasCas = checkCasSupport(binPath);
        const scaleFilter = "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)':flags=lanczos";
        const sharpStage = hasCas
            ? 'unsharp=3:3:0.35:3:3:0.0,cas=0.55'
            : 'unsharp=3:3:0.35:3:3:0.0';

        const filterParts = [];
        if (isHDR) {
            const hasZscale = checkZscaleSupport(binPath);
            if (hasZscale) {
                filterParts.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p');
            } else {
                filterParts.push('eq=contrast=1.08:saturation=1.18,format=yuv420p');
            }
        }

        filterParts.push(
            scaleFilter,
            'setsar=1',
            'hqdn3d=1.2:1.2:3:3',
            sharpStage,
            'eq=contrast=1.04:saturation=1.07:brightness=0.01',
            'fps=60'
        );

        const vfChain = filterParts.join(',');
        const args = ['-y', '-i', inputPath];
        if (maxDurationSec > 0) {
            args.push('-t', String(maxDurationSec));
        }
        args.push(
            '-vf', vfChain,
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level', '4.2',
            '-preset', 'veryfast',
            '-crf', '17',
            '-maxrate', '15M',
            '-bufsize', '30M',
            '-g', '60',
            '-keyint_min', '60',
            '-sc_threshold', '0',
            '-pix_fmt', 'yuv420p',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-movflags', '+faststart',
            '-af', 'highpass=f=75,dynaudnorm=f=150:g=15',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ar', '48000',
            '-ac', '2',
            '-threads', '2',
            outputPath
        );

        const proc = spawn(binPath, args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                incrementStat('videosProcessed');
                resolve();
            } else {
                reject(new Error(`FFmpeg TikTok ralat (kod ${code}): ${stderr.slice(-400)}`));
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
                    incrementStat('imagesProcessed');
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
// PENJANAAN NO. INVOIS CLEAR STATUS (CS-YYYYMMDD-XXXX) & CHIP ASIA
// -------------------------------------------------------------
function generateClearStatusInvoiceRef() {
    const dateStr = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
    const stats = loadStats();
    let seq = 1;
    if (stats.lastInvoiceDate === dateStr) {
        seq = (parseInt(stats.lastInvoiceSeq, 10) || 0) + 1;
    }
    stats.lastInvoiceDate = dateStr;
    stats.lastInvoiceSeq = seq;
    saveStats(stats);
    return `CS-${dateStr}-${String(seq).padStart(4, '0')}`;
}

async function createChipCheckout({ userKey, phone, formattedName, userEmail = '', planType = 'WA', planTitle = 'WhatsApp Status HD', amountRM = '11.99', days = 30, platform = 'whatsapp', appliedRefCode = '' }) {
    if (!CHIP_BRAND_ID || !CHIP_API_KEY) {
        throw new Error('CHIP_BRAND_ID atau CHIP_API_KEY belum dikonfigurasikan di Environment Variables.');
    }

    const invoiceRef = generateClearStatusInvoiceRef();
    const numericPhone = String(phone || '').replace(/[^0-9]/g, '') || '60000000000';
    const priceCents = Math.round((parseFloat(amountRM) || 0) * 100);

    const clientPayload = {
        full_name: formattedName || 'Pelanggan StatusClear',
        phone: `+${numericPhone}`
    };
    const cleanEmail = String(userEmail || '').trim();
    if (cleanEmail && cleanEmail.includes('@')) {
        clientPayload.email = cleanEmail;
    }

    const payload = {
        brand_id: CHIP_BRAND_ID,
        reference: invoiceRef,
        payment_method_whitelist: ['duitnow_qr'],
        client: clientPayload,
        purchase: {
            currency: 'MYR',
            products: [
                {
                    name: `Clear Status - ${planTitle}`,
                    price: priceCents,
                    quantity: 1
                }
            ],
            metadata: {
                app: 'clear_status',
                invoiceRef,
                phone: userKey || phone,
                planType,
                days,
                platform,
                referralCode: appliedRefCode || ''
            }
        },
        success_callback: `${PUBLIC_BASE_URL}/webhook/chip`,
        success_redirect: `${PUBLIC_BASE_URL}/?paid=1`,
        failure_redirect: `${PUBLIC_BASE_URL}/?paid=0`
    };

    console.log(`[CHIP ASIA] Creating checkout ${invoiceRef} for ${userKey || phone} (${planType}, RM${(priceCents / 100).toFixed(2)})...`);
    const response = await fetch(CHIP_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CHIP_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const resText = await response.text();
    let resJson = {};
    try {
        resJson = JSON.parse(resText);
    } catch {
        throw new Error(`CHIP Asia API Ralat (${response.status}): ${resText.slice(0, 200)}`);
    }

    if (!response.ok || !resJson.checkout_url) {
        const errMsg = resJson.message || resJson.detail || JSON.stringify(resJson);
        throw new Error(`CHIP Asia Gateway Ralat (${response.status}): ${errMsg}`);
    }

    const rawCheckoutUrl = String(resJson.checkout_url);
    const directQrUrl = rawCheckoutUrl.includes('?')
        ? `${rawCheckoutUrl}&preferred=duitnow_qr`
        : `${rawCheckoutUrl}?preferred=duitnow_qr`;

    return {
        ...resJson,
        invoiceRef,
        checkout_url: directQrUrl
    };
}

// -------------------------------------------------------------
// PANGGILAN HITPAY PAYMENT REQUEST API (ASLI FETCH)
// -------------------------------------------------------------
async function createHitPayPaymentRequest({ userKey, phone, pushName, planCode = 'WA', days = 30, amount = '11.99', purpose, redirectUrl }) {
    if (!HITPAY_API_KEY) {
        throw new Error('HITPAY_API_KEY belum dikonfigurasikan di persekitaran (Environment Variables).');
    }

    const refKey = userKey || phone;
    console.log(`[HITPAY] Creating payment request for ${refKey} (${planCode}, ${days} days)...`);

    const cleanAmount = parseFloat(amount).toFixed(2);
    const payload = {
        amount: cleanAmount,
        currency: 'MYR',
        name: (pushName || refKey || 'Ahli StatusClear').slice(0, 50),
        purpose: purpose || `StatusClear ${planCode} (${days} Hari)`,
        reference_number: `${refKey}|${planCode}|${days}`,
        redirect_url: redirectUrl || ('https://wa.me/' + (process.env.PAIRING_NUMBER || PRIMARY_ADMIN)),
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
    const cleanA = a.toLowerCase().trim();
    const cleanB = b.toLowerCase().trim();
    const bufA = Buffer.from(cleanA, 'utf8');
    const bufB = Buffer.from(cleanB, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifyHitPaySignature(rawBuffer, headers, parsedBody) {
    if (!HITPAY_SALT) {
        console.warn('[HitPay Webhook] HITPAY_SALT tidak diset; mengabaikan pengesahan tandatangan.');
        return true;
    }

    const hmacInPayload = parsedBody?.hmac || parsedBody?.data?.hmac;
    if (hmacInPayload) {
        const dataToSign = { ...(parsedBody?.data || parsedBody) };
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

    const hitpaySignatureHeader = headers['hitpay-signature'] || headers['x-hitpay-signature'] || headers['Hitpay-Signature'];
    if (hitpaySignatureHeader) {
        const cleanHeader = hitpaySignatureHeader.replace(/^sha256=/i, '').trim();
        const computedHeaderHmac = crypto
            .createHmac('sha256', HITPAY_SALT)
            .update(rawBuffer)
            .digest('hex');

        if (safeCompareHex(computedHeaderHmac, cleanHeader)) {
            return true;
        }
    }

    return false;
}

// -------------------------------------------------------------
// FUNGSI PUSAT PENGAKTIFAN BAYARAN BERJAYA (WEBHOOK & AUTO-SYNC)
// -------------------------------------------------------------
async function processCompletedPayment({ paymentId, referenceNumber, customerName, realName = '', paymentType, amountPaid, feeAmount = null, invoiceRef = '' }) {
    if (!referenceNumber || !referenceNumber.includes('|')) {
        return { success: false, reason: 'invalid_reference' };
    }

    const processed = loadProcessedPayments();
    if (paymentId && processed.has(paymentId)) {
        return { success: false, reason: 'already_processed' };
    }

    if (paymentId) recordProcessedPayment(paymentId);

    const refParts = referenceNumber.split('|');
    const rawKey = (refParts[0] || '').trim();
    let planCode = 'WA';
    let days = 30;
    if (refParts.length >= 3) {
        planCode = (refParts[1] || 'WA').trim().toUpperCase();
        days = parseInt(refParts[2], 10) || 30;
    } else {
        days = parseInt(refParts[1], 10) || 30;
    }

    const isTgUser = rawKey.startsWith('tg_');
    const targetKey = isTgUser ? rawKey : normalizeIdentifier(rawKey);
    if (!targetKey) return { success: false, reason: 'no_target_phone' };

    try {
        const users = loadUsers();
        let targetUser = users[targetKey];
        if (!targetUser) {
            for (const u of Object.values(users)) {
                if (u.phone === targetKey || u.lid === targetKey || (isTgUser && u.telegramChatId === targetKey.slice(3))) {
                    targetUser = u;
                    break;
                }
            }
        }

        const cleanReal = realName && !isGenericDisplayName(realName) ? formatTitleCaseName(realName, targetKey) : null;
        const rawCandidateName = cleanReal || customerName || targetUser?.name || '';
        const finalName = formatTitleCaseName(rawCandidateName, targetKey);
        const now = Date.now();
        const addMs = days * 24 * 60 * 60 * 1000;
        const addedMonths = Math.max(1, Math.round(days / 30));

        if (!targetUser) {
            targetUser = normalizeUserTiers({
                phone: targetKey,
                name: finalName,
                realName: cleanReal,
                waName: (!cleanReal && customerName && !isGenericDisplayName(customerName)) ? formatTitleCaseName(customerName, targetKey) : null,
                status: 'ACTIVE',
                createdAt: now,
                registeredAt: new Date().toISOString(),
                subscribedMonths: addedMonths,
                waExpiredAt: (planCode === 'WA' || planCode === 'COMBO') ? (now + addMs) : null,
                ttExpiredAt: (planCode === 'TT' || planCode === 'UPGRADE_TT' || planCode === 'COMBO') ? (now + addMs) : null,
                preferredMode: (planCode === 'TT') ? 'TT' : 'WA',
                telegramChatId: isTgUser ? targetKey.slice(3) : null,
                refCode: generateReferralCode(finalName, users),
                referredBy: null,
                paidReferrals: 0,
                totalPaidReferrals: 0,
                refSentToExisting: true,
                reminded3Days: false,
                jid: null,
                altJid: null
            });
            users[targetKey] = targetUser;
        } else {
            normalizeUserTiers(targetUser);
            if (cleanReal) {
                if (!targetUser.waName && targetUser.name && !isGenericDisplayName(targetUser.name) && targetUser.name.toLowerCase() !== cleanReal.toLowerCase()) {
                    targetUser.waName = targetUser.name;
                }
                targetUser.realName = cleanReal;
                targetUser.name = cleanReal;
            } else if (customerName && (!targetUser.name || isGenericDisplayName(targetUser.name))) {
                targetUser.name = formatTitleCaseName(customerName, targetKey);
            }
            targetUser.registeredAt = targetUser.registeredAt || new Date().toISOString();
            if (planCode !== 'UPGRADE_TT') {
                targetUser.subscribedMonths = (targetUser.subscribedMonths || 0) + addedMonths;
            }

            if (planCode === 'WA' || planCode === 'COMBO') {
                const waBase = (targetUser.waExpiredAt && targetUser.waExpiredAt > now) ? targetUser.waExpiredAt : now;
                targetUser.waExpiredAt = waBase + addMs;
            }
            if (planCode === 'UPGRADE_TT') {
                targetUser.ttExpiredAt = (targetUser.waExpiredAt && targetUser.waExpiredAt > now)
                    ? targetUser.waExpiredAt
                    : (now + addMs);
            } else if (planCode === 'TT' || planCode === 'COMBO') {
                const ttBase = (targetUser.ttExpiredAt && targetUser.ttExpiredAt > now) ? targetUser.ttExpiredAt : now;
                targetUser.ttExpiredAt = ttBase + addMs;
            }
            if (planCode === 'TT' && (!targetUser.waExpiredAt || targetUser.waExpiredAt <= now)) {
                targetUser.preferredMode = 'TT';
            }
            if (isTgUser && !targetUser.telegramChatId) {
                targetUser.telegramChatId = targetKey.slice(3);
            }

            normalizeUserTiers(targetUser);
            targetUser.status = 'ACTIVE';
            targetUser.reminded3Days = false;
            targetUser.refSentToExisting = true;
            if (!targetUser.refCode) {
                targetUser.refCode = generateReferralCode(targetUser.name, users);
            }
            users[targetUser.phone] = targetUser;
        }

        if (!isTgUser && currentSock) {
            try {
                const checkJid = targetUser.phone.includes('@') ? targetUser.phone : `${targetUser.phone}@s.whatsapp.net`;
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
                normalizeUserTiers(referrer);
                referrer.paidReferrals = (referrer.paidReferrals || 0) + 1;
                referrer.totalPaidReferrals = (referrer.totalPaidReferrals || 0) + 1;
                referralRewardMsg = `\n• Penaja: ${referrer.name} (${referrer.phone}) [+1 Tajaan, Baki: ${referrer.paidReferrals}/3]`;

                const refJid = (!String(referrer.phone).startsWith('tg_'))
                    ? (referrer.jid || referrer.altJid || `${referrer.phone}@s.whatsapp.net`)
                    : null;
                const friendDisplayName = targetUser.name || finalName || targetUser.phone;

                if (referrer.paidReferrals >= 3) {
                    referrer.paidReferrals -= 3;
                    const refNow = Date.now();
                    const bonusMs = 30 * 24 * 60 * 60 * 1000;
                    const refHasWa = !!(referrer.waExpiredAt && referrer.waExpiredAt > refNow);
                    const refHasTt = !!(referrer.ttExpiredAt && referrer.ttExpiredAt > refNow);
                    if (refHasTt && !refHasWa) {
                        referrer.ttExpiredAt = referrer.ttExpiredAt + bonusMs;
                    } else if (refHasWa && refHasTt) {
                        referrer.waExpiredAt = referrer.waExpiredAt + bonusMs;
                        referrer.ttExpiredAt = referrer.ttExpiredAt + bonusMs;
                    } else {
                        const refBase = refHasWa ? referrer.waExpiredAt : refNow;
                        referrer.waExpiredAt = refBase + bonusMs;
                    }
                    normalizeUserTiers(referrer);
                    referrer.status = 'ACTIVE';

                    const newExpiryStr = new Date(referrer.expiredAt).toLocaleDateString('ms-MY', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });

                    const bonusMsg =
                        `✓ *Tahniah, anda terima +30 hari percuma!*\n\n` +
                        `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* telah melengkapkan *3/3 tajaan* menggunakan code referral anda (*${referrer.refCode}*).\n\n` +
                        `• Ganjaran: *+30 Hari* pada pelan active anda\n` +
                        `• Tarikh tamat baru: *${newExpiryStr}*`;

                    if (currentSock && refJid) {
                        try {
                            await sendHumanReply(currentSock, refJid, { text: bonusMsg });
                            console.log(`[REFERRAL BONUS] Berjaya hantar notifikasi +30 hari ke ${refJid}`);
                        } catch (refErr) {
                            console.error(`[REFERRAL BONUS] Gagal hantar notifikasi bonus ke ${refJid}:`, refErr.message);
                        }
                    }
                    if (referrer.telegramChatId && TELEGRAM_BOT_TOKEN) {
                        await sendTelegramMessage(referrer.telegramChatId, bonusMsg.replace(/\*/g, '')).catch(() => {});
                    }
                    referralRewardMsg += ` -> BONUS +30 HARI TELAH DIBERIKAN!`;
                } else {
                    const remaining = 3 - referrer.paidReferrals;
                    const progressMsg =
                        `✓ *Tajaan berjaya (+1 rakan)*\n\n` +
                        `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* telah melanggan menggunakan code referral anda (*${referrer.refCode}*).\n\n` +
                        `• Kemajuan: *${referrer.paidReferrals}/3 rakan*\n` +
                        `• Baki: *${remaining} rakan* lagi untuk terima +30 hari percuma.`;

                    if (currentSock && refJid) {
                        try {
                            await sendHumanReply(currentSock, refJid, { text: progressMsg });
                            console.log(`[REFERRAL PROGRESS] Berjaya hantar notifikasi kemajuan (${referrer.paidReferrals}/3) ke ${refJid}`);
                        } catch (refErr) {
                            console.error(`[REFERRAL PROGRESS] Gagal hantar notifikasi kemajuan ke ${refJid}:`, refErr.message);
                        }
                    }
                    if (referrer.telegramChatId && TELEGRAM_BOT_TOKEN) {
                        await sendTelegramMessage(referrer.telegramChatId, progressMsg.replace(/\*/g, '')).catch(() => {});
                    }
                }
            }
        }

        saveUsers(users);

        // Rekod transaksi untuk paparan PWA Monitor
        const planPrices = { WA: '11.99', TT: '15.99', UPGRADE_TT: '12.99', COMBO: '20.99' };
        const pkgPrices = { 30: '11.99', 90: '32.00', 180: '60.00', 365: '110.00' };
        const txAmount = amountPaid != null && !isNaN(parseFloat(amountPaid))
            ? parseFloat(amountPaid).toFixed(2)
            : (planPrices[planCode] || pkgPrices[days] || '11.99');

        const fin = computeHitPayFeeAndNet(txAmount, feeAmount);
        recordTransaction({
            paymentId: paymentId || `PAY_${Date.now()}`,
            invoiceRef: invoiceRef || '',
            buyerName: formatTitleCaseName(targetUser.name || finalName, targetUser.phone),
            buyerPhone: targetUser.phone,
            planCode,
            packageDays: days,
            amount: fin.gross,
            feeAmount: fin.fee,
            netAmount: fin.net,
            timestamp: Date.now(),
            method: paymentType || 'CHIP Asia Gateway'
        });

        const activePlanExpiry = (planCode === 'TT' || planCode === 'UPGRADE_TT')
            ? targetUser.ttExpiredAt
            : targetUser.waExpiredAt || targetUser.expiredAt;
        const formattedExpiryDate = new Date(activePlanExpiry).toLocaleDateString('ms-MY', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
        const planLabel = planCode === 'COMBO'
            ? 'Combo WhatsApp + TikTok HD'
            : (planCode === 'UPGRADE_TT'
                ? 'TikTok 1080p 60fps HD (Upgrade Selari WA)'
                : (planCode === 'TT' ? 'TikTok 1080p 60fps HD' : 'WhatsApp Status HD'));
        const invoiceLine = invoiceRef ? `\n• No. Invois: *${invoiceRef}*` : '';

        const welcomeTutorialMessage =
`✓ *Pembayaran berjaya & akaun anda kini active.*

Terima kasih kerana melanggan *${BOT_NAME}*.${invoiceLine}
• Pelan: *${planLabel}* (+${days} Hari)
• Tamat tempoh: *${formattedExpiryDate}*
• Code referral anda: *${targetUser.refCode}*

*Cara guna bot supaya kualiti tidak pecah:*
1. Tekan ikon klip kertas / (+) di ruang chat.
2. Pilih *Document* (elakkan pilih Gallery/Photos terus).
3. Pilih *video* atau *gambar* asal anda dan tekan *Send*.
4. Tunggu bot siap proses dan muat turun file HD tersebut.

• Tukar mod bila-bila masa: taip *WA* (WhatsApp Status HD) atau *TT* (TikTok 1080p 60fps).
• Kongsi code *${targetUser.refCode}* — setiap *3 rakan* yang melanggan, anda dapat *+30 hari percuma*.`;

        if (!isTgUser && currentSock) {
            const targetJid = targetUser.jid || targetUser.altJid || `${targetUser.phone}@s.whatsapp.net`;
            try {
                await sendHumanReply(currentSock, targetJid, { text: welcomeTutorialMessage });
                console.log(`[HITPAY -> WA] Sent welcome & tutorial to ${targetJid}`);
            } catch (waErr) {
                console.error(`[HITPAY -> WA] Ralat penghantaran ke ${targetJid}:`, waErr.message);
                if (targetJid !== `${targetUser.phone}@s.whatsapp.net`) {
                    try {
                        await sendHumanReply(currentSock, `${targetUser.phone}@s.whatsapp.net`, { text: welcomeTutorialMessage });
                        console.log(`[HITPAY -> WA] Sent welcome & tutorial fallback to ${targetUser.phone}@s.whatsapp.net`);
                    } catch (fallbackErr) {
                        console.error(`[HITPAY -> WA] Fallback juga gagal:`, fallbackErr.message);
                    }
                }
            }
        }

        if (targetUser.telegramChatId && TELEGRAM_BOT_TOKEN) {
            await sendTelegramMessage(targetUser.telegramChatId, welcomeTutorialMessage.replace(/\*/g, '')).catch(() => {});
        }

        if (currentSock) {
            await notifyAdmins(
                currentSock,
                `✓ *Notifikasi Jualan HitPay*\n\n` +
                `• Pelanggan: *${targetUser.name}* (${targetUser.phone})\n` +
                `• Pelan: *${planLabel}* (${planCode}, +${days} Hari)\n` +
                `• Jumlah: *RM ${txAmount}*\n` +
                `• Kaedah: ${paymentType || 'HitPay Online Gateway'}\n` +
                `• Tamat tempoh: ${formattedExpiryDate}\n` +
                `• Code referral: *${targetUser.refCode}*${referralRewardMsg}`
            );
        }

        return { success: true, user: targetUser, planCode, days, formattedExpiryDate };
    } catch (err) {
        console.error('[processCompletedPayment] Ralat pemprosesan:', err);
        return { success: false, error: err.message };
    }
}

// -------------------------------------------------------------
// SISTEM PENYELARASAN AUTO-SYNC TRANSAKSI HITPAY DARI API
// -------------------------------------------------------------
async function syncHitPayPayments() {
    if (!HITPAY_API_KEY) return { checked: 0, activated: 0 };
    try {
        console.log('[HitPay Auto-Sync] Menyemak transaksi completed di pelayan HitPay...');
        const response = await fetch(`${HITPAY_API_URL}?per_page=15`, {
            method: 'GET',
            headers: {
                'X-BUSINESS-API-KEY': HITPAY_API_KEY,
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            console.error(`[HitPay Auto-Sync] Ralat status API: ${response.status}`);
            return { checked: 0, activated: 0 };
        }

        const resData = await response.json();
        const items = Array.isArray(resData) ? resData : (resData.data || []);
        let activatedCount = 0;
        let activatedList = [];

        for (const item of items) {
            const status = (item.status || '').toLowerCase();
            const paymentId = item.id || item.payment_id;
            const ref = item.reference_number || '';

            if (status === 'completed' && ref && ref.includes('|')) {
                const processed = loadProcessedPayments();
                if (!processed.has(paymentId)) {
                    console.log(`[HitPay Auto-Sync] Menemui pembayaran berjaya tertunggak: ${paymentId} (${ref})`);
                    const result = await processCompletedPayment({
                        paymentId,
                        referenceNumber: ref,
                        customerName: item.name || '',
                        paymentType: (item.payment_methods && item.payment_methods[0]) || 'HitPay Gateway',
                        amountPaid: item.amount
                    });
                    if (result.success) {
                        activatedCount++;
                        activatedList.push(`${result.user.name} (${result.user.phone}) +${result.days}H`);
                    }
                }
            }
        }

        if (activatedCount > 0) {
            hitpayDashboardCache.fetchedAt = 0;
            console.log(`[HitPay Auto-Sync Selesai] Berjaya mengaktifkan ${activatedCount} bayaran.`);
        }
        return { checked: items.length, activated: activatedCount, list: activatedList };
    } catch (err) {
        console.error('[HitPay Auto-Sync Error]:', err.message);
        return { checked: 0, activated: 0, error: err.message };
    }
}

// -------------------------------------------------------------
// ONE-TIME USER DATA ADJUSTMENTS (ALIF, NAZHAN, IRFAN ANUAR)
// -------------------------------------------------------------
function applyPendingUserMigrations() {
    try {
        const cfg = loadConfig();
        if (!cfg.migrations) cfg.migrations = {};
        if (cfg.migrations.alifRef1_v1 && cfg.migrations.nazhanRefAlif_v1 && cfg.migrations.irfanAnuarPlus2Months_v1) {
            return false;
        }

        const users = loadUsers();
        const uniqueUsers = Object.values(users).filter((u, i, arr) => u && u.phone && arr.findIndex(x => x.phone === u.phone) === i);
        let usersChanged = false;
        let cfgChanged = false;

        const alif = uniqueUsers.find(u => (u.name || '').toLowerCase().includes('alif')) || users['601164552773'];
        if (alif && !cfg.migrations.alifRef1_v1) {
            alif.paidReferrals = (alif.paidReferrals || 0) + 1;
            alif.totalPaidReferrals = (alif.totalPaidReferrals || 0) + 1;
            if (!alif.refCode) alif.refCode = generateReferralCode(alif.name || 'ALIF', users);
            users[alif.phone] = alif;
            if (alif.lid) users[alif.lid] = alif;
            cfg.migrations.alifRef1_v1 = true;
            usersChanged = true;
            cfgChanged = true;
            console.log(`[Migration] Added +1 referral to Alif (${alif.phone}).`);
        }

        const nazhan = uniqueUsers.find(u => (u.name || '').toLowerCase().includes('nazhan'));
        if (nazhan && alif && !cfg.migrations.nazhanRefAlif_v1) {
            nazhan.referredBy = alif.phone;
            nazhan.referredByCode = alif.refCode || 'ALIF';
            nazhan.referralCredited = true;
            users[nazhan.phone] = nazhan;
            if (nazhan.lid) users[nazhan.lid] = nazhan;
            cfg.migrations.nazhanRefAlif_v1 = true;
            usersChanged = true;
            cfgChanged = true;
            console.log(`[Migration] Linked Nazhan (${nazhan.phone}) to Alif referral code (${alif.refCode}).`);
        }

        const irfan = uniqueUsers.find(u => (u.name || '').toLowerCase().includes('irfan anuar'))
            || uniqueUsers.find(u => (u.name || '').toLowerCase().includes('irfan'));
        if (irfan && !cfg.migrations.irfanAnuarPlus2Months_v1) {
            normalizeUserTiers(irfan);
            const baseExpiry = (irfan.waExpiredAt && irfan.waExpiredAt > 0) ? irfan.waExpiredAt : ((irfan.expiredAt && irfan.expiredAt > 0) ? irfan.expiredAt : Date.now());
            const existingMonths = irfan.subscribedMonths || Math.max(1, Math.round(Math.max(0, baseExpiry - (irfan.registeredAt ? new Date(irfan.registeredAt).getTime() : Date.now())) / (30 * 24 * 60 * 60 * 1000)) || 1);
            irfan.waExpiredAt = baseExpiry + (60 * 24 * 60 * 60 * 1000);
            normalizeUserTiers(irfan);
            irfan.status = irfan.expiredAt > Date.now() ? 'ACTIVE' : irfan.status;
            irfan.subscribedMonths = existingMonths + 2;
            irfan.reminded3Days = false;
            users[irfan.phone] = irfan;
            if (irfan.lid) users[irfan.lid] = irfan;
            cfg.migrations.irfanAnuarPlus2Months_v1 = true;
            usersChanged = true;
            cfgChanged = true;
            console.log(`[Migration] Extended Irfan Anuar (${irfan.phone}) by +2 months (+60 days).`);
        }

        if (usersChanged) saveUsers(users);
        if (cfgChanged) saveConfig(cfg);
        return usersChanged;
    } catch (e) {
        console.error('[Migration Error]:', e.message);
        return false;
    }
}

// -------------------------------------------------------------
// HITPAY LIVE DASHBOARD DATA ENGINE (PAYMENTS + CHARGES + PAYOUTS)
// -------------------------------------------------------------
let hitpayDashboardCache = {
    fetchedAt: 0,
    data: null,
    inFlight: null
};

async function fetchHitPayAllPages(endpoint, maxPages = 10) {
    if (!HITPAY_API_KEY) return [];
    const collected = [];
    for (let page = 1; page <= maxPages; page++) {
        const sep = endpoint.includes('?') ? '&' : '?';
        const url = `${HITPAY_BASE_URL}${endpoint}${sep}per_page=100&page=${page}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'X-BUSINESS-API-KEY': HITPAY_API_KEY,
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        if (!res.ok) {
            if (page === 1) {
                throw new Error(`HitPay ${endpoint} HTTP ${res.status}`);
            }
            break;
        }
        const json = await res.json();
        const items = Array.isArray(json) ? json : (json.data || []);
        if (!Array.isArray(items) || items.length === 0) break;
        collected.push(...items);

        const lastPage = json.meta?.last_page || json.last_page;
        const nextUrl = json.links?.next || json.next_page_url;
        if ((lastPage && page >= lastPage) || (nextUrl === null) || (!lastPage && !nextUrl && items.length < 100)) {
            break;
        }
    }
    return collected;
}

function syncRealNamesFromHitPay(payments) {
    if (!Array.isArray(payments) || payments.length === 0) return false;
    try {
        const users = loadUsers();
        let changed = false;
        const seenPhones = new Set();

        for (const tx of payments) {
            if (!tx || !tx.realName || isGenericDisplayName(tx.realName)) continue;
            const rawPhone = tx.buyerPhone || '';
            if (!rawPhone || rawPhone === '-') continue;
            const phoneKey = rawPhone.startsWith('tg_') ? rawPhone : normalizeIdentifier(rawPhone);
            if (!phoneKey || seenPhones.has(phoneKey)) continue;
            seenPhones.add(phoneKey);

            const target = users[phoneKey] || Object.values(users).find(u => u.phone === phoneKey || u.lid === phoneKey);
            if (!target) continue;

            const realFormatted = formatTitleCaseName(tx.realName, phoneKey);
            if (!target.waName && target.name && !isGenericDisplayName(target.name) && target.name.toLowerCase() !== realFormatted.toLowerCase()) {
                target.waName = formatTitleCaseName(target.name, phoneKey);
                changed = true;
            }
            if (target.realName !== realFormatted || target.name !== realFormatted) {
                target.realName = realFormatted;
                target.name = realFormatted;
                changed = true;
            }
        }

        if (changed) {
            saveUsers(users);
            console.log('[HitPay Real Name Sync] Nama sebenar pembayar dari HitPay diselaraskan ke users.json.');
        }
        return changed;
    } catch (err) {
        console.error('[HitPay Real Name Sync Error]:', err.message);
        return false;
    }
}

async function fetchHitPayDashboardData(force = false) {
    if (!HITPAY_API_KEY) {
        return {
            configured: false,
            payments: [],
            payouts: [],
            totalCollectedRM: null,
            totalNetRM: null,
            totalFeesRM: null,
            totalPaidOutRM: 0,
            totalPendingPayoutRM: 0,
            paymentsCount: 0,
            payoutsCount: 0,
            lastSyncedAt: null
        };
    }

    const now = Date.now();
    if (!force && hitpayDashboardCache.data && (now - hitpayDashboardCache.fetchedAt) < 60000) {
        return hitpayDashboardCache.data;
    }

    if (hitpayDashboardCache.inFlight) {
        return hitpayDashboardCache.inFlight;
    }

    hitpayDashboardCache.inFlight = (async () => {
        try {
            const [prRes, chRes, poRes] = await Promise.allSettled([
                fetchHitPayAllPages('/payment-requests'),
                fetchHitPayAllPages('/charges'),
                fetchHitPayAllPages('/payouts')
            ]);

            const paymentRequests = prRes.status === 'fulfilled' ? prRes.value : [];
            const charges = chRes.status === 'fulfilled' ? chRes.value : [];
            const rawPayouts = poRes.status === 'fulfilled' ? poRes.value : [];

            const chargesSucceeded = charges.filter(c => ['succeeded', 'completed', 'paid'].includes((c.status || '').toLowerCase()));
            const chargeById = new Map();
            const chargeByReqId = new Map();
            for (const c of chargesSucceeded) {
                if (c.id) chargeById.set(c.id, c);
                if (c.payment_request_id) chargeByReqId.set(c.payment_request_id, c);
            }

            const usedChargeIds = new Set();
            const payments = [];

            const prCompleted = paymentRequests.filter(pr => ['completed', 'succeeded'].includes((pr.status || '').toLowerCase()));
            for (const pr of prCompleted) {
                const subPayment = (Array.isArray(pr.payments) && pr.payments[0]) || null;
                const matchedCharge = (subPayment && subPayment.id && chargeById.get(subPayment.id)) || chargeByReqId.get(pr.id) || null;
                if (matchedCharge && matchedCharge.id) usedChargeIds.add(matchedCharge.id);
                if (subPayment && subPayment.id) usedChargeIds.add(subPayment.id);

                const refParts = (pr.reference_number || '').split('|');
                const rawPhone = pr.phone || (refParts.length >= 2 ? refParts[0] : '') || matchedCharge?.customer_phone || '';
                const cleanPhone = rawPhone ? (normalizeIdentifier(rawPhone) || String(rawPhone).trim()) : '-';
                const daysFromRef = refParts.length >= 2 ? parseInt(refParts[1], 10) : null;
                const amountNum = parseFloat((matchedCharge && matchedCharge.amount) ?? (subPayment && subPayment.amount) ?? pr.amount) || 0;
                const feeNum = matchedCharge
                    ? ((parseFloat(matchedCharge.fixed_fee) || 0) + (parseFloat(matchedCharge.discount_fee) || 0))
                    : (subPayment && subPayment.fees != null ? parseFloat(subPayment.fees) : null);
                const netNum = matchedCharge && matchedCharge.amount_without_fees != null
                    ? parseFloat(matchedCharge.amount_without_fees)
                    : (feeNum != null ? Math.max(0, amountNum - feeNum) : null);

                const tsRaw = (matchedCharge && matchedCharge.created_at) || (subPayment && subPayment.created_at) || pr.updated_at || pr.created_at;
                const ts = tsRaw ? new Date(tsRaw).getTime() : Date.now();

                const rawRealName =
                    matchedCharge?.customer_name ||
                    matchedCharge?.buyer_name ||
                    matchedCharge?.payer_name ||
                    subPayment?.buyer_name ||
                    subPayment?.customer_name ||
                    '';
                const formattedRealName = rawRealName && !isGenericDisplayName(rawRealName)
                    ? formatTitleCaseName(rawRealName, cleanPhone)
                    : null;
                const fallbackTxName = formatTitleCaseName(pr.name || pr.email || 'Customer', cleanPhone);

                payments.push({
                    paymentId: (matchedCharge && matchedCharge.id) || (subPayment && subPayment.id) || pr.id,
                    realName: formattedRealName,
                    buyerName: formattedRealName || fallbackTxName,
                    buyerPhone: cleanPhone,
                    packageDays: Number.isFinite(daysFromRef) ? daysFromRef : 0,
                    amount: amountNum.toFixed(2),
                    fee: feeNum != null ? feeNum.toFixed(2) : null,
                    netAmount: netNum != null ? netNum.toFixed(2) : null,
                    currency: (pr.currency || matchedCharge?.currency || 'MYR').toUpperCase(),
                    timestamp: Number.isFinite(ts) ? ts : Date.now(),
                    method: (matchedCharge?.payment_method?.name) || (subPayment && subPayment.payment_method) || (pr.payment_methods && pr.payment_methods[0]) || 'HitPay'
                });
            }

            // Include any succeeded charges not tied to payment-requests so total matches HitPay 100%
            for (const c of chargesSucceeded) {
                if (c.id && usedChargeIds.has(c.id)) continue;
                const amountNum = parseFloat(c.amount) || 0;
                const feeNum = (parseFloat(c.fixed_fee) || 0) + (parseFloat(c.discount_fee) || 0);
                const netNum = c.amount_without_fees != null ? (parseFloat(c.amount_without_fees) || 0) : Math.max(0, amountNum - feeNum);
                const ts = c.created_at ? new Date(c.created_at).getTime() : Date.now();
                const cleanChargePhone = c.customer_phone ? (normalizeIdentifier(c.customer_phone) || c.customer_phone) : '-';
                const rawChargeRealName = c.customer_name || c.buyer_name || c.payer_name || '';
                const formattedChargeReal = rawChargeRealName && !isGenericDisplayName(rawChargeRealName)
                    ? formatTitleCaseName(rawChargeRealName, cleanChargePhone)
                    : null;
                payments.push({
                    paymentId: c.id || `CHG_${ts}`,
                    realName: formattedChargeReal,
                    buyerName: formattedChargeReal || formatTitleCaseName(c.remark || c.customer_email || 'HitPay Payment', cleanChargePhone),
                    buyerPhone: cleanChargePhone,
                    packageDays: 0,
                    amount: amountNum.toFixed(2),
                    fee: feeNum.toFixed(2),
                    netAmount: netNum.toFixed(2),
                    currency: (c.currency || 'MYR').toUpperCase(),
                    timestamp: Number.isFinite(ts) ? ts : Date.now(),
                    method: c.payment_method?.name || 'HitPay'
                });
            }

            payments.sort((a, b) => b.timestamp - a.timestamp);
            syncRealNamesFromHitPay(payments);

            let totalCollectedRM = 0;
            let totalNetRM = null;
            let totalFeesRM = null;
            if (chargesSucceeded.length > 0) {
                totalCollectedRM = chargesSucceeded.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                totalNetRM = chargesSucceeded.reduce((sum, c) => {
                    const gross = parseFloat(c.amount) || 0;
                    const fees = (parseFloat(c.fixed_fee) || 0) + (parseFloat(c.discount_fee) || 0);
                    return sum + (c.amount_without_fees != null ? (parseFloat(c.amount_without_fees) || 0) : Math.max(0, gross - fees));
                }, 0);
                totalFeesRM = Math.max(0, totalCollectedRM - totalNetRM);
            } else {
                totalCollectedRM = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
            }

            const payouts = rawPayouts.map(p => {
                const tsRaw = p.arrival_date || p.created_at;
                const ts = tsRaw ? new Date(tsRaw).getTime() : Date.now();
                return {
                    id: p.id || '',
                    amount: (parseFloat(p.amount) || 0).toFixed(2),
                    currency: (p.currency || 'MYR').toUpperCase(),
                    status: (p.status || 'paid').toLowerCase(),
                    bankName: p.bank_name || 'Bank Account',
                    bankAccount: p.bank_account || '',
                    reference: p.reference || p.id || '-',
                    arrivalDate: p.arrival_date || p.created_at || '',
                    timestamp: Number.isFinite(ts) ? ts : Date.now()
                };
            }).sort((a, b) => b.timestamp - a.timestamp);

            const totalPaidOutRM = payouts
                .filter(p => p.status === 'paid')
                .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
            const totalPendingPayoutRM = payouts
                .filter(p => ['processing', 'scheduled', 'pending'].includes(p.status))
                .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

            const result = {
                configured: true,
                payments,
                payouts,
                totalCollectedRM: totalCollectedRM.toFixed(2),
                totalNetRM: totalNetRM != null ? totalNetRM.toFixed(2) : null,
                totalFeesRM: totalFeesRM != null ? totalFeesRM.toFixed(2) : null,
                totalPaidOutRM: totalPaidOutRM.toFixed(2),
                totalPendingPayoutRM: totalPendingPayoutRM.toFixed(2),
                paymentsCount: chargesSucceeded.length > 0 ? chargesSucceeded.length : payments.length,
                payoutsCount: payouts.length,
                lastSyncedAt: Date.now()
            };

            hitpayDashboardCache.data = result;
            hitpayDashboardCache.fetchedAt = Date.now();
            return result;
        } catch (err) {
            console.error('[HitPay Dashboard Fetch Error]:', err.message);
            return hitpayDashboardCache.data || {
                configured: true,
                error: err.message,
                payments: [],
                payouts: [],
                totalCollectedRM: null,
                totalNetRM: null,
                totalFeesRM: null,
                totalPaidOutRM: '0.00',
                totalPendingPayoutRM: '0.00',
                paymentsCount: 0,
                payoutsCount: 0,
                lastSyncedAt: null
            };
        } finally {
            hitpayDashboardCache.inFlight = null;
        }
    })();

    return hitpayDashboardCache.inFlight;
}

// -------------------------------------------------------------
// PWA ASSETS & TEMPLATES (DARK OBSIDIAN + ELECTRIC LIME TELEMETRY)
// -------------------------------------------------------------
const PWA_MANIFEST = {
    name: "StatusClear Monitor",
    short_name: "StatusClear",
    description: "Dark Obsidian & Electric Lime Telemetry Dashboard for StatusClear Bot",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0B08",
    theme_color: "#0A0B08",
    orientation: "portrait",
    icons: [
        {
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='128' fill='%230A0B08'/%3E%3Ccircle cx='256' cy='256' r='180' fill='none' stroke='%23C6FF00' stroke-width='36' stroke-dasharray='800' stroke-dashoffset='120'/%3E%3Cpath d='M190 260 L240 310 L330 200' fill='none' stroke='%23C6FF00' stroke-width='40' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
            sizes: "192x192 512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
        }
    ]
};

const PWA_SW = `
const CACHE_NAME = 'statusclear-telemetry-v8';
const ASSETS = ['/', '/manifest.json'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/')) {
        return; // Always network for API
    }
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
`;

const PWA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>StatusClear Telemetry</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0A0B08">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      background-color: #0A0B08;
      background-image: radial-gradient(circle at 50% -10%, rgba(198, 255, 0, 0.22), transparent 55%);
      color: #FFFFFF;
      font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 110px);
    }
    .app-container {
      max-width: 460px;
      margin: 0 auto;
      padding: calc(env(safe-area-inset-top, 0px) + 24px) 18px 20px;
    }

    /* TYPOGRAPHY & HEADER */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 22px;
    }
    .top-title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #FFFFFF;
    }
    .top-subtitle {
      font-size: 13px;
      color: #8E9387;
      margin-top: 3px;
      font-weight: 500;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: rgba(20, 22, 18, 0.85);
      border: 1px solid rgba(198, 255, 0, 0.25);
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #C6FF00;
      box-shadow: 0 0 15px rgba(198, 255, 0, 0.12);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #C6FF00;
      box-shadow: 0 0 8px #C6FF00;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* BENTO CARDS */
    .bento-card {
      background: #141612;
      border: 1px solid rgba(198, 255, 0, 0.14);
      border-radius: 24px;
      padding: 20px;
      margin-bottom: 16px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 12px 30px rgba(0,0,0,0.45);
      transition: border-color 0.2s ease, transform 0.2s ease;
    }
    .bento-card:hover {
      border-color: rgba(198, 255, 0, 0.28);
    }

    /* HERO CIRCULAR ARC GAUGE */
    .gauge-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 10px 0 6px;
    }
    .gauge-svg {
      width: 220px;
      height: 125px;
    }

    /* 2-COLUMN BENTO GRID */
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .users-action-row {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }
    .action-pill-btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 11px 14px;
      border-radius: 999px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid rgba(198, 255, 0, 0.28);
      background: rgba(198, 255, 0, 0.12);
      color: #C6FF00;
      transition: transform 0.1s ease;
    }
    .action-pill-btn.solid {
      background: #C6FF00;
      color: #0A0B08;
      border-color: #C6FF00;
    }
    .action-pill-btn:active { transform: scale(0.97); }
    .form-input {
      width: 100%;
      background: #0F110D;
      border: 1px solid rgba(198, 255, 0, 0.2);
      border-radius: 14px;
      padding: 11px 13px;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      margin-bottom: 10px;
    }
    .form-input:focus {
      border-color: #C6FF00;
    }
    .form-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #8E9387;
      margin-bottom: 5px;
    }
    /* 3-COLUMN BENTO GRID */
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .mini-card {
      background: #141612;
      border: 1px solid rgba(198, 255, 0, 0.14);
      border-radius: 20px;
      padding: 14px 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .mini-label {
      font-size: 10px;
      color: #8E9387;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .mini-val {
      font-size: 17px;
      font-weight: 800;
      color: #FFFFFF;
      margin: 8px 0 6px;
      letter-spacing: -0.3px;
      font-variant-numeric: tabular-nums;
    }
    .sparkline-svg {
      width: 100%;
      height: 22px;
      overflow: visible;
    }

    /* 7-DAY LINE CHART */
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .chart-title {
      font-size: 13px;
      font-weight: 700;
      color: #FFFFFF;
      letter-spacing: -0.2px;
    }
    .chart-subtitle {
      font-size: 11px;
      color: #8E9387;
    }
    .line-chart-svg {
      width: 100%;
      height: 110px;
      overflow: visible;
    }

    /* RAILWAY COUNTDOWN CARD */
    .railway-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .railway-title {
      font-size: 14px;
      font-weight: 700;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pill-btn-small {
      background: rgba(198, 255, 0, 0.12);
      border: 1px solid rgba(198, 255, 0, 0.3);
      color: #C6FF00;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    /* PROGRESS BARS */
    .ram-bar-track {
      width: 100%;
      height: 7px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
      margin: 10px 0 6px;
    }
    .ram-bar-fill {
      height: 100%;
      background: #C6FF00;
      border-radius: 999px;
      box-shadow: 0 0 10px rgba(198, 255, 0, 0.6);
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #8E9387;
      font-weight: 500;
    }

    /* USERS LIST */
    .search-box {
      width: 100%;
      background: #141612;
      border: 1px solid rgba(198, 255, 0, 0.18);
      border-radius: 16px;
      padding: 12px 14px 12px 42px;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      margin-bottom: 12px;
      position: relative;
    }
    .pill-filter-bar {
      display: flex;
      gap: 4px;
      background: #141612;
      border: 1px solid rgba(198, 255, 0, 0.14);
      border-radius: 999px;
      padding: 4px;
      margin-bottom: 16px;
    }
    .filter-pill {
      flex: 1;
      background: transparent;
      border: none;
      border-radius: 999px;
      padding: 8px 6px;
      color: #8E9387;
      font-family: inherit;
      font-size: 10.5px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s ease;
    }
    .filter-pill.active {
      background: #C6FF00;
      color: #0A0B08;
      box-shadow: 0 0 14px rgba(198, 255, 0, 0.35);
    }
    .broadcast-textarea {
      width: 100%;
      min-height: 130px;
      background: #0F110D;
      border: 1px solid rgba(198, 255, 0, 0.2);
      border-radius: 16px;
      padding: 14px;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      resize: vertical;
      outline: none;
    }
    .broadcast-textarea:focus {
      border-color: #C6FF00;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }
    .template-chip {
      background: rgba(198, 255, 0, 0.08);
      border: 1px solid rgba(198, 255, 0, 0.22);
      color: #C6FF00;
      border-radius: 999px;
      padding: 6px 12px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .broadcast-status-box {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(198, 255, 0, 0.08);
      border: 1px solid rgba(198, 255, 0, 0.22);
      font-size: 12px;
      color: #FFFFFF;
      display: none;
    }
    .search-wrapper {
      position: relative;
    }
    .search-icon {
      position: absolute;
      left: 14px;
      top: 13px;
      color: #8E9387;
    }
    .user-card {
      background: #141612;
      border: 1px solid rgba(198, 255, 0, 0.12);
      border-radius: 20px;
      padding: 16px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .user-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .user-name {
      font-size: 15px;
      font-weight: 700;
      color: #FFFFFF;
    }
    .user-phone {
      font-size: 12px;
      color: #8E9387;
      margin-top: 2px;
    }
    .user-badge {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .user-badge.active {
      background: #C6FF00;
      color: #0A0B08;
      box-shadow: 0 0 10px rgba(198, 255, 0, 0.3);
    }
    .user-badge.expired {
      background: rgba(255, 255, 255, 0.08);
      color: #8E9387;
    }
    .user-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .btn-action {
      flex: 1;
      padding: 8px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: transform 0.1s ease;
    }
    .btn-action:active { transform: scale(0.96); }
    .btn-action.lime { background: rgba(198, 255, 0, 0.15); color: #C6FF00; border: 1px solid rgba(198, 255, 0, 0.25); }
    .btn-action.danger { background: rgba(255, 75, 75, 0.12); color: #FF6B6B; border: 1px solid rgba(255, 75, 75, 0.2); }

    /* TRANSACTIONS FEED */
    .tx-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .tx-item:last-child { border-bottom: none; }
    .tx-name { font-size: 14px; font-weight: 700; color: #FFFFFF; }
    .tx-date { font-size: 11px; color: #8E9387; margin-top: 3px; }
    .tx-amount { font-size: 15px; font-weight: 800; color: #C6FF00; text-align: right; }
    .tx-pkg { font-size: 11px; color: #8E9387; margin-top: 2px; }

    /* PRIMARY PILL ACTION BUTTON */
    .primary-pill-btn {
      width: 100%;
      background: #C6FF00;
      color: #0A0B08;
      border: none;
      border-radius: 999px;
      padding: 16px 20px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: 0 8px 24px rgba(198, 255, 0, 0.3);
      transition: transform 0.1s ease, filter 0.2s ease;
      margin-top: 14px;
    }
    .primary-pill-btn:active { transform: scale(0.98); filter: brightness(0.9); }

    /* FLOATING PILL BOTTOM NAVIGATION BAR */
    .bottom-nav {
      position: fixed;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 28px);
      max-width: 428px;
      background: rgba(22, 24, 19, 0.88);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(198, 255, 0, 0.15);
      border-radius: 999px;
      padding: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
    }
    .nav-btn {
      background: transparent;
      border: none;
      color: #8E9387;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: inherit;
    }
    .nav-btn.active {
      background: #C6FF00;
      color: #0A0B08;
      width: auto;
      border-radius: 999px;
      padding: 0 13px;
      gap: 6px;
      font-weight: 800;
      font-size: 12px;
      box-shadow: 0 0 20px rgba(198, 255, 0, 0.4);
    }
    .nav-btn .nav-text {
      display: none;
    }
    .nav-btn.active .nav-text {
      display: inline;
    }

    /* PIN LOCK OVERLAY */
    .pin-overlay {
      position: fixed;
      inset: 0;
      background: #0A0B08;
      background-image: radial-gradient(circle at 50% 20%, rgba(198, 255, 0, 0.2), transparent 60%);
      z-index: 999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: calc(env(safe-area-inset-top, 0px) + 24px) 24px calc(env(safe-area-inset-bottom, 0px) + 24px);
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }
    .pin-overlay.hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    .pin-dots {
      display: flex;
      gap: 14px;
      margin: 28px 0 36px;
    }
    .pin-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1.5px solid rgba(198, 255, 0, 0.4);
      background: transparent;
      transition: all 0.2s ease;
    }
    .pin-dot.filled {
      background: #C6FF00;
      box-shadow: 0 0 10px #C6FF00;
      transform: scale(1.15);
    }
    .keypad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      width: 270px;
    }
    .key-btn {
      width: 74px;
      height: 74px;
      border-radius: 50%;
      background: #141612;
      border: 1px solid rgba(198, 255, 0, 0.15);
      color: #FFFFFF;
      font-size: 24px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
      transition: background 0.1s ease, transform 0.1s ease;
    }
    .key-btn:active {
      background: rgba(198, 255, 0, 0.2);
      transform: scale(0.92);
    }

    /* TAB VIEWS */
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.25s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>

  <!-- PIN LOCK SCREEN -->
  <div id="pin-screen" class="pin-overlay">
    <div style="width: 56px; height: 56px; border-radius: 20px; background: rgba(198, 255, 0, 0.12); border: 1px solid rgba(198, 255, 0, 0.28); display: flex; align-items: center; justify-content: center; margin-bottom: 18px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C6FF00" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
    </div>
    <h2 style="font-size: 20px; font-weight: 800; letter-spacing: -0.3px;">StatusClear Monitor</h2>
    <p style="font-size: 13px; color: #8E9387; margin-top: 4px;">Enter 6-digit security PIN</p>
    <p id="pin-error" style="font-size: 12px; color: #FF6B6B; margin-top: 8px; min-height: 16px;"></p>
    
    <div class="pin-dots">
      <div class="pin-dot" id="dot-0"></div>
      <div class="pin-dot" id="dot-1"></div>
      <div class="pin-dot" id="dot-2"></div>
      <div class="pin-dot" id="dot-3"></div>
      <div class="pin-dot" id="dot-4"></div>
      <div class="pin-dot" id="dot-5"></div>
    </div>

    <div class="keypad">
      <button type="button" class="key-btn" onclick="pressKey('1')">1</button>
      <button type="button" class="key-btn" onclick="pressKey('2')">2</button>
      <button type="button" class="key-btn" onclick="pressKey('3')">3</button>
      <button type="button" class="key-btn" onclick="pressKey('4')">4</button>
      <button type="button" class="key-btn" onclick="pressKey('5')">5</button>
      <button type="button" class="key-btn" onclick="pressKey('6')">6</button>
      <button type="button" class="key-btn" onclick="pressKey('7')">7</button>
      <button type="button" class="key-btn" onclick="pressKey('8')">8</button>
      <button type="button" class="key-btn" onclick="pressKey('9')">9</button>
      <button type="button" class="key-btn" style="font-size: 12px; color: #8E9387;" onclick="clearPin()">RESET</button>
      <button type="button" class="key-btn" onclick="pressKey('0')">0</button>
      <button type="button" class="key-btn" onclick="deletePin()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="9" x2="18" y2="15"></line></svg>
      </button>
    </div>
  </div>

  <!-- MAIN APP CONTAINER -->
  <div class="app-container">

    <!-- TOP HEADER -->
    <div class="top-bar">
      <div>
        <h1 class="top-title" id="page-heading">Dashboard</h1>
        <p class="top-subtitle" id="current-date">Loading date...</p>
      </div>
      <div class="status-badge">
        <div class="status-dot" id="wa-dot"></div>
        <span id="wa-text">ONLINE</span>
      </div>
    </div>

    <!-- TAB 1: OVERVIEW -->
    <div id="tab-overview" class="tab-content active">

      <!-- HERO CIRCULAR ARC GAUGE -->
      <div class="bento-card">
        <div class="gauge-wrapper">
          <svg viewBox="0 0 200 120" class="gauge-svg">
            <path d="M 25 105 A 75 75 0 0 1 175 105" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="13" stroke-linecap="round"/>
            <path id="gauge-arc" d="M 25 105 A 75 75 0 0 1 175 105" fill="none" stroke="#C6FF00" stroke-width="13" stroke-linecap="round"
              stroke-dasharray="235.6" stroke-dashoffset="23.5" style="filter: drop-shadow(0 0 8px rgba(198, 255, 0, 0.6)); transition: stroke-dashoffset 0.8s ease;"/>
            <text x="100" y="80" text-anchor="middle" id="gauge-score" fill="#FFFFFF" font-family="'Plus Jakarta Sans', sans-serif" font-weight="800" font-size="38">96</text>
            <text x="100" y="100" text-anchor="middle" fill="#8E9387" font-family="'Inter', sans-serif" font-weight="600" font-size="10" letter-spacing="1.2">SYSTEM READINESS</text>
          </svg>
        </div>
        <div style="text-align: center; font-size: 12px; color: #8E9387; font-weight: 500; margin-top: 4px;">
          Baileys Socket Active • Memory Protected
        </div>
      </div>

      <!-- 3-COLUMN BENTO GRID -->
      <div class="grid-3">
        <div class="mini-card">
          <span class="mini-label">Revenue (All)</span>
          <span class="mini-val" id="stat-revenue" style="margin-bottom: 2px;">RM 0.00</span>
          <span id="stat-revenue-net" style="font-size: 10.5px; color: #C6FF00; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 4px;">Net RM 0.00</span>
          <svg viewBox="0 0 80 24" class="sparkline-svg">
            <rect x="4" y="12" width="8" height="12" rx="2" fill="rgba(198,255,0,0.3)"/>
            <rect x="20" y="8" width="8" height="16" rx="2" fill="rgba(198,255,0,0.5)"/>
            <rect x="36" y="14" width="8" height="10" rx="2" fill="rgba(198,255,0,0.4)"/>
            <rect x="52" y="6" width="8" height="18" rx="2" fill="rgba(198,255,0,0.7)"/>
            <rect x="68" y="2" width="8" height="22" rx="2" fill="#C6FF00"/>
          </svg>
        </div>
        <div class="mini-card">
          <span class="mini-label">Active Users</span>
          <span class="mini-val" id="stat-users">0</span>
          <svg viewBox="0 0 80 24" class="sparkline-svg">
            <path d="M 2 18 Q 20 6, 40 14 T 78 4" fill="none" stroke="#C6FF00" stroke-width="1.75" stroke-linecap="round" style="filter: drop-shadow(0 0 4px #C6FF00);"/>
          </svg>
        </div>
        <div class="mini-card">
          <span class="mini-label">HD Media</span>
          <span class="mini-val" id="stat-media">0</span>
          <svg viewBox="0 0 80 24" class="sparkline-svg">
            <rect x="6" y="10" width="7" height="14" rx="2" fill="rgba(198,255,0,0.4)"/>
            <rect x="22" y="4" width="7" height="20" rx="2" fill="rgba(198,255,0,0.8)"/>
            <rect x="38" y="12" width="7" height="12" rx="2" fill="rgba(198,255,0,0.5)"/>
            <rect x="54" y="6" width="7" height="18" rx="2" fill="rgba(198,255,0,0.9)"/>
            <rect x="70" y="2" width="7" height="22" rx="2" fill="#C6FF00"/>
          </svg>
        </div>
      </div>

      <!-- 7-DAY LINE CHART -->
      <div class="bento-card">
        <div class="chart-header">
          <div>
            <div class="chart-title">Weekly Activity (Mon – Sun)</div>
            <div class="chart-subtitle">Transactions & media processing volume</div>
          </div>
          <div style="font-size: 11px; font-weight: 700; color: #C6FF00; background: rgba(198,255,0,0.1); padding: 4px 10px; border-radius: 999px;">
            7 Days
          </div>
        </div>
        <svg viewBox="0 0 380 110" class="line-chart-svg" id="chart-svg">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#C6FF00" stop-opacity="0.32"/>
              <stop offset="100%" stop-color="#C6FF00" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <path id="chart-area" d="" fill="url(#chartGrad)"/>
          <path id="chart-line" d="" fill="none" stroke="#C6FF00" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px rgba(198,255,0,0.7));"/>
          <g id="chart-nodes"></g>
          <g id="chart-labels" fill="#8E9387" font-size="10" font-family="'Inter', sans-serif" text-anchor="middle"></g>
        </svg>
      </div>

      <!-- RAILWAY PLAN & INSIGHT CARD -->
      <div class="bento-card">
        <div class="railway-banner">
          <div class="railway-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C6FF00" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
            Railway Pro Instance
          </div>
          <button type="button" class="pill-btn-small" onclick="promptRailwayDate()">Edit Expiry</button>
        </div>
        <div class="meta-row">
          <span>Subscription Remaining:</span>
          <span style="color: #C6FF00; font-weight: 700;" id="railway-countdown">Checking...</span>
        </div>
        <div class="ram-bar-track">
          <div class="ram-bar-fill" id="ram-fill" style="width: 32%;"></div>
        </div>
        <div class="meta-row">
          <span>RAM Headroom (<span id="ram-text">120 MB / 384 MB</span>)</span>
          <span id="ram-percent" style="font-weight: 700; color: #FFFFFF;">31%</span>
        </div>
      </div>

    </div>

    <!-- TAB 2: USERS & REFERRALS -->
    <div id="tab-users" class="tab-content">
      <div class="users-action-row">
        <button type="button" class="action-pill-btn solid" onclick="toggleRegisterForm()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
          Register Member
        </button>
        <button type="button" class="action-pill-btn" id="users-sync-btn" onclick="syncAllData('users-sync-btn', 'users-sync-status')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Sync Now
        </button>
      </div>

      <div class="broadcast-status-box" id="users-sync-status" style="margin-top: 0; margin-bottom: 12px;"></div>

      <!-- REGISTER MEMBER FORM -->
      <div class="bento-card" id="register-member-card" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <span style="font-size: 14px; font-weight: 700;">Register New Member</span>
          <button type="button" class="pill-btn-small" onclick="toggleRegisterForm(false)">Close</button>
        </div>
        <label class="form-label" for="reg-name">Full Name</label>
        <input type="text" id="reg-name" class="form-input" placeholder="e.g. Muhammad Ali">

        <label class="form-label" for="reg-phone">WhatsApp Phone Number</label>
        <input type="text" id="reg-phone" class="form-input" placeholder="e.g. 0123456789 or 60123456789">

        <label class="form-label" for="reg-tier">Subscription Tier</label>
        <select id="reg-tier" class="form-input">
          <option value="WA">WhatsApp Status HD (WA)</option>
          <option value="TT">TikTok 1080p 60fps HD (TT)</option>
          <option value="COMBO">Combo WhatsApp + TikTok (WA + TT)</option>
        </select>

        <label class="form-label" for="reg-months">Subscription Duration</label>
        <select id="reg-months" class="form-input">
          <option value="1">1 Month (30 Days)</option>
          <option value="2">2 Months (60 Days)</option>
          <option value="3">3 Months (90 Days)</option>
          <option value="6">6 Months (180 Days)</option>
          <option value="12">12 Months (365 Days)</option>
        </select>

        <label class="form-label" for="reg-refcode">Referral Code Used (Optional)</label>
        <input type="text" id="reg-refcode" class="form-input" placeholder="e.g. ALIF123">

        <button type="button" class="primary-pill-btn" id="reg-submit-btn" onclick="submitRegisterMember()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span id="reg-submit-label">Activate & Save Member</span>
        </button>
      </div>

      <div class="search-wrapper">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" class="search-box" id="user-search" placeholder="Search name, phone number, or referral code..." oninput="filterUsers()">
      </div>
      <div class="pill-filter-bar" id="user-filter-bar">
        <button type="button" class="filter-pill active" id="filter-all" onclick="setUserFilter('all')">Semua (0)</button>
        <button type="button" class="filter-pill" id="filter-wa" onclick="setUserFilter('wa')">Subs WA (0)</button>
        <button type="button" class="filter-pill" id="filter-tt" onclick="setUserFilter('tt')">Subs TT (0)</button>
        <button type="button" class="filter-pill" id="filter-combo" onclick="setUserFilter('combo')">Subs WA + TT (0)</button>
      </div>
      <div class="pill-filter-bar" id="user-pay-sort-bar" style="margin-top: -8px;">
        <button type="button" class="filter-pill active" id="pay-filter-all" onclick="setPayFilter('all')">All</button>
        <button type="button" class="filter-pill" id="pay-filter-paid" onclick="setPayFilter('paid')">Paid</button>
        <button type="button" class="filter-pill" id="pay-filter-unpaid" onclick="setPayFilter('unpaid')">Unpaid</button>
        <button type="button" class="filter-pill active" id="sort-newest" onclick="setUserSort('newest')">Newest</button>
        <button type="button" class="filter-pill" id="sort-oldest" onclick="setUserSort('oldest')">Oldest</button>
      </div>
      <div id="users-list-container">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- TAB 3: CHIP ASIA PAYMENTS & PAYOUTS -->
    <div id="tab-hitpay" class="tab-content">
      <div class="bento-card" style="padding: 16px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-size: 14px; font-weight: 700;">CHIP Asia Gateway</span>
            <div style="font-size: 11px; color: #8E9387; margin-top: 2px;" id="hitpay-sync-time">Live Webhook & Records</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 10px; font-weight: 700; color: #C6FF00; background: rgba(198,255,0,0.1); padding: 4px 10px; border-radius: 999px;" id="hitpay-status-pill">LIVE</span>
            <button type="button" class="pill-btn-small" id="hitpay-sync-btn" onclick="syncAllData('hitpay-sync-btn', 'hitpay-sync-status')">Sync</button>
          </div>
        </div>
        <div class="broadcast-status-box" id="hitpay-sync-status" style="margin-top: 10px;"></div>
      </div>

      <div class="grid-3">
        <div class="mini-card">
          <span class="mini-label">Gross Sales</span>
          <span class="mini-val" id="hitpay-gross-rev" style="font-size: 15px;">RM 0.00</span>
          <span style="font-size: 10px; color: #8E9387;">Total Collected</span>
        </div>
        <div class="mini-card">
          <span class="mini-label">Net Revenue</span>
          <span class="mini-val" id="hitpay-net-rev" style="font-size: 15px; color: #C6FF00;">RM 0.00</span>
          <span style="font-size: 10px; color: #8E9387;">After CHIP Fee</span>
        </div>
        <div class="mini-card">
          <span class="mini-label">CHIP Fees</span>
          <span class="mini-val" id="hitpay-total-fees" style="font-size: 15px; color: #FF9F43;">RM 0.00</span>
          <span style="font-size: 10px; color: #8E9387;">Gateway Fee</span>
        </div>
      </div>

      <div class="grid-2">
        <div class="mini-card">
          <span class="mini-label">Successful Payments</span>
          <span class="mini-val" id="hitpay-total-collected" style="color: #C6FF00;">RM 0.00</span>
          <span style="font-size: 11px; color: #8E9387;" id="hitpay-collected-meta">0 payments</span>
        </div>
        <div class="mini-card">
          <span class="mini-label">Bank Payouts</span>
          <span class="mini-val" id="hitpay-total-payout">RM 0.00</span>
          <span style="font-size: 11px; color: #8E9387;" id="hitpay-payout-meta">0 payouts</span>
        </div>
      </div>

      <div class="pill-filter-bar" id="hitpay-view-bar">
        <button type="button" class="filter-pill active" id="hp-tab-payments" onclick="setHitPayView('payments')">Payments In (0)</button>
        <button type="button" class="filter-pill" id="hp-tab-payouts" onclick="setHitPayView('payouts')">Bank Payouts (0)</button>
      </div>

      <div class="bento-card">
        <div style="font-size: 12px; font-weight: 700; margin-bottom: 10px; color: #8E9387; text-transform: uppercase; letter-spacing: 0.5px;" id="hitpay-feed-heading">
          Successful Payments Received
        </div>
        <div id="transactions-container">
          <!-- Rendered dynamically -->
        </div>
        <div id="payouts-container" style="display: none;">
          <!-- Rendered dynamically -->
        </div>
      </div>
    </div>

    <!-- TAB 4: SYSTEM & HARDWARE TELEMETRY -->
    <div id="tab-system" class="tab-content">
      <div class="bento-card">
        <div style="font-size: 14px; font-weight: 700; margin-bottom: 14px;">Server Memory (Node.js RSS)</div>
        <div class="ram-bar-track" style="height: 10px;">
          <div class="ram-bar-fill" id="sys-ram-fill" style="width: 35%;"></div>
        </div>
        <div class="meta-row" style="margin-top: 10px;">
          <span>Physical Memory:</span>
          <span style="color: #FFFFFF; font-weight: 700;" id="sys-ram-rss">-- MB / 384 MB</span>
        </div>
        <div class="meta-row" style="margin-top: 6px;">
          <span>Heap Memory:</span>
          <span style="color: #8E9387;" id="sys-ram-heap">-- MB</span>
        </div>
      </div>

      <div class="bento-card">
        <div style="font-size: 14px; font-weight: 700; margin-bottom: 14px;">System & WhatsApp Telemetry</div>
        <div class="meta-row" style="margin-bottom: 10px;">
          <span>Server Uptime:</span>
          <span style="color: #FFFFFF; font-weight: 700;" id="sys-uptime">--</span>
        </div>
        <div class="meta-row" style="margin-bottom: 10px;">
          <span>CPU Cores & Load:</span>
          <span style="color: #FFFFFF; font-weight: 700;" id="sys-cpu">--</span>
        </div>
        <div class="meta-row" style="margin-bottom: 10px;">
          <span>Media Queue (FIFO):</span>
          <span style="color: #C6FF00; font-weight: 700;" id="sys-queue">0 / 25</span>
        </div>
        <div class="meta-row">
          <span>WhatsApp Bot Number:</span>
          <span style="color: #FFFFFF; font-weight: 700;" id="sys-wa-num">--</span>
        </div>

        <button type="button" class="primary-pill-btn" onclick="triggerGC()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Flush Memory / Trigger GC (global.gc())
        </button>
      </div>
    </div>

    <!-- TAB 5: BROADCAST MESSAGE -->
    <div id="tab-broadcast" class="tab-content">
      <div class="bento-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 14px; font-weight: 700;">Target Audience</span>
          <span style="font-size: 11px; color: #C6FF00; background: rgba(198,255,0,0.1); padding: 4px 10px; border-radius: 999px;" id="broadcast-count-pill">0 Recipients</span>
        </div>

        <div class="pill-filter-bar" style="margin-bottom: 14px;">
          <button type="button" class="filter-pill active" id="bcast-target-all" onclick="setBroadcastTarget('all')">All</button>
          <button type="button" class="filter-pill" id="bcast-target-paid" onclick="setBroadcastTarget('paid')">Paid</button>
          <button type="button" class="filter-pill" id="bcast-target-unpaid" onclick="setBroadcastTarget('unpaid')">Unpaid</button>
        </div>

        <div style="font-size: 12px; color: #8E9387; margin-bottom: 8px;">Quick Templates (Optional):</div>
        <div class="chip-row">
          <button type="button" class="template-chip" onclick="applyBroadcastTemplate('promo')">Subscription Promo</button>
          <button type="button" class="template-chip" onclick="applyBroadcastTemplate('reminder')">Renewal Reminder</button>
          <button type="button" class="template-chip" onclick="applyBroadcastTemplate('info')">System Update</button>
        </div>

        <textarea id="broadcast-message" class="broadcast-textarea" placeholder="Write your WhatsApp broadcast message here... Use {name} for the member's name."></textarea>
        <div style="font-size: 11px; color: #8E9387; margin-top: 8px;">
          Supported variable: <strong style="color: #C6FF00;">{name}</strong> • WhatsApp formatting (*bold*, _italic_)
        </div>

        <button type="button" class="primary-pill-btn" id="broadcast-send-btn" onclick="sendBroadcastMessage()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          <span id="broadcast-btn-label">Send Broadcast Now</span>
        </button>

        <div class="broadcast-status-box" id="broadcast-status-box"></div>
      </div>
    </div>

  </div>

  <!-- FLOATING PILL BOTTOM NAVIGATION BAR -->
  <nav class="bottom-nav">
    <button type="button" class="nav-btn active" id="btn-overview" onclick="switchTab('overview')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      <span class="nav-text">Overview</span>
    </button>

    <button type="button" class="nav-btn" id="btn-users" onclick="switchTab('users')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
      <span class="nav-text">Users</span>
    </button>

    <button type="button" class="nav-btn" id="btn-hitpay" onclick="switchTab('hitpay')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
      <span class="nav-text">HitPay</span>
    </button>

    <button type="button" class="nav-btn" id="btn-broadcast" onclick="switchTab('broadcast')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      <span class="nav-text">Broadcast</span>
    </button>

    <button type="button" class="nav-btn" id="btn-system" onclick="switchTab('system')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
      <span class="nav-text">System</span>
    </button>
  </nav>

  <script>
    // PIN SECURITY LOGIC
    let enteredPin = '';
    const CORRECT_PIN = ${JSON.stringify(ADMIN_PIN)};

    function escHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function initPin() {
      if (localStorage.getItem('sc_pin_unlocked') === 'true') {
        document.getElementById('pin-screen').classList.add('hidden');
      }
    }

    function pressKey(num) {
      if (enteredPin.length < 6) {
        document.getElementById('pin-error').textContent = '';
        enteredPin += num;
        updateDots();
        if (enteredPin.length === 6) {
          setTimeout(verifyPin, 100);
        }
      }
    }

    function deletePin() {
      if (enteredPin.length > 0) {
        enteredPin = enteredPin.slice(0, -1);
        updateDots();
      }
    }

    function clearPin() {
      enteredPin = '';
      document.getElementById('pin-error').textContent = '';
      updateDots();
    }

    function updateDots() {
      for (let i = 0; i < 6; i++) {
        const dot = document.getElementById('dot-' + i);
        if (i < enteredPin.length) dot.classList.add('filled');
        else dot.classList.remove('filled');
      }
    }

    function verifyPin() {
      if (enteredPin === CORRECT_PIN) {
        localStorage.setItem('sc_pin_unlocked', 'true');
        document.getElementById('pin-error').textContent = '';
        document.getElementById('pin-screen').classList.add('hidden');
      } else {
        document.getElementById('pin-error').textContent = 'Invalid PIN. Please try again.';
        enteredPin = '';
        updateDots();
      }
    }

    document.addEventListener('keydown', function (e) {
      const pinScreen = document.getElementById('pin-screen');
      if (!pinScreen || pinScreen.classList.contains('hidden')) return;
      if (e.key >= '0' && e.key <= '9') pressKey(e.key);
      else if (e.key === 'Backspace') deletePin();
      else if (e.key === 'Escape') clearPin();
    });

    initPin();

    // TAB SWITCHING
    function switchTab(tabId) {
      const tabs = ['overview', 'users', 'hitpay', 'broadcast', 'system'];
      tabs.forEach(t => {
        document.getElementById('tab-' + t).classList.remove('active');
        document.getElementById('btn-' + t).classList.remove('active');
      });
      document.getElementById('tab-' + tabId).classList.add('active');
      document.getElementById('btn-' + tabId).classList.add('active');

      const titles = {
        overview: 'Dashboard',
        users: 'Users & Referrals',
        hitpay: 'CHIP Asia Gateway',
        broadcast: 'WhatsApp Broadcast',
        system: 'System Telemetry'
      };
      document.getElementById('page-heading').innerText = titles[tabId] || 'Dashboard';
    }

    // TELEMETRY STATE & POLLING
    let currentData = null;
    let currentUserFilter = 'all';
    let currentPayFilter = 'all';
    let currentUserSort = 'newest';
    let broadcastTarget = 'all';
    let hitpayView = 'payments';

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        currentData = await res.json();
        renderDashboard(currentData);
      } catch (e) {
        console.error('Stats poll error:', e);
      }
    }

    function renderDashboard(data) {
      // Date & Header
      const options = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
      document.getElementById('current-date').innerText = new Date().toLocaleDateString('en-GB', options);

      // WhatsApp Status Badge
      const waText = document.getElementById('wa-text');
      const waDot = document.getElementById('wa-dot');
      waText.innerText = data.waStatus || 'OFFLINE';
      if (data.waStatus === 'ONLINE') {
        waDot.style.background = '#C6FF00';
        waDot.style.boxShadow = '0 0 8px #C6FF00';
      } else if (data.waStatus === 'PAIRING') {
        waDot.style.background = '#FFD600';
        waDot.style.boxShadow = '0 0 8px #FFD600';
      } else {
        waDot.style.background = '#8E9387';
        waDot.style.boxShadow = 'none';
      }

      // Hero Readiness Arc Gauge
      const score = Math.max(0, Math.min(100, data.readinessScore || 95));
      document.getElementById('gauge-score').textContent = score;
      const offset = 235.6 * (1 - (score / 100));
      document.getElementById('gauge-arc').style.strokeDashoffset = offset;

      // 3-Column Bento Stats
      const metricsObj = data.metrics || {};
      const grossRevStr = data.grossRevenue || metricsObj.grossRevenue || metricsObj.revenueRM || '0.00';
      const netRevStr = data.netRevenue || metricsObj.netRevenue || '0.00';
      document.getElementById('stat-revenue').innerText = 'RM ' + grossRevStr;
      const netRevEl = document.getElementById('stat-revenue-net');
      if (netRevEl) netRevEl.innerText = 'Net RM ' + netRevStr;
      document.getElementById('stat-users').innerText = metricsObj.activeUsersCount || '0';
      document.getElementById('stat-media').innerText = metricsObj.totalMediaProcessed || '0';

      // 7-Day Chart
      render7DayChart(data.weeklyActivity || [0,0,0,0,0,0,0]);

      // Railway Countdown
      renderRailwayCountdown(data.railwayRenewDate);

      // RAM
      const ramPercent = Math.min(100, Math.round((data.ram.rssMB / data.ram.maxMB) * 100));
      document.getElementById('ram-fill').style.width = ramPercent + '%';
      document.getElementById('ram-text').innerText = data.ram.rssMB + ' MB / ' + data.ram.maxMB + ' MB';
      document.getElementById('ram-percent').innerText = ramPercent + '%';

      // System Tab
      document.getElementById('sys-ram-fill').style.width = ramPercent + '%';
      document.getElementById('sys-ram-rss').innerText = data.ram.rssMB + ' MB / ' + data.ram.maxMB + ' MB (' + ramPercent + '%)';
      document.getElementById('sys-ram-heap').innerText = data.ram.heapUsedMB + ' MB / ' + data.ram.heapTotalMB + ' MB';
      document.getElementById('sys-uptime').innerText = data.uptimeFormatted || '--';
      document.getElementById('sys-cpu').innerText = data.cpu.cores + ' Cores • Load: ' + data.cpu.loadAvg;
      document.getElementById('sys-queue').innerText = (data.queue.waiting || 0) + ' / ' + data.queue.max;
      document.getElementById('sys-wa-num').innerText = '+' + (data.pairingNumber || data.adminNumber || '601157270564');

      // Users, HitPay & Broadcast
      renderUsers(data.users || []);
      renderHitPaySection(data);
      updateBroadcastTargetCount();
      if (data.broadcastState && data.broadcastState.running) {
        showBoxMessage('broadcast-status-box', 'Sending: ' + data.broadcastState.sent + ' sent, ' + data.broadcastState.failed + ' failed (of ' + data.broadcastState.total + ')', false);
      }
    }

    function render7DayChart(values) {
      if (!Array.isArray(values) || values.length === 0) values = [0, 0, 0, 0, 0, 0, 0];
      const max = Math.max(...values, 5);
      const points = [];
      const shortLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const width = 380;
      const height = 90;
      const step = (width - 40) / 6;

      values.forEach((v, i) => {
        const x = 20 + (i * step);
        const y = height - ((v / max) * 60) - 15;
        points.push({ x, y, v });
      });

      let dLine = 'M ' + points[0].x + ' ' + points[0].y;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const cpX1 = prev.x + (curr.x - prev.x) / 2;
        const cpX2 = cpX1;
        dLine += ' C ' + cpX1 + ' ' + prev.y + ', ' + cpX2 + ' ' + curr.y + ', ' + curr.x + ' ' + curr.y;
      }

      const dArea = dLine + ' L ' + points[points.length - 1].x + ' 100 L ' + points[0].x + ' 100 Z';
      document.getElementById('chart-line').setAttribute('d', dLine);
      document.getElementById('chart-area').setAttribute('d', dArea);

      let nodesHtml = '';
      let labelsHtml = '';
      points.forEach((p, i) => {
        nodesHtml += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="#C6FF00" style="filter: drop-shadow(0 0 4px #C6FF00);"/>';
        labelsHtml += '<text x="' + p.x + '" y="105">' + (shortLabels[i] || '') + '</text>';
      });
      document.getElementById('chart-nodes').innerHTML = nodesHtml;
      document.getElementById('chart-labels').innerHTML = labelsHtml;
    }

    function renderRailwayCountdown(dateStr) {
      const elem = document.getElementById('railway-countdown');
      if (!dateStr) {
        elem.innerText = 'Active (Date not set)';
        elem.style.color = '#C6FF00';
        return;
      }
      const target = new Date(dateStr).getTime();
      if (isNaN(target)) {
        elem.innerText = 'Invalid date format';
        elem.style.color = '#FF6B6B';
        return;
      }
      const diff = target - Date.now();
      if (diff <= 0) {
        elem.innerText = 'Expired / Renewal Required';
        elem.style.color = '#FF6B6B';
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        elem.innerText = days + ' Days ' + hours + ' Hours Left';
        elem.style.color = '#C6FF00';
      }
    }

    async function promptRailwayDate() {
      const current = (currentData && currentData.railwayRenewDate) || '';
      const input = prompt('Enter Railway subscription expiry date (Format: YYYY-MM-DD):', current);
      if (input !== null) {
        await postAction('setRailwayDate', { date: input.trim() });
        fetchStats();
      }
    }

    function showBoxMessage(boxId, msg, isError) {
      const box = document.getElementById(boxId);
      if (!box) return;
      box.style.display = 'block';
      box.style.borderColor = isError ? 'rgba(255, 107, 107, 0.45)' : 'rgba(198, 255, 0, 0.28)';
      box.style.background = isError ? 'rgba(255, 75, 75, 0.12)' : 'rgba(198, 255, 0, 0.08)';
      box.style.color = isError ? '#FF6B6B' : '#FFFFFF';
      box.innerText = msg;
    }

    // REGISTER MEMBER & SYNC
    function toggleRegisterForm(forceState) {
      const card = document.getElementById('register-member-card');
      if (!card) return;
      const shouldShow = forceState !== undefined ? forceState : (card.style.display === 'none');
      card.style.display = shouldShow ? 'block' : 'none';
    }

    async function submitRegisterMember() {
      const nameEl = document.getElementById('reg-name');
      const phoneEl = document.getElementById('reg-phone');
      const tierEl = document.getElementById('reg-tier');
      const monthsEl = document.getElementById('reg-months');
      const refEl = document.getElementById('reg-refcode');
      const btn = document.getElementById('reg-submit-btn');
      const lbl = document.getElementById('reg-submit-label');

      const name = (nameEl && nameEl.value || '').trim();
      const phone = (phoneEl && phoneEl.value || '').trim();
      const tier = (tierEl && tierEl.value) || 'WA';
      const months = parseInt(monthsEl && monthsEl.value, 10) || 1;
      const referralCode = (refEl && refEl.value || '').trim();

      if (!phone || phone.replace(/[^0-9]/g, '').length < 8) {
        showBoxMessage('users-sync-status', 'Please enter a valid WhatsApp phone number.', true);
        return;
      }

      btn.disabled = true;
      lbl.innerText = 'Registering...';
      const res = await postAction('registerUser', { name, phone, tier, months, referralCode });
      btn.disabled = false;
      lbl.innerText = 'Activate & Save Member';

      if (res && res.success) {
        if (nameEl) nameEl.value = '';
        if (phoneEl) phoneEl.value = '';
        if (refEl) refEl.value = '';
        toggleRegisterForm(false);
        showBoxMessage('users-sync-status', res.message || 'Member registered successfully.', false);
        fetchStats();
      } else {
        showBoxMessage('users-sync-status', (res && res.message) || 'Failed to register member.', true);
      }
    }

    async function syncAllData(btnId, statusBoxId) {
      const btn = document.getElementById(btnId);
      const origText = btn ? btn.innerText : '';
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Syncing...';
      }
      showBoxMessage(statusBoxId, 'Syncing HitPay payments, payouts & WhatsApp records...', false);
      const res = await postAction('syncData');
      if (btn) {
        btn.disabled = false;
        btn.innerText = origText || 'Sync';
      }
      if (res && res.success) {
        showBoxMessage(statusBoxId, res.message || 'Sync completed.', false);
        fetchStats();
      } else {
        showBoxMessage(statusBoxId, (res && res.message) || 'Sync failed.', true);
      }
    }

    // USERS RENDERING & ACTIONS
    function setUserFilter(filter) {
      currentUserFilter = filter;
      ['all', 'wa', 'tt', 'combo'].forEach(f => {
        const el = document.getElementById('filter-' + f);
        if (el) el.classList.toggle('active', f === filter);
      });
      if (currentData) renderUsers(currentData.users || []);
    }

    function setPayFilter(mode) {
      currentPayFilter = mode;
      ['all', 'paid', 'unpaid'].forEach(m => {
        const el = document.getElementById('pay-filter-' + m);
        if (el) el.classList.toggle('active', m === mode);
      });
      if (currentData) renderUsers(currentData.users || []);
    }

    function setUserSort(dir) {
      currentUserSort = dir;
      ['newest', 'oldest'].forEach(d => {
        const el = document.getElementById('sort-' + d);
        if (el) el.classList.toggle('active', d === dir);
      });
      if (currentData) renderUsers(currentData.users || []);
    }

    function renderUsers(users) {
      const container = document.getElementById('users-list-container');
      const query = (document.getElementById('user-search').value || '').toLowerCase().trim();

      const waCount = users.filter(u => !!u.waActive).length;
      const ttCount = users.filter(u => !!u.ttActive).length;
      const comboCount = users.filter(u => !!u.waActive && !!u.ttActive).length;
      const allBtn = document.getElementById('filter-all');
      const waBtn = document.getElementById('filter-wa');
      const ttBtn = document.getElementById('filter-tt');
      const comboBtn = document.getElementById('filter-combo');
      if (allBtn) allBtn.innerText = 'Semua (' + users.length + ')';
      if (waBtn) waBtn.innerText = 'Subs WA (' + waCount + ')';
      if (ttBtn) ttBtn.innerText = 'Subs TT (' + ttCount + ')';
      if (comboBtn) comboBtn.innerText = 'Subs WA + TT (' + comboCount + ')';

      const filtered = users.filter(u => {
        const hasWa = !!u.waActive;
        const hasTt = !!u.ttActive;
        const matchesCat =
          currentUserFilter === 'all' ||
          (currentUserFilter === 'wa' && hasWa) ||
          (currentUserFilter === 'tt' && hasTt) ||
          (currentUserFilter === 'combo' && hasWa && hasTt);
        if (!matchesCat) return false;

        const isPaidUser = (u.totalPaid || 0) > 0 || hasWa || hasTt;
        if (currentPayFilter === 'paid' && !isPaidUser) return false;
        if (currentPayFilter === 'unpaid' && isPaidUser) return false;

        return (u.name || '').toLowerCase().includes(query) ||
               (u.realName || '').toLowerCase().includes(query) ||
               (u.waName || '').toLowerCase().includes(query) ||
               (u.phone || '').includes(query) ||
               (u.refCode || '').toLowerCase().includes(query);
      });

      filtered.sort((a, b) => {
        const ta = a.createdAt || 0;
        const tb = b.createdAt || 0;
        return currentUserSort === 'oldest' ? (ta - tb) : (tb - ta);
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #8E9387; padding: 30px 0; font-size: 13px;">No members found.</div>';
        return;
      }

      let html = '';
      filtered.forEach(u => {
        const hasWa = !!u.waActive;
        const hasTt = !!u.ttActive;
        const isAct = hasWa || hasTt || u.status === 'ACTIVE';
        const tierBadge = (hasWa && hasTt)
          ? 'WA + TT'
          : (hasWa ? 'WA' : (hasTt ? 'TT' : (u.rawStatus === 'WAITING' ? 'WAITING' : (u.rawStatus === 'NEW' ? 'UNPAID' : 'EXPIRED'))));
        const safePhone = escHtml(String(u.phone || ''));
        const monthsNum = u.subscribedMonths || 0;
        const monthsLabel = monthsNum > 0 ? (monthsNum + (monthsNum === 1 ? ' month' : ' months')) : 'None';
        const daysLeftNum = u.daysLeft || 0;
        const daysLeftLabel = isAct ? (daysLeftNum + (daysLeftNum === 1 ? ' day left' : ' days left')) : '0 days left';
        const waSubHtml = (u.waName && String(u.waName).toLowerCase() !== String(u.name || '').toLowerCase())
          ? '<div style="font-size: 11px; color: #8E9387; margin-top: 1px;">WA: ' + escHtml(u.waName) + '</div>'
          : '';
        const tierDetails =
          'WA: <strong style="color: ' + (hasWa ? '#C6FF00' : '#8E9387') + ';">' + escHtml(u.waExpiredAtFormatted || 'None') + '</strong>' +
          ' • TT: <strong style="color: ' + (hasTt ? '#C6FF00' : '#8E9387') + ';">' + escHtml(u.ttExpiredAtFormatted || 'None') + '</strong>';
        const refByHtml = u.referredByName
          ? '<div style="font-size: 11px; color: #8E9387;">Referred by: <strong style="color: #FFFFFF;">' + escHtml(u.referredByName) + '</strong>' + (u.referredByCode ? ' (' + escHtml(u.referredByCode) + ')' : '') + '</div>'
          : '';
        html +=
          '<div class="user-card">' +
            '<div class="user-card-header">' +
              '<div>' +
                '<div class="user-name">' + escHtml(u.name) + '</div>' +
                waSubHtml +
                '<div class="user-phone">' + escHtml(u.phone) + ' • Code: <strong style="color: #C6FF00;">' + escHtml(u.refCode) + '</strong></div>' +
              '</div>' +
              '<span class="user-badge ' + (isAct ? 'active' : 'expired') + '">' + tierBadge + '</span>' +
            '</div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #8E9387;">' +
              '<span>Subscribed: <strong style="color: #FFFFFF;">' + escHtml(monthsLabel) + '</strong></span>' +
              '<span style="color: ' + (isAct ? '#C6FF00' : '#FF6B6B') + '; font-weight: 700;">' + escHtml(daysLeftLabel) + '</span>' +
            '</div>' +
            '<div style="font-size: 11px; color: #8E9387;">' + tierDetails + '</div>' +
            '<div style="font-size: 12px; color: #8E9387;">' +
              'Expires: <strong style="color: #FFFFFF;">' + escHtml(u.expiredAtFormatted) + '</strong> • Referrals: <strong style="color: #C6FF00;">' + (u.paidReferrals || 0) + '/3</strong>' +
            '</div>' +
            refByHtml +
            '<div class="user-actions">' +
              '<button type="button" class="btn-action lime" data-action="extend" data-phone="' + safePhone + '" data-tier="WA" data-days="30">+30d WA</button>' +
              '<button type="button" class="btn-action lime" data-action="extend" data-phone="' + safePhone + '" data-tier="TT" data-days="30">+30d TT</button>' +
              '<button type="button" class="btn-action lime" data-action="extend" data-phone="' + safePhone + '" data-tier="COMBO" data-days="30">+30d Combo</button>' +
              '<button type="button" class="btn-action danger" data-action="expire" data-phone="' + safePhone + '">Expire</button>' +
            '</div>' +
          '</div>';
      });
      container.innerHTML = html;
    }

    // BROADCAST FUNCTIONS
    function setBroadcastTarget(target) {
      broadcastTarget = target;
      ['all', 'paid', 'unpaid'].forEach(t => {
        const el = document.getElementById('bcast-target-' + t);
        if (el) el.classList.toggle('active', t === target);
      });
      updateBroadcastTargetCount();
    }

    function getBroadcastRecipients() {
      const users = (currentData && currentData.users) || [];
      const adminNum = (currentData && currentData.adminNumber) || '';
      return users.filter(u => {
        if (!u.phone || u.phone === adminNum) return false;
        if (broadcastTarget === 'paid') return u.status === 'ACTIVE';
        if (broadcastTarget === 'unpaid') return u.status !== 'ACTIVE';
        return true;
      });
    }

    function updateBroadcastTargetCount() {
      const pill = document.getElementById('broadcast-count-pill');
      if (!pill) return;
      const list = getBroadcastRecipients();
      pill.innerText = list.length + (list.length === 1 ? ' Recipient' : ' Recipients');
    }

    function applyBroadcastTemplate(type) {
      const box = document.getElementById('broadcast-message');
      if (!box) return;
      if (type === 'promo') {
        box.value = 'Hai {name}, nikmati video & foto WhatsApp Status HD tanpa pecah dengan StatusClear! Balas *PAKEJ* untuk melanggan sekarang.';
      } else if (type === 'reminder') {
        box.value = 'Hai {name}, langganan StatusClear anda hampir tamat atau telah luput. Balas *1* untuk sambung 30 hari (RM11.99) secara automatik!';
      } else if (type === 'info') {
        box.value = 'Makluman StatusClear: Sistem telah dikemaskini untuk kelajuan pemprosesan 60 FPS yang lebih lancar. Hantar media anda sebagai Document untuk mula!';
      }
      box.focus();
    }

    async function sendBroadcastMessage() {
      const msgEl = document.getElementById('broadcast-message');
      const btn = document.getElementById('broadcast-send-btn');
      const lbl = document.getElementById('broadcast-btn-label');
      const text = (msgEl && msgEl.value || '').trim();
      if (!text) {
        showBoxMessage('broadcast-status-box', 'Please enter a broadcast message first.', true);
        return;
      }
      const recipients = getBroadcastRecipients();
      if (recipients.length === 0) {
        showBoxMessage('broadcast-status-box', 'No recipients found in the selected target group.', true);
        return;
      }
      const targetLabel = broadcastTarget === 'paid' ? 'Paid' : (broadcastTarget === 'unpaid' ? 'Unpaid' : 'All');
      if (!confirm('Send broadcast message to ' + recipients.length + ' recipients (' + targetLabel + ')?')) {
        return;
      }

      btn.disabled = true;
      lbl.innerText = 'Sending...';
      showBoxMessage('broadcast-status-box', 'Starting broadcast to ' + recipients.length + ' recipients...', false);

      const res = await postAction('sendBroadcast', { target: broadcastTarget, message: text });
      btn.disabled = false;
      lbl.innerText = 'Send Broadcast Now';

      if (res && res.success) {
        showBoxMessage('broadcast-status-box', res.message || 'Broadcast sent successfully.', false);
      } else {
        showBoxMessage('broadcast-status-box', (res && res.message) || 'Failed to send broadcast.', true);
      }
      fetchStats();
    }

    document.getElementById('users-list-container').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const act = btn.getAttribute('data-action');
      const phone = btn.getAttribute('data-phone');
      if (act === 'extend') {
        const days = parseInt(btn.getAttribute('data-days'), 10) || 30;
        const tier = btn.getAttribute('data-tier') || 'WA';
        handleUserExtend(phone, days, tier);
      } else if (act === 'expire') {
        handleUserExpire(phone);
      }
    });

    function filterUsers() {
      if (currentData) renderUsers(currentData.users || []);
    }

    async function handleUserExtend(phone, days, tier) {
      const planTier = tier || 'WA';
      if (confirm('Add +' + days + ' days (' + planTier + ') to ' + phone + '?')) {
        await postAction('extendUser', { phone, days, tier: planTier });
        fetchStats();
      }
    }

    async function handleUserExpire(phone) {
      if (confirm('Expire subscription for ' + phone + ' immediately?')) {
        await postAction('expireUser', { phone });
        fetchStats();
      }
    }

    // HITPAY PAYMENTS & PAYOUTS RENDERING
    function setHitPayView(view) {
      hitpayView = view;
      const payBtn = document.getElementById('hp-tab-payments');
      const outBtn = document.getElementById('hp-tab-payouts');
      const payList = document.getElementById('transactions-container');
      const outList = document.getElementById('payouts-container');
      const heading = document.getElementById('hitpay-feed-heading');
      if (payBtn) payBtn.classList.toggle('active', view === 'payments');
      if (outBtn) outBtn.classList.toggle('active', view === 'payouts');
      if (payList) payList.style.display = view === 'payments' ? 'block' : 'none';
      if (outList) outList.style.display = view === 'payouts' ? 'block' : 'none';
      if (heading) heading.innerText = view === 'payments' ? 'Successful Payments Received' : 'Transferred Bank Payouts';
    }

    function renderHitPaySection(data) {
      const hp = data.hitpay || {};
      const statusPill = document.getElementById('hitpay-status-pill');
      const syncTimeEl = document.getElementById('hitpay-sync-time');
      if (statusPill) {
        statusPill.innerText = hp.configured ? ((data.hitpayEnv || 'LIVE').toUpperCase()) : 'NOT CONFIGURED';
      }
      if (syncTimeEl) {
        syncTimeEl.innerText = hp.lastSyncedAt
          ? 'Synced: ' + new Date(hp.lastSyncedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : (hp.configured ? 'Waiting for sync...' : 'Local records only');
      }

      const paymentsList = (hp.configured && Array.isArray(hp.payments) && hp.payments.length > 0)
        ? hp.payments
        : (data.transactions || []);
      const payoutsList = Array.isArray(hp.payouts) ? hp.payouts : [];

      const collectedStr = data.grossRevenue || (hp.totalCollectedRM != null ? hp.totalCollectedRM : (data.metrics.revenueRM || '0.00'));
      const netStr = data.netRevenue || (hp.totalNetRM != null ? hp.totalNetRM : '0.00');
      const feesStr = data.totalFees || '0.00';

      const grossHeaderEl = document.getElementById('hitpay-gross-rev');
      const netHeaderEl = document.getElementById('hitpay-net-rev');
      const feesHeaderEl = document.getElementById('hitpay-total-fees');
      if (grossHeaderEl) grossHeaderEl.innerText = 'RM ' + collectedStr;
      if (netHeaderEl) netHeaderEl.innerText = 'RM ' + netStr;
      if (feesHeaderEl) feesHeaderEl.innerText = 'RM ' + feesStr;

      const collectedEl = document.getElementById('hitpay-total-collected');
      const collectedMetaEl = document.getElementById('hitpay-collected-meta');
      if (collectedEl) collectedEl.innerText = 'RM ' + collectedStr;
      if (collectedMetaEl) {
        collectedMetaEl.innerText = (hp.paymentsCount || paymentsList.length) + ' payments • Net RM ' + netStr;
      }

      const payoutEl = document.getElementById('hitpay-total-payout');
      const payoutMetaEl = document.getElementById('hitpay-payout-meta');
      if (payoutEl) payoutEl.innerText = 'RM ' + (hp.totalPaidOutRM || '0.00');
      if (payoutMetaEl) {
        const pendingVal = parseFloat(hp.totalPendingPayoutRM || '0');
        payoutMetaEl.innerText = payoutsList.length + ' payouts' + (pendingVal > 0 ? (' • Pending RM ' + pendingVal.toFixed(2)) : '');
      }

      const payTabBtn = document.getElementById('hp-tab-payments');
      const outTabBtn = document.getElementById('hp-tab-payouts');
      if (payTabBtn) payTabBtn.innerText = 'Payments In (' + paymentsList.length + ')';
      if (outTabBtn) outTabBtn.innerText = 'Bank Payouts (' + payoutsList.length + ')';

      renderTransactions(paymentsList);
      renderPayouts(payoutsList);
    }

    function renderTransactions(txs) {
      const container = document.getElementById('transactions-container');
      if (!txs || txs.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #8E9387; padding: 24px 0; font-size: 12px;">No successful payments found yet.</div>';
        return;
      }
      let html = '';
      txs.slice(0, 50).forEach(t => {
        const dateStr = new Date(t.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const amtNum = parseFloat(t.amount);
        const amtStr = Number.isFinite(amtNum) ? amtNum.toFixed(2) : '0.00';
        const netLabel = t.netAmount != null ? (' • Net RM ' + escHtml(t.netAmount)) : '';
        const invLabel = t.invoiceRef ? ('<strong style="color:#C6FF00;">' + escHtml(t.invoiceRef) + '</strong> • ') : '';
        html +=
          '<div class="tx-item">' +
            '<div>' +
              '<div class="tx-name">' + escHtml(t.buyerName || 'Customer') + '</div>' +
              '<div class="tx-date">' + escHtml(t.buyerPhone || '-') + ' • ' + escHtml(dateStr) + '</div>' +
              '<div class="tx-pkg">' + invLabel + escHtml(t.method || 'CHIP Asia') + netLabel + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="tx-amount">RM ' + amtStr + '</div>' +
              '<div class="tx-pkg" style="text-align: right;">' + (t.packageDays ? ('+' + t.packageDays + ' Days') : escHtml(t.currency || 'MYR')) + '</div>' +
            '</div>' +
          '</div>';
      });
      container.innerHTML = html;
    }

    function renderPayouts(payouts) {
      const container = document.getElementById('payouts-container');
      if (!container) return;
      if (!payouts || payouts.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #8E9387; padding: 24px 0; font-size: 12px;">No bank payouts recorded yet.</div>';
        return;
      }
      let html = '';
      payouts.slice(0, 50).forEach(p => {
        const dateStr = p.timestamp ? new Date(p.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : (p.arrivalDate || '-');
        const amtNum = parseFloat(p.amount);
        const amtStr = Number.isFinite(amtNum) ? amtNum.toFixed(2) : '0.00';
        const st = String(p.status || 'paid').toUpperCase();
        const isPaid = st === 'PAID';
        const bankLabel = escHtml(p.bankName || 'Bank Account') + (p.bankAccount ? (' (' + escHtml(p.bankAccount) + ')') : '');
        html +=
          '<div class="tx-item">' +
            '<div>' +
              '<div class="tx-name">' + bankLabel + '</div>' +
              '<div class="tx-date">' + escHtml(dateStr) + ' • Ref: ' + escHtml(p.reference || '-') + '</div>' +
            '</div>' +
            '<div style="text-align: right;">' +
              '<div class="tx-amount" style="color: ' + (isPaid ? '#C6FF00' : '#FFFFFF') + ';">RM ' + amtStr + '</div>' +
              '<span class="user-badge ' + (isPaid ? 'active' : 'expired') + '" style="display: inline-block; margin-top: 4px;">' + escHtml(st) + '</span>' +
            '</div>' +
          '</div>';
      });
      container.innerHTML = html;
    }

    // ACTIONS API CALLER
    async function postAction(action, payload = {}) {
      try {
        const res = await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ action }, payload))
        });
        const data = await res.json();
        return data;
      } catch (err) {
        alert('Action error: ' + err.message);
      }
    }

    async function triggerGC() {
      const res = await postAction('triggerGC');
      alert((res && res.message) ? res.message : 'Node.js garbage collection triggered.');
      fetchStats();
    }

    // SERVICE WORKER REGISTRATION (PWA)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Start Silent Polling every 5 seconds
    fetchStats();
    setInterval(fetchStats, 5000);
  </script>
</body>
</html>
`;

// -------------------------------------------------------------
// PELAYAN WEB RAILWAY & PENGENDALI WEBHOOK HITPAY
// -------------------------------------------------------------
const PORT = process.env.PORT || process.env.WEBHOOK_PORT || 3000;
let currentSock = null;
let httpServer = null;
let broadcastState = {
    running: false,
    sent: 0,
    failed: 0,
    total: 0,
    lastCompletedAt: null
};

const BROADCAST_DELAY_MS = 30000;

function startBackgroundBroadcast({ recipients, buildMessage, onComplete }) {
    if (broadcastState.running) {
        return { started: false, reason: 'already_running' };
    }
    broadcastState = {
        running: true,
        sent: 0,
        failed: 0,
        total: recipients.length,
        lastCompletedAt: null
    };

    (async () => {
        for (let i = 0; i < recipients.length; i++) {
            const u = recipients[i];
            try {
                const text = typeof buildMessage === 'function' ? buildMessage(u) : '';
                if (text) {
                    const isTgOnly = String(u.phone || '').startsWith('tg_');
                    if (!isTgOnly && currentSock && currentSock.user) {
                        const targetJid = u.jid || u.altJid || (String(u.phone).includes('@') ? u.phone : `${u.phone}@s.whatsapp.net`);
                        await sendCachedMessage(currentSock, targetJid, { text });
                        broadcastState.sent++;
                    } else if (u.telegramChatId && TELEGRAM_BOT_TOKEN) {
                        await sendTelegramMessage(u.telegramChatId, text.replace(/\*/g, ''));
                        broadcastState.sent++;
                    } else {
                        broadcastState.failed++;
                    }
                }
            } catch (sendErr) {
                broadcastState.failed++;
                console.error(`[Broadcast Queue] Gagal hantar ke ${u.phone}:`, sendErr.message);
            }
            if (i < recipients.length - 1) {
                await new Promise(r => setTimeout(r, BROADCAST_DELAY_MS));
            }
        }
        broadcastState.running = false;
        broadcastState.lastCompletedAt = Date.now();
        if (typeof onComplete === 'function') {
            try { await onComplete(broadcastState); } catch {}
        }
    })().catch(err => {
        console.error('[Broadcast Queue Error]:', err);
        broadcastState.running = false;
    });

    return { started: true, total: recipients.length };
}

function ensureHttpServer() {
    if (httpServer) return httpServer;

    const server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;

        // PWA MONITOR ROOT & /admin ROUTE
        if (req.method === 'GET' && (pathname === '/' || pathname === '/admin')) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(PWA_HTML);
            return;
        }

        // PWA MANIFEST
        if (req.method === 'GET' && pathname === '/manifest.json') {
            res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
            res.end(JSON.stringify(PWA_MANIFEST));
            return;
        }

        // SERVICE WORKER
        if (req.method === 'GET' && pathname === '/sw.js') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end(PWA_SW);
            return;
        }

        // HEALTH CHECK
        if (req.method === 'GET' && pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                bot: BOT_NAME,
                uptime: Math.floor(process.uptime()),
                chipConfigured: !!(CHIP_API_KEY && CHIP_BRAND_ID),
                hitpayConfigured: !!HITPAY_API_KEY,
                env: HITPAY_ENV,
                webhookUrl: `${PUBLIC_BASE_URL}/webhook/chip`
            }));
            return;
        }

        // TELEMETRY API: GET /api/stats
        if (req.method === 'GET' && pathname === '/api/stats') {
            applyPendingUserMigrations();
            const mem = process.memoryUsage();
            const uptime = Math.floor(process.uptime());
            const users = loadUsers();
            const userList = Object.values(users).filter((u, i, arr) => arr.findIndex(x => x.phone === u.phone) === i);
            const activeUsers = userList.filter(u => u.status === 'ACTIVE' && u.expiredAt && u.expiredAt > Date.now());
            const stats = loadStats();
            const cfg = loadConfig();
            const hitpayData = await fetchHitPayDashboardData(false);

            const rawHitpayPayments = (hitpayData.configured && hitpayData.payments && hitpayData.payments.length > 0)
                ? hitpayData.payments
                : (stats.transactions || []);

            const hitpayPayments = rawHitpayPayments.map(tx => {
                const fin = computeHitPayFeeAndNet(tx.amount, tx.feeAmount ?? tx.fees);
                return {
                    ...tx,
                    buyerName: formatTitleCaseName(tx.buyerName, tx.buyerPhone),
                    amount: fin.gross,
                    feeAmount: fin.fee,
                    netAmount: fin.net
                };
            });

            let grossRevenue = 0;
            let totalFees = 0;
            let netRevenue = 0;
            let todayRevenue = 0;
            const todayIso = new Date().toLocaleDateString('en-CA');

            hitpayPayments.forEach(tx => {
                const amt = parseFloat(tx.amount) || 0;
                const fee = parseFloat(tx.feeAmount) || 0;
                const net = parseFloat(tx.netAmount) || 0;
                if (tx.timestamp && new Date(tx.timestamp).toLocaleDateString('en-CA') === todayIso) {
                    todayRevenue += amt;
                }
                if (!(hitpayData.configured && hitpayData.totalCollectedRM != null)) {
                    grossRevenue += amt;
                    totalFees += fee;
                    netRevenue += net;
                }
            });

            if (hitpayData.configured && hitpayData.totalCollectedRM != null) {
                grossRevenue = parseFloat(hitpayData.totalCollectedRM) || 0;
                if (hitpayData.totalNetRM != null && !isNaN(parseFloat(hitpayData.totalNetRM))) {
                    netRevenue = parseFloat(hitpayData.totalNetRM) || 0;
                    totalFees = Math.max(0, Number((grossRevenue - netRevenue).toFixed(2)));
                } else if (hitpayPayments.length > 0) {
                    const summedFees = hitpayPayments.reduce((s, t) => s + (parseFloat(t.feeAmount) || 0), 0);
                    totalFees = Number(summedFees.toFixed(2));
                    netRevenue = Math.max(0, Number((grossRevenue - totalFees).toFixed(2)));
                } else {
                    const est = computeHitPayFeeAndNet(grossRevenue);
                    totalFees = est.feeNum;
                    netRevenue = est.netNum;
                }
            } else if (hitpayPayments.length === 0) {
                grossRevenue = activeUsers.length * 11.99;
                const est = computeHitPayFeeAndNet(grossRevenue);
                totalFees = est.feeNum;
                netRevenue = est.netNum;
            }
            const totalRevenue = grossRevenue;

            const now = new Date();
            const dayOfWeek = (now.getDay() + 6) % 7;
            const weeklyData = [0, 0, 0, 0, 0, 0, 0];
            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            hitpayPayments.forEach(tx => {
                if (tx.timestamp >= sevenDaysAgo) {
                    const d = new Date(tx.timestamp);
                    const dayIdx = (d.getDay() + 6) % 7;
                    weeklyData[dayIdx] += 1;
                }
            });
            if (weeklyData.every(v => v === 0)) {
                weeklyData[dayOfWeek] = hitpayPayments.length || activeUsers.length || 3;
            }

            let waStatus = 'OFFLINE';
            if (currentSock && currentSock.user) {
                waStatus = 'ONLINE';
            } else if (currentSock && !currentSock.user) {
                waStatus = 'PAIRING';
            }

            const rssMB = mem.rss / (1024 * 1024);
            const freeRamRatio = Math.max(0, Math.min(1, (384 - rssMB) / 384));
            let readinessScore = (waStatus === 'ONLINE' ? 40 : (waStatus === 'PAIRING' ? 20 : 0))
                + Math.floor(freeRamRatio * 40)
                + (videoQueue.waitingLength < 10 ? 20 : 10);
            readinessScore = Math.max(10, Math.min(100, readinessScore));

            const txDaysByPhone = {};
            const txPaidByPhone = {};
            const realNameByPhone = {};
            const seenTxIds = new Set();
            [...(hitpayPayments || []), ...(stats.transactions || [])].forEach(tx => {
                const txKey = tx.paymentId || `${tx.buyerPhone}_${tx.timestamp}_${tx.amount}`;
                if (seenTxIds.has(txKey)) return;
                seenTxIds.add(txKey);
                if (tx.buyerPhone) {
                    const p = normalizeIdentifier(tx.buyerPhone);
                    txDaysByPhone[p] = (txDaysByPhone[p] || 0) + (parseInt(tx.packageDays, 10) || 30);
                    txPaidByPhone[p] = (txPaidByPhone[p] || 0) + (parseFloat(tx.amount) || 0);
                    if (!realNameByPhone[p] && tx.realName && !isGenericDisplayName(tx.realName)) {
                        realNameByPhone[p] = formatTitleCaseName(tx.realName, p);
                    }
                }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                botName: BOT_NAME,
                hitpayEnv: HITPAY_ENV,
                waStatus,
                pairingNumber: process.env.PAIRING_NUMBER || '601157270564',
                adminNumber: ADMIN_NUMBER,
                readinessScore,
                uptime,
                uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
                grossRevenue: grossRevenue.toFixed(2),
                netRevenue: netRevenue.toFixed(2),
                totalFees: totalFees.toFixed(2),
                todayRevenue: todayRevenue.toFixed(2),
                ram: {
                    rssMB: parseFloat(rssMB.toFixed(1)),
                    heapUsedMB: parseFloat((mem.heapUsed / (1024 * 1024)).toFixed(1)),
                    heapTotalMB: parseFloat((mem.heapTotal / (1024 * 1024)).toFixed(1)),
                    maxMB: 384
                },
                cpu: {
                    cores: os.cpus().length,
                    model: os.cpus()[0]?.model || 'Cloud vCPU',
                    loadAvg: os.loadavg ? os.loadavg()[0].toFixed(2) : '0.12'
                },
                queue: {
                    active: !!videoQueue.activeJob,
                    waiting: videoQueue.waitingLength,
                    max: MAX_QUEUE_SIZE
                },
                metrics: {
                    revenueRM: totalRevenue.toFixed(2),
                    grossRevenue: grossRevenue.toFixed(2),
                    netRevenue: netRevenue.toFixed(2),
                    totalFees: totalFees.toFixed(2),
                    todayRevenue: todayRevenue.toFixed(2),
                    activeUsersCount: activeUsers.length,
                    totalUsersCount: userList.length,
                    videosProcessed: stats.videosProcessed || 0,
                    imagesProcessed: stats.imagesProcessed || 0,
                    totalMediaProcessed: (stats.videosProcessed || 0) + (stats.imagesProcessed || 0)
                },
                weeklyActivity: weeklyData,
                railwayRenewDate: cfg.railwayRenewDate || '',
                broadcastState,
                hitpay: hitpayData,
                transactions: hitpayPayments,
                users: userList.map(u => {
                    normalizeUserTiers(u);
                    const nowTs = Date.now();
                    const waActive = hasWaAccess(u, false);
                    const ttActive = hasTtAccess(u, false);
                    const isAct = waActive || ttActive;
                    const maxExp = Math.max(waActive ? (u.waExpiredAt || 0) : 0, ttActive ? (u.ttExpiredAt || 0) : 0) || u.expiredAt;
                    const daysLeft = isAct && maxExp ? Math.max(0, Math.ceil((maxExp - nowTs) / (1000 * 60 * 60 * 24))) : 0;
                    const waDaysLeft = waActive ? Math.max(0, Math.ceil((u.waExpiredAt - nowTs) / (1000 * 60 * 60 * 24))) : 0;
                    const ttDaysLeft = ttActive ? Math.max(0, Math.ceil((u.ttExpiredAt - nowTs) / (1000 * 60 * 60 * 24))) : 0;
                    let subMonths = u.subscribedMonths || 0;
                    if (!subMonths) {
                        if (txDaysByPhone[u.phone]) {
                            subMonths = Math.max(1, Math.round(txDaysByPhone[u.phone] / 30));
                        } else if (u.expiredAt) {
                            const regTime = u.registeredAt ? new Date(u.registeredAt).getTime() : null;
                            if (regTime && u.expiredAt > regTime) {
                                subMonths = Math.max(1, Math.round((u.expiredAt - regTime) / (30 * 24 * 60 * 60 * 1000)));
                            } else if (daysLeft > 0) {
                                subMonths = Math.max(1, Math.ceil(daysLeft / 30));
                            } else {
                                subMonths = 1;
                            }
                        }
                    }
                    const refUser = u.referredBy ? (users[u.referredBy] || userList.find(x => x.phone === u.referredBy)) : null;
                    const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'None';
                    const resolvedRealName = u.realName || realNameByPhone[u.phone] || null;
                    const resolvedDisplayName = resolvedRealName || u.name;
                    const resolvedWaName = (u.waName && u.waName.toLowerCase() !== resolvedDisplayName.toLowerCase())
                        ? u.waName
                        : ((resolvedRealName && u.name && u.name.toLowerCase() !== resolvedRealName.toLowerCase() && !isGenericDisplayName(u.name))
                            ? u.name
                            : null);
                    return {
                        phone: u.phone,
                        name: resolvedDisplayName,
                        realName: resolvedRealName,
                        waName: resolvedWaName,
                        createdAt: u.createdAt || Date.now(),
                        totalPaid: Number((txPaidByPhone[u.phone] || 0).toFixed(2)),
                        rawStatus: u.status || 'NEW',
                        status: isAct ? 'ACTIVE' : 'EXPIRED',
                        tier: (waActive && ttActive) ? 'COMBO' : (waActive ? 'WA' : (ttActive ? 'TT' : 'NONE')),
                        waActive,
                        ttActive,
                        waExpiredAt: u.waExpiredAt || null,
                        ttExpiredAt: u.ttExpiredAt || null,
                        waExpiredAtFormatted: fmtDate(u.waExpiredAt),
                        ttExpiredAtFormatted: fmtDate(u.ttExpiredAt),
                        waDaysLeft,
                        ttDaysLeft,
                        preferredMode: u.preferredMode || 'WA',
                        telegramLinked: !!u.telegramChatId,
                        expiredAt: u.expiredAt,
                        expiredAtFormatted: fmtDate(maxExp),
                        daysLeft,
                        subscribedMonths: subMonths,
                        refCode: u.refCode || '-',
                        referredBy: u.referredBy || null,
                        referredByName: refUser ? refUser.name : (u.referredBy || null),
                        referredByCode: u.referredByCode || (refUser ? refUser.refCode : null),
                        paidReferrals: u.paidReferrals || 0,
                        totalPaidReferrals: u.totalPaidReferrals || 0
                    };
                })
            }));
            return;
        }

        // TELEMETRY ACTIONS: POST /api/action
        if (req.method === 'POST' && pathname === '/api/action') {
            let chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    const action = body.action;

                    if (action === 'registerUser') {
                        const rawPhone = String(body.phone || '').trim();
                        const targetPhone = rawPhone.startsWith('tg_') ? rawPhone : normalizeIdentifier(rawPhone);
                        const name = formatTitleCaseName(body.name, targetPhone);
                        const tier = ['WA', 'TT', 'COMBO'].includes(String(body.tier || '').toUpperCase())
                            ? String(body.tier).toUpperCase()
                            : 'WA';
                        const months = Math.max(1, parseInt(body.months, 10) || 1);
                        const days = months === 12 ? 365 : months * 30;
                        const addMs = days * 24 * 60 * 60 * 1000;
                        const refCodeInput = typeof body.referralCode === 'string' ? body.referralCode.trim().toUpperCase() : '';

                        if (!targetPhone || targetPhone.length < 5) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Invalid phone number.' }));
                            return;
                        }

                        const users = loadUsers();
                        let targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);
                        const now = Date.now();

                        let matchedReferrer = null;
                        if (refCodeInput) {
                            matchedReferrer = Object.values(users).find(u => u.refCode && u.refCode.toUpperCase() === refCodeInput);
                        }

                        if (!targetUser) {
                            targetUser = normalizeUserTiers({
                                phone: targetPhone,
                                name,
                                status: 'ACTIVE',
                                registeredAt: new Date().toISOString(),
                                subscribedMonths: months,
                                waExpiredAt: (tier === 'WA' || tier === 'COMBO') ? (now + addMs) : null,
                                ttExpiredAt: (tier === 'TT' || tier === 'COMBO') ? (now + addMs) : null,
                                preferredMode: tier === 'TT' ? 'TT' : 'WA',
                                refCode: generateReferralCode(name, users),
                                referredBy: matchedReferrer && matchedReferrer.phone !== targetPhone ? matchedReferrer.phone : null,
                                referredByCode: matchedReferrer && matchedReferrer.phone !== targetPhone ? matchedReferrer.refCode : null,
                                referralCredited: false,
                                paidReferrals: 0,
                                totalPaidReferrals: 0,
                                refSentToExisting: true,
                                reminded3Days: false,
                                jid: null,
                                altJid: null
                            });
                        } else {
                            normalizeUserTiers(targetUser);
                            if (name && name !== 'Member') targetUser.name = name;
                            targetUser.registeredAt = targetUser.registeredAt || new Date().toISOString();
                            targetUser.subscribedMonths = (targetUser.subscribedMonths || 0) + months;
                            if (tier === 'WA' || tier === 'COMBO') {
                                const waBase = (targetUser.waExpiredAt && targetUser.waExpiredAt > now) ? targetUser.waExpiredAt : now;
                                targetUser.waExpiredAt = waBase + addMs;
                            }
                            if (tier === 'TT' || tier === 'COMBO') {
                                const ttBase = (targetUser.ttExpiredAt && targetUser.ttExpiredAt > now) ? targetUser.ttExpiredAt : now;
                                targetUser.ttExpiredAt = ttBase + addMs;
                            }
                            if (tier === 'TT' && (!targetUser.waExpiredAt || targetUser.waExpiredAt <= now)) {
                                targetUser.preferredMode = 'TT';
                            }
                            normalizeUserTiers(targetUser);
                            targetUser.status = 'ACTIVE';
                            targetUser.reminded3Days = false;
                            targetUser.refSentToExisting = true;
                            if (!targetUser.refCode) targetUser.refCode = generateReferralCode(targetUser.name, users);
                            if (matchedReferrer && matchedReferrer.phone !== targetPhone && !targetUser.referredBy) {
                                targetUser.referredBy = matchedReferrer.phone;
                                targetUser.referredByCode = matchedReferrer.refCode;
                            }
                        }

                        if (matchedReferrer && matchedReferrer.phone !== targetPhone && !targetUser.referralCredited) {
                            normalizeUserTiers(matchedReferrer);
                            targetUser.referralCredited = true;
                            matchedReferrer.paidReferrals = (matchedReferrer.paidReferrals || 0) + 1;
                            matchedReferrer.totalPaidReferrals = (matchedReferrer.totalPaidReferrals || 0) + 1;
                            if (matchedReferrer.paidReferrals >= 3) {
                                matchedReferrer.paidReferrals -= 3;
                                const refBase = (matchedReferrer.waExpiredAt && matchedReferrer.waExpiredAt > now) ? matchedReferrer.waExpiredAt : now;
                                matchedReferrer.waExpiredAt = refBase + (30 * 24 * 60 * 60 * 1000);
                                normalizeUserTiers(matchedReferrer);
                                matchedReferrer.status = 'ACTIVE';
                            }
                            users[matchedReferrer.phone] = matchedReferrer;
                            if (matchedReferrer.lid) users[matchedReferrer.lid] = matchedReferrer;
                        }

                        if (!targetPhone.startsWith('tg_') && currentSock && currentSock.user) {
                            try {
                                const [waUser] = await currentSock.onWhatsApp(`${targetPhone}@s.whatsapp.net`);
                                if (waUser && waUser.lid) {
                                    const cleanLid = normalizeIdentifier(waUser.lid);
                                    targetUser.lid = cleanLid;
                                    users[cleanLid] = targetUser;
                                }
                            } catch {}
                        }

                        users[targetPhone] = targetUser;
                        if (targetUser.lid) users[targetUser.lid] = targetUser;
                        saveUsers(users);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            message: `${targetUser.name} (${targetPhone}) activated (${tier}) for ${months} ${months === 1 ? 'month' : 'months'}.`
                        }));
                        return;
                    }

                    if (action === 'syncData') {
                        applyPendingUserMigrations();
                        const paySync = await syncHitPayPayments();
                        const hpData = await fetchHitPayDashboardData(true);
                        let lidUpdated = 0;
                        if (currentSock && currentSock.user) {
                            try { lidUpdated = await syncAllActiveLids(currentSock); } catch {}
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            message: `Sync complete: ${paySync.activated || 0} new activations, ${hpData.paymentsCount || 0} HitPay payments, ${hpData.payoutsCount || 0} payouts, ${lidUpdated} LIDs synced.`
                        }));
                        return;
                    }

                    if (action === 'extendUser') {
                        const rawPhone = String(body.phone || '').trim();
                        const targetPhone = rawPhone.startsWith('tg_') ? rawPhone : normalizeIdentifier(rawPhone);
                        const days = parseInt(body.days, 10) || 30;
                        const tier = ['WA', 'TT', 'COMBO'].includes(String(body.tier || '').toUpperCase())
                            ? String(body.tier).toUpperCase()
                            : 'WA';
                        const users = loadUsers();
                        let targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);
                        if (targetUser) {
                            normalizeUserTiers(targetUser);
                            const now = Date.now();
                            const addMs = days * 24 * 60 * 60 * 1000;
                            if (tier === 'WA' || tier === 'COMBO') {
                                const waBase = (targetUser.waExpiredAt && targetUser.waExpiredAt > now) ? targetUser.waExpiredAt : now;
                                targetUser.waExpiredAt = waBase + addMs;
                            }
                            if (tier === 'TT' || tier === 'COMBO') {
                                const ttBase = (targetUser.ttExpiredAt && targetUser.ttExpiredAt > now) ? targetUser.ttExpiredAt : now;
                                targetUser.ttExpiredAt = ttBase + addMs;
                            }
                            normalizeUserTiers(targetUser);
                            targetUser.subscribedMonths = (targetUser.subscribedMonths || 0) + Math.max(1, Math.round(days / 30));
                            targetUser.status = 'ACTIVE';
                            targetUser.reminded3Days = false;
                            if (targetUser.lid) users[targetUser.lid] = targetUser;
                            if (targetUser.phone) users[targetUser.phone] = targetUser;
                            saveUsers(users);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, message: `Added +${days} days (${tier}).` }));
                            return;
                        }
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'User not found.' }));
                        return;
                    }

                    if (action === 'expireUser') {
                        const rawPhone = String(body.phone || '').trim();
                        const targetPhone = rawPhone.startsWith('tg_') ? rawPhone : normalizeIdentifier(rawPhone);
                        const users = loadUsers();
                        let targetUser = users[targetPhone] || Object.values(users).find(u => u.phone === targetPhone);
                        if (targetUser) {
                            const pastTs = Date.now() - 1000;
                            targetUser.waExpiredAt = pastTs;
                            targetUser.ttExpiredAt = pastTs;
                            targetUser.expiredAt = pastTs;
                            targetUser.status = 'EXPIRED';
                            if (targetUser.lid) users[targetUser.lid] = targetUser;
                            if (targetUser.phone) users[targetUser.phone] = targetUser;
                            saveUsers(users);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, message: 'Membership expired.' }));
                            return;
                        }
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'User not found.' }));
                        return;
                    }

                    if (action === 'triggerGC') {
                        if (global.gc) {
                            global.gc();
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, message: 'Garbage collection executed.' }));
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Node.js was not started with --expose-gc.' }));
                        return;
                    }

                    if (action === 'setRailwayDate') {
                        const cfg = loadConfig();
                        cfg.railwayRenewDate = typeof body.date === 'string' ? body.date.trim() : '';
                        saveConfig(cfg);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Railway expiry date updated.' }));
                        return;
                    }

                    if (action === 'sendBroadcast') {
                        const messageText = typeof body.message === 'string' ? body.message.trim() : '';
                        const target = body.target || 'all';

                        if (!messageText) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Broadcast message cannot be empty.' }));
                            return;
                        }
                        if ((!currentSock || !currentSock.user) && !TELEGRAM_BOT_TOKEN) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'WhatsApp bot is OFFLINE. Please connect WhatsApp first.' }));
                            return;
                        }
                        if (broadcastState.running) {
                            res.writeHead(409, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Another broadcast is already running. Please wait.' }));
                            return;
                        }

                        const users = loadUsers();
                        const uniqueUsers = Object.values(users).filter((u, i, arr) => arr.findIndex(x => x.phone === u.phone) === i);
                        const recipients = uniqueUsers.filter(u => {
                            if (!u.phone || isAnyAdmin(u.phone, u.jid || '', false)) return false;
                            const isPaid = hasAnyAccess(u, false);
                            if (target === 'paid') return isPaid;
                            if (target === 'unpaid') return !isPaid;
                            return true;
                        });

                        if (recipients.length === 0) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'No recipients found in this category.' }));
                            return;
                        }

                        startBackgroundBroadcast({
                            recipients,
                            buildMessage: (u) => messageText.replace(/\{(name|nama)\}/gi, u.name || 'Ahli'),
                            onComplete: async (st) => {
                                if (currentSock && currentSock.user) {
                                    await notifyAdmins(
                                        currentSock,
                                        `✓ *Broadcast Selesai*\n\n• Berjaya: *${st.sent}/${st.total}*\n• Gagal: *${st.failed}*`
                                    );
                                }
                            }
                        });

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            queued: true,
                            total: recipients.length,
                            message: `Broadcast queued for ${recipients.length} recipients (30s interval per message).`
                        }));
                        return;
                    }

                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid action.' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        // CHIP ASIA WEBHOOK ENDPOINT
        if (req.method === 'POST' && pathname === '/webhook/chip') {
            let chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                let parsedBody = {};
                try {
                    parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch {}

                const purchaseObj = parsedBody.data || parsedBody;
                const eventType = String(parsedBody.event_type || parsedBody.event || '').toLowerCase();
                const status = String(purchaseObj.status || '').toLowerCase();
                const reference = String(purchaseObj.reference || purchaseObj.purchase?.metadata?.invoiceRef || '').trim();
                const meta = purchaseObj.purchase?.metadata || purchaseObj.metadata || {};

                if (eventType !== 'purchase.paid' && status !== 'paid') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Ignored event');
                    return;
                }

                if (!reference.startsWith('CS-') && meta.app !== 'clear_status') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Ignored non-Clear-Status purchase');
                    return;
                }

                const purchaseId = purchaseObj.id || parsedBody.id;
                const processed = loadProcessedPayments();
                if (purchaseId && processed.has(purchaseId)) {
                    console.log(`[CHIP Webhook] Idempotensi: Transaksi ${purchaseId} (${reference}) sudah diproses.`);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Already processed');
                    return;
                }

                const phone = String(meta.phone || purchaseObj.client?.phone || '').trim();
                const planType = String(meta.planType || 'WA').toUpperCase();
                const days = parseInt(meta.days, 10) || 30;
                const referralCode = String(meta.referralCode || '').trim().toUpperCase();
                const invoiceRef = reference || String(meta.invoiceRef || '');
                const totalCents = purchaseObj.purchase?.total ?? purchaseObj.payment?.amount ?? purchaseObj.amount ?? 0;
                const grossAmount = Number(((Number(totalCents) || 0) / 100).toFixed(2));
                const paymentMethod = String(
                    purchaseObj.transaction_data?.payment_method ||
                    purchaseObj.payment?.payment_method ||
                    'CHIP Asia'
                );

                const rawExplicitFee = purchaseObj.payment?.fee_amount ?? purchaseObj.transaction_data?.fee_amount ?? purchaseObj.fee_amount ?? null;
                let chipFee;
                if (rawExplicitFee != null && !isNaN(Number(rawExplicitFee))) {
                    chipFee = Number((Number(rawExplicitFee) / 100).toFixed(2));
                } else if (/fpx/i.test(paymentMethod)) {
                    chipFee = 1.00;
                } else {
                    chipFee = Number((grossAmount * 0.01).toFixed(2));
                }

                if (referralCode && phone) {
                    const usersPre = loadUsers();
                    const uKey = phone.startsWith('tg_') ? phone : normalizeIdentifier(phone);
                    const uRec = usersPre[uKey] || Object.values(usersPre).find(u => u.phone === uKey);
                    if (uRec && !uRec.referredBy) {
                        const referrer = Object.values(usersPre).find(u => u.refCode && u.refCode.toUpperCase() === referralCode);
                        if (referrer && referrer.phone !== uRec.phone) {
                            uRec.referredBy = referrer.phone;
                            uRec.referredByCode = referrer.refCode;
                            saveUsers(usersPre);
                        }
                    }
                }

                console.log(`[CHIP Webhook] Bayaran berjaya ${invoiceRef} (${purchaseId}) | ${phone} | ${planType} | RM${grossAmount.toFixed(2)} (Fee RM${chipFee.toFixed(2)})`);
                await processCompletedPayment({
                    paymentId: purchaseId,
                    referenceNumber: `${phone}|${planType}|${days}`,
                    customerName: purchaseObj.client?.full_name || '',
                    realName: purchaseObj.client?.full_name || '',
                    paymentType: `CHIP Asia (${paymentMethod})`,
                    amountPaid: grossAmount,
                    feeAmount: chipFee,
                    invoiceRef
                });

                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('CHIP webhook processed');
            });
            return;
        }

        // HITPAY WEBHOOK ENDPOINT
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

                const data = parsedBody.data || parsedBody;
                let paymentId = data.payment_id || data.id || parsedBody.payment_id || parsedBody.id;
                let status = (data.status || parsedBody.status || '').toLowerCase();
                let referenceNumber = data.reference_number || parsedBody.reference_number || '';
                const paymentRequestId = data.payment_request_id || parsedBody.payment_request_id || paymentId;

                console.log(`[HitPay Webhook] Menerima event: payment_id=${paymentId}, status=${status}, ref=${referenceNumber}, reqId=${paymentRequestId}`);

                let isVerified = verifyHitPaySignature(rawBuffer, req.headers, parsedBody);

                // Fallback Keselamatan: Semak terus ke HitPay API jika HMAC ragu-ragu
                if (!isVerified && paymentRequestId && HITPAY_API_KEY) {
                    try {
                        console.log(`[HitPay Webhook Fallback] Mengesahkan status terus dengan pelayan HitPay API...`);
                        const verifyRes = await fetch(`${HITPAY_API_URL}/${paymentRequestId}`, {
                            method: 'GET',
                            headers: {
                                'X-BUSINESS-API-KEY': HITPAY_API_KEY,
                                'Accept': 'application/json',
                                'X-Requested-With': 'XMLHttpRequest'
                            }
                        });
                        if (verifyRes.ok) {
                            const verifyJson = await verifyRes.json();
                            if ((verifyJson.status || '').toLowerCase() === 'completed') {
                                isVerified = true;
                                status = 'completed';
                                if (!referenceNumber) referenceNumber = verifyJson.reference_number || '';
                                if (!paymentId) paymentId = verifyJson.id || paymentRequestId;
                                console.log(`[HitPay Webhook Fallback] Transaksi disahkan SAH oleh HitPay API!`);
                            }
                        }
                    } catch (verifyErr) {
                        console.error('[HitPay Webhook Fallback Error]:', verifyErr.message);
                    }
                }

                if (!isVerified) {
                    console.error('[HitPay Webhook] Tandatangan HMAC tidak sah dan semakan API gagal.');
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

                if (status === 'completed' || status === 'succeeded' || (parsedBody.event_type && parsedBody.event_type.endsWith('.completed'))) {
                    console.log(`[HitPay Webhook] Bayaran ${paymentId} berjaya disahkan! Memulakan pengaktifan...`);
                    await processCompletedPayment({
                        paymentId,
                        referenceNumber,
                        customerName: data.name || parsedBody.name || '',
                        realName: data.buyer_name || data.customer_name || data.payer_name || parsedBody.buyer_name || parsedBody.customer_name || '',
                        paymentType: data.payment_type || parsedBody.payment_type || (data.payment_methods && data.payment_methods[0]) || 'HitPay Online Gateway',
                        amountPaid: data.amount || parsedBody.amount,
                        feeAmount: data.fees ?? data.fee ?? parsedBody.fees ?? parsedBody.fee ?? null
                    });
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
        console.log(`[Pelayan Web] Berjalan pada port ${PORT} (0.0.0.0) untuk Health Checks, PWA Monitor & HitPay Webhook.`);
    });

    httpServer = server;
    return server;
}

// -------------------------------------------------------------
// FUNGSI UTAMA PELANCARAN BOT BAILEYS
// -------------------------------------------------------------
async function startBot() {
    applyPendingUserMigrations();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const pairingNumber = (process.env.PAIRING_NUMBER || '601157270564').replace(/\D/g, '');

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        printQRInTerminal: !pairingNumber,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        msgRetryCounterCache,
        retryRequestDelayMs: 500,
        getMessage: async (key) => {
            return (key && key.id) ? getCachedProtoMessage(key.id) : undefined;
        }
    });

    currentSock = sock;
    ensureHttpServer();

    // Auto-Sync Watchdog: Periksa bayaran HitPay secara berkala
    if (HITPAY_API_KEY) {
        setTimeout(() => syncHitPayPayments(), 8000);
        setInterval(() => syncHitPayPayments(), 60000);
    }

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
            if (isShuttingDown) {
                console.log('[Sambungan Ditutup] Penutupan kemas (SIGTERM/SIGINT). Tidak menyambung semula.');
                return;
            }
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
                storeCachedMessage(msg.key.id, unwrapMessage(msg.message) || msg.message);
            }

            if (msg.messageStubType || (Array.isArray(msg.messageStubParameters) && msg.messageStubParameters.length > 0)) {
                const stubJoined = (msg.messageStubParameters || []).join(' ');
                if (/bad mac|messagecountererror|no matching sessions|sessionerror|ciphertext/i.test(stubJoined) || msg.messageStubType === 2) {
                    const stubJid = msg.key?.remoteJid || '';
                    if (stubJid && !stubJid.endsWith('@g.us')) {
                        console.warn(`[Signal Decrypt Stub] ${stubJid}: ${stubJoined || 'CIPHERTEXT'} — auto-purging corrupted session...`);
                        purgeUserSignalSessions(stubJid);
                        if (msg.key?.remoteJidAlt) purgeUserSignalSessions(msg.key.remoteJidAlt);
                    }
                }
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
                const pushName = formatTitleCaseName(msg.pushName, phone);
                const refCode = generateReferralCode(pushName, users);
                user = normalizeUserTiers({
                    phone: phone,
                    name: pushName,
                    status: 'NEW',
                    createdAt: Date.now(),
                    expiredAt: null,
                    refCode: refCode,
                    referredBy: null,
                    paidReferrals: 0,
                    totalPaidReferrals: 0,
                    refSentToExisting: false,
                    reminded3Days: false,
                    jid: remoteJid,
                    altJid: altJid || null
                });
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
                normalizeUserTiers(user);
                if (msg.pushName && (!user.name || /^(ahli|pengguna|member|user\s*\d*)$/i.test(user.name))) {
                    user.name = formatTitleCaseName(msg.pushName, phone);
                    saveUsers(users);
                }
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
            }

            const fromMe = msg.key.fromMe;
            const isSuperAdmin = isPrimaryAdmin(phone, remoteJid) || isPrimaryAdmin(user?.phone, altJid);
            const isAdmin = isAnyAdmin(phone, remoteJid, fromMe) || isSuperAdmin;
            const waActive = hasWaAccess(user, isSuperAdmin);
            const ttActive = hasTtAccess(user, isSuperAdmin);
            const isActive = waActive || ttActive;

            const textContent = (inner.conversation || inner.extendedTextMessage?.text || '').trim();
            const textParts = textContent.split(/\s+/);
            const rawCmd = textParts[0].toLowerCase();
            const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
            const upperText = textContent.toUpperCase();

            // ---------------------------------------------------------
            // 1. PENGENDALIAN ARAHAN PENTADBIR
            // ---------------------------------------------------------
            if (isAdmin && (['tunggu', 'waiting', 'tambah', 'add', 'daftar', 'kod', 'setref', 'hebah', 'broadcast', 'broadcastref', 'semak', 'check', 'padam', 'buang', 'delete', 'senarai', 'ahli', 'list', 'bantuan', 'menu', 'help', 'sync', 'selaras', 'fixsession', 'resetsession', 'sesi', 'ram', 'memori', 'syncbayar', 'cekbayar', 'checkhitpay'].includes(cmd))) {
                console.log(`[Arahan Pentadbir] ${remoteJid}: "${textContent}"`);

                if (['syncbayar', 'cekbayar', 'checkhitpay'].includes(cmd)) {
                    await sock.sendMessage(remoteJid, {
                        text: `🔄 *MEMULAKAN SEMAKAN HITPAY...*\n\nSedang menyemak transaksi pembayaran terkini di pelayan HitPay...`
                    }, { quoted: msg });

                    const syncRes = await syncHitPayPayments();
                    if (syncRes.activated > 0) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `✅ *SEMAKAN HITPAY BERJAYA!*\n\n` +
                                `Sebanyak *${syncRes.activated} pembayaran* tertunggak telah berjaya diaktifkan:\n` +
                                `• ${syncRes.list.join('\n• ')}\n\n` +
                                `Mesej aluan, tarikh luput & tutorial telah dihantar terus ke WhatsApp pelanggan! 🚀`
                        }, { quoted: msg });
                    } else if (syncRes.error) {
                        await sock.sendMessage(remoteJid, {
                            text: `❌ *Ralat Semakan HitPay:*\n${syncRes.error}\n\nSila pastikan HITPAY_API_KEY telah dimasukkan di Railway Variables.`
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text: `ℹ️ *Semakan Selesai:* ${syncRes.checked} transaksi disemak di HitPay. Tiada bayaran tertunggak baharu ditemui.`
                        }, { quoted: msg });
                    }
                    continue;
                }

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
                    const maybeTier = (textParts[3] || '').toLowerCase();
                    let grantTier = 'wa';
                    let optName = '';
                    if (['wa', 'tt', 'combo'].includes(maybeTier)) {
                        grantTier = maybeTier;
                        optName = textParts.slice(4).join(' ').trim();
                    } else {
                        optName = textParts.slice(3).join(' ').trim();
                    }

                    if (!rawTarget || isNaN(days) || days <= 0) {
                        await sendCachedMessage(sock, remoteJid, {
                            text:
                                `Format tidak sah.\n\n` +
                                `Gunakan format:\n` +
                                `*/add <nombor> <hari> [wa|tt|combo] [nama]*\n\n` +
                                `Contoh:\n` +
                                `*/add 01113270914 30 wa Fieya*\n` +
                                `*/add 01113270914 30 combo Fieya*`
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

                    const now = Date.now();
                    const addMs = days * 24 * 60 * 60 * 1000;
                    const addMonths = Math.max(1, Math.round(days / 30));

                    if (!targetUser) {
                        const fallbackName = formatTitleCaseName(optName, targetPhone);
                        targetUser = normalizeUserTiers({
                            phone: targetPhone,
                            name: fallbackName,
                            status: 'ACTIVE',
                            createdAt: now,
                            registeredAt: new Date().toISOString(),
                            subscribedMonths: addMonths,
                            waExpiredAt: (grantTier === 'wa' || grantTier === 'combo') ? (now + addMs) : null,
                            ttExpiredAt: (grantTier === 'tt' || grantTier === 'combo') ? (now + addMs) : null,
                            preferredMode: grantTier === 'tt' ? 'TT' : 'WA',
                            refCode: generateReferralCode(fallbackName, users),
                            referredBy: null,
                            paidReferrals: 0,
                            totalPaidReferrals: 0,
                            refSentToExisting: true,
                            reminded3Days: false,
                            jid: null,
                            altJid: null
                        });
                        users[targetPhone] = targetUser;
                    } else {
                        normalizeUserTiers(targetUser);
                        if (optName) targetUser.name = formatTitleCaseName(optName, targetPhone);
                        targetUser.registeredAt = targetUser.registeredAt || new Date().toISOString();
                        targetUser.subscribedMonths = (targetUser.subscribedMonths || 0) + addMonths;
                        if (grantTier === 'wa' || grantTier === 'combo') {
                            const waBase = (targetUser.waExpiredAt && targetUser.waExpiredAt > now) ? targetUser.waExpiredAt : now;
                            targetUser.waExpiredAt = waBase + addMs;
                        }
                        if (grantTier === 'tt' || grantTier === 'combo') {
                            const ttBase = (targetUser.ttExpiredAt && targetUser.ttExpiredAt > now) ? targetUser.ttExpiredAt : now;
                            targetUser.ttExpiredAt = ttBase + addMs;
                        }
                        if (grantTier === 'tt' && (!targetUser.waExpiredAt || targetUser.waExpiredAt <= now)) {
                            targetUser.preferredMode = 'TT';
                        }
                        normalizeUserTiers(targetUser);
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
                            normalizeUserTiers(referrer);
                            referrer.paidReferrals = (referrer.paidReferrals || 0) + 1;
                            referrer.totalPaidReferrals = (referrer.totalPaidReferrals || 0) + 1;
                            referralRewardMsg = `\n• Penaja: ${referrer.name} (${referrer.phone}) [+1 Tajaan, Baki: ${referrer.paidReferrals}/3]`;

                            const refJid = referrer.jid || referrer.altJid || (referrer.phone.includes('@') ? referrer.phone : `${referrer.phone}@s.whatsapp.net`);
                            const friendDisplayName = targetUser.name || targetPhone;

                            if (referrer.paidReferrals >= 3) {
                                referrer.paidReferrals -= 3;
                                const refNow = Date.now();
                                const refBase = (referrer.waExpiredAt && referrer.waExpiredAt > refNow) ? referrer.waExpiredAt : refNow;
                                referrer.waExpiredAt = refBase + 30 * 24 * 60 * 60 * 1000;
                                normalizeUserTiers(referrer);
                                referrer.status = 'ACTIVE';

                                const newExpiryStr = new Date(referrer.expiredAt).toLocaleDateString('ms-MY', {
                                    day: '2-digit', month: '2-digit', year: 'numeric'
                                });

                                try {
                                    await sendHumanReply(sock, refJid, {
                                        text:
                                            `✓ *Tahniah, anda terima +30 hari percuma!*\n\n` +
                                            `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* (${targetPhone}) telah melengkapkan *3/3 tajaan* menggunakan code referral anda (*${referrer.refCode}*).\n\n` +
                                            `• Ganjaran: *+30 Hari* langganan percuma\n` +
                                            `• Tarikh tamat baru: *${newExpiryStr}*`
                                    });
                                } catch {}
                                referralRewardMsg += ` -> BONUS +30 HARI TELAH DIBERIKAN!`;
                            } else {
                                const remaining = 3 - referrer.paidReferrals;
                                try {
                                    await sendHumanReply(sock, refJid, {
                                        text:
                                            `✓ *Tajaan berjaya (+1 rakan)*\n\n` +
                                            `Hai *${referrer.name}*, rakan anda *${friendDisplayName}* (${targetPhone}) telah melanggan menggunakan code referral anda (*${referrer.refCode}*).\n\n` +
                                            `• Kemajuan: *${referrer.paidReferrals}/3 rakan*\n` +
                                            `• Baki: *${remaining} rakan* lagi untuk terima +30 hari percuma.`
                                    });
                                } catch {}
                            }
                        }
                    }

                    saveUsers(users);

                    const tierExpiry = grantTier === 'tt' ? targetUser.ttExpiredAt : (targetUser.waExpiredAt || targetUser.expiredAt);
                    const expDateStr = new Date(tierExpiry).toLocaleDateString('ms-MY', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });
                    const tierLabel = grantTier === 'combo' ? 'Combo WA + TikTok HD' : (grantTier === 'tt' ? 'TikTok 1080p 60fps HD' : 'WhatsApp Status HD');

                    const userJid = targetUser.jid || targetUser.altJid || (targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`);
                    try {
                        await sendHumanReply(sock, userJid, {
                            text:
                                `✓ *Langganan anda telah diaktifkan.*\n\n` +
                                `• Nama: ${targetUser.name}\n` +
                                `• Pelan: *${tierLabel}* (+${days} Hari)\n` +
                                `• Tamat tempoh: *${expDateStr}*\n` +
                                `• Code referral anda: *${targetUser.refCode}*\n\n` +
                                `Sila hantar video atau gambar anda sebagai *Document* untuk mula memproses.`
                        });
                    } catch {}

                    await sendCachedMessage(sock, remoteJid, {
                        text:
                            `✓ *Pengaktifan Ahli Berjaya*\n\n` +
                            `• Nama: ${targetUser.name}\n` +
                            `• Nombor: ${targetPhone}\n` +
                            `• Pelan: ${tierLabel} (+${days} Hari)\n` +
                            `• Tamat tempoh: ${expDateStr}\n` +
                            `• Code referral: *${targetUser.refCode}*${referralRewardMsg}`
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
                    const activeUsers = Object.values(users).filter((u, i, arr) =>
                        u && u.phone && !isAnyAdmin(u.phone, u.jid || '', false) && hasAnyAccess(u, false) &&
                        arr.findIndex(x => x.phone === u.phone) === i
                    );

                    if (activeUsers.length === 0) {
                        await sendCachedMessage(sock, remoteJid, { text: 'Tiada ahli active untuk dihantar hebahan.' }, { quoted: msg });
                        continue;
                    }

                    activeUsers.forEach(u => {
                        if (!u.refCode) u.refCode = generateReferralCode(u.name, users);
                        u.refSentToExisting = true;
                    });
                    saveUsers(users);

                    const started = startBackgroundBroadcast({
                        recipients: activeUsers,
                        buildMessage: (u) =>
                            `Makluman Ganjaran Referral (${BOT_NAME})\n\n` +
                            `Hai ${u.name}, kongsikan code referral anda kepada rakan untuk terima langganan percuma:\n` +
                            `• Code anda: *${u.refCode}*\n\n` +
                            `Setiap *3 rakan* yang melanggan menggunakan code ini, anda akan terima *+30 hari percuma* secara automatik.`,
                        onComplete: async (st) => {
                            await notifyAdmins(
                                sock,
                                `✓ *Hebahan Referral Selesai*\n\n• Berjaya: *${st.sent}/${st.total}*\n• Gagal: *${st.failed}*`
                            );
                        }
                    });

                    if (!started.started) {
                        await sendCachedMessage(sock, remoteJid, { text: 'Hebahan lain sedang berjalan. Sila tunggu hingga selesai.' }, { quoted: msg });
                    } else {
                        await sendCachedMessage(sock, remoteJid, {
                            text: `Hebahan referral dimasukkan ke background queue untuk *${activeUsers.length} ahli active* (sela 30 saat setiap mesej).`
                        }, { quoted: msg });
                    }
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

                if (cmd === 'resetsession') {
                    if (!isSuperAdmin) {
                        await sendCachedMessage(sock, remoteJid, {
                            text: 'Arahan /resetsession hanya dibenarkan untuk Primary Admin (60194066718).'
                        }, { quoted: msg });
                        continue;
                    }
                    const targetRaw = textParts[1];
                    if (!targetRaw) {
                        await sendCachedMessage(sock, remoteJid, {
                            text: 'Format: */resetsession <nombor>*\nContoh: */resetsession 60123456789*'
                        }, { quoted: msg });
                        continue;
                    }
                    const targetPhone = normalizeIdentifier(targetRaw);
                    const purgedCount = purgeUserSignalSessions(targetPhone);
                    const targetJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`;
                    try { msgRetryCounterCache.del(targetJid); } catch {}

                    let testSentInfo = 'Berjaya dihantar';
                    try {
                        await safeSendMessage(sock, targetJid, { text: 'Sesi sambungan dikemas kini.' });
                    } catch (sendErr) {
                        testSentInfo = `Gagal (${sendErr.message})`;
                    }

                    await sendCachedMessage(sock, remoteJid, {
                        text:
                            `✓ *Reset Sesi Signal (${targetPhone})*\n\n` +
                            `• Fail Sesi Dipadam: *${purgedCount}*\n` +
                            `• Mesej Ujian: *${testSentInfo}*`
                    }, { quoted: msg });
                    continue;
                }

                if (['fixsession', 'sesi'].includes(cmd)) {
                    const targetRaw = textParts[1];
                    let extraInfo = '';

                    msgRetryCounterCache.flushAll();
                    cachedMessages.clear();

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

                    await sendCachedMessage(sock, remoteJid, {
                        text:
                            `✓ *Pemulihan Sesi Signal Berjaya (/fixsession)*\n\n` +
                            `• Retry Counter Cache: Dikosongkan\n` +
                            `• Simpanan Mesej (cachedMessages): Direset\n` +
                            `• Penyelarasan LID Ahli Aktif: ${synced} diselaraskan${extraInfo}`
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

                    await sendCachedMessage(sock, remoteJid, {
                        text:
                            `STATUS SISTEM & PRESTASI PELAYAN\n\n` +
                            `Penggunaan Memori:\n` +
                            `• Memori Fizikal (RSS): ${rssMB} MB / 384.0 MB (${percentage}%)\n` +
                            `• Memori Heap Aktif: ${heapUsedMB} MB\n` +
                            `• Simpanan Mesej (cachedMessages): ${cachedMessages.size}/${MAX_CACHED_MESSAGES} item\n` +
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
                    await sendCachedMessage(sock, remoteJid, {
                        text:
                            `Panduan Perintah Pentadbir (${BOT_NAME}):\n\n` +
                            `• */add <nombor> <hari> [wa|tt|combo] [nama]* — Aktifkan atau tambah tempoh pelan ahli.\n` +
                            `• *syncbayar* — Semak bayaran HitPay tertunggak.\n` +
                            `• *tunggu* — Senarai pengguna menunggu pembayaran.\n` +
                            `• */setref <nombor> <kod>* — Tukar code referral ahli.\n` +
                            `• */broadcastref* — Hebah code referral ke semua ahli active (30s/mesej).\n` +
                            `• */check <nombor>* — Semak status keahlian.\n` +
                            `• *padam <nombor>* — Padam ahli.\n` +
                            `• *senarai* — Senarai ahli active.\n` +
                            `• *selaras* — Selaras LID ahli.\n` +
                            `• *fixsession [nombor]* — Pulihkan sesi Signal.\n` +
                            `• */resetsession <nombor>* — Padam sesi Signal pengguna & hantar mesej ujian.\n` +
                            `• *ram* — Semak memori & queue pelayan.`
                    }, { quoted: msg });
                    continue;
                }
            }

            // ---------------------------------------------------------
            // 1B. TUKAR MOD PEMPROSESAN (WA / TT) & PAUTAN SILANG PLATFORM (/link)
            // ---------------------------------------------------------
            if (['tt', '/tt', 'tiktok', '/tiktok'].includes(cmd)) {
                user.preferredMode = 'TT';
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                if (ttActive) {
                    const ttExp = isSuperAdmin ? 'Tanpa Had (Super Admin)' : new Date(user.ttExpiredAt).toLocaleDateString('ms-MY');
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `✓ *MOD TIKTOK 1080P 60FPS AKTIF*\n\n` +
                            `Semua video yang anda hantar selepas ini akan diproses menggunakan profil *TikTok HD (1080p 60fps, High Bitrate)*.\n\n` +
                            `• Status TikTok HD: Aktif sehingga ${ttExp}\n` +
                            `• Untuk kembali ke mod WhatsApp Status HD, balas *WA*.`
                    }, { quoted: msg });
                } else if (waActive) {
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `Mod pilihan anda ditukar ke *TikTok 1080p 60fps*, namun akaun anda buat masa ini hanya mempunyai langganan *WhatsApp Status HD* yang active.\n\n` +
                            `Balas *4* untuk upgrade tambah akses *TikTok HD (RM12.99/bulan prorata ikut baki hari WA)*, atau balas *WA* untuk kembali ke mod WhatsApp Status.`
                    }, { quoted: msg });
                } else {
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `Mod pilihan anda ditetapkan ke *TikTok 1080p 60fps*, namun anda belum mempunyai langganan active.\n\n` +
                            `Balas *2* untuk langgan *TikTok HD (RM15.99/bulan)* atau *3* untuk *Combo WA + TT (RM20.99/bulan)*.`
                    }, { quoted: msg });
                }
                continue;
            }

            if (['wa', '/wa', 'whatsapp', '/whatsapp'].includes(cmd)) {
                user.preferredMode = 'WA';
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                if (waActive) {
                    const waExp = isSuperAdmin ? 'Tanpa Had (Super Admin)' : new Date(user.waExpiredAt).toLocaleDateString('ms-MY');
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `✓ *MOD WHATSAPP STATUS HD AKTIF*\n\n` +
                            `Semua video dan foto yang anda hantar selepas ini akan diproses menggunakan profil *WhatsApp Status HD (60fps + QHD+)*.\n\n` +
                            `• Status WhatsApp HD: Aktif sehingga ${waExp}\n` +
                            `• Untuk bertukar ke mod TikTok 1080p 60fps, balas *TT*.`
                    }, { quoted: msg });
                } else if (ttActive) {
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `Mod pilihan anda ditukar ke *WhatsApp Status HD*, namun akaun anda buat masa ini hanya mempunyai langganan *TikTok HD* yang active.\n\n` +
                            `Balas *1* untuk langgan *WhatsApp Status HD (RM11.99/bulan)*, atau balas *TT* untuk kembali ke mod TikTok HD.`
                    }, { quoted: msg });
                } else {
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `Mod pilihan anda ditetapkan ke *WhatsApp Status HD*, namun anda belum mempunyai langganan active.\n\n` +
                            `Balas *1* untuk langgan *WhatsApp Status HD (RM11.99/bulan)* atau *3* untuk *Combo WA + TT (RM20.99/bulan)*.`
                    }, { quoted: msg });
                }
                continue;
            }

            if (cmd === '/link' || cmd === 'link') {
                const targetCode = (textParts[1] || '').trim().toUpperCase();
                if (!targetCode) {
                    await sendHumanReply(sock, remoteJid, {
                        text: `Sila masukkan kod rujukan akaun anda. Contoh: */link ${user.refCode || 'KODANDA'}*`
                    }, { quoted: msg });
                    continue;
                }

                const targetAcc = Object.values(users).find(u => u.refCode && u.refCode.toUpperCase() === targetCode);
                if (!targetAcc) {
                    await sendHumanReply(sock, remoteJid, {
                        text: `Kod rujukan *${targetCode}* tidak ditemui. Sila semak kod anda melalui arahan *STATUS* pada akaun asal.`
                    }, { quoted: msg });
                    continue;
                }

                if (targetAcc === user) {
                    await sendHumanReply(sock, remoteJid, {
                        text: `Kod *${targetCode}* adalah kod akaun WhatsApp ini sendiri. Hantarkan kod ini di bot Telegram untuk memautkan langganan anda.`
                    }, { quoted: msg });
                    continue;
                }

                normalizeUserTiers(user);
                normalizeUserTiers(targetAcc);
                const mergedWa = Math.max(user.waExpiredAt || 0, targetAcc.waExpiredAt || 0);
                const mergedTt = Math.max(user.ttExpiredAt || 0, targetAcc.ttExpiredAt || 0);
                const nowMs = Date.now();

                user.waExpiredAt = mergedWa;
                user.ttExpiredAt = mergedTt;
                user.expiredAt = Math.max(mergedWa, mergedTt);
                targetAcc.waExpiredAt = mergedWa;
                targetAcc.ttExpiredAt = mergedTt;
                targetAcc.expiredAt = Math.max(mergedWa, mergedTt);

                if (mergedWa > nowMs || mergedTt > nowMs) {
                    user.status = 'ACTIVE';
                    targetAcc.status = 'ACTIVE';
                }
                if (targetAcc.telegramChatId && !user.telegramChatId) user.telegramChatId = targetAcc.telegramChatId;
                if (!targetAcc.linkedWaPhone) targetAcc.linkedWaPhone = phone;
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                const waStr = mergedWa > nowMs ? new Date(mergedWa).toLocaleDateString('ms-MY') : 'Tiada';
                const ttStr = mergedTt > nowMs ? new Date(mergedTt).toLocaleDateString('ms-MY') : 'Tiada';
                await sendHumanReply(sock, remoteJid, {
                    text:
                        `✓ *AKAUN BERJAYA DIPAUTKAN*\n\n` +
                        `Langganan anda kini diselaraskan merentasi platform:\n` +
                        `• WhatsApp Status HD: ${waStr}\n` +
                        `• TikTok 1080p 60fps HD: ${ttStr}`
                }, { quoted: msg });
                continue;
            }

            // ---------------------------------------------------------
            // 2. PEMILIHAN PAKEJ INTERAKTIF (1, 2, 3, 4) ➔ HITPAY TERUS
            // ---------------------------------------------------------
            const cleanText = textContent.trim();
            const selectedPkg = PACKAGES[cleanText];
            if (selectedPkg) {
                if (selectedPkg.requiresWa && !waActive) {
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `Pakej *4 (Upgrade TikTok HD RM12.99 prorata)* khas untuk ahli yang sudah mempunyai langganan *WhatsApp Status HD* active.\n\n` +
                            `Sila pilih salah satu pakej berikut:\n` +
                            `• Balas *2* untuk *TikTok 1080p 60fps HD Sahaja (RM15.99/bulan)*\n` +
                            `• Balas *3* untuk *Combo WhatsApp + TikTok HD (RM20.99/bulan)*`
                    }, { quoted: msg });
                    continue;
                }

                try {
                    await sock.sendMessage(remoteJid, {
                        react: { text: '⏳', key: msg.key }
                    });
                } catch {}

                try {
                    const isUpgradePlan = selectedPkg.planCode === 'UPGRADE_TT';
                    const prorate = isUpgradePlan ? calculateProratedUpgrade(user?.waExpiredAt) : null;
                    const reqDays = isUpgradePlan ? prorate.remainingDays : selectedPkg.days;
                    const reqAmount = isUpgradePlan ? prorate.amount : selectedPkg.amount;
                    const reqPurpose = isUpgradePlan
                        ? `${BOT_NAME} - Upgrade TikTok HD (${prorate.remainingDays} Hari Prorata)`
                        : `${BOT_NAME} - ${selectedPkg.title}`;

                    const chipRes = await createChipCheckout({
                        userKey: phone,
                        phone: phone,
                        formattedName: formatTitleCaseName(msg.pushName || user?.name, phone),
                        planType: selectedPkg.planCode,
                        planTitle: selectedPkg.title,
                        amountRM: reqAmount,
                        days: reqDays,
                        platform: 'whatsapp',
                        appliedRefCode: user?.referredByCode || ''
                    });

                    const shortNote = (isUpgradePlan && prorate.isShortRemaining)
                        ? `\nNota: Baki WA anda kurang daripada 5 hari — anda juga boleh balas *3* untuk *Combo (RM20.99)* bagi mendapatkan 30 hari penuh untuk kedua-dua mod.\n`
                        : '';
                    const pkgSummaryLine = isUpgradePlan
                        ? `Pakej: *${selectedPkg.title}*\nBaki Tempoh WA: *${prorate.remainingDays} hari* | Harga Prorata: *${prorate.priceLabel}* (Tamat serentak dengan WA anda)${shortNote}`
                        : `Pakej: *${selectedPkg.title}* (${selectedPkg.price} / ${selectedPkg.days} Hari)`;

                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `✓ *PAUTAN PEMBAYARAN RASMI CHIP ASIA*\n\n` +
                            `No. Invois: *${chipRes.invoiceRef}*\n` +
                            `${pkgSummaryLine}\n\n` +
                            `Sila tekan link selamat di bawah untuk membuat bayaran:\n` +
                            `${chipRes.checkout_url}\n\n` +
                            `Kaedah bayaran disokong: FPX Online Banking, DuitNow QR, eWallet & Kad Debit/Kredit.\n\n` +
                            `Akses anda akan diaktifkan secara automatik sebaik sahaja pembayaran selesai tanpa perlu menghantar resit.`
                    }, { quoted: msg });

                    if (user) {
                        if (!isActive) user.status = 'WAITING';
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
                    await sendHumanReply(sock, remoteJid, {
                        text: `Maaf, terdapat ralat semasa menjana pautan HitPay: ${err.message}. Sila cuba sebentar lagi atau hubungi pentadbir.`
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
                    await sendHumanReply(sock, remoteJid, {
                        text: "Ralat: Anda tidak boleh menggunakan kod referral peribadi anda sendiri."
                    }, { quoted: msg });
                    continue;
                }

                if (isActive) {
                    await sendHumanReply(sock, remoteJid, {
                        text: `Akaun anda sudah berstatus active. Kod referral hanya sah untuk pendaftaran baharu atau pembaharuan langganan yang telah tamat.`
                    }, { quoted: msg });
                    continue;
                }

                user.referredBy = matchedReferrer.phone;
                user.status = 'WAITING';
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                const confirmCaption =
                    `✓ *KOD REFERRAL DISAHKAN*\n\n` +
                    `Anda dijemput oleh *${matchedReferrer.name}* (${matchedReferrer.refCode}).\n\n` +
                    `${PACKAGE_TEMPLATE}`;

                await sendHumanReply(sock, remoteJid, { text: confirmCaption }, { quoted: msg });

                // Notifikasi Automatik ke Penaja bahawa kod telah ditebus oleh rakan
                const refJid = matchedReferrer.jid || matchedReferrer.altJid || (matchedReferrer.phone && matchedReferrer.phone.includes('@') ? matchedReferrer.phone : `${matchedReferrer.phone}@s.whatsapp.net`);
                const friendName = msg.pushName || user.name || phone;
                if (refJid && !String(matchedReferrer.phone).startsWith('tg_')) {
                    try {
                        await sendHumanReply(sock, refJid, {
                            text:
                                `✓ *KOD REFERRAL ANDA DIGUNAKAN*\n\n` +
                                `Hai *${matchedReferrer.name}*, rakan anda *${friendName}* (${phone}) baru sahaja memasukkan kod referral anda (*${matchedReferrer.refCode}*).\n\n` +
                                `Status: Rakan anda sedang memilih pakej langganan. Anda akan dimaklumkan sebaik sahaja pembayaran mereka selesai.`
                        });
                        console.log(`[REFERRAL NOTI] Penaja ${matchedReferrer.phone} diberitahu tentang ${phone} menggunakan kod.`);
                    } catch (notiErr) {
                        console.error(`[REFERRAL NOTI] Gagal hantar notifikasi ke penaja:`, notiErr.message);
                    }
                }

                continue;
            }

            // ---------------------------------------------------------
            // 4. PEMBAYARAN TERUS (BAYAR / PAKEJ)
            // ---------------------------------------------------------
            if (['bayar', '/bayar', 'pakej', 'beli', 'qr', 'upgrade', '/upgrade'].includes(cmd) || upperText === 'BAYAR' || upperText === 'PAKEJ') {
                if (!isActive) user.status = 'WAITING';
                user.jid = remoteJid;
                if (altJid) user.altJid = altJid;
                saveUsers(users);

                await sendHumanReply(sock, remoteJid, {
                    text:
                        `MAKLUMAT PAKEJ LANGGANAN (${BOT_NAME})\n\n` +
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

                    const waStr = isSuperAdmin ? 'Tanpa Had (Super Admin)' : (waActive ? new Date(user.waExpiredAt).toLocaleDateString('ms-MY') : 'Tidak Active (Balas 1 untuk langgan RM11.99)');
                    const ttStr = isSuperAdmin ? 'Tanpa Had (Super Admin)' : (ttActive ? new Date(user.ttExpiredAt).toLocaleDateString('ms-MY') : (waActive ? 'Tidak Active (Balas 4 untuk upgrade prorata RM12.99/30h)' : 'Tidak Active (Balas 2 untuk langgan RM15.99)'));
                    const currentMode = user.preferredMode || (ttActive && !waActive ? 'TT' : 'WA');

                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `✓ *SELAMAT KEMBALI KE ${BOT_NAME}*\n\n` +
                            `• Mod Pemprosesan Semasa: *${currentMode === 'TT' ? 'TikTok 1080p 60fps HD' : 'WhatsApp Status HD'}*\n` +
                            `• Langganan WhatsApp HD: ${waStr}\n` +
                            `• Langganan TikTok HD: ${ttStr}\n` +
                            `• Kod Referral Peribadi: *${user.refCode}*\n\n` +
                            `Panduan Ringkas:\n` +
                            `• Hantar video atau foto anda sebagai *file / document* (Lampiran > Document > Galeri) supaya kualiti asal kekal terpelihara.\n` +
                            `• Taip *TT* untuk tukar ke mod TikTok 1080p 60fps, atau *WA* untuk mod WhatsApp Status HD (boleh juga letak caption WA/TT pada document).\n` +
                            `• Guna arahan */link ${user.refCode}* di Telegram jika mahu pautkan langganan anda.\n\n` +
                            `Ganjaran Referral: Ajak 3 rakan melanggan menggunakan kod *${user.refCode}* untuk tebus 1 bulan percuma secara automatik.`
                    }, { quoted: msg });
                } else {
                    saveUsers(users);
                    const lastExp = Math.max(user?.waExpiredAt || 0, user?.ttExpiredAt || 0, user?.expiredAt || 0);
                    const isExpired = lastExp > 0 && lastExp <= Date.now();
                    const headerLine = isExpired
                        ? `*LANGGANAN ANDA TELAH TAMAT (${new Date(lastExp).toLocaleDateString('ms-MY')})*`
                        : `*SELAMAT DATANG KE ${BOT_NAME.toUpperCase()}*`;

                    const welcomeCaption =
                        `${headerLine}\n\n` +
                        `Naik taraf kualiti video *60fps* & gambar *QHD+* anda untuk WhatsApp Status dan TikTok tanpa pecah.\n\n` +
                        `*Pilih Pelan Anda (30 Hari):*\n` +
                        `*1.* *WhatsApp Status HD* — *RM11.99*\n` +
                        `*2.* *TikTok 1080p 60fps HD* — *RM15.99*\n` +
                        `*3.* *Combo WhatsApp + TikTok HD* — *RM20.99* _(Pilihan Terbaik)_\n` +
                        `*4.* *Upgrade TikTok HD* — *RM12.99* _(Prorata ikut baki hari WA)_\n\n` +
                        `*Cara Langgan:*\n` +
                        `• Balas nombor *1, 2, 3, atau 4* untuk jana link bayaran *HitPay* automatik (DuitNow QR, FPX, eWallet & Kad).\n` +
                        `• Ada *kod referral* rakan? Hantar kod tersebut terus di sini.\n` +
                        `• Akses diaktifkan *serta-merta* selepas bayaran selesai.`;

                    if (fs.existsSync(START_BANNER_PATH)) {
                        await sendHumanReply(sock, remoteJid, {
                            image: fs.readFileSync(START_BANNER_PATH)
                        }, { quoted: msg });
                        await sendCachedMessage(sock, remoteJid, { text: welcomeCaption });
                    } else {
                        await sendHumanReply(sock, remoteJid, { text: welcomeCaption }, { quoted: msg });
                    }
                }
                continue;
            }

            if (['status', 'baki', 'langganan'].includes(cmd)) {
                if (isActive) {
                    const waDays = isSuperAdmin ? 9999 : (waActive ? Math.ceil((user.waExpiredAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0);
                    const ttDays = isSuperAdmin ? 9999 : (ttActive ? Math.ceil((user.ttExpiredAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0);
                    const waLine = isSuperAdmin ? 'Active (Super Admin Unlimited)' : (waActive ? `Active (${waDays} hari lagi, luput ${new Date(user.waExpiredAt).toLocaleDateString('ms-MY')})` : 'Tiada');
                    const ttLine = isSuperAdmin ? 'Active (Super Admin Unlimited)' : (ttActive ? `Active (${ttDays} hari lagi, luput ${new Date(user.ttExpiredAt).toLocaleDateString('ms-MY')})` : 'Tiada');
                    const currentMode = user.preferredMode || (ttActive && !waActive ? 'TT' : 'WA');

                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `✓ *STATUS KEAHLIAN ANDA*\n\n` +
                            `• Nama: *${user.name}*\n` +
                            `• Mod Pilihan: *${currentMode === 'TT' ? 'TikTok 1080p 60fps HD' : 'WhatsApp Status HD'}*\n` +
                            `• WhatsApp Status HD: ${waLine}\n` +
                            `• TikTok 1080p 60fps HD: ${ttLine}\n` +
                            `• Kod Referral: *${user.refCode || '-'}*\n` +
                            `• Kemajuan Ganjaran: ${user.paidReferrals || 0}/3 rakan melanggan\n\n` +
                            `Balas *TT* atau *WA* untuk menukar mod pemprosesan, atau *BAYAR* untuk tambah/perbaharui langganan.`
                    }, { quoted: msg });
                } else {
                    await sendHumanReply(sock, remoteJid, {
                        text:
                            `STATUS: TIADA LANGGANAN ACTIVE\n\n` +
                            `Akaun anda belum berdaftar sebagai ahli active ${BOT_NAME}.\n\n` +
                            `Sila taip *START* untuk melihat senarai pakej dan memulakan langganan.`
                    }, { quoted: msg });
                }
                continue;
            }

            // ---------------------------------------------------------
            // 6. PENGESANAN MEDIA & SEKATAN KEAHLIAN (MEMBERSHIP GATE)
            // ---------------------------------------------------------
            if (inner.videoMessage) {
                await sendHumanReply(sock, remoteJid, {
                    text:
                        `PERINGATAN FORMAT PENGHANTARAN VIDEO\n\n` +
                        `Video ini dikesan dihantar melalui mod biasa, jadi WhatsApp akan memampatkan kualiti video tersebut.\n\n` +
                        `Sila hantar semula video sebagai *file / document*:\n` +
                        `1. Tekan ikon Lampiran (+ atau klip kertas)\n` +
                        `2. Pilih *Document* > Pilih daripada galeri\n` +
                        `3. Hantar video anda sebagai document.`
                }, { quoted: msg });
                continue;
            }

            const isDirectImage = !!inner.imageMessage;
            const docMsg = inner.documentMessage || inner.documentWithCaptionMessage?.message?.documentMessage;
            const docMime = (docMsg?.mimetype || '').toLowerCase().split(';')[0].trim();
            const docFileName = (docMsg?.fileName || '').trim();
            const docExt = path.extname(docFileName).toLowerCase();

            const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.3gp']);
            const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
            const MIME_TO_VIDEO_EXT = {
                'video/mp4': '.mp4',
                'video/quicktime': '.mov',
                'video/x-m4v': '.m4v',
                'video/x-matroska': '.mkv',
                'video/x-msvideo': '.avi',
                'video/avi': '.avi',
                'video/webm': '.webm',
                'video/3gpp': '.3gp',
                'video/3gpp2': '.3gp'
            };

            const isDocVideo = !!docMsg && (docMime.startsWith('video/') || VIDEO_EXTS.has(docExt));
            const isHeicDoc = !!docMsg && !isDocVideo && (
                docExt === '.heic' ||
                docExt === '.heif' ||
                docMime === 'image/heic' ||
                docMime === 'image/heif' ||
                docMime.startsWith('image/heic') ||
                docMime.startsWith('image/heif')
            );
            const isDocImage = !!docMsg && !isDocVideo && (docMime.startsWith('image/') || IMAGE_EXTS.has(docExt));

            if (!isDirectImage && !isDocVideo && !isDocImage) {
                continue;
            }

            const mediaCaptionUpper = (docMsg?.caption || inner.imageMessage?.caption || textContent || '').trim().toUpperCase();
            let effectiveMode = user?.preferredMode || (ttActive && !waActive ? 'TT' : 'WA');
            if (/\b(TT|TIKTOK)\b/.test(mediaCaptionUpper)) {
                effectiveMode = 'TT';
            } else if (/\b(WA|WHATSAPP)\b/.test(mediaCaptionUpper)) {
                effectiveMode = 'WA';
            }

            if (!isActive) {
                const isWaiting = user && user.status === 'WAITING';
                const msgText = isWaiting
                    ? `AKSES DITANGGUHKAN: MENUNGGU PEMBAYARAN\n\nAkaun anda sedang menunggu pengesahan bayaran. Sila lengkapkan transaksi melalui link HitPay yang telah diberikan atau taip *START* untuk lihat semula pakej.`
                    : `AKSES DISEKAT: LANGGANAN DIPERLUKAN\n\nFungsi pemprosesan video 60fps & foto QHD+ hanya tersedia untuk ahli active.\n\nTaip *START* untuk melihat pakej langganan rasmi.`;

                await sendHumanReply(sock, remoteJid, { text: msgText }, { quoted: msg });
                continue;
            }

            if (effectiveMode === 'TT' && !ttActive) {
                await sendHumanReply(sock, remoteJid, {
                    text:
                        `AKSES TIKTOK HD DIPERLUKAN\n\n` +
                        `Pelan anda buat masa ini hanya meliputi *WhatsApp Status HD*. Untuk memproses video dalam mod *TikTok 1080p 60fps HD*, sila balas *4* untuk upgrade tambah akses TikTok HD (*kadar asas RM12.99/bulan, prorata ikut baki hari WA anda*).\n\n` +
                        `Jika anda mahu memproses untuk WhatsApp Status, balas *WA* dan hantar semula file anda.`
                }, { quoted: msg });
                continue;
            }

            if (effectiveMode === 'WA' && !waActive) {
                await sendHumanReply(sock, remoteJid, {
                    text:
                        `AKSES WHATSAPP STATUS HD DIPERLUKAN\n\n` +
                        `Pelan anda buat masa ini hanya meliputi *TikTok 1080p 60fps HD*. Untuk memproses media bagi *WhatsApp Status HD*, sila balas *1* (*RM11.99/bulan*) atau *3* untuk *Combo WA + TT (RM20.99/bulan)*.\n\n` +
                        `Jika anda mahu memproses video untuk TikTok, balas *TT* atau sertakan caption *TT* pada document anda.`
                }, { quoted: msg });
                continue;
            }

            // ---------------------------------------------------------
            // 7. CABANG A: PEMPROSESAN FOTO / IMEJ (Resolusi 2560px HD)
            // ---------------------------------------------------------
            if (isDirectImage || isDocImage) {
                const isHeicJob = isHeicDoc;
                const heicExt = docExt === '.heif' ? '.heif' : '.heic';
                const enqueueResult = videoQueue.enqueue({
                    userId: remoteJid,
                    priority: isSuperAdmin,
                    run: async () => {
                        const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                        const rawHeicPath = isHeicJob ? path.join(TEMP_DIR, `raw_${fileId}${heicExt}`) : null;
                        const inputPath = path.join(TEMP_DIR, `input_${fileId}.jpg`);
                        const outputPath = path.join(TEMP_DIR, `status_clear_photo_${fileId}.jpg`);

                        try {
                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '⏳', key: msg.key }
                                });
                            } catch {}

                            console.log(`\n[Pemprosesan Imej Bermula] Memuat turun foto${isHeicJob ? ` (${heicExt.toUpperCase()})` : ''} dari ${remoteJid}...`);
                            const mediaStream = await downloadMediaMessage(msg, 'stream', {}, { logger, reuploadRequest: sock.updateMediaMessage });
                            await pipeline(mediaStream, fs.createWriteStream(isHeicJob ? rawHeicPath : inputPath));

                            if (isHeicJob) {
                                console.log(`[HEIC/HEIF Convert] Menyahkod ${path.basename(rawHeicPath)} ke JPEG (Q=0.98)...`);
                                let heicBuffer = await fs.promises.readFile(rawHeicPath);
                                let jpegBuffer = await heicConvert({
                                    buffer: heicBuffer,
                                    format: 'JPEG',
                                    quality: 0.98
                                });
                                await fs.promises.writeFile(inputPath, jpegBuffer);
                                heicBuffer = null;
                                jpegBuffer = null;
                                if (fs.existsSync(rawHeicPath)) { try { fs.unlinkSync(rawHeicPath); } catch {} }
                            }

                            console.log(`[FFmpeg Imej] Meningkatkan foto ke 2560px QHD+ dengan penapis Lanczos & CAS...`);
                            const { sizeBytes, hasCas, usedQ } = await enhanceQhdPhoto(inputPath, outputPath, ffmpegPath);

                            const sizeKB = (sizeBytes / 1024).toFixed(1);
                            const sharpNote = hasCas ? 'CAS 0.35 (Kontras Adaptif)' : 'Lanczos Sharp Resample';

                            await sendCachedMessage(sock, remoteJid, {
                                image: { stream: fs.createReadStream(outputPath) },
                                caption:
                                    `✓ *PENGOPTIMUMAN FOTO SELESAI*\n\n` +
                                    `Foto anda telah ditingkatkan ke resolusi 2560px (QHD+) dengan penalaan ${sharpNote} & kawalan anti-mampatan WhatsApp Status.\n\n` +
                                    `• Saiz File: ${sizeKB} KB (Zon Selamat)\n` +
                                    `• Profil Kualiti: JPEG Q=${usedQ}\n\n` +
                                    `Anda boleh terus muat naik foto ini ke WhatsApp Status anda.`
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

                                await sendHumanReply(sock, remoteJid, {
                                    text:
                                        `✓ *KOD REFERRAL PERIBADI ANDA: ${user.refCode}*\n\n` +
                                        `Sebagai ahli active ${BOT_NAME}, ajak 3 rakan anda melanggan menggunakan kod *${user.refCode}* untuk menerima 1 bulan (30 hari) langganan tambahan secara percuma.`
                                });
                            }

                            console.log(`[Selesai] Foto HD (${sizeKB} KB) berjaya dihantar ke ${remoteJid}.`);

                        } catch (err) {
                            console.error('[Ralat Pemprosesan Imej]', err);
                            try {
                                await sendHumanReply(sock, remoteJid, {
                                    text: `Ralat: Proses penambahbaikan foto gagal dilaksanakan. (${err.message})`
                                }, { quoted: msg });
                            } catch {}
                        } finally {
                            if (rawHeicPath && fs.existsSync(rawHeicPath)) { try { fs.unlinkSync(rawHeicPath); } catch {} }
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
                        await sendHumanReply(sock, remoteJid, {
                            text: `MAKLUMAN: Kapasiti giliran pemprosesan sedang penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE} media). Sila tunggu beberapa minit sebelum menghantar semula.`
                        }, { quoted: msg });
                    } else if (enqueueResult.reason === 'duplicate') {
                        await sendHumanReply(sock, remoteJid, {
                            text: `PERINGATAN: Anda sudah mempunyai satu media yang sedang diproses dalam giliran. Sila tunggu media semasa selesai sebelum menghantar media baharu.`
                        }, { quoted: msg });
                    }
                } else {
                    if (enqueueResult.position > 1) {
                        await sendHumanReply(sock, remoteJid, {
                            text: `Foto diterima. Anda berada di giliran ke-${enqueueResult.position}. Sistem akan memproses foto anda sebaik sahaja giliran tiba.`
                        }, { quoted: msg });
                    }
                }
                continue;
            }

            // ---------------------------------------------------------
            // 8. CABANG B: PEMPROSESAN DOKUMEN VIDEO (WA 60FPS / TIKTOK 1080P 60FPS)
            // ---------------------------------------------------------
            if (isDocVideo) {
                const fileLength = Number(docMsg.fileLength || 0);
                const sizeMB = (fileLength / (1024 * 1024)).toFixed(1);
                const videoInputExt = VIDEO_EXTS.has(docExt) ? docExt : (MIME_TO_VIDEO_EXT[docMime] || '.mp4');
                const targetMode = effectiveMode === 'TT' ? 'TT' : 'WA';

                const enqueueResult = videoQueue.enqueue({
                    userId: remoteJid,
                    priority: isSuperAdmin,
                    run: async () => {
                        const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                        const inputPath = path.join(TEMP_DIR, `input_${fileId}${videoInputExt}`);
                        const outputPath = path.join(TEMP_DIR, targetMode === 'TT' ? `TikTok_HD_${fileId}.mp4` : `status_clear_60fps_${fileId}.mp4`);

                        try {
                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '⏳', key: msg.key }
                                });
                            } catch {}

                            console.log(`\n[Pemprosesan Video ${targetMode} Bermula] Memuat turun video (${sizeMB} MB, format ${videoInputExt}) dari ${remoteJid}...`);

                            const mediaStream = await downloadMediaMessage(msg, 'stream', {}, { logger, reuploadRequest: sock.updateMediaMessage });
                            await pipeline(mediaStream, fs.createWriteStream(inputPath));

                            const { duration: durationSec, fps: sourceFps, isHDR } = await probeVideo(inputPath, ffprobePath);

                            if (targetMode === 'TT') {
                                console.log(`[FFmpeg TikTok] 1080p60 CRF 17 (15M maxrate) | Dual Sharpen + hqdn3d + Audio Norm | Sumber: ${sourceFps.toFixed(1)} FPS (${isHDR ? 'HDR Tone-Mapped' : 'SDR Asal'}) | Durasi: ${durationSec.toFixed(1)}s`);
                                await transcodeTikTokVideo(inputPath, outputPath, ffmpegPath, sourceFps, isHDR, isSuperAdmin ? 0 : 90);

                                const ttSent = await safeSendMessage(sock, remoteJid, {
                                    document: fs.readFileSync(outputPath),
                                    mimetype: 'video/mp4',
                                    fileName: 'TikTok_HD_' + Date.now() + '.mp4'
                                }, { quoted: msg });
                                if (ttSent && ttSent.key && ttSent.key.id && ttSent.message) {
                                    storeCachedMessage(ttSent.key.id, ttSent.message);
                                }

                                await sendCachedMessage(sock, remoteJid, {
                                    text: 'Video TikTok 1080p 60fps HD siap diproses. Simpan fail di atas ke Gallery dan pastikan tetapan Allow high-quality uploads diaktifkan sebelum post di TikTok.'
                                });

                                try {
                                    await sock.sendMessage(remoteJid, {
                                        react: { text: '✅', key: msg.key }
                                    });
                                } catch {}
                            } else {
                                if (!isSuperAdmin && durationSec > 180) {
                                    await sendHumanReply(sock, remoteJid, {
                                        text:
                                            `HAD DURASI WHATSAPP STATUS HD (MAKS 180 SAAT)\n\n` +
                                            `Durasi video anda ialah *${Math.round(durationSec)} saat*. Mod WhatsApp Status HD menyokong video sehingga *180 saat (3 minit)* dengan pemecahan automatik setiap 60 saat.\n\n` +
                                            `Sila potong video kepada 3 minit ke bawah atau tukar ke mod TikTok (*TT*) jika diperlukan.`
                                    }, { quoted: msg });
                                    return;
                                }

                                const totalParts = durationSec <= 60 ? 1 : Math.ceil(durationSec / 60);

                                for (let partIdx = 0; partIdx < totalParts; partIdx++) {
                                    const startSec = partIdx * 60;
                                    const clipDuration = Math.min(60, Math.max(1, durationSec - startSec));
                                    const targetVideoKbps = computeWaTargetBitrate(clipDuration);
                                    const partFileName = totalParts === 1 ? 'Status_HD.mp4' : `Status_HD_Part${partIdx + 1}.mp4`;
                                    const partOutputPath = path.join(TEMP_DIR, `${fileId}_${partFileName}`);

                                    try {
                                        const targetShortSide = targetVideoKbps >= 4600 ? 1080 : 720;
                                        console.log(`[FFmpeg Transcode WA] Bahagian ${partIdx + 1}/${totalParts} | ${targetShortSide}p @ ${targetVideoKbps} kbps (15.2MB Cap) | CAS 0.35 | aq-mode 3 | Durasi: ${clipDuration.toFixed(1)}s | Sumber: ${sourceFps.toFixed(1)} FPS (${isHDR ? 'HDR Tone-Mapped' : 'SDR'})`);
                                        await transcode60fpsVideo(inputPath, partOutputPath, ffmpegPath, targetVideoKbps, sourceFps, isHDR, startSec, clipDuration);

                                        const waSent = await safeSendMessage(sock, remoteJid, {
                                            video: { stream: fs.createReadStream(partOutputPath) },
                                            mimetype: 'video/mp4',
                                            hd: true
                                        }, { quoted: msg });
                                        if (waSent && waSent.key && waSent.key.id && waSent.message) {
                                            storeCachedMessage(waSent.key.id, waSent.message);
                                        }
                                    } finally {
                                        if (fs.existsSync(partOutputPath)) { try { fs.unlinkSync(partOutputPath); } catch {} }
                                    }
                                }

                                await sendCachedMessage(sock, remoteJid, {
                                    text: totalParts === 1
                                        ? 'Video HD siap diproses. Terus tekan Forward pada video di atas dan pilih My Status (jangan muat naik semula dari Gallery supaya kualiti 60fps kekal tajam).'
                                        : `Video HD siap diproses (${totalParts} bahagian, 60 saat setiap satu). Sila Forward mengikut turutan terus ke My Status.`
                                });

                                try {
                                    await sock.sendMessage(remoteJid, {
                                        react: { text: '✅', key: msg.key }
                                    });
                                } catch {}
                            }

                            if (user && user.status === 'ACTIVE' && (!user.refSentToExisting || !user.refCode)) {
                                if (!user.refCode) user.refCode = generateReferralCode(user.name, users);
                                user.refSentToExisting = true;
                                saveUsers(users);

                                await sendHumanReply(sock, remoteJid, {
                                    text:
                                        `✓ *KOD REFERRAL PERIBADI ANDA: ${user.refCode}*\n\n` +
                                        `Sebagai ahli active ${BOT_NAME}, ajak 3 rakan anda melanggan menggunakan kod *${user.refCode}* untuk menerima 1 bulan (30 hari) langganan tambahan secara percuma.`
                                });
                            }

                            console.log(`[Selesai] Video ${targetMode} berjaya dihantar ke ${remoteJid}.`);

                        } catch (err) {
                            console.error('[Ralat Pemprosesan Video]', err);
                            try {
                                await sendHumanReply(sock, remoteJid, {
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
                        await sendHumanReply(sock, remoteJid, {
                            text: `MAKLUMAN: Kapasiti giliran pemprosesan sedang penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE} video). Sila tunggu beberapa minit sebelum menghantar semula video anda.`
                        }, { quoted: msg });
                    } else if (enqueueResult.reason === 'duplicate') {
                        await sendHumanReply(sock, remoteJid, {
                            text: `PERINGATAN: Anda sudah mempunyai satu media yang sedang diproses dalam giliran. Sila tunggu video semasa selesai sebelum menghantar video baharu.`
                        }, { quoted: msg });
                    }
                } else {
                    if (enqueueResult.position > 1) {
                        await sendHumanReply(sock, remoteJid, {
                            text: `Video diterima (Mod ${targetMode === 'TT' ? 'TikTok 1080p 60fps' : 'WhatsApp Status HD'}). Anda berada di giliran ke-${enqueueResult.position}. Sistem akan memproses sebaik sahaja giliran tiba.`
                        }, { quoted: msg });
                    }
                }
            }
        }
    });
}

// =====================================================================
// TELEGRAM BOT INTEGRATION (BERKONGSI PANGKALAN DATA & HITPAY)
// =====================================================================
async function tgApi(method, body) {
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const data = await res.json();
    if (!data.ok) {
        throw new Error(data.description || `Telegram API error on ${method}`);
    }
    return data.result;
}

async function sendTelegramMessage(chatId, text, replyToMessageId = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return null;
    try {
        const payload = { chat_id: String(chatId), text: String(text || '') };
        if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
        return await tgApi('sendMessage', payload);
    } catch (err) {
        console.error(`[TELEGRAM] Gagal hantar mesej ke ${chatId}:`, err.message);
        return null;
    }
}

async function sendTelegramMedia(chatId, mediaType, filePath, caption, replyToMessageId = null) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return null;
    const buf = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    if (replyToMessageId) form.append('reply_to_message_id', String(replyToMessageId));

    const fileName = path.basename(filePath);
    if (mediaType === 'photo') {
        form.append('photo', new Blob([buf], { type: 'image/jpeg' }), fileName);
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: form
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Telegram sendPhoto failed');
        return data.result;
    } else if (mediaType === 'document') {
        form.append('document', new Blob([buf], { type: 'video/mp4' }), fileName);
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: form
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Telegram sendDocument failed');
        return data.result;
    } else {
        form.append('supports_streaming', 'true');
        form.append('video', new Blob([buf], { type: 'video/mp4' }), fileName);
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`, {
            method: 'POST',
            body: form
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Telegram sendVideo failed');
        return data.result;
    }
}

async function downloadTelegramFile(fileId, maxBytes = 20 * 1024 * 1024, destPath) {
    const fileInfo = await tgApi('getFile', { file_id: fileId });
    if (fileInfo.file_size && fileInfo.file_size > maxBytes) {
        throw new Error(`Saiz file melebihi had maksimum 20 MB Telegram Bot (${(fileInfo.file_size / (1024 * 1024)).toFixed(1)} MB).`);
    }
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Gagal muat turun file Telegram (HTTP ${res.status})`);
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > maxBytes) {
        throw new Error(`Saiz file melebihi had maksimum 20 MB Telegram Bot (${(arrayBuf.byteLength / (1024 * 1024)).toFixed(1)} MB).`);
    }
    await fs.promises.writeFile(destPath, Buffer.from(arrayBuf));
    return destPath;
}

function getOrCreateTelegramUser(users, chatId, displayName) {
    const tgKey = `tg_${chatId}`;
    const cleanDisplayName = formatTitleCaseName(displayName, chatId);
    let user = users[tgKey] || Object.values(users).find(u => String(u.telegramChatId || '') === String(chatId));
    if (!user) {
        user = normalizeUserTiers({
            phone: tgKey,
            telegramChatId: String(chatId),
            name: cleanDisplayName,
            status: 'NEW',
            createdAt: Date.now(),
            waExpiredAt: null,
            ttExpiredAt: null,
            preferredMode: 'WA',
            refCode: null,
            referredBy: null,
            paidReferrals: 0,
            totalPaidReferrals: 0,
            refSentToExisting: false,
            reminded3Days: false,
            jid: null,
            altJid: null
        });
        users[tgKey] = user;
        saveUsers(users);
    } else {
        normalizeUserTiers(user);
        if (cleanDisplayName && /^user\s*\d*$/i.test(user.name)) {
            user.name = cleanDisplayName;
        }
        if (!user.telegramChatId) {
            user.telegramChatId = String(chatId);
        }
        saveUsers(users);
    }
    return { tgKey, user };
}

async function handleTelegramMessage(tgMsg) {
    if (!tgMsg || !tgMsg.chat) return;
    const chatId = String(tgMsg.chat.id);
    const msgId = tgMsg.message_id;
    const rawFromName = [tgMsg.from?.first_name, tgMsg.from?.last_name].filter(Boolean).join(' ') || tgMsg.from?.username || '';
    const fromName = formatTitleCaseName(rawFromName, chatId);
    const textContent = (tgMsg.text || tgMsg.caption || '').trim();
    const textParts = textContent.split(/\s+/);
    const cmdRaw = (textParts[0] || '').toLowerCase();
    const cmd = cmdRaw.split('@')[0];
    const upperText = textContent.toUpperCase();

    const users = loadUsers();
    const { tgKey, user } = getOrCreateTelegramUser(users, chatId, fromName);
    const isSuperAdmin = isPrimaryAdmin(user.phone) || isPrimaryAdmin(user.linkedWaPhone);
    const waActive = hasWaAccess(user, isSuperAdmin);
    const ttActive = hasTtAccess(user, isSuperAdmin);
    const isActive = waActive || ttActive;
    const cleanPkgTemplate = PACKAGE_TEMPLATE.replace(/\*/g, '');

    if (['/tt', 'tt', '/tiktok', 'tiktok'].includes(cmd)) {
        user.preferredMode = 'TT';
        saveUsers(users);
        if (ttActive) {
            const ttExp = isSuperAdmin ? 'Tanpa Had (Super Admin)' : new Date(user.ttExpiredAt).toLocaleDateString('ms-MY');
            await sendTelegramMessage(chatId,
                `✓ MOD TIKTOK 1080P 60FPS AKTIF\n\n` +
                `Semua video yang anda hantar selepas ini akan diproses menggunakan profil TikTok HD (1080p 60fps, High Bitrate).\n\n` +
                `• Status TikTok HD: Aktif sehingga ${ttExp}\n` +
                `• Untuk kembali ke mod WhatsApp Status HD, hantar /wa`,
                msgId
            );
        } else if (waActive) {
            await sendTelegramMessage(chatId,
                `Mod pilihan ditukar ke TikTok 1080p 60fps, namun pelan active anda kini hanya WhatsApp Status HD.\n\nBalas 4 untuk upgrade tambah TikTok HD (RM12.99/bulan prorata ikut baki hari WA), atau /wa untuk kembali ke mod WhatsApp.`,
                msgId
            );
        } else {
            await sendTelegramMessage(chatId,
                `Mod pilihan ditetapkan ke TikTok 1080p 60fps, namun anda belum mempunyai langganan active.\n\nBalas 2 untuk TikTok HD (RM15.99/bulan) atau 3 untuk Combo WA + TT (RM20.99/bulan).`,
                msgId
            );
        }
        return;
    }

    if (['/wa', 'wa', '/whatsapp', 'whatsapp'].includes(cmd)) {
        user.preferredMode = 'WA';
        saveUsers(users);
        if (waActive) {
            const waExp = isSuperAdmin ? 'Tanpa Had (Super Admin)' : new Date(user.waExpiredAt).toLocaleDateString('ms-MY');
            await sendTelegramMessage(chatId,
                `✓ MOD WHATSAPP STATUS HD AKTIF\n\n` +
                `Semua video dan foto yang anda hantar selepas ini akan diproses menggunakan profil WhatsApp Status HD (60fps + QHD+).\n\n` +
                `• Status WhatsApp HD: Aktif sehingga ${waExp}\n` +
                `• Untuk bertukar ke mod TikTok 1080p 60fps, hantar /tt`,
                msgId
            );
        } else if (ttActive) {
            await sendTelegramMessage(chatId,
                `Mod pilihan ditukar ke WhatsApp Status HD, namun pelan active anda kini hanya TikTok HD.\n\nBalas 1 untuk WhatsApp Status HD (RM11.99/bulan), atau /tt untuk kembali ke mod TikTok.`,
                msgId
            );
        } else {
            await sendTelegramMessage(chatId,
                `Mod pilihan ditetapkan ke WhatsApp Status HD, namun anda belum mempunyai langganan active.\n\nBalas 1 untuk WhatsApp Status HD (RM11.99/bulan) atau 3 untuk Combo WA + TT (RM20.99/bulan).`,
                msgId
            );
        }
        return;
    }

    if (cmd === '/link') {
        const targetCode = (textParts[1] || '').trim().toUpperCase();
        if (!targetCode) {
            await sendTelegramMessage(chatId, `Sila sertakan kod rujukan akaun anda. Contoh: /link ${user.refCode || 'KODANDA'}`, msgId);
            return;
        }
        const targetAcc = Object.values(users).find(u => u.refCode && u.refCode.toUpperCase() === targetCode);
        if (!targetAcc) {
            await sendTelegramMessage(chatId, `Kod rujukan ${targetCode} tidak ditemui. Sila semak kod anda menggunakan arahan STATUS di WhatsApp.`, msgId);
            return;
        }
        if (targetAcc === user) {
            await sendTelegramMessage(chatId, `Kod ${targetCode} adalah kod akaun Telegram ini sendiri.`, msgId);
            return;
        }
        normalizeUserTiers(user);
        normalizeUserTiers(targetAcc);
        const mergedWa = Math.max(user.waExpiredAt || 0, targetAcc.waExpiredAt || 0);
        const mergedTt = Math.max(user.ttExpiredAt || 0, targetAcc.ttExpiredAt || 0);
        const nowMs = Date.now();

        user.waExpiredAt = mergedWa;
        user.ttExpiredAt = mergedTt;
        user.expiredAt = Math.max(mergedWa, mergedTt);
        targetAcc.waExpiredAt = mergedWa;
        targetAcc.ttExpiredAt = mergedTt;
        targetAcc.expiredAt = Math.max(mergedWa, mergedTt);

        if (mergedWa > nowMs || mergedTt > nowMs) {
            user.status = 'ACTIVE';
            targetAcc.status = 'ACTIVE';
        }
        targetAcc.telegramChatId = chatId;
        user.telegramChatId = chatId;
        if (targetAcc.phone && !String(targetAcc.phone).startsWith('tg_')) {
            user.linkedWaPhone = targetAcc.phone;
        }
        saveUsers(users);

        const waStr = mergedWa > nowMs ? new Date(mergedWa).toLocaleDateString('ms-MY') : 'Tiada';
        const ttStr = mergedTt > nowMs ? new Date(mergedTt).toLocaleDateString('ms-MY') : 'Tiada';
        await sendTelegramMessage(chatId,
            `✓ AKAUN BERJAYA DIPAUTKAN\n\n` +
            `Langganan anda kini diselaraskan antara WhatsApp dan Telegram:\n` +
            `• WhatsApp Status HD: ${waStr}\n` +
            `• TikTok 1080p 60fps HD: ${ttStr}`,
            msgId
        );
        return;
    }

    const selectedPkg = PACKAGES[textContent];
    if (selectedPkg && !tgMsg.document && !tgMsg.video && !tgMsg.photo) {
        if (selectedPkg.requiresWa && !waActive) {
            await sendTelegramMessage(chatId,
                `Pakej 4 (Upgrade TikTok HD RM12.99 prorata) khas untuk ahli yang sudah mempunyai langganan WhatsApp Status HD active.\n\n` +
                `Sila pilih:\n• Balas 2 untuk TikTok 1080p 60fps HD Sahaja (RM15.99/bulan)\n• Balas 3 untuk Combo WhatsApp + TikTok HD (RM20.99/bulan)`,
                msgId
            );
            return;
        }
        try {
            const isUpgradePlan = selectedPkg.planCode === 'UPGRADE_TT';
            const prorate = isUpgradePlan ? calculateProratedUpgrade(user?.waExpiredAt) : null;
            const reqDays = isUpgradePlan ? prorate.remainingDays : selectedPkg.days;
            const reqAmount = isUpgradePlan ? prorate.amount : selectedPkg.amount;
            const reqPurpose = isUpgradePlan
                ? `${BOT_NAME} (Telegram) - Upgrade TikTok HD (${prorate.remainingDays} Hari Prorata)`
                : `${BOT_NAME} (Telegram) - ${selectedPkg.title}`;

            const chipRes = await createChipCheckout({
                userKey: tgKey,
                phone: tgKey,
                formattedName: formatTitleCaseName(fromName, tgKey),
                planType: selectedPkg.planCode,
                planTitle: selectedPkg.title,
                amountRM: reqAmount,
                days: reqDays,
                platform: 'telegram',
                appliedRefCode: user?.referredByCode || ''
            });
            if (!isActive) user.status = 'WAITING';
            saveUsers(users);

            const shortNote = (isUpgradePlan && prorate.isShortRemaining)
                ? `\nNota: Baki WA anda kurang daripada 5 hari — anda juga boleh balas 3 untuk Combo (RM20.99) bagi mendapatkan 30 hari penuh untuk kedua-dua mod.\n`
                : '';
            const pkgSummaryLine = isUpgradePlan
                ? `Pakej: ${selectedPkg.title}\nBaki Tempoh WA: ${prorate.remainingDays} hari | Harga Prorata: ${prorate.priceLabel} (Tamat serentak dengan WA anda)${shortNote}`
                : `Pakej: ${selectedPkg.title} (${selectedPkg.price} / ${selectedPkg.days} Hari)`;

            await sendTelegramMessage(chatId,
                `✓ PAUTAN PEMBAYARAN RASMI CHIP ASIA\n\n` +
                `No. Invois: ${chipRes.invoiceRef}\n` +
                `${pkgSummaryLine}\n\n` +
                `Sila klik link di bawah untuk membuat bayaran (FPX, DuitNow QR, eWallet & Kad):\n` +
                `${chipRes.checkout_url}\n\n` +
                `Akses anda akan diaktifkan secara automatik sebaik sahaja transaksi selesai.`,
                msgId
            );
        } catch (err) {
            await sendTelegramMessage(chatId, `Maaf, terdapat ralat semasa menjana link CHIP Asia: ${err.message}`, msgId);
        }
        return;
    }

    if (['/bayar', 'bayar', '/pakej', 'pakej', '/upgrade', 'upgrade'].includes(cmd)) {
        if (!isActive) user.status = 'WAITING';
        saveUsers(users);
        await sendTelegramMessage(chatId, `MAKLUMAT PAKEJ LANGGANAN (${BOT_NAME})\n\n${cleanPkgTemplate}`, msgId);
        return;
    }

    if (['/start', 'start', '/menu', 'menu', '/help', 'help'].includes(cmd)) {
        if (isActive) {
            if (!user.refCode) user.refCode = generateReferralCode(user.name, users);
            user.refSentToExisting = true;
            saveUsers(users);

            const waStr = isSuperAdmin ? 'Tanpa Had (Super Admin)' : (waActive ? new Date(user.waExpiredAt).toLocaleDateString('ms-MY') : 'Tidak Active (Balas 1 - RM11.99)');
            const ttStr = isSuperAdmin ? 'Tanpa Had (Super Admin)' : (ttActive ? new Date(user.ttExpiredAt).toLocaleDateString('ms-MY') : (waActive ? 'Tidak Active (Balas 4 untuk upgrade prorata RM12.99/30h)' : 'Tidak Active (Balas 2 - RM15.99)'));
            const currentMode = user.preferredMode || (ttActive && !waActive ? 'TT' : 'WA');

            await sendTelegramMessage(chatId,
                `✓ SELAMAT KEMBALI KE ${BOT_NAME} (TELEGRAM)\n\n` +
                `• Mod Semasa: ${currentMode === 'TT' ? 'TikTok 1080p 60fps HD' : 'WhatsApp Status HD'}\n` +
                `• WhatsApp Status HD: ${waStr}\n` +
                `• TikTok 1080p 60fps HD: ${ttStr}\n` +
                `• Kod Referral: ${user.refCode}\n\n` +
                `Panduan Ringkas:\n` +
                `• Hantar video atau foto sebagai File (tanpa compression, maks 20 MB mengikut had Telegram Bot API).\n` +
                `• Taip /tt untuk mod TikTok 1080p 60fps, atau /wa untuk mod WhatsApp Status HD.\n` +
                `• Ada langganan WhatsApp sedia ada? Taip /link <KOD_REFERRAL_WA_ANDA>.`,
                msgId
            );
        } else {
            const lastExp = Math.max(user?.waExpiredAt || 0, user?.ttExpiredAt || 0, user?.expiredAt || 0);
            const isExpired = lastExp > 0 && lastExp <= Date.now();
            const tgHeader = isExpired
                ? `LANGGANAN ANDA TELAH TAMAT (${new Date(lastExp).toLocaleDateString('ms-MY')})`
                : `SELAMAT DATANG KE ${BOT_NAME.toUpperCase()}`;

            const tgWelcomeCaption =
                `${tgHeader}\n\n` +
                `Naik taraf kualiti video 60fps & gambar QHD+ anda untuk WhatsApp Status dan TikTok tanpa pecah.\n\n` +
                `Pilih Pelan Anda (30 Hari):\n` +
                `1. WhatsApp Status HD — RM11.99\n` +
                `2. TikTok 1080p 60fps HD — RM15.99\n` +
                `3. Combo WhatsApp + TikTok HD — RM20.99 (Pilihan Terbaik)\n` +
                `4. Upgrade TikTok HD — RM12.99 (Prorata ikut baki hari WA)\n\n` +
                `Cara Langgan:\n` +
                `• Balas nombor 1, 2, 3, atau 4 untuk jana link bayaran HitPay automatik.\n` +
                `• Sudah melanggan di WhatsApp? Hantar /link <KOD_REFERRAL_ANDA>.\n` +
                `• Akses diaktifkan serta-merta selepas bayaran selesai.`;

            if (fs.existsSync(START_BANNER_PATH)) {
                try {
                    await sendTelegramMedia(chatId, 'photo', START_BANNER_PATH, null, msgId);
                } catch {}
                await sendTelegramMessage(chatId, tgWelcomeCaption);
            } else {
                await sendTelegramMessage(chatId, tgWelcomeCaption, msgId);
            }
        }
        return;
    }

    if (['/status', 'status', 'baki'].includes(cmd)) {
        if (isActive) {
            const waDays = isSuperAdmin ? 9999 : (waActive ? Math.ceil((user.waExpiredAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0);
            const ttDays = isSuperAdmin ? 9999 : (ttActive ? Math.ceil((user.ttExpiredAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0);
            const waLine = isSuperAdmin ? 'Active (Super Admin Unlimited)' : (waActive ? `Active (${waDays} hari lagi, luput ${new Date(user.waExpiredAt).toLocaleDateString('ms-MY')})` : 'Tiada');
            const ttLine = isSuperAdmin ? 'Active (Super Admin Unlimited)' : (ttActive ? `Active (${ttDays} hari lagi, luput ${new Date(user.ttExpiredAt).toLocaleDateString('ms-MY')})` : 'Tiada');
            await sendTelegramMessage(chatId,
                `✓ STATUS KEAHLIAN ANDA\n\n` +
                `• Nama: ${user.name}\n` +
                `• Mod Pilihan: ${(user.preferredMode || 'WA') === 'TT' ? 'TikTok 1080p 60fps HD' : 'WhatsApp Status HD'}\n` +
                `• WhatsApp Status HD: ${waLine}\n` +
                `• TikTok 1080p 60fps HD: ${ttLine}\n` +
                `• Kod Referral: ${user.refCode || '-'}\n` +
                `• Kemajuan Ganjaran: ${user.paidReferrals || 0}/3 rakan melanggan`,
                msgId
            );
        } else {
            await sendTelegramMessage(chatId,
                `STATUS: TIADA LANGGANAN ACTIVE\n\nSila hantar /start untuk melihat pakej langganan atau /link <KOD> jika sudah melanggan di WhatsApp.`,
                msgId
            );
        }
        return;
    }

    if (textContent && !tgMsg.photo && !tgMsg.video && !tgMsg.document) {
        const candidateCode = (cmd === '/ref' && textParts[1]) ? textParts[1].toUpperCase() : upperText;
        const matchedReferrer = Object.values(users).find(u => u.refCode && u.refCode.toUpperCase() === candidateCode);
        if (matchedReferrer && matchedReferrer !== user) {
            if (isActive) {
                await sendTelegramMessage(chatId, `Akaun anda sudah berstatus active. Kod referral hanya sah untuk pendaftaran baharu atau pembaharuan langganan yang tamat.`, msgId);
                return;
            }
            user.referredBy = matchedReferrer.phone;
            user.status = 'WAITING';
            saveUsers(users);
            await sendTelegramMessage(chatId, `✓ KOD REFERRAL DISAHKAN\n\nAnda dijemput oleh ${matchedReferrer.name} (${matchedReferrer.refCode}).\n\n${cleanPkgTemplate}`, msgId);
            return;
        }
    }

    const doc = tgMsg.document;
    const vid = tgMsg.video;
    const photos = Array.isArray(tgMsg.photo) ? tgMsg.photo : [];
    const docName = (doc?.file_name || '').trim();
    const docExt = path.extname(docName).toLowerCase();
    const docMime = (doc?.mime_type || '').toLowerCase();

    const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.3gp']);
    const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

    const isTgVideo = !!vid || (!!doc && (docMime.startsWith('video/') || VIDEO_EXTS.has(docExt)));
    const isTgHeic = !!doc && !isTgVideo && (docExt === '.heic' || docExt === '.heif' || docMime.includes('heic') || docMime.includes('heif'));
    const isTgImage = photos.length > 0 || (!!doc && !isTgVideo && (docMime.startsWith('image/') || IMAGE_EXTS.has(docExt)));

    if (!isTgVideo && !isTgImage) return;

    if (!isActive) {
        await sendTelegramMessage(chatId,
            `AKSES DISEKAT: LANGGANAN DIPERLUKAN\n\nFungsi pemprosesan video 60fps & foto QHD+ hanya tersedia untuk ahli active. Hantar /start untuk melanggan atau /link <KOD>.`,
            msgId
        );
        return;
    }

    const captionUpper = (tgMsg.caption || '').trim().toUpperCase();
    let effectiveMode = user.preferredMode || (ttActive && !waActive ? 'TT' : 'WA');
    if (/\b(TT|TIKTOK)\b/.test(captionUpper)) effectiveMode = 'TT';
    else if (/\b(WA|WHATSAPP)\b/.test(captionUpper)) effectiveMode = 'WA';

    if (effectiveMode === 'TT' && !ttActive) {
        await sendTelegramMessage(chatId,
            `Pelan anda kini hanya meliputi WhatsApp Status HD. Balas 4 untuk upgrade TikTok HD (kadar asas RM12.99/bulan prorata ikut baki hari WA), atau hantar /wa untuk proses mod WhatsApp.`,
            msgId
        );
        return;
    }
    if (effectiveMode === 'WA' && !waActive) {
        await sendTelegramMessage(chatId,
            `Pelan anda kini hanya meliputi TikTok HD. Balas 1 untuk WhatsApp Status HD (RM11.99/bulan) atau 3 untuk Combo (RM20.99/bulan), atau hantar /tt untuk proses mod TikTok.`,
            msgId
        );
        return;
    }

    const MAX_TG_BYTES = 20 * 1024 * 1024;
    if (isTgImage) {
        const fileObj = photos.length > 0 ? photos[photos.length - 1] : doc;
        if (fileObj.file_size && fileObj.file_size > MAX_TG_BYTES) {
            await sendTelegramMessage(chatId, `Maaf, saiz foto (${(fileObj.file_size / (1024 * 1024)).toFixed(1)} MB) melebihi had muat turun 20 MB Telegram Bot API.`, msgId);
            return;
        }
        const heicExt = docExt === '.heif' ? '.heif' : '.heic';
        const enqueueResult = videoQueue.enqueue({
            userId: tgKey,
            priority: isSuperAdmin,
            run: async () => {
                const fileId = `tg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                const rawHeicPath = isTgHeic ? path.join(TEMP_DIR, `raw_${fileId}${heicExt}`) : null;
                const inputPath = path.join(TEMP_DIR, `input_${fileId}.jpg`);
                const outputPath = path.join(TEMP_DIR, `status_clear_photo_${fileId}.jpg`);
                try {
                    await downloadTelegramFile(fileObj.file_id, MAX_TG_BYTES, isTgHeic ? rawHeicPath : inputPath);
                    if (isTgHeic) {
                        let heicBuf = await fs.promises.readFile(rawHeicPath);
                        let jpgBuf = await heicConvert({ buffer: heicBuf, format: 'JPEG', quality: 0.98 });
                        await fs.promises.writeFile(inputPath, jpgBuf);
                        heicBuf = null;
                        jpgBuf = null;
                    }
                    const { sizeBytes, hasCas, usedQ } = await enhanceQhdPhoto(inputPath, outputPath, ffmpegPath);
                    const sizeKB = (sizeBytes / 1024).toFixed(1);
                    const sharpNote = hasCas ? 'CAS 0.35 (Kontras Adaptif)' : 'Lanczos Sharp Resample';
                    await sendTelegramMedia(chatId, 'photo', outputPath,
                        `✓ PENGOPTIMUMAN FOTO SELESAI\nResolusi: 2560px QHD+ | ${sharpNote} | ${sizeKB} KB (JPEG Q=${usedQ})`,
                        msgId
                    );
                } catch (err) {
                    await sendTelegramMessage(chatId, `Ralat pemprosesan foto: ${err.message}`, msgId);
                } finally {
                    if (rawHeicPath && fs.existsSync(rawHeicPath)) { try { fs.unlinkSync(rawHeicPath); } catch {} }
                    if (fs.existsSync(inputPath)) { try { fs.unlinkSync(inputPath); } catch {} }
                    if (fs.existsSync(outputPath)) { try { fs.unlinkSync(outputPath); } catch {} }
                    if (global.gc) { try { global.gc(); } catch {} }
                }
            }
        });
        if (!enqueueResult.success) {
            await sendTelegramMessage(chatId, enqueueResult.reason === 'full' ? `Giliran penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}). Cuba lagi sebentar.` : `Media anda masih diproses dalam giliran.`, msgId);
        }
        return;
    }

    if (isTgVideo) {
        const fileObj = vid || doc;
        if (fileObj.file_size && fileObj.file_size > MAX_TG_BYTES) {
            await sendTelegramMessage(chatId,
                `Maaf, saiz video (${(fileObj.file_size / (1024 * 1024)).toFixed(1)} MB) melebihi had 20 MB Telegram Bot API.\n\nUntuk video bersaiz besar sehingga 100MB, anda boleh hantar melalui WhatsApp bot menggunakan akaun yang dipautkan (/link).`,
                msgId
            );
            return;
        }
        const videoInputExt = VIDEO_EXTS.has(docExt) ? docExt : '.mp4';
        const targetMode = effectiveMode === 'TT' ? 'TT' : 'WA';
        const enqueueResult = videoQueue.enqueue({
            userId: tgKey,
            priority: isSuperAdmin,
            run: async () => {
                const fileId = `tg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                const inputPath = path.join(TEMP_DIR, `input_${fileId}${videoInputExt}`);
                const outputPath = path.join(TEMP_DIR, targetMode === 'TT' ? `TikTok_HD_${fileId}.mp4` : `status_clear_60fps_${fileId}.mp4`);
                try {
                    await downloadTelegramFile(fileObj.file_id, MAX_TG_BYTES, inputPath);
                    const { duration: durationSec, fps: sourceFps, isHDR } = await probeVideo(inputPath, ffprobePath);
                    if (targetMode === 'TT') {
                        await transcodeTikTokVideo(inputPath, outputPath, ffmpegPath, sourceFps, isHDR, isSuperAdmin ? 0 : 90);
                        await sendTelegramMedia(chatId, 'document', outputPath, null, msgId);
                        await sendTelegramMessage(chatId,
                            'Video TikTok 1080p 60fps HD siap diproses. Simpan fail di atas ke Gallery dan pastikan tetapan Allow high-quality uploads diaktifkan sebelum post di TikTok.',
                            msgId
                        );
                    } else {
                        if (!isSuperAdmin && durationSec > 180) {
                            await sendTelegramMessage(chatId,
                                `HAD DURASI WHATSAPP STATUS HD (MAKS 180 SAAT)\n\nDurasi video anda ialah ${Math.round(durationSec)} saat. Mod WhatsApp Status HD menyokong video sehingga 180 saat (3 minit) dengan pemecahan automatik 60 saat.`,
                                msgId
                            );
                            return;
                        }
                        const totalParts = durationSec <= 60 ? 1 : Math.ceil(durationSec / 60);
                        for (let partIdx = 0; partIdx < totalParts; partIdx++) {
                            const startSec = partIdx * 60;
                            const clipDuration = Math.min(60, Math.max(1, durationSec - startSec));
                            const targetVideoKbps = computeWaTargetBitrate(clipDuration);
                            const partFileName = totalParts === 1 ? 'Status_HD.mp4' : `Status_HD_Part${partIdx + 1}.mp4`;
                            const partOutputPath = path.join(TEMP_DIR, `${fileId}_${partFileName}`);
                            try {
                                await transcode60fpsVideo(inputPath, partOutputPath, ffmpegPath, targetVideoKbps, sourceFps, isHDR, startSec, clipDuration);
                                const targetShortSide = targetVideoKbps >= 4600 ? 1080 : 720;
                                const tgWaCaption = totalParts === 1
                                    ? `✓ VIDEO WHATSAPP STATUS HD SIAP\nSimpan file ini terus ke galeri dan muat naik ke WhatsApp Status tanpa trim/edit.\n• Profil: ${targetShortSide}p | ${sourceFps >= 48 ? '60fps' : sourceFps.toFixed(1) + 'fps'} | ${targetVideoKbps} kbps (15.2MB Cap) | Audio 96k`
                                    : `✓ VIDEO WHATSAPP STATUS HD — Bahagian ${partIdx + 1}/${totalParts}\nSimpan file ini dan muat naik mengikut turutan ke WhatsApp Status.\n• Profil: ${targetShortSide}p | ${targetVideoKbps} kbps (15.2MB Cap)`;
                                await sendTelegramMedia(chatId, 'document', partOutputPath, tgWaCaption, msgId);
                            } finally {
                                if (fs.existsSync(partOutputPath)) { try { fs.unlinkSync(partOutputPath); } catch {} }
                            }
                        }
                    }
                } catch (err) {
                    await sendTelegramMessage(chatId, `Ralat pemprosesan video: ${err.message}`, msgId);
                } finally {
                    if (fs.existsSync(inputPath)) { try { fs.unlinkSync(inputPath); } catch {} }
                    if (fs.existsSync(outputPath)) { try { fs.unlinkSync(outputPath); } catch {} }
                    if (global.gc) { try { global.gc(); } catch {} }
                }
            }
        });
        if (!enqueueResult.success) {
            await sendTelegramMessage(chatId, enqueueResult.reason === 'full' ? `Giliran penuh (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}). Cuba lagi sebentar.` : `Media anda masih diproses dalam giliran.`, msgId);
        }
    }
}

async function startTelegramBot() {
    if (!TELEGRAM_BOT_TOKEN) return;
    console.log('[TELEGRAM BOT] Memulakan long-polling Telegram Bot API...');
    let offset = 0;
    while (true) {
        try {
            const updates = await tgApi('getUpdates', {
                offset,
                timeout: 25,
                allowed_updates: ['message']
            });
            if (Array.isArray(updates)) {
                for (const upd of updates) {
                    offset = upd.update_id + 1;
                    if (upd.message) {
                        handleTelegramMessage(upd.message).catch(err => {
                            console.error('[TELEGRAM] Ralat pengendalian mesej:', err.message);
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[TELEGRAM] Ralat getUpdates:', err.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

migrateNamesAndFinancialsOnStartup();
startBot();
if (TELEGRAM_BOT_TOKEN) {
    startTelegramBot();
}