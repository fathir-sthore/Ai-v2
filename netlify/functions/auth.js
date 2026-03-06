/**
 * FADAX DRAK AI — Netlify Function: Auth
 * Handles: POST /api/auth/login
 *          POST /api/auth/register
 *          GET  /api/auth/me
 *
 * Env vars needed (set di Netlify Dashboard):
 *   MONGODB_URI, JWT_SECRET, BCRYPT_ROUNDS
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

// ── Mongoose connection (reuse across warm invocations) ──
let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.DB_NAME || 'fadax_ai',
        serverSelectionTimeoutMS: 8000,
    });
    isConnected = true;
}

// ── User Model ──
let User;
if (mongoose.models.User) {
    User = mongoose.model('User');
} else {
    const userSchema = new mongoose.Schema({
        username:  { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
        email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
        password:  { type: String, required: true },
        role:      { type: String, enum: ['user', 'admin'], default: 'user' },
        lastLogin: { type: Date },
    }, { timestamps: true });

    userSchema.pre('save', async function (next) {
        if (!this.isModified('password')) return next();
        this.password = await bcrypt.hash(this.password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
        next();
    });

    userSchema.methods.checkPassword = function (plain) {
        return bcrypt.compare(plain, this.password);
    };

    userSchema.set('toJSON', {
        transform: (_, ret) => { delete ret.password; return ret; }
    });

    User = mongoose.model('User', userSchema);
}

// ── Helpers ──
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function makeToken(user) {
    return jwt.sign(
        { userId: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS?.split(',')[0] || '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
        body: JSON.stringify(body),
    };
}

// ── Main Handler ──
exports.handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return response(200, {});
    }

    const path   = event.path.replace('/.netlify/functions/auth', '');
    const method = event.httpMethod;

    try {
        await connectDB();
    } catch (err) {
        console.error('DB connect error:', err.message);
        return response(503, { message: 'Database tidak bisa dihubungi. Coba lagi.' });
    }

    // ── POST /api/auth/register ──
    if (method === 'POST' && path === '/register') {
        try {
            const { username, email, password } = JSON.parse(event.body || '{}');

            if (!username?.trim() || !email?.trim() || !password)
                return response(400, { message: 'Semua field wajib diisi.' });
            if (username.trim().length < 3)
                return response(400, { message: 'Username minimal 3 karakter.' });
            if (!isEmail(email))
                return response(400, { message: 'Format email tidak valid.' });
            if (password.length < 8)
                return response(400, { message: 'Password minimal 8 karakter.' });

            const exists = await User.findOne({
                $or: [{ email: email.toLowerCase() }, { username: username.trim() }]
            });
            if (exists) {
                const field = exists.email === email.toLowerCase() ? 'Email' : 'Username';
                return response(409, { message: `${field} sudah digunakan.` });
            }

            const user = await User.create({
                username: username.trim(),
                email:    email.toLowerCase().trim(),
                password,
            });

            return response(201, {
                message: 'Akun berhasil dibuat!',
                user: { id: user._id, username: user.username, email: user.email },
            });

        } catch (err) {
            console.error('Register error:', err.message);
            return response(500, { message: 'Server error. Coba lagi.' });
        }
    }

    // ── POST /api/auth/login ──
    if (method === 'POST' && path === '/login') {
        try {
            const { identifier, password } = JSON.parse(event.body || '{}');

            if (!identifier?.trim() || !password)
                return response(400, { message: 'Email/username dan password wajib diisi.' });

            const query = isEmail(identifier)
                ? { email: identifier.toLowerCase().trim() }
                : { username: identifier.trim() };

            const user = await User.findOne(query);
            if (!user || !(await user.checkPassword(password)))
                return response(401, { message: 'Email/username atau password salah.' });

            user.lastLogin = new Date();
            await user.save();

            const token = makeToken(user);
            return response(200, {
                token,
                user: { id: user._id, username: user.username, email: user.email, role: user.role },
            });

        } catch (err) {
            console.error('Login error:', err.message);
            return response(500, { message: 'Server error. Coba lagi.' });
        }
    }

    // ── GET /api/auth/me ──
    if (method === 'GET' && path === '/me') {
        try {
            const header = event.headers['authorization'] || event.headers['Authorization'];
            if (!header?.startsWith('Bearer '))
                return response(401, { message: 'Token tidak ditemukan.' });

            const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
            const user    = await User.findById(decoded.userId).select('-password');
            if (!user) return response(404, { message: 'User tidak ditemukan.' });

            return response(200, { user });

        } catch (err) {
            return response(401, { message: 'Token tidak valid atau expired.' });
        }
    }

    return response(404, { message: 'Route tidak ditemukan.' });
};
