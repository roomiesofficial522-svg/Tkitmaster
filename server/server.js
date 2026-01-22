// 🟢 FIX 1: USE REQUIRE INSTEAD OF IMPORT
require('dotenv').config(); 

const express = require('express');
const { createClient } = require('redis');
const mongoose = require('mongoose');
const cors = require('cors');
const Seat = require('./models/Seat'); 
const rateLimit = require('express-rate-limit');

const app = express();
// 🟢 FIX 2: KEEP IP SPOOFING ENABLED FOR DEMO
app.set('trust proxy', true); 

app.use(cors());
app.use(express.json());

// CONFIG
const MONGO_URI = process.env.MONGO_URI; // Loaded from .env
const REDIS_TTL = 300; // 5 Minutes

// --- 1. DATABASE CONNECTIONS ---
const redisClient = createClient();
redisClient.on('error', (err) => console.log('Redis Error', err));
redisClient.connect();

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB (The Vault)'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));


// =================================================================
// 🛡️ ARCHITECTURE NOTE: ATOMICITY
// We use a LUA SCRIPT here to ensure the "Check-Then-Set" operation
// happens atomically within Redis. This prevents the classic
// "Race Condition" where two users see the seat as free simultaneously.
// =================================================================
const LOCK_SCRIPT = `
    local seatKey = KEYS[1]
    local userId = ARGV[1]
    local ttl = ARGV[2]
    
    if redis.call("GET", seatKey) == "SOLD" then
        return 0 
    end

    if redis.call("EXISTS", seatKey) == 1 then
        return 0
    end

    redis.call("SET", seatKey, "LOCKED:" .. userId, "EX", ttl)
    return 1
`;

// =================================================================
// 🛡️ ARCHITECTURE NOTE: DISTRIBUTED DEFENSE
// This Rate Limiter looks at the 'X-Forwarded-For' header to identify
// unique users. This simulates a real-world API Gateway protecting
// against DDoS attacks from botnets.
// =================================================================
const limiter = rateLimit({
    windowMs: 1000, 
    max: 10, 
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "⚠️ SECURITY SHIELD TRIGGERED: Too many requests. Chill out." },
    // 🟢 KEY GENERATOR: Manually read the spoofed header for the demo
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for'] || req.ip; 
    },
    // 🟢 FIX 3: SILENCE THE WARNING (It's intentional for the hackathon)
    validate: { trustProxy: false } 
});

// --- 3. API ENDPOINTS ---

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
                if (val === "SOLD") {
                    status = 'booked';
                } else if (val.startsWith('LOCKED:')) {
                    status = 'locked';
                    lockedBy = parseInt(val.split(':')[1]);
                    ttl = keyTTL;
                }
            }

            return {
                id: seat.seatId,
                row: seat.row,
                number: seat.number,
                tier: seat.tier,
                price: seat.price,
                state: status,
                lockedBy: lockedBy,
                ttl: ttl 
            };
        });

        res.json({ seats: seatMap });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch stadium" });
    }
});

// APPLY RATE LIMITER TO LOCK ENDPOINT
app.post('/api/lock', limiter, async (req, res) => {
    const { seatId, userId } = req.body;
    const seatKey = `seat:${seatId}`;
    
    // DEBUG LOG: See what IP the server thinks this is
    // console.log(`[REQ] User ${userId} from IP: ${req.headers['x-forwarded-for'] || req.ip}`);

    const arrivalTime = new Date().toISOString(); 
    if (seatId === "A1") {
        console.log(`[RACE_ENTRY] User ${userId} arrived at ${arrivalTime.split('T')[1]}`); 
    }

    try {
        const result = await redisClient.eval(LOCK_SCRIPT, {
            keys: [seatKey],
            arguments: [String(userId), String(REDIS_TTL)]
        });

        if (result === 1) {
            console.log(`\n🏆 [WINNER] User ${userId} WON the race at ${arrivalTime.split('T')[1]}\n`);
            res.json({ success: true });
        } else {
            res.status(409).json({ success: false, message: "Seat Unavailable" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Lock Error" });
    }
});

app.post('/api/pay', async (req, res) => {
    const { idempotencyKey, seatId, userId } = req.body;
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
        if (seat.status === 'booked') {
            throw new Error('Double Booking Detected'); 
        }
        
        seat.status = 'booked';
        seat.userId = userId;
        await seat.save({ session });

        await redisClient.del(seatKey);

        await session.commitTransaction();
        session.endSession();

        const receipt = { 
            success: true, 
            txId: "tx_" + Math.random().toString(36).substr(2, 9) 
        };

        await redisClient.set(idempotencyKeyStore, JSON.stringify(receipt), { EX: 86400 });

        console.log(`[SOLD] Seat ${seatId} sold to User ${userId}`);
        res.json(receipt);

    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error(err);
        res.status(500).json({ error: "Payment Failed" });
    }
});

const RELEASE_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
    else
        return 0
    end
`;

app.post('/api/release', async (req, res) => {
    const { seatId, userId } = req.body;
    const seatKey = `seat:${seatId}`;

    try {
        await redisClient.eval(RELEASE_SCRIPT, {
            keys: [seatKey],
            arguments: [`LOCKED:${userId}`]
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Release Error" });
    }
});

app.post('/api/reset', async (req, res) => {
    try {
        await redisClient.flushDb();
        await Seat.updateMany({}, { status: 'available', userId: null });
        console.log('⚠️ DATABASE WIPED BY ADMIN');
        res.json({ success: true, message: "Database Cleared" });
    } catch (error) {
        res.status(500).json({ error: "Reset Failed" });
    }
});

app.listen(3001, () => {
    console.log('🚀 FlashSeat Engine running on port 3001');
});