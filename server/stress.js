require('dotenv').config(); // 🟢 LOAD .ENV (Matches Server)

const axios = require('axios');
const jwt = require('jsonwebtoken');

const TARGET_SEAT = "A1";
const TOTAL_BOTS = 1000;
const URL = "http://localhost:3001/api/lock";

// 🟢 GET SECRET FROM ENV (CRITICAL FIX)
// If .env is missing, it falls back to string, but warns you.
const JWT_SECRET = process.env.JWT_SECRET || "hackathon_super_secret_key";

if (!process.env.JWT_SECRET) {
    console.log("⚠️  WARNING: JWT_SECRET not found in .env. Using fallback. Bots might fail if server has a different key.");
}

// Colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m"
};

const getRandomIP = () => {
    return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
};

const runStressTest = async () => {
    const startId = Math.floor(Math.random() * 800000) + 100000; 
    
    console.log(`\nLAUNCHING AUTHENTICATED BOT ATTACK (${TOTAL_BOTS} BOTS)...`);
    console.log(`Target: ${URL} | Secret: ${JWT_SECRET.substring(0, 5)}...`);

    const requests = [];
    const dispatchStart = process.hrtime(); 

    for (let i = 0; i < TOTAL_BOTS; i++) {
        const botId = startId + i;
        const fakeIP = getRandomIP(); //Enter "IP" to make constant ip(Test rate limiting)
        
        // GENERATE VALID TOKEN
        const token = jwt.sign({ userId: botId, email: `bot${botId}@hackathon.com` }, JWT_SECRET);

        requests.push(
            axios.post(URL, { seatId: TARGET_SEAT }, { 
                headers: { 
                    'X-Forwarded-For': fakeIP,
                    'Authorization': `Bearer ${token}` // SEND TOKEN
                }
            })
            .then(res => ({ status: res.status, id: botId }))
            .catch(err => ({ status: err.response?.status || 500, id: botId, err: err.message }))
        );
    }
    
    const dispatchEnd = process.hrtime(dispatchStart);
    const dispatchTimeMs = (dispatchEnd[0] * 1000 + dispatchEnd[1] / 1e6).toFixed(2);

    console.log(`ALL ${TOTAL_BOTS} REQUESTS FIRED IN: ${dispatchTimeMs}ms`);
    console.log("---------------------------------------------------");

    const results = await Promise.all(requests);

    // ANALYZE ALL STATUS CODES
    const successes = results.filter(r => r.status === 200);
    const failures = results.filter(r => r.status === 409);
    const rateLimited = results.filter(r => r.status === 429);
    const authFailed = results.filter(r => r.status === 403 || r.status === 401);
    const serverErrors = results.filter(r => r.status === 500);
    const others = results.filter(r => ![200, 409, 429, 403, 401, 500].includes(r.status));

    console.log(`SUCCESS (200):     ${successes.length} ${successes.length === 1 ? "(WINNER)" : ""}`);
    console.log(`CONFLICTS (409):   ${failures.length} (Stopped by Redis)`);
    console.log(`RATE LIMIT (429):   ${rateLimited.length}`);
    
    if (authFailed.length > 0) {
        console.log(`AUTH FAILED (403): ${authFailed.length} (Secret Key Mismatch?)`);
    }
    
    if (serverErrors.length > 0) {
        console.log(`SERVER ERROR (500): ${serverErrors.length}`);
    }

    if (others.length > 0) {
        console.log(`UNKNOWN (${others[0].status}):   ${others.length}`);
    }

    console.log("---------------------------------------------------");

    if (successes.length === 1 && failures.length + rateLimited.length === (TOTAL_BOTS - 1)) {
        console.log(`TEST PASSED: SYSTEM SECURE & ATOMIC`);
    } else {
        console.log(`TEST FAILED / MIXED RESULTS`);
    }
};

runStressTest();