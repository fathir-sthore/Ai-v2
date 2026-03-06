/**
 * FADAX DRAK AI — Netlify Function: Chat
 * Handles: POST /api/chat          → kirim pesan ke AI
 *          GET  /api/chat/history  → ambil riwayat chat
 *          DELETE /api/chat/history → hapus riwayat
 *
 * Env vars needed (set di Netlify Dashboard):
 *   OPENAI_API_KEY, MONGODB_URI, JWT_SECRET
 *
 * ★ OPENAI_API_KEY tidak pernah dikirim ke browser
 */

const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');

// ── DB Connection (reuse di serverless warm start) ──
let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.DB_NAME || 'fadax_ai',
        serverSelectionTimeoutMS: 8000,
    });
    isConnected = true;
}

// ── Chat Model ──
let Chat;
if (mongoose.models.Chat) {
    Chat = mongoose.model('Chat');
} else {
    const chatSchema = new mongoose.Schema({
        userId:      { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        title:       { type: String, default: 'New Chat', maxlength: 100 },
        model:       { type: String, default: 'gpt-4o-mini' },
        messages:    [{
            role:    { type: String, enum: ['user', 'assistant'], required: true },
            content: { type: String, required: true, maxlength: 12000 },
            ts:      { type: Date, default: Date.now },
        }],
        totalTokens: { type: Number, default: 0 },
    }, { timestamps: true });

    Chat = mongoose.model('Chat', chatSchema);
}

// ── Helpers ──
function verifyToken(event) {
    const header = event.headers['authorization'] || event.headers['Authorization'];
    if (!header?.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
        return null;
    }
}

function res(statusCode, body, extra = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS?.split(',')[0] || '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            ...extra,
        },
        body: JSON.stringify(body),
    };
}

// ── System prompt kagui AI ──
const SYSTEM_PROMPT = `Kamu adalah kagui, AI asisten cerdas yang dikembangkan oleh Selvi Time Daxyinz dalam platform FADAX DRAK AI.
Panduan: Bicara bahasa Indonesia kecuali user pakai bahasa lain. Ahli di coding, teknologi, keamanan siber, dan topik umum. Jawab langsung dan tepat. Gunakan markdown untuk kode dan daftar. Jujur jika tidak tahu.`;

// ── Allowed OpenAI models ──
const ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];

