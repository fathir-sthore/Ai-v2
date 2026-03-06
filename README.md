# FADAX DRAK AI 🤖

Chat assistant berbasis OpenAI GPT dengan autentikasi JWT dan penyimpanan riwayat di MongoDB Atlas.

**Developed by Selvi Time Daxyinz**

---

## 📁 Struktur Project

```
fadax-drak-ai/
├── netlify/
│   └── functions/
│       ├── auth.js        ← API login & register
│       └── chat.js        ← API chat (proxy ke OpenAI)
├── ai.html                ← Halaman chat utama
├── login.html             ← Halaman login/register
├── index.js               ← Frontend logic
├── netlify.toml           ← Konfigurasi Netlify routing
├── package.json
├── .gitignore             ← .env TIDAK diupload ke Git
└── README.md
```

---

## 🚀 Cara Deploy ke Netlify

### 1. Persiapan lokal

```bash
# Clone atau download project
git init
git add .
git commit -m "Initial commit"

# Push ke GitHub
git remote add origin https://github.com/username/fadax-drak-ai.git
git push -u origin main
```

> ⚠️ Pastikan `.env` ada di `.gitignore` dan TIDAK ikut ke-push!

---

### 2. Connect ke Netlify

1. Login ke [netlify.com](https://netlify.com)
2. Klik **"Add new site"** → **"Import an existing project"**
3. Pilih **GitHub** → pilih repo `fadax-drak-ai`
4. Build settings:
   - **Base directory**: *(kosongkan)*
   - **Build command**: *(kosongkan)*
   - **Publish directory**: `.`
5. Klik **"Deploy site"**

---

### 3. Set Environment Variables di Netlify

Pergi ke: **Site configuration** → **Environment variables** → **Add a variable**

Tambahkan semua variabel berikut:

| Key | Value | Keterangan |
|-----|-------|-----------|
| `OPENAI_API_KEY` | `sk-proj-...` | Dari platform.openai.com |
| `MONGODB_URI` | `mongodb+srv://...` | Dari MongoDB Atlas |
| `JWT_SECRET` | *(64 karakter random)* | Generate: lihat di bawah |
| `DB_NAME` | `fadax_ai` | Nama database |
| `NODE_ENV` | `production` | Mode production |
| `ALLOWED_ORIGINS` | `https://nama-site.netlify.app` | URL site kamu |
| `OPENAI_DEFAULT_MODEL` | `gpt-4o-mini` | Model default |
| `OPENAI_MAX_TOKENS` | `1500` | Max panjang balasan |
| `OPENAI_TEMPERATURE` | `0.7` | Kreativitas AI (0-1) |
| `JWT_EXPIRES_IN` | `7d` | Masa berlaku token |
| `BCRYPT_ROUNDS` | `12` | Keamanan password |

**Generate JWT_SECRET** (jalankan di terminal):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

### 4. Trigger Redeploy

Setelah set env variables, klik **"Trigger deploy"** → **"Deploy site"**

---

### 5. Cek berhasil

Buka URL Netlify kamu, misalnya:
```
https://fadax-drak-ai.netlify.app/login
```

Test API:
```
https://fadax-drak-ai.netlify.app/api/auth/register
```

---

## 💻 Development Lokal

```bash
# Install dependencies
npm install

# Install Netlify CLI
npm install -g netlify-cli

# Buat file .env (JANGAN commit ke Git)
cp .env.example .env
# Isi OPENAI_API_KEY, MONGODB_URI, JWT_SECRET di .env

# Jalankan lokal dengan Netlify Dev
netlify dev
```

Akses di: `http://localhost:8888`

---

## 🔐 Cara Dapat API Keys

**OpenAI API Key:**
1. Login ke [platform.openai.com](https://platform.openai.com)
2. Klik avatar → **API keys** → **Create new secret key**
3. Copy key (hanya muncul sekali!)

**MongoDB Atlas URI:**
1. Login ke [cloud.mongodb.com](https://cloud.mongodb.com)
2. Buat cluster gratis (M0)
3. Klik **Connect** → **Drivers** → pilih Node.js
4. Copy connection string, ganti `<password>` dengan password database kamu

---

## 🛡️ Keamanan

- ✅ OpenAI API key hanya ada di server (Netlify env var), tidak pernah dikirim ke browser
- ✅ Password user di-hash dengan bcrypt (12 rounds)
- ✅ Autentikasi pakai JWT dengan expiry 7 hari
- ✅ Rate limiting untuk mencegah brute force
- ✅ File `.env` tidak pernah masuk ke GitHub

---

© 2025 FADAX DRAK AI · Selvi Time Daxyinz
