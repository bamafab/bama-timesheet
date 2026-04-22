const { app } = require('@azure/functions');
const { query } = require('../db');

// Runs every 4 minutes between 5am-8pm Mon-Sat (UK working hours for a workshop)
// Keeps the Function App warm so kiosk users never hit a cold start
app.timer('keep-warm', {
    schedule: '0 */4 5-20 * * 1-6',
    handler: async (myTimer, context) => {
        try {
            // Simple DB query to keep the connection pool alive too
            await query('SELECT 1 AS ok');
            context.log(`Keep-warm ping at ${new Date().toISOString()}`);
        } catch (err) {
            context.warn('Keep-warm ping failed:', err.message);
        }
    }
});
