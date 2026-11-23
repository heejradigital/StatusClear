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

const ADMIN_IDENTIFIERS = [
    '60194066718',
    '0194066718',
    '194066718',
    '68225740046362'
];

const TEMP_DIR = path.join(__dirname, 'temp');
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info');
// Simpan fail ahli terus di dalam Volume Simpanan Kekal (AUTH_DIR)
const MEMBERS_FILE = path.join(AUTH_DIR, 'members.json');
const LEGACY_MEMBERS_FILE = path.join(__dirname, 'members.json');

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

// Migrasi Automatik: Pastikan data ahli dipindahkan ke Volume Kekal jika belum wujud
function ensureMembersPersistence() {
    try {
        if (!fs.existsSync(MEMBERS_FILE)) {
            if (fs.existsSync(LEGACY_MEMBERS_FILE)) {
                const legacyData = fs.readFileSync(LEGACY_MEMBERS_FILE, 'utf8');
                fs.writeFileSync(MEMBERS_FILE, legacyData);
                console.log('[Kekal Ahli] Senarai ahli sedia ada berjaya dipindahkan ke Volume Kekal.');
            } else {
                fs.writeFileSync(MEMBERS_FILE, JSON.stringify({}, null, 2));
            }
        }
    } catch (err) {
        console.error('Ralat inisialisasi fail ahli di volume:', err);
    }
}
ensureMembersPersistence();

