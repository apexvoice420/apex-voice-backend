const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// POST VAPI Webhook
router.post('/vapi', async (req, res) => {
    const callData = req.body.message || req.body;
    console.log('Webhook received:', callData.type);

    try {
        if (callData.type === 'end-of-call-report') {
            const { call, transcript, summary, analysis } = callData;

            if (call.customer && call.customer.number) {
                // Clean phone
                const phone = call.customer.number.replace(/\D/g, '').slice(-10);

                // Find Lead
                const leadRes = await pool.query('SELECT id FROM leads WHERE phone LIKE $1', [`%${phone}`]);

                if (leadRes.rows.length > 0) {
                    const leadId = leadRes.rows[0].id;

                    // Insert Call Record
                    await pool.query(`
                        INSERT INTO calls (lead_id, vapi_call_id, duration, status, transcript, sentiment, outcome)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [
                        leadId,
                        call.id,
                        Math.round(call.duration || 0),
                        call.status,
                        transcript || '',
                        analysis?.sentiment || 'netural',
                        analysis?.successEvaluation ? 'success' : 'failure'
                    ]);

                    // Update Lead Status
                    await pool.query(`UPDATE leads SET status = 'Called', last_called_at = NOW() WHERE id = $1`, [leadId]);

                    console.log(`✅ Call logged for lead ${leadId}`);
                }
            }
        }
    } catch (err) {
        console.error('Webhook error:', err);
    }

    res.json({ received: true });
});

module.exports = router;
