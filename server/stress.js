// server/stress.js
const axios = require('axios'); // You might need to `npm install axios` in /server

const TARGET_SEAT = "A1";
const TOTAL_BOTS = 500;
const URL = "http://localhost:3001/api/lock";

const runStressTest = async () => {
    console.log(`\n🚀 LAUNCHING ${TOTAL_BOTS} CONCURRENT REQUESTS FOR SEAT [${TARGET_SEAT}]...`);
    console.log("---------------------------------------------------");

    // 1. Create 500 Promises (Bots)
    const requests = [];
    for (let i = 0; i < TOTAL_BOTS; i++) {
        const botId = 90000 + i;
        // All requests fire INSTANTLY at the same time
        requests.push(
            axios.post(URL, { seatId: TARGET_SEAT, userId: botId })
                .then(res => ({ status: res.status, id: botId, data: res.data }))
                .catch(err => ({ status: err.response?.status || 500, id: botId }))
        );
    }

    // 2. Fire them all!
    const startTime = Date.now();
    const results = await Promise.all(requests);
    const endTime = Date.now();

    // 3. Analyze Results
    const successes = results.filter(r => r.status === 200);
    const failures = results.filter(r => r.status === 409);
    const errors = results.filter(r => r.status === 500);

    console.log("---------------------------------------------------");
    console.log(`⚡ PROCESSED IN:  ${endTime - startTime}ms`);
    console.log(`✅ SUCCESS (200): ${successes.length}`);
    console.log(`❌ CONFLICTS (409): ${failures.length}`);
    console.log(`💀 ERRORS (500):    ${errors.length}`);
    console.log("---------------------------------------------------");

    if (successes.length === 1 && failures.length === (TOTAL_BOTS - 1)) {
        console.log("🏆 TEST PASSED: PERFECT CONCURRENCY CONTROL");
        if (successes.length > 0) {
            console.log(`🥇 Winner: Bot ID ${successes[0].id}`);
        }
    } else {
        console.log("⚠️ TEST FAILED: Race condition detected!");
    }
};

runStressTest();