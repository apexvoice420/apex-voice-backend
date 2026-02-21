const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const fetch = require('node-fetch');

// Make a VAPI call
router.post('/make-call', async (req, res) => {
    try {
        const { leadId } = req.body;

        // 1. Get Lead
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
        if (leadResult.rows.length === 0) return res.status(404).json({ error: 'Lead not found' });
        const lead = leadResult.rows[0];

        // 2. Call VAPI
        const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, // Optional if assistant has one
                assistantId: process.env.VAPI_ASSISTANT_ID,
                customer: {
                    number: lead.phone,
                    name: lead.business_name
                }
            })
        });

        if (!vapiRes.ok) {
            const err = await vapiRes.text();
            throw new Error(`VAPI Error: ${err}`);
        }

        const vapiData = await vapiRes.json();

        // 3. Log Call
        await pool.query(`
        INSERT INTO calls (lead_id, vapi_call_id, phone_number, status, outcome)
        VALUES ($1, $2, $3, 'queued', 'pending')
    `, [lead.id, vapiData.id, lead.phone]);

        res.json({ success: true, callId: vapiData.id });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Get Calls
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM calls ORDER BY created_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
