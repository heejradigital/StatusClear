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

// Pengenalan Pentadbir Rasmi (Danial)
const ADMIN_IDENTIFIERS = [
    '60194066718',
    '0194066718',
    '194066718',
    '68225740046362'
];

const TEMP_DIR = path.join(__dirname, 'temp');
const AUTH_DIR = path.join(__dirname, 'auth_info');
const MEMBERS_FILE = path.join(__dirname, 'members.json');

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

function loadMembers() {
    try {
        if (!fs.existsSync(MEMBERS_FILE)) {
            fs.writeFileSync(MEMBERS_FILE, JSON.stringify({}, null, 2));
            return {};
        }
        return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveMembers(data) {
    try {
        fs.writeFileSync(MEMBERS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Ralat simpan ahli:', err);
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

    // 1. Semakan terus pada JID
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

    // 2. Semakan melalui remoteJidAlt / participantAlt
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
                    console.log(`[Pembersihan Memori GC] RAM aktif selepas transcode: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
                } catch {}
            }

            this.processNext();
        }
    }
}

const videoQueue = new RobustVideoQueue(MAX_QUEUE_SIZE);

function probeDuration(filePath, binPath) {
    return new Promise((resolve) => {
        const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath];
        const proc = spawn(binPath, args);
        let stdout = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0) {
                const duration = parseFloat(stdout.trim());
                if (!isNaN(duration) && duration > 0) return resolve(duration);
            }
            resolve(30.0);
        });
        proc.on('error', () => resolve(30.0));
    });
}

function transcode60fpsVideo(inputPath, outputPath, binPath, vBitrate, scaleWidth) {
    return new Promise((resolve, reject) => {
        const maxRate = Math.round(vBitrate * 1.2);
        const bufSize = Math.round(vBitrate * 2.0);
        const filterString = `fps=60,scale='min(${scaleWidth},iw)':-2:flags=lanczos`;

        const args = [
            '-y',
            '-i', inputPath,
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level:v', '4.2',
            '-preset', 'fast',
            '-tune', 'film',
            '-vf', filterString,
            '-b:v', `${vBitrate}k`,
            '-maxrate', `${maxRate}k`,
            '-bufsize', `${bufSize}k`,
            '-g', '120',
            '-keyint_min', '120',
            '-sc_threshold', '0',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-threads', '2',
            '-movflags', '+faststart',
            outputPath
        ];

        const proc = spawn(binPath, args);
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg error: ${stderr.slice(-300)}`));
        });
        proc.on('error', (err) => reject(new Error(`Ralat pelancaran FFmpeg: ${err.message}`)));
    });
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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
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
            console.log(`Penghantaran Video: Asing Teks & Video (Clean Video File)`);
            console.log('======================================================\n');
        }
    });

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
                const caption = inner.videoMessage?.caption || inner.documentMessage?.caption || '';
                const text = inner.conversation || inner.extendedTextMessage?.text || caption;

                if (
                    text.includes(BOT_NAME) ||
                    text.includes('Sistem pengoptimuman') ||
                    text.includes('AKSES') ||
                    text.includes('PENTADBIR') ||
                    text.includes('PENGOPTIMUMAN VIDEO SELESAI') ||
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

                // Arahan Bantuan
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
                                `   Sila hantar video anda sebagai fail Dokumen (Lampirkan > Dokumen > Pilih dari galeri) bagi mendapatkan kualiti 60 FPS tanpa kehilangan kualiti.\n\n` +
                                `2. Semakan Langganan:\n` +
                                `   Taip "status" untuk melihat baki tempoh keahlian anda.\n\n` +
                                `Perkhidmatan ini dikhaskan untuk ahli yang berdaftar sahaja.`
                        }, { quoted: msg });
                    }
                    continue;
                }

                // Arahan Pentadbir: DAFTAR
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
                            `Status: Aktif & Diselaraskan`
                    }, { quoted: msg });
                    continue;
                }

                // Arahan Pentadbir: SENARAI
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

                // Arahan Pentadbir: PADAM
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

                // Semakan Status Keahlian Sendiri
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
                        await sock.sendMessage(remoteJid, {
                            text:
                                `STATUS: TIADA LANGGANAN AKTIF\n\n` +
                                `Akaun anda belum berdaftar sebagai ahli aktif ${BOT_NAME}.\n\n` +
                                `Sila hubungi pentadbir di talian 019-4066718 untuk urusan pendaftaran keahlian bulanan.`
                        }, { quoted: msg });
                    }
                    continue;
                }

                // Semakan RAM & Prestasi Pelayan
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
                            `• Sedang Diproses: ${videoQueue.activeJob ? '1 Video' : 'Tiada'}\n` +
                            `• Menunggu Dalam Antrian: ${videoQueue.waitingLength} / ${MAX_QUEUE_SIZE} Video\n\n` +
                            `Masa Operasi Pelayan: ${hours} jam ${minutes} minit`
                    }, { quoted: msg });
                    continue;
                }

                // Balasan Mesej Teks Am
                if (access.authorized) {
                    await sock.sendMessage(remoteJid, {
                        text:
                            `Selamat kembali ke ${BOT_NAME}.\n\n` +
                            `Sila lampirkan video anda sebagai Dokumen (Lampiran > Dokumen > Pilih dari galeri) untuk memulakan pemprosesan 60 FPS.\n\n` +
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

            // 2. VIDEO BIASA (Bukan Dokumen)
            if (inner.videoMessage) {
                await sock.sendMessage(remoteJid, {
                    text:
                        `PERINGATAN FORMAT PENGHANTARAN\n\n` +
                        `Fail video dikesan dihantar melalui mod biasa. Aplikasi WhatsApp akan memampatkan kualiti video biasa secara drastik sebelum penghantaran.\n\n` +
                        `Sila hantar semula sebagai Dokumen:\n` +
                        `1. Tekan ikon Lampiran (+ atau klip kertas)\n` +
                        `2. Pilih Dokumen > Pilih daripada galeri\n` +
                        `3. Hantar video anda sebagai fail dokumen.`
                }, { quoted: msg });
                continue;
            }

            // 3. PEMPROSESAN DOKUMEN VIDEO (Asingkan Fail Video & Teks)
            const docMsg = inner.documentMessage || inner.documentWithCaptionMessage?.message?.documentMessage;
            if (!docMsg) continue;

            const mime = (docMsg.mimetype || '').toLowerCase();
            const fileName = (docMsg.fileName || '').toLowerCase();
            const isVideo = mime.startsWith('video/') || /\.(mp4|mov|mkv|avi|3gp|webm|m4v)$/i.test(fileName);

            if (!isVideo) continue;

            const fileLength = Number(docMsg.fileLength || 0);
            const sizeMB = (fileLength / (1024 * 1024)).toFixed(1);

            // Kawalan Akses
            if (!access.authorized) {
                console.log(`[Akses Ditolak] Penghantaran video oleh bukan ahli: ${remoteJid}`);
                const reason = access.isExpired ? "Tempoh langganan keahlian anda telah tamat." : "Akaun anda belum berdaftar sebagai ahli.";

                await sock.sendMessage(remoteJid, {
                    text:
                        `AKSES PEMPROSESAN DITOLAK\n\n` +
                        `${reason}\n\n` +
                        `Sila hubungi pentadbir di talian 019-4066718 untuk urusan pembaharuan atau pendaftaran langganan bulanan.`
                }, { quoted: msg });
                continue;
            }

            // Masukkan metadata ringan ke dalam antrian pintar
            const enqueueResult = videoQueue.enqueue({
                userId: remoteJid,
                run: async () => {
                    const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                    const inputPath = path.join(TEMP_DIR, `input_${fileId}.mp4`);
                    const outputPath = path.join(TEMP_DIR, `status_clear_60fps_${fileId}.mp4`);

                    try {
                        console.log(`\n[Pemprosesan Bermula] Memuat turun video (${sizeMB} MB) dari ${remoteJid}...`);
                        await sock.sendMessage(remoteJid, {
                            text: `Giliran anda telah tiba. Memuat turun dan memproses video 60 FPS (${sizeMB} MB). Sila tunggu sebentar.`
                        }, { quoted: msg });

                        const mediaStream = await downloadMediaMessage(msg, 'stream', {}, { logger, reuploadRequest: sock.updateMediaMessage });
                        await pipeline(mediaStream, fs.createWriteStream(inputPath));

                        const durationSec = await probeDuration(inputPath, ffprobePath);

                        const rawBitrate = Math.floor(((13.5 * 8192) / durationSec) - 128);
                        const vBitrate = Math.max(2500, Math.min(8500, rawBitrate));
                        const scaleWidth = vBitrate >= 4500 ? 1080 : 720;
                        const resLabel = scaleWidth === 1080 ? '1080p (60 FPS)' : '720p (60 FPS)';

                        console.log(`[FFmpeg Transcode] ${resLabel} @ ${vBitrate} kbps | Durasi: ${durationSec.toFixed(1)}s`);
                        await transcode60fpsVideo(inputPath, outputPath, ffmpegPath, vBitrate, scaleWidth);

                        // 1. HANTAR FAIL VIDEO BERSIH (TANPA KAPSYEN TEKS)
                        await sock.sendMessage(remoteJid, {
                            video: { stream: fs.createReadStream(outputPath) },
                            mimetype: 'video/mp4'
                        }, { quoted: msg });

                        // 2. HANTAR MAKLUMAT & SPESIFIKASI SECARA BERASINGAN
                        await sock.sendMessage(remoteJid, {
                            text:
                                `PENGOPTIMUMAN VIDEO SELESAI\n\n` +
                                `Sila majukan (forward) video di atas terus ke Status WhatsApp anda tanpa melakukan sebarang suntingan atau pemotongan (trim) bagi mengekalkan resolusi 60 FPS.\n\n` +
                                `Spesifikasi Output:\n` +
                                `• Format: ${resLabel}\n` +
                                `• Bitrate: ${vBitrate} kbps\n` +
                                `• Profil Warna: BT.709 Standard`
                        });

                        console.log(`[Selesai] Video 60 FPS & teks berasingan berjaya dihantar ke ${remoteJid}.`);

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

            // Pengendalian Respon Pemasukan Antrian
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
                if (enqueueResult.position === 1) {
                    await sock.sendMessage(remoteJid, {
                        text: `Video diterima. Pemprosesan video 60 FPS anda bermula sekarang...`
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `Video diterima. Anda berada di giliran ke-${enqueueResult.position} dalam antrian pemprosesan. Sistem akan memaklumkan anda sebaik sahaja pemprosesan bermula.`
                    }, { quoted: msg });
                }
            }
        }
    });
}

startBot();
