const { app } = require('@azure/functions');

// Runs every 4 minutes between 5am-8pm Mon-Sat (UK working hours for a workshop)
// Keeps the Function App INSTANCE warm so kiosk users never hit a cold start.
//
// IMPORTANT: do NOT touch the SQL pool from here. The DB is on Serverless and
// auto-pauses when idle; pinging it every 4 min keeps it online for 15 hrs/day,
// which burns the entire monthly free vCore allowance in ~4 working days.
// The timer firing is what keeps the App warm — the handler itself doesn't
// need to do anything for that to work.
app.timer('keep-warm', {
    schedule: '0 */4 5-20 * * 1-6',
    handler: async (myTimer, context) => {
        context.log(`Keep-warm ping at ${new Date().toISOString()}`);
    }
});
