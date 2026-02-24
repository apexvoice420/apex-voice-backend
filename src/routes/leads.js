const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const emailService = require('../services/email');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Get all leads with filters
router.get('/', async (req, res) => {
    try {
        const { city, state, status, niche, limit = 100 } = req.query;

        let query = 'SELECT * FROM leads WHERE 1=1';
        const params = [];
        let paramCount = 1;

        if (city) { query += ` AND city = $${paramCount}`; params.push(city); paramCount++; }
        if (state) { query += ` AND state = $${paramCount}`; params.push(state); paramCount++; }
        if (status) { query += ` AND status = $${paramCount}`; params.push(status); paramCount++; }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
        params.push(limit);

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single lead by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new lead (triggers Agent E email)
router.post('/', async (req, res) => {
    try {
        const { name, email, phone, business_name, business_type, address, city, state, zip, source, status, notes } = req.body;
        
        // Insert lead
        const result = await pool.query(
            `INSERT INTO leads (name, email, phone, business_name, business_type, address, city, state, zip, source, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [name, email, phone, business_name, business_type, address, city, state, zip, source || 'manual', status || 'new', notes]
        );
        
        const lead = result.rows[0];
        
        // Trigger Agent E email if lead has email
        if (lead.email) {
            console.log(`📧 Triggering Agent E for new lead: ${lead.email}`);
            
            // Send email asynchronously (don't block response)
            emailService.processLeadWithAgentE({
                ...lead,
                firstName: lead.name?.split(' ')[0] || 'there',
                businessType: lead.business_type
            }).then(emailResult => {
                if (emailResult.success) {
                    // Update lead with email tracking
                    pool.query(
                        `UPDATE leads SET 
                            email_sent = true, 
                            email_type = $1, 
                            email_sent_at = NOW(),
                            updated_at = NOW()
                         WHERE id = $2`,
                        [status === 'demo' ? 'demo_confirmation' : 'cold_intro', lead.id]
                    ).catch(err => console.error('Failed to update email tracking:', err));
                }
            }).catch(err => console.error('Agent E error:', err));
        }
        
        res.status(201).json(lead);
    } catch (error) {
        console.error('Create lead error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update lead status
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const result = await pool.query(
            'UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [status, id]
        );

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send email to lead (manual trigger)
router.post('/:id/email', async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // cold_intro, follow_up, demo, reactivation
        
        // Get lead
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
        if (leadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        const lead = leadResult.rows[0];
        
        if (!lead.email) {
            return res.status(400).json({ error: 'Lead has no email address' });
        }
        
        // Send email based on type
        let result;
        const leadData = {
            ...lead,
            firstName: lead.name?.split(' ')[0] || 'there',
            businessType: lead.business_type
        };
        
        switch (type) {
            case 'cold_intro':
                result = await emailService.sendColdIntro(leadData);
                break;
            case 'demo':
                result = await emailService.sendDemoConfirmation(leadData);
                break;
            case 'follow_up':
                result = await emailService.sendFollowUp(leadData);
                break;
            case 'reactivation':
                result = await emailService.sendReactivation(leadData);
                break;
            default:
                result = await emailService.processLeadWithAgentE(leadData);
        }
        
        // Update tracking
        if (result.success) {
            await pool.query(
                `UPDATE leads SET 
                    email_sent = true, 
                    email_type = $1, 
                    email_sent_at = NOW(),
                    updated_at = NOW()
                 WHERE id = $2`,
                [type || 'auto', id]
            );
        }
        
        res.json(result);
    } catch (error) {
        console.error('Send email error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Bulk email to leads
router.post('/bulk-email', async (req, res) => {
    try {
        const { leadIds, type = 'cold_intro' } = req.body;
        
        if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ error: 'No leads selected' });
        }
        
        // Get leads
        const result = await pool.query(
            `SELECT * FROM leads WHERE id = ANY($1) AND email IS NOT NULL`,
            [leadIds]
        );
        
        const leads = result.rows;
        
        // Send emails
        const results = [];
        for (const lead of leads) {
            const leadData = {
                ...lead,
                firstName: lead.name?.split(' ')[0] || 'there',
                businessType: lead.business_type
            };
            
            let emailResult;
            switch (type) {
                case 'follow_up':
                    emailResult = await emailService.sendFollowUp(leadData);
                    break;
                case 'reactivation':
                    emailResult = await emailService.sendReactivation(leadData);
                    break;
                default:
                    emailResult = await emailService.sendColdIntro(leadData);
            }
            
            results.push({ leadId: lead.id, email: lead.email, ...emailResult });
        }
        
        res.json({ sent: results.length, results });
    } catch (error) {
        console.error('Bulk email error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
