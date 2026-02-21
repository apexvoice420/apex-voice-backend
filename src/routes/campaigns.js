const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// List Campaigns
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create Campaign
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        const result = await pool.query(
            'INSERT INTO campaigns (name, status) VALUES ($1, \'draft\') RETURNING *',
            [name]
        );
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
