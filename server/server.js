require('dotenv').config();

const express = require('express');
const { createClient } = require('redis');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// MODELS
const Seat = require('./models/Seat');
const User = require('./models/User');

const app = express();
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());

// CONFIG
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const REDIS_TTL = 300; // 5 Minutes

// --- 1. DATABASE CONNECTIONS ---
const redisClient = createClient();
redisClient.on('error', (err) => console.log('Redis Error', err));
redisClient.connect();

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB (The Vault)'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- EMAIL TRANSPORTER ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// =================================================================
// 🛡️ ARCHITECTURE NOTE: ATOMICITY
// =================================================================
const LOCK_SCRIPT = `
    local seatKey = KEYS[1]
    local userId = ARGV[1]
    local ttl = ARGV[2]
    
    if redis.call("GET", seatKey) == "SOLD" then return 0 end
    if redis.call("EXISTS", seatKey) == 1 then return 0 end

    redis.call("SET", seatKey, "LOCKED:" .. userId, "EX", ttl)
    return 1
`;

// =================================================================
// 🛡️ ARCHITECTURE NOTE: DISTRIBUTED DEFENSE
// =================================================================
const limiter = rateLimit({
    windowMs: 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "⚠️ SECURITY SHIELD TRIGGERED: Too many requests. Chill out." },
    keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
    validate: { trustProxy: false }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: "⚠️ Too many login attempts. Try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Unauthorized: Missing Token" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Forbidden: Invalid Token" });
        req.user = user;
        next();
    });
};

// --- HELPER: EMAIL VALIDATION ---
const validateEmailDomain = (email) => {
    const allowedDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
    const domain = email.split('@')[1];
    return allowedDomains.includes(domain);
};

// --- 3. AUTH ENDPOINTS ---

// STEP 1: REGISTER & SEND OTP
app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { email } = req.body;

    // 🛡️ SECURITY: PREVENT NoSQL INJECTION
    if (typeof email !== 'string') return res.status(400).json({ error: "Invalid payload" });

    // 🛡️ SECURITY: EMAIL DOMAIN CHECK
    if (!validateEmailDomain(email)) {
        return res.status(400).json({ error: "Only Gmail, Yahoo, Outlook, or iCloud allowed." });
    }
    
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: "User already exists" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await redisClient.set(`otp:${email}`, otp, { EX: 300 });

    const mailOptions = {
        from: EMAIL_USER,
        to: email,
        subject: 'TicketS ID OTP Verification',
        text: `Your verification code is: ${otp}. 
        Do not share this.`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Email Error:", error);
            return res.status(500).json({ error: "Failed to send email" });
        }
        res.json({ success: true, message: "OTP sent to email" });
    });
});

// STEP 2: VERIFY OTP & CREATE ACCOUNT
app.post('/api/auth/verify-register', authLimiter, async (req, res) => {
    const { email, otp, password, phone } = req.body;

    // 🛡️ SECURITY: INPUT SANITIZATION
    if (typeof email !== 'string' || typeof otp !== 'string') return res.status(400).json({ error: "Invalid payload" });

    const storedOtp = await redisClient.get(`otp:${email}`);
    if (storedOtp !== otp) {
        return res.status(400).json({ error: "Invalid or Expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword, phone });
    await newUser.save();

    await redisClient.del(`otp:${email}`);

    const token = jwt.sign({ userId: newUser._id, email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ success: true, token, userId: newUser._id });
});

// STEP 3: LOGIN
app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;

    // 🛡️ SECURITY: PREVENT NoSQL INJECTION
    if (typeof email !== 'string') return res.status(400).json({ error: "Invalid payload" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ userId: user._id, email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ success: true, token, userId: user._id });
});

// --- 4. TICKET ENDPOINTS ---

app.get('/api/seats', async (req, res) => {
    try {
        const keys = await redisClient.keys('seat:*');
        const redisData = {};
        if (keys.length > 0) {
            const values = await Promise.all(keys.map(key => redisClient.get(key)));
            const ttls = await Promise.all(keys.map(key => redisClient.ttl(key)));
            keys.forEach((key, index) => {
                const seatId = key.split(':')[1];
                redisData[seatId] = { val: values[index], ttl: ttls[index] };
            });
        }
        const seats = await Seat.find({}).sort({ row: 1, number: 1 });
        const seatMap = seats.map(seat => {
            let status = seat.status;
            let lockedBy = null;
            let ttl = null;
            const redisEntry = redisData[seat.seatId];
            if (redisEntry) {
                const { val, ttl: keyTTL } = redisEntry;
                if (val === "SOLD") status = 'booked';
                else if (val.startsWith('LOCKED:')) {
                    status = 'locked';
                    lockedBy = parseInt(val.split(':')[1]); // Keeping logic compatible
                    ttl = keyTTL;
                }
            }
            return { id: seat.seatId, row: seat.row, number: seat.number, tier: seat.tier, price: seat.price, state: status, lockedBy, ttl };
        });
        res.json({ seats: seatMap });
    } catch (err) { res.status(500).json({ error: "DB Error" }); }
});

app.post('/api/lock', limiter, authenticateToken, async (req, res) => {
    const { seatId } = req.body; 
    const userId = req.user.userId;
    const seatKey = `seat:${seatId}`;
    
    try {
        const result = await redisClient.eval(LOCK_SCRIPT, {
            keys: [seatKey],
            arguments: [String(userId), String(REDIS_TTL)]
        });
        if (result === 1) res.json({ success: true });
        else res.status(409).json({ success: false, message: "Seat Unavailable" });
    } catch (err) { res.status(500).json({ error: "Lock Error" }); }
});

app.post('/api/pay', authenticateToken, async (req, res) => {
    const { idempotencyKey, seatId } = req.body; 
    const userId = req.user.userId;
    const idempotencyKeyStore = `receipt:${idempotencyKey}`;
    const seatKey = `seat:${seatId}`;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const cachedReceipt = await redisClient.get(idempotencyKeyStore);
        if (cachedReceipt) {
            await session.abortTransaction();
            session.endSession();
            return res.json(JSON.parse(cachedReceipt));
        }

        const lockVal = await redisClient.get(seatKey);
        if (lockVal !== `LOCKED:${userId}`) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: "Lock Expired or Stolen" });
        }

        const seat = await Seat.findOne({ seatId: seatId }).session(session);
        if (seat.status === 'booked') throw new Error('Double Booking');
        
        seat.status = 'booked';
        seat.userId = userId;
        await seat.save({ session });
        await redisClient.set(seatKey, "SOLD");
        await session.commitTransaction();
        session.endSession();

        const receipt = { success: true, txId: "tx_" + Math.random().toString(36).substr(2, 9) };
        await redisClient.set(idempotencyKeyStore, JSON.stringify(receipt), { EX: 86400 });
        res.json(receipt);
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ error: "Payment Failed" });
    }
});

app.post('/api/release', async (req, res) => {
    const { seatId, userId } = req.body;
    await redisClient.del(`seat:${seatId}`); 
    res.json({ success: true });
});

app.post('/api/reset', async (req, res) => {
    await redisClient.flushDb();
    await Seat.updateMany({}, { status: 'available', userId: null });
    res.json({ success: true });
});

app.listen(3001, () => console.log('🚀 TicketS Engine running on port 3001'));