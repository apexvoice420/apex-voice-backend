const express = require('express');
const router = express.Router();
const { pool } = require('../db');

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

module.exports = router;