function loadMembers() {
    try {
        if (!fs.existsSync(MEMBERS_FILE)) {
            ensureMembersPersistence();
        }
        return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveMembers(data) {
    try {
        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
        fs.writeFileSync(MEMBERS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Ralat simpan ahli ke volume:', err);
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

async function checkAccess(sock, msg) {
    const remoteJid = msg.key.remoteJid || '';
    const fromMe = msg.key.fromMe;

    const isOwner = fromMe || ADMIN_IDENTIFIERS.some(id => remoteJid.includes(id));
    if (isOwner) {
        return { authorized: true, isAdmin: true, daysLeft: Infinity };
    }

    const members = loadMembers();
    const cleanJid = remoteJid.replace(/@.*$/, '');
    const now = Date.now();

    for (const [key, data] of Object.entries(members)) {
        if (remoteJid.includes(key) || cleanJid === key) {
            if (data.expiresTimestamp > now) {
                const daysLeft = Math.ceil((data.expiresTimestamp - now) / (1000 * 60 * 60 * 24));
                return { authorized: true, isAdmin: false, daysLeft, data };
            } else {
                return { authorized: false, isExpired: true, data };
            }
        }
    }

    const altJid = msg.key.remoteJidAlt || msg.key.participantAlt || '';
    const cleanAlt = altJid.replace(/@.*$/, '').replace(/:.*$/, '');
    if (cleanAlt) {
        for (const [key, data] of Object.entries(members)) {
            if (cleanAlt === key || altJid.includes(key)) {
                if (!members[cleanJid]) {
                    members[cleanJid] = { ...data, linkedTo: key };
                    saveMembers(members);
                }
                if (data.expiresTimestamp > now) {
                    const daysLeft = Math.ceil((data.expiresTimestamp - now) / (1000 * 60 * 60 * 24));
                    return { authorized: true, isAdmin: false, daysLeft, data };
                } else {
                    return { authorized: false, isExpired: true, data };
                }
            }
        }
    }

    return { authorized: false, notRegistered: true };
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

// Semakan Sokongan Penapis zscale & cas FFmpeg
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

/**
 * Pengekstrakan Durasi, Kadar Bingkai (FPS), dan Metadata Warna Sumber menggunakan ffprobe
 */
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

                    // Semakan Metadata Warna HDR (Dolby Vision, HLG, HDR10+)
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

/**
 * Enjin Transcode Video Anti-Glitch (Zero B-Frame & Exact PTS Timing) dengan Pemetaan Tona HDR-ke-SDR
 */
function transcode60fpsVideo(inputPath, outputPath, binPath, vBitrate, targetShortSide, sourceFps, isHDR) {
    return new Promise((resolve, reject) => {
        const isHighFps = sourceFps >= 48;
        const maxRate = Math.floor(vBitrate * 1.25);
        const bufSize = Math.floor(vBitrate * 2.5);

        // Skala Lanczos Pintar Mengikut Orientasi (Portrait 9:16 vs Landscape 16:9)
        const scaleFilter = `scale='if(gt(iw,ih),-2,min(${targetShortSide},iw))':'if(gt(iw,ih),min(${targetShortSide},ih),-2)':flags=lanczos`;

        // 1. Pemetaan Tona Warna HDR-ke-SDR (Hable Tone Mapping)
        let colorFilter = '';
        if (isHDR) {
            const hasZscale = checkZscaleSupport(binPath);
            if (hasZscale) {
                colorFilter = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
            } else {
                colorFilter = 'eq=contrast=1.08:saturation=1.18,format=yuv420p';
            }
        }

        // 2. Gabungkan Rangkaian Penapis Video (Tone Map -> Scale -> Exact PTS)
        const filterParts = [];
        if (colorFilter) filterParts.push(colorFilter);
        filterParts.push(scaleFilter);
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
            '-bf', '0',
            '-refs', '3',
            '-rc-lookahead', '25',
            '-vf', vfFilter,
            '-b:v', `${vBitrate}k`,
            '-maxrate', `${maxRate}k`,
            '-bufsize', `${bufSize}k`,
            '-g', '60',
            '-keyint_min', '60',
            '-sc_threshold', '0',
            '-x264-params', 'deblock=-1:-1:aq-mode=2:aq-strength=1.0',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-c:a', 'aac',
            '-b:a', '128k',
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

/**
 * Enjin Pemprosesan Imej QHD+ 2560px Anti-Compression WhatsApp Status (CAS Sharpening)
 */
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

    // Percubaan pertama: Kualiti optimum -q:v 2
    await executeEncode(2);

    let stats = fs.statSync(outputPath);
    const MAX_SAFE_BYTES = 1.85 * 1024 * 1024; // Siling selamat 1.85 MB WhatsApp
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
            console.log(`Pentadbir Sistem: 0194066718`);
            console.log(`Enjin Video: Fluid Zero-B-Frame 60 FPS Anti-Glitch (Pengekalan Warna HDR/SDR)`);
            console.log(`Enjin Foto: 2560px QHD+ CAS Sharpening (Anti-Compression Safe)`);
            console.log(`Kapasiti Antrian: Maksimum ${MAX_QUEUE_SIZE} Media`);
            console.log(`Pangkalan Data Ahli: Kekal di dalam Volume (${MEMBERS_FILE})`);
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

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg || !msg.message) continue;

            const remoteJid = msg.key.remoteJid || '';

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

            const access = await checkAccess(sock, msg);
            const textContent = (inner.conversation || inner.extendedTextMessage?.text || '').trim();
            const textParts = textContent.split(/\s+/);
            const command = textParts[0].toLowerCase();

            // 1. PENGENDALIAN ARAHAN TEKS
            if (textContent) {
                console.log(`[Mesej Masuk] ${remoteJid}: "${textContent}"`);

                if (['bantuan', 'help', 'menu'].includes(command)) {
                    if (access.isAdmin) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `PANDUAN PERINTAH PENTADBIR (${BOT_NAME})\n\n` +
                                `1. daftar <nombor biasa> [nama]\n` +
                                `   Mendaftarkan ahli baharu selama 30 hari.\n` +
                                `   Contoh: daftar 01113270914 fieyanina\n\n` +
                                `2. padam <nombor/ID>\n` +
                                `   Membatalkan akses ahli daripada pangkalan data.\n\n` +
                                `3. senarai\n` +
                                `   Memaparkan senarai semua ahli aktif dan baki tempoh.\n\n` +
                                `4. semak <nombor/ID>\n` +
                                `   Menyemak status langganan sesuatu akaun.\n\n` +
                                `5. ram\n` +
                                `   Menyemak status memori pelayan dan statistik antrian.`
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `PANDUAN PENGGUNA (${BOT_NAME})\n\n` +
                                `1. Pengoptimuman Video:\n` +
                                `   Sila hantar video anda sebagai fail Dokumen (Lampirkan > Dokumen > Galeri) bagi mengekalkan kualiti 60 FPS tanpa mampatan.\n\n` +
                                `2. Pengoptimuman Foto (QHD+):\n` +
                                `   Hantar foto (biasa atau dokumen) untuk diproses ke resolusi 2560px QHD+ dengan teknologi ketajaman CAS.\n\n` +
                                `3. Semakan Langganan:\n` +
                                `   Taip "status" untuk melihat baki tempoh keahlian anda.\n\n` +
                                `Perkhidmatan ini dikhaskan untuk ahli yang berdaftar sahaja.`
                        }, { quoted: msg });
                    }
                    continue;
                }

                if (command === 'daftar' && access.isAdmin) {
                    const rawTarget = textParts[1];
                    const memberName = textParts.slice(2).join(' ') || 'Ahli';

                    if (!rawTarget) {
                        await sock.sendMessage(remoteJid, {
                            text: "Format tidak sah. Sila gunakan format: daftar <nombor> [nama]\nContoh: daftar 01113270914 fieyanina"
                        }, { quoted: msg });
                        continue;
                    }

                    const target = normalizeIdentifier(rawTarget);
                    const members = loadMembers();
                    const now = Date.now();
                    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

                    let baseTime = now;
                    if (members[target] && members[target].expiresTimestamp > now) {
                        baseTime = members[target].expiresTimestamp;
                    }

                    const newExpiresTimestamp = baseTime + THIRTY_DAYS;
                    const expiryDateStr = new Date(newExpiresTimestamp).toLocaleDateString('ms-MY', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                    });

                    const memberData = {
                        name: memberName,
                        target: target,
                        registeredAt: new Date(now).toISOString(),
                        expiresTimestamp: newExpiresTimestamp,
                        expiresDateStr: expiryDateStr
                    };

                    members[target] = memberData;

                    try {
                        const checkJid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
                        const [waUser] = await sock.onWhatsApp(checkJid);
                        if (waUser && waUser.lid) {
                            const cleanLid = waUser.lid.replace(/@.*$/, '');
                            members[cleanLid] = { ...memberData, linkedTo: target, lid: cleanLid };
                            console.log(`[Auto-LID Sync] ${target} -> ${cleanLid}`);
                        }
                    } catch (err) {}

                    saveMembers(members);

                    const days = Math.ceil((newExpiresTimestamp - now) / (1000 * 60 * 60 * 24));

                    await sock.sendMessage(remoteJid, {
                        text:
                            `PENDAFTARAN AHLI BERJAYA\n\n` +
                            `Nama: ${memberName}\n` +
                            `Nombor Telefon: ${target}\n` +
                            `Tempoh Diluluskan: 30 Hari (Baki: ${days} hari)\n` +
                            `Tarikh Tamat: ${expiryDateStr}\n` +
                            `Status: Aktif & Disimpan Kekal`
                    }, { quoted: msg });
                    continue;
                }

                if (['senarai', 'ahli'].includes(command) && access.isAdmin) {
                    const members = loadMembers();
                    const uniqueMembers = {};

                    for (const [key, data] of Object.entries(members)) {
                        const primaryKey = data.linkedTo || data.target || key;
                        uniqueMembers[primaryKey] = data;
                    }

                    const keys = Object.keys(uniqueMembers);
                    if (keys.length === 0) {
                        await sock.sendMessage(remoteJid, {
                            text: "Tiada ahli berdaftar di dalam pangkalan data pada masa ini."
                        }, { quoted: msg });
                        continue;
                    }

                    const now = Date.now();
                    let response = `SENARAI KEAHLIAN BERDAFTAR (${keys.length} Orang)\n\n`;

                    keys.forEach((key, index) => {
                        const m = uniqueMembers[key];
                        const isActive = m.expiresTimestamp > now;
                        const daysLeft = isActive ? Math.ceil((m.expiresTimestamp - now) / (1000 * 60 * 60 * 24)) : 0;
                        const statusStr = isActive ? `Aktif (${daysLeft} hari lagi)` : `Tamat Tempoh`;

                        response += `${index + 1}. ${m.name} (${key})\n   Status: ${statusStr}\n   Luput: ${m.expiresDateStr}\n\n`;
                    });

                    await sock.sendMessage(remoteJid, { text: response.trim() }, { quoted: msg });
                    continue;
                }

                if (['padam', 'buang'].includes(command) && access.isAdmin) {
                    const target = normalizeIdentifier(textParts[1]);
                    const members = loadMembers();

                    let found = false;
                    for (const key of Object.keys(members)) {
                        if (key === target || members[key]?.target === target || members[key]?.linkedTo === target) {
                            delete members[key];
                            found = true;
                        }
                    }

                    if (!found) {
                        await sock.sendMessage(remoteJid, {
                            text: `Akaun ${target || 'tersebut'} tidak ditemui di dalam senarai ahli.`
                        }, { quoted: msg });
                        continue;
                    }

                    saveMembers(members);

                    await sock.sendMessage(remoteJid, {
                        text: `PENGESAHAN: Akses keahlian bagi nombor ${target} telah dibatalkan serta-merta.`
                    }, { quoted: msg });
                    continue;
                }

                if (['status', 'baki', 'langganan'].includes(command)) {
                    if (access.isAdmin) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `STATUS AKAUN PENTADBIR\n\n` +
                                `Akaun: Pentadbir Utama (Danial)\n` +
                                `Akses: Tanpa Had (Penuh)\n` +
                                `Pelayan: Aktif`
                        }, { quoted: msg });
                    } else if (access.authorized) {
                        await sock.sendMessage(remoteJid, {
                            text:
                                `STATUS KEAHLIAN ANDA\n\n` +
                                `Nama: ${access.data.name}\n` +
                                `Status: Aktif\n` +
                                `Baki Tempoh: ${access.daysLeft} hari\n` +
                                `Tarikh Luput: ${access.data.expiresDateStr}\n\n` +
                                `Sila hubungi pentadbir sekiranya anda ingin memperbaharui langganan.`
                        }, { quoted: msg });
                    } else {
                        const cleanSender = remoteJid.replace(/@.*$/, '');
                        await sock.sendMessage(remoteJid, {
                            text:
                                `STATUS: TIADA LANGGANAN AKTIF\n\n` +
                                `Akaun anda belum berdaftar sebagai ahli aktif ${BOT_NAME}.\n\n` +
                                `Sila hubungi pentadbir di talian 019-4066718 untuk urusan pendaftaran keahlian bulanan.`
                        }, { quoted: msg });
                    }
                    continue;
                }

                if (['ram', 'memori'].includes(command)) {
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

                if (access.authorized) {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `Selamat kembali ke ${BOT_NAME}.\n\n` +
                            `Sila hantar foto atau lampirkan video sebagai Dokumen untuk memulakan pengoptimuman ultra-kualiti WhatsApp Status.\n\n` +
                            `Taip "bantuan" untuk melihat panduan arahan.`
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `PEMBERITAHUAN AKSES SISTEM\n\n` +
                            `Akaun anda belum berdaftar sebagai ahli aktif ${BOT_NAME}.\n\n` +
                            `Perkhidmatan ini dikhaskan untuk ahli yang melanggan sahaja. Sila hubungi pentadbir di talian 019-4066718 untuk pendaftaran.`
                    }, { quoted: msg });
                }
                continue;
            }

            // 2. VIDEO BIASA
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

            // 3. PENGESANAN MEDIA (FOTO & DOKUMEN VIDEO/FOTO)
            const isDirectImage = !!inner.imageMessage;
            const docMsg = inner.documentMessage || inner.documentWithCaptionMessage?.message?.documentMessage;
            const docMime = (docMsg?.mimetype || '').toLowerCase();
            const docFileName = (docMsg?.fileName || '').toLowerCase();

            const isDocImage = !!docMsg && (docMime.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff|heic|heif)$/i.test(docFileName));
            const isDocVideo = !!docMsg && (docMime.startsWith('video/') || /\.(mp4|mov|mkv|avi|3gp|webm|m4v)$/i.test(docFileName));

            if (!isDirectImage && !isDocImage && !isDocVideo) {
                continue;
            }

            if (!access.authorized) {
                console.log(`[Akses Ditolak] Penghantaran media oleh bukan ahli: ${remoteJid}`);
                const reason = access.isExpired ? "Tempoh langganan keahlian anda telah tamat." : "Akaun anda belum berdaftar sebagai ahli.";

                await sock.sendMessage(remoteJid, {
                    text:
                        `AKSES PEMPROSESAN DITOLAK\n\n` +
                        `${reason}\n\n` +
                        `Sila hubungi pentadbir di talian 019-4066718 untuk urusan pembaharuan atau pendaftaran langganan bulanan.`
                }, { quoted: msg });
                continue;
            }

            // 4. CABANG A: PEMPROSESAN FOTO QHD+ 2560px DENGAN CAS SHARPENING
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

            // 5. CABANG B: PEMPROSESAN DOKUMEN VIDEO (True CFR 60 FPS Pipeline)
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

                            // Dwi-pengekstrakan Durasi, FPS, dan Metadata Warna Sumber
                            const { duration: durationSec, fps: sourceFps, isHDR } = await probeVideo(inputPath, ffprobePath);

                            // Pengiraan Bitrate Dinamik Siling 60 Saat (Sasaran 14.5MB)
                            const effectiveDuration = Math.min(durationSec, 60);
                            const rawBitrate = Math.floor(((14.5 * 8192) / effectiveDuration) - 128);
                            const vBitrate = Math.max(3200, Math.min(9000, rawBitrate));
                            const targetShortSide = vBitrate >= 4800 ? 1080 : 720;
                            const isTrimmed = durationSec > 60;
                            const isHighFps = sourceFps >= 48;

                            const resLabel = targetShortSide === 1080 ? (isHighFps ? '1080p (60 FPS)' : '1080p (HD)') : (isHighFps ? '720p (60 FPS)' : '720p (HD)');
                            const fpsStatus = isHighFps ? '60.0 FPS Malar (True 60fps Native)' : `${sourceFps.toFixed(1)} FPS Malar (True Native CFR)`;

                            console.log(`[FFmpeg Transcode] ${resLabel} @ ${vBitrate} kbps | Sumber: ${sourceFps.toFixed(1)} FPS (${isHDR ? 'HDR Tone-Mapped' : 'SDR Asal'}) | Mod: ${isHighFps ? 'True 60fps Native' : 'Native CFR'} | Durasi: ${durationSec.toFixed(1)}s`);
                            await transcode60fpsVideo(inputPath, outputPath, ffmpegPath, vBitrate, targetShortSide, sourceFps, isHDR);

                            // 1. Hantar fail video bersih tanpa teks
                            await sock.sendMessage(remoteJid, {
                                video: { stream: fs.createReadStream(outputPath) },
                                mimetype: 'video/mp4'
                            }, { quoted: msg });

                            try {
                                await sock.sendMessage(remoteJid, {
                                    react: { text: '✅', key: msg.key }
                                });
                            } catch {}

                            // 2. Hantar mesej laporan teknikal secara berasingan
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
                                    `• Bitrate: ${vBitrate} kbps (Sasaran ~14.5 MB)\n` +
                                    `• Profil Warna: ${colorNote}${trimNote}`
                            });

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
                            text: `PERINGATAN: Anda sudah mempunyai satu video yang sedang menunggu atau diproses dalam antrian. Sila tunggu video semasa selesai sebelum menghantar video baharu.`
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