/**
 * FADAX DRAK AI — Frontend Chat Logic
 * Developed by Selvi Time Daxyinz
 *
 * Alur:
 * 1. authGuard() → cek JWT di sessionStorage
 * 2. User kirim pesan → callAI() → POST /api/chat (backend)
 * 3. Backend pakai OPENAI_API_KEY dari .env → kirim ke OpenAI
 * 4. Reply balik ke frontend → tampil di UI + simpan ke MongoDB
 */

'use strict';

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CFG = {
    API_CHAT:    '/api/chat',           // route backend server.js
    MAX_RETRIES: 2,
    RETRY_DELAY: 1500,                  // ms antar retry
    MAX_HISTORY: 30,                    // max pesan yang dikirim ke AI
};

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const state = {
    messages:    [],      // { role, content, ts }
    loading:     false,
    tokens:      0,
    model:       'gpt-4o-mini',
    currentUser: null,
    chatId:      null,    // MongoDB chat session ID
};

// ─────────────────────────────────────────────
//  SESSION STORAGE HELPERS
// ─────────────────────────────────────────────
function loadUser()  { try { return JSON.parse(sessionStorage.getItem('_fx_usr')); } catch { return null; } }
function clearUser() { sessionStorage.removeItem('_fx_usr'); }

// ─────────────────────────────────────────────
//  AUTH GUARD
// ─────────────────────────────────────────────
function authGuard() {
    const user = loadUser();
    if (!user?.token) {
        window.location.href = 'login.html';
        return false;
    }
    state.currentUser = user;
    const el = document.getElementById('userNameDisplay');
    if (el) el.textContent = user.username || user.email || 'User';
    return true;
}

// ─────────────────────────────────────────────
//  TOAST NOTIFICATION
// ─────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = 'err', dur = 4000) {
    const el = document.getElementById('toast');
    const m  = document.getElementById('toastMsg');
    if (!el || !m) return;
    clearTimeout(_toastTimer);
    m.textContent  = msg;
    el.className   = `toast show${type === 'ok' ? ' ok' : ''}`;
    _toastTimer    = setTimeout(() => el.classList.remove('show'), dur);
}

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

function updateStats() {
    const sm = $('statMsgs'), st = $('statTokens');
    if (sm) sm.textContent = state.messages.length;
    if (st) st.textContent = state.tokens > 999
        ? (state.tokens / 1000).toFixed(1) + 'k'
        : state.tokens;
}

function setLoading(on) {
    state.loading = on;
    const btn = $('sendBtn'), inp = $('chatInput');
    if (btn) btn.disabled = on;
    if (inp) inp.disabled = on;
}

function scrollBottom() {
    const c = $('messages');
    if (c) requestAnimationFrame(() => c.scrollTop = c.scrollHeight);
}

function hideWelcome() {
    const w = $('welcomeView');
    if (w) w.style.display = 'none';
}

function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────
//  MARKDOWN RENDERER
// ─────────────────────────────────────────────
function escHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderMd(text) {
    let h = escHtml(text);
    // Code block
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const id = 'cb' + Math.random().toString(36).slice(2, 7);
        return `<pre id="${id}"><button class="copy-btn" onclick="copyCode('${id}')">Copy</button><code class="lang-${lang}">${code.trim()}</code></pre>`;
    });
    // Inline code
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Bullet list
    h = h.replace(/^[-*] (.+)$/gm, '• $1');
    // Numbered list
    h = h.replace(/^\d+\. (.+)$/gm, (_, t) => `<span style="margin-left:.5rem">• ${t}</span>`);
    // Newline
    h = h.replace(/\n/g, '<br>');
    return h;
}

window.copyCode = function(preId) {
    const pre = document.getElementById(preId);
    if (!pre) return;
    navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '')
        .then(() => {
            const btn = pre.querySelector('.copy-btn');
            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1800); }
        })
        .catch(() => toast('Gagal menyalin kode'));
};

window.copyMsg = function(btn) {
    const b = btn.closest('.msg-group')?.querySelector('.bubble');
    if (!b) return;
    navigator.clipboard.writeText(b.textContent || '')
        .then(() => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1800); });
};

// ─────────────────────────────────────────────
//  RENDER CHAT BUBBLE
// ─────────────────────────────────────────────
function renderMsg(role, content, ts) {
    hideWelcome();
    const c = $('messages');
    if (!c) return;
    const timestamp = ts || Date.now();
    const isUser    = role === 'user';

    const g = document.createElement('div');
    g.className    = `msg-group ${role}`;
    g.dataset.ts   = timestamp;
    g.innerHTML = `
        <div class="msg-row">
            <div class="m-av">${isUser ? '<i class="fas fa-user"></i>' : ''}</div>
            <div class="bubble">${isUser
                ? `<span>${escHtml(content)}</span>`
                : renderMd(content)
            }</div>
        </div>
        <div class="msg-meta">
            <span>${isUser ? (state.currentUser?.username || 'Kamu') : 'kagui AI'}</span>
            <span>${fmtTime(timestamp)}</span>
            ${!isUser ? `<div class="meta-actions"><button class="meta-act" onclick="copyMsg(this)">Copy</button></div>` : ''}
        </div>`;
    c.appendChild(g);
    scrollBottom();
}

// ─────────────────────────────────────────────
//  TYPING INDICATOR
// ─────────────────────────────────────────────
function showTyping() {
    const c = $('messages');
    if (!c) return;
    const el     = document.createElement('div');
    el.id        = 'typingRow';
    el.className = 'typing-row';
    // Avatar pakai gambar AI (sesuai CSS .m-av assistant)
    el.innerHTML = `
        <div class="m-av" style="width:30px;height:30px;border-radius:50%;
            background:url('https://files.catbox.moe/le2tsc.jpg') center/cover;
            border:1px solid rgba(139,0,0,0.4);flex-shrink:0"></div>
        <div class="typing-bub">
            <div class="t-dot"></div>
            <div class="t-dot"></div>
            <div class="t-dot"></div>
        </div>`;
    c.appendChild(el);
    scrollBottom();
}

function hideTyping() { $('typingRow')?.remove(); }

// ─────────────────────────────────────────────
//  CALL BACKEND → OpenAI (via server.js)
//  Route: POST /api/chat
//  API key OpenAI HANYA ada di server/.env
// ─────────────────────────────────────────────
async function callAI(userMsg) {
    const user = loadUser();
    if (!user?.token) { window.location.href = 'login.html'; return null; }

    const history = state.messages
        .slice(-CFG.MAX_HISTORY)
        .map(m => ({ role: m.role, content: m.content }));

    for (let attempt = 1; attempt <= CFG.MAX_RETRIES + 1; attempt++) {
        try {
            const res = await fetch(CFG.API_CHAT, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${user.token}`,   // JWT token user
                },
                body: JSON.stringify({
                    message: userMsg,
                    history,
                    model:  state.model,
                    chatId: state.chatId || null,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (res.status === 401) {
                    clearUser();
                    toast('Sesi kamu expired. Login kembali...');
                    setTimeout(() => window.location.href = 'login.html', 1200);
                    return null;
                }
                if (res.status === 429) { toast('Rate limit. Tunggu sebentar lalu coba lagi.'); return null; }
                throw new Error(err?.message || `Server error ${res.status}`);
            }

            const data = await res.json();
            if (!data.reply) throw new Error('Respons kosong dari server');

            // Simpan chatId untuk sesi yang sama
            if (data.chatId) state.chatId = data.chatId;
            if (data.tokens) state.tokens += data.tokens;

            return data.reply;

        } catch (err) {
            if (attempt > CFG.MAX_RETRIES) {
                toast(err.message?.includes('fetch')
                    ? 'Koneksi gagal. Periksa internet kamu.'
                    : `Error: ${err.message}`);
                return null;
            }
            // Tunggu lalu retry
            await new Promise(r => setTimeout(r, CFG.RETRY_DELAY * attempt));
        }
    }
    return null;
}

// ─────────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────────
async function sendMessage() {
    const inp  = $('chatInput');
    const text = inp?.value.trim();
    if (!text || state.loading) return;

    const userMsg = { role: 'user', content: text, ts: Date.now() };
    state.messages.push(userMsg);
    inp.value = '';
    inp.style.height = 'auto';

    renderMsg('user', text, userMsg.ts);
    setLoading(true);
    showTyping();
    updateStats();

    const reply = await callAI(text);

    hideTyping();

    if (reply) {
        const aiMsg = { role: 'assistant', content: reply, ts: Date.now() };
        state.messages.push(aiMsg);
        renderMsg('assistant', reply, aiMsg.ts);
        updateHistoryList();
    }

    setLoading(false);
    updateStats();
    inp?.focus();
}

// ─────────────────────────────────────────────
//  HISTORY SIDEBAR (dari state lokal)
// ─────────────────────────────────────────────
function updateHistoryList() {
    const list = $('historyList');
    if (!list) return;
    const msgs = state.messages.filter(m => m.role === 'user').slice(-8).reverse();
    if (!msgs.length) return;
    list.innerHTML = msgs.map(m => `
        <div class="hist-item" title="${escHtml(m.content)}">
            <i class="hist-ico fas fa-comment"></i>
            <span class="hist-txt">${escHtml(m.content.slice(0, 38))}${m.content.length > 38 ? '…' : ''}</span>
        </div>`).join('');
}

// ─────────────────────────────────────────────
//  EXPORT CHAT
// ─────────────────────────────────────────────
function exportChat() {
    if (!state.messages.length) { toast('Tidak ada percakapan untuk diekspor.'); return; }
    const lines = state.messages.map(m =>
        `[${fmtTime(m.ts || Date.now())}] ${m.role === 'user'
            ? (state.currentUser?.username || 'KAMU')
            : 'kagui AI'}:\n${m.content}\n`
    );
    const content = [
        'FADAX DRAK AI — Chat Export',
        new Date().toLocaleString('id-ID'),
        '─'.repeat(40),
        '',
        ...lines,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `fadax-chat-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────
//  CLEAR CHAT
// ─────────────────────────────────────────────
function clearChat() {
    state.messages = [];
    state.tokens   = 0;
    state.chatId   = null;

    const c = $('messages');
    if (c) {
        c.querySelectorAll('.msg-group, .typing-row, .date-sep').forEach(el => el.remove());
        const w = $('welcomeView');
        if (w) w.style.display = '';
    }

    updateStats();

    const hl = $('historyList');
    if (hl) hl.innerHTML = `
        <div class="hist-empty">
            <i class="fas fa-comment-slash" style="font-size:1.3rem;opacity:0.25;display:block;margin-bottom:.5rem"></i>
            Belum ada riwayat
        </div>`;
}

// ─────────────────────────────────────────────
//  AUTO RESIZE TEXTAREA
// ─────────────────────────────────────────────
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
function init() {
    console.log('🚀 FADAX DRAK AI v2.1');

    if (!authGuard()) return;

    // Model selector
    const ms = $('modelSelect');
    if (ms) {
        ms.value = state.model;
        ms.addEventListener('change', () => { state.model = ms.value; });
    }

    // Send button
    $('sendBtn')?.addEventListener('click', sendMessage);

    // Textarea
    const ta = $('chatInput');
    if (ta) {
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        ta.addEventListener('input', function () {
            autoResize(this);
            const cc = $('charCount');
            if (cc) cc.textContent = this.value.length > 0 ? this.value.length : '';
        });
    }

    // Buttons
    $('clearChatBtn')?.addEventListener('click', clearChat);
    $('newChatBtn')?.addEventListener('click',   clearChat);
    $('exportBtn')?.addEventListener('click',    exportChat);
    $('logoutBtn')?.addEventListener('click',    () => { clearUser(); window.location.href = 'login.html'; });

    // Quick prompts
    document.querySelectorAll('.qs-btn, .quick-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            const p = btn.dataset.prompt;
            if (p && ta) { ta.value = p; autoResize(ta); ta.focus(); }
        })
    );

    // Hint pills di welcome screen
    document.querySelectorAll('.hint').forEach(h =>
        h.addEventListener('click', () => {
            const p = h.dataset.prompt;
            if (p && ta) { ta.value = p; autoResize(ta); ta.focus(); }
        })
    );

    // Ctrl+K → fokus input
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'k') { e.preventDefault(); ta?.focus(); }
    });

    // Fokus input setelah load
    setTimeout(() => ta?.focus(), 200);
}

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Untuk testing Node.js (jika diperlukan)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { state, sendMessage, clearChat };
}