// ── Main Handler ──
exports.handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') return res(200, {});

    // Verifikasi JWT untuk semua route
    const decoded = verifyToken(event);
    if (!decoded) return res(401, { message: 'Akses ditolak. Silahkan login.' });

    const userId = decoded.userId;

    // Pisahkan path setelah nama function
    // event.path: /.netlify/functions/chat  atau  /.netlify/functions/chat/history
    const basePath = event.path.replace('/.netlify/functions/chat', '') || '/';
    const method   = event.httpMethod;

    // ────────────────────────────────────────────
    //  POST /api/chat  →  kirim pesan ke OpenAI
    // ────────────────────────────────────────────
    if (method === 'POST' && (basePath === '/' || basePath === '')) {
        try {
            const { message, history = [], model, chatId } = JSON.parse(event.body || '{}');

            if (!message?.trim())
                return res(400, { message: 'Pesan tidak boleh kosong.' });

            const useModel = ALLOWED_MODELS.includes(model)
                ? model
                : (process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini');

            // Susun messages untuk OpenAI
            const apiMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history.slice(-30).map(m => ({
                    role:    m.role === 'user' ? 'user' : 'assistant',
                    content: String(m.content).slice(0, 8000),
                })),
                { role: 'user', content: message.trim() },
            ];

            // ── PANGGIL OPENAI ──
            // API key HANYA ada di server (Netlify env var), tidak pernah ke browser
            const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model:       useModel,
                    messages:    apiMessages,
                    max_tokens:  parseInt(process.env.OPENAI_MAX_TOKENS)    || 1500,
                    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
                }),
            });

            if (!oRes.ok) {
                const oErr = await oRes.json().catch(() => ({}));
                console.error('OpenAI error:', oRes.status, oErr?.error?.message);
                if (oRes.status === 401) return res(502, { message: 'OpenAI API key tidak valid. Hubungi admin.' });
                if (oRes.status === 429) return res(429, { message: 'AI sedang sibuk. Coba lagi sebentar.' });
                if (oRes.status === 402) return res(502, { message: 'Quota OpenAI habis. Hubungi admin.' });
                return res(502, { message: 'AI service error. Coba lagi.' });
            }

            const oData  = await oRes.json();
            const reply  = oData?.choices?.[0]?.message?.content;
            const tokens = oData?.usage?.total_tokens || 0;

            if (!reply) return res(502, { message: 'Respons kosong dari AI.' });

            // ── SIMPAN KE MONGODB ──
            let activeChatId = chatId;
            try {
                await connectDB();
                if (activeChatId && mongoose.Types.ObjectId.isValid(activeChatId)) {
                    await Chat.updateOne(
                        { _id: activeChatId, userId },
                        {
                            $push: { messages: { $each: [
                                { role: 'user',      content: message.trim() },
                                { role: 'assistant', content: reply },
                            ]}},
                            $inc: { totalTokens: tokens },
                        }
                    );
                } else {
                    const newChat = await Chat.create({
                        userId,
                        title:       message.trim().slice(0, 60) + (message.length > 60 ? '…' : ''),
                        model:       useModel,
                        messages:    [
                            { role: 'user',      content: message.trim() },
                            { role: 'assistant', content: reply },
                        ],
                        totalTokens: tokens,
                    });
                    activeChatId = newChat._id;
                }
            } catch (dbErr) {
                console.error('DB save error:', dbErr.message);
                // Tetap kirim reply meskipun DB error
            }

            return res(200, { reply, chatId: activeChatId, tokens });

        } catch (err) {
            console.error('Chat error:', err.message);
            return res(500, { message: 'Server error. Coba lagi.' });
        }
    }

    // ────────────────────────────────────────────
    //  GET /api/chat/history  →  daftar riwayat
    // ────────────────────────────────────────────
    if (method === 'GET' && basePath === '/history') {
        try {
            await connectDB();
            const page  = Math.max(1, parseInt(event.queryStringParameters?.page)  || 1);
            const limit = Math.min(50, parseInt(event.queryStringParameters?.limit) || 20);

            const [chats, total] = await Promise.all([
                Chat.find({ userId })
                    .select('title model totalTokens createdAt updatedAt')
                    .sort({ updatedAt: -1 })
                    .skip((page - 1) * limit)
                    .limit(limit),
                Chat.countDocuments({ userId }),
            ]);

            return res(200, { chats, total, page, limit });

        } catch (err) {
            return res(500, { message: 'Gagal mengambil riwayat.' });
        }
    }

    // ────────────────────────────────────────────
    //  GET /api/chat/history/:id  →  detail sesi
    // ────────────────────────────────────────────
    if (method === 'GET' && basePath.startsWith('/history/')) {
        try {
            const id = basePath.replace('/history/', '');
            if (!mongoose.Types.ObjectId.isValid(id))
                return res(400, { message: 'ID tidak valid.' });

            await connectDB();
            const chat = await Chat.findOne({ _id: id, userId });
            if (!chat) return res(404, { message: 'Chat tidak ditemukan.' });

            return res(200, { chat });

        } catch (err) {
            return res(500, { message: 'Gagal mengambil chat.' });
        }
    }

    // ────────────────────────────────────────────
    //  DELETE /api/chat/history  →  hapus semua
    // ────────────────────────────────────────────
    if (method === 'DELETE' && basePath === '/history') {
        try {
            await connectDB();
            const result = await Chat.deleteMany({ userId });
            return res(200, { message: `${result.deletedCount} chat dihapus.` });
        } catch (err) {
            return res(500, { message: 'Gagal menghapus riwayat.' });
        }
    }

    // ────────────────────────────────────────────
    //  DELETE /api/chat/history/:id  →  hapus satu
    // ────────────────────────────────────────────
    if (method === 'DELETE' && basePath.startsWith('/history/')) {
        try {
            const id = basePath.replace('/history/', '');
            if (!mongoose.Types.ObjectId.isValid(id))
                return res(400, { message: 'ID tidak valid.' });

            await connectDB();
            await Chat.deleteOne({ _id: id, userId });
            return res(200, { message: 'Chat dihapus.' });

        } catch (err) {
            return res(500, { message: 'Gagal menghapus chat.' });
        }
    }

    return res(404, { message: 'Route tidak ditemukan.' });
};
