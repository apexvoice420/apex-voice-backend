const express = require('express');
const router = express.Router();

// GET all clients
router.get('/', async (req, res) => {
    const db = req.app.locals.db;
    
    try {
        const result = await db.query(`
            SELECT * FROM clients 
            ORDER BY created_at DESC
        `);
        res.json({ clients: result.rows });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// GET single client
router.get('/:id', async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;
    
    try {
        const result = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        res.json({ client: result.rows[0] });
    } catch (error) {
        console.error('Error fetching client:', error);
        res.status(500).json({ error: 'Failed to fetch client' });
    }
});

// POST create new client
router.post('/', async (req, res) => {
    const db = req.app.locals.db;
    const {
        businessName,
        industry,
        city,
        state,
        contactName,
        contactPhone,
        contactEmail,
        businessPhone,
        escalationPhone,
        greeting,
        voiceStyle,
        services,
        faq
    } = req.body;

    // Validation
    if (!businessName || !contactEmail) {
        return res.status(400).json({ error: 'Business name and contact email are required' });
    }

    try {
        const result = await db.query(`
            INSERT INTO clients (
                business_name, industry, city, state,
                contact_name, contact_phone, contact_email, business_phone,
                escalation_phone, greeting, voice_style, services, faq,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
            RETURNING *
        `, [
            businessName, industry, city, state,
            contactName, contactPhone, contactEmail, businessPhone,
            escalationPhone, greeting, voiceStyle, services, faq
        ]);

        res.status(201).json({ client: result.rows[0] });
    } catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// PUT update client
router.put('/:id', async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;
    const updates = req.body;

    try {
        // Build dynamic update query
        const fields = [];
        const values = [id];
        let paramCount = 2;

        const fieldMap = {
            businessName: 'business_name',
            industry: 'industry',
            city: 'city',
            state: 'state',
            contactName: 'contact_name',
            contactPhone: 'contact_phone',
            contactEmail: 'contact_email',
            businessPhone: 'business_phone',
            escalationPhone: 'escalation_phone',
            greeting: 'greeting',
            voiceStyle: 'voice_style',
            services: 'services',
            faq: 'faq',
            status: 'status',
            vapiPhone: 'vapi_phone',
            vapiAgentId: 'vapi_agent_id'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = $${paramCount}`);
                values.push(updates[key]);
                paramCount++;
            }
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        fields.push('updated_at = NOW()');

        const query = `UPDATE clients SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
        const result = await db.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ client: result.rows[0] });
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});

// DELETE client
router.delete('/:id', async (req, res) => {
    const db = req.app.locals.db;
    const { id } = req.params;

    try {
        const result = await db.query('DELETE FROM clients WHERE id = $1 RETURNING id', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ success: true, message: 'Client deleted' });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});

module.exports = router;
