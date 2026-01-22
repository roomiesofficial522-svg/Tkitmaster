const axios = require('axios');

const TARGET_SEAT = "A1";
const TOTAL_BOTS = 1000;
const URL = "http://localhost:3001/api/lock";

// Terminal Colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m"
};

// 🟢 HELPER: Generate a fake random IP (e.g., "192.168.1.50")
const getRandomIP = () => {
    return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
};

const runStressTest = async () => {
    const startId = Math.floor(Math.random() * 800000) + 100000; 
    
    console.log(`\n${colors.cyan}🚀 PREPARING DISTRIBUTED ATTACK: ${TOTAL_BOTS} UNIQUE IPs...${colors.reset}`);
    console.log(`${colors.magenta}ℹ️  Mode: IP Spoofing Enabled (Bypassing Rate Limiter)${colors.reset}`);

    const requests = [];
    const dispatchStart = process.hrtime(); 

    for (let i = 0; i < TOTAL_BOTS; i++) {
        const botId = startId + i;
        const fakeIP = getRandomIP(); // Each bot gets a unique identity

        requests.push(
            axios.post(URL, { seatId: TARGET_SEAT, userId: botId }, {
                // 🟢 SPOOF THE IP ADDRESS
                headers: { 'X-Forwarded-For': fakeIP }
            })
            .then(res => ({ status: res.status, id: botId, ip: fakeIP }))
            .catch(err => ({ status: err.response?.status || 500, id: botId, ip: fakeIP }))
        );
    }
    
    const dispatchEnd = process.hrtime(dispatchStart);
    const dispatchTimeMs = (dispatchEnd[0] * 1000 + dispatchEnd[1] / 1e6).toFixed(2);

    console.log(`${colors.yellow}⚡ ALL ${TOTAL_BOTS} REQUESTS FIRED IN: ${dispatchTimeMs}ms${colors.reset}`);
    console.log(`(Simulating global traffic from ${TOTAL_BOTS} different locations)`);
    console.log("---------------------------------------------------");

    const results = await Promise.all(requests);

    const successes = results.filter(r => r.status === 200);
    const failures = results.filter(r => r.status === 409); // Redis Logic Rejection
    const blocked = results.filter(r => r.status === 429);  // Rate Limiter Rejection
    const errors = results.filter(r => r.status === 500);

    console.log(`${colors.green}✅ SUCCESS (200):   ${successes.length} (The Winner)${colors.reset}`);
    console.log(`${colors.red}❌ CONFLICTS (409): ${failures.length} (Stopped by Redis)${colors.reset}`);
    console.log(`${colors.magenta}🛡️  BLOCKED (429):   ${blocked.length} (Stopped by Rate Limit)${colors.reset}`);
    
    if (errors.length > 0) console.log(`💀 ERRORS (500):    ${errors.length}`);
    console.log("---------------------------------------------------");

    if (successes.length === 1 && failures.length === (TOTAL_BOTS - 1)) {
        console.log(`${colors.green}🏆 TEST PASSED: REDIS HANDLED GLOBAL CONCURRENCY${colors.reset}`);
        if (successes.length > 0) {
            console.log(`🥇 Winner: Bot ${successes[0].id} from IP [${successes[0].ip}]`);
        }
    } else {
        console.log(`${colors.red}⚠️ TEST FAILED / MIXED RESULTS${colors.reset}`);
    }
};

runStressTest();