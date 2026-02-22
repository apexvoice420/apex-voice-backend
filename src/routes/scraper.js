const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { scrapeGoogleMaps, enrichLeadsWithEmails } = require('../scraper');

/**
 * POST /api/scraper/scrape
 * Scrape Google Maps for leads, optionally enrich with website emails
 * 
 * Body: {
 *   city: string,
 *   state: string, 
 *   type: string (business type: roofing, plumber, hvac, etc.),
 *   minRating: number (default 4.0),
 *   maxResults: number (default 50),
 *   enrichEmails: boolean (default true) - visit websites to find emails
 *   saveToDb: boolean (default true) - save leads to database
 * }
 */
router.post('/scrape', async (req, res) => {
    const { 
        city, 
        state, 
        type, 
        minRating = 4.0, 
        maxResults = 50,
        enrichEmails = true,
        saveToDb = true
    } = req.body;

    if (!city || !state || !type) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required fields: city, state, type' 
        });
    }

    console.log(`🔍 Starting scrape: ${type} in ${city}, ${state}`);

    try {
        // Step 1: Scrape Google Maps
        const leads = await scrapeGoogleMaps(city, state, type, maxResults);
        
        // Filter by minimum rating
        const filteredLeads = leads.filter(l => l.rating >= minRating);
        console.log(`Found ${leads.length} leads, ${filteredLeads} with rating >= ${minRating}`);

        // Step 2: Enrich with website emails
        let enrichedLeads = filteredLeads;
        if (enrichEmails && filteredLeads.length > 0) {
            console.log('📧 Enriching leads with website emails...');
            enrichedLeads = await enrichLeadsWithEmails(filteredLeads, maxResults);
        }

        // Step 3: Save to database
        const savedLeads = [];
        if (saveToDb) {
            for (const lead of enrichedLeads) {
                try {
                    const formattedPhone = lead.phone.replace(/\D/g, '').slice(-10);
                    
                    const result = await pool.query(
                        `INSERT INTO leads (business_name, phone, email, city, state, niche, rating, reviews, address, website, source)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                         ON CONFLICT (phone) DO UPDATE SET
                           email = COALESCE(EXCLUDED.email, leads.email),
                           rating = EXCLUDED.rating,
                           reviews = EXCLUDED.reviews,
                           website = COALESCE(EXCLUDED.website, leads.website),
                           updated_at = NOW()
                         RETURNING *`,
                        [
                            lead.businessName,
                            formattedPhone,
                            lead.email,
                            lead.city,
                            lead.state,
                            lead.industry || type,
                            lead.rating,
                            lead.reviews,
                            lead.address,
                            lead.website,
                            lead.source
                        ]
                    );
                    
                    if (result.rows[0]) {
                        savedLeads.push(result.rows[0]);
                    }
                } catch (dbErr) {
                    console.error(`Error saving lead ${lead.businessName}:`, dbErr.message);
                }
            }
        }

        // Stats
        const stats = {
            total: leads.length,
            filtered: filteredLeads.length,
            withEmails: enrichedLeads.filter(l => l.email).length,
            saved: savedLeads.length
        };

        console.log(`✅ Scrape complete:`, stats);
        
        res.json({ 
            success: true, 
            stats,
            leads: saveToDb ? savedLeads : enrichedLeads 
        });

    } catch (error) {
        console.error('❌ Scraping error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/scraper/enrich
 * Enrich existing leads with website emails
 * 
 * Body: {
 *   leadIds: number[] (optional - if not provided, enriches all leads without emails)
 *   maxLeads: number (default 100)
 * }
 */
router.post('/enrich', async (req, res) => {
    const { leadIds, maxLeads = 100 } = req.body;

    try {
        let leadsToEnrich;
        
        if (leadIds && leadIds.length > 0) {
            // Enrich specific leads
            const result = await pool.query(
                `SELECT id, business_name, phone, email, website 
                 FROM leads WHERE id = ANY($1)`,
                [leadIds]
            );
            leadsToEnrich = result.rows;
        } else {
            // Enrich all leads without emails that have websites
            const result = await pool.query(
                `SELECT id, business_name, phone, email, website 
                 FROM leads 
                 WHERE (email IS NULL OR email = '') 
                   AND website IS NOT NULL 
                   AND website != ''
                 LIMIT $1`,
                [maxLeeds]
            );
            leadsToEnrich = result.rows;
        }

        if (leadsToEnrich.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No leads to enrich',
                enriched: 0 
            });
        }

        console.log(`📧 Enriching ${leadsToEnrich.length} leads with emails...`);

        // Convert to scraper format
        const leads = leadsToEnrich.map(l => ({
            businessName: l.business_name,
            phone: l.phone,
            website: l.website
        }));

        // Enrich
        const enrichedLeads = await enrichLeadsWithEmails(leads, maxLeads);

        // Update database
        let updated = 0;
        for (const lead of enrichedLeads) {
            if (lead.email) {
                await pool.query(
                    `UPDATE leads SET email = $1, updated_at = NOW() WHERE phone = $2`,
                    [lead.email, lead.phone.replace(/\D/g, '').slice(-10)]
                );
                updated++;
            }
        }

        res.json({
            success: true,
            processed: leadsToEnrich.length,
            enriched: updated,
            leads: enrichedLeads.filter(l => l.email)
        });

    } catch (error) {
        console.error('❌ Enrichment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
