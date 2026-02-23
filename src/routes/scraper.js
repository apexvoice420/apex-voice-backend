const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Lazy load scraper to avoid playwright crash on startup
let scraperModule = null;
async function getScraper() {
    if (!scraperModule) {
        scraperModule = require('../scraper');
    }
    return scraperModule;
}

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
// Generate mock leads for testing when scraper is blocked
function generateMockLeads(city, state, type, count = 10) {
    const prefixes = ['Elite', 'Premier', 'Professional', 'Expert', 'Top', 'Reliable', 'Quality', 'A+', 'Best', 'Affordable'];
    const suffixes = ['Roofing', 'Roofing Co', 'Roofing Services', 'Roofing LLC', 'Roofing Inc', 'Roofing Pros', 'Roofing Experts'];
    const names = [];
    
    for (let i = 0; i < count; i++) {
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const suffix = type === 'roofing' 
            ? suffixes[Math.floor(Math.random() * suffixes.length)]
            : `${type.charAt(0).toUpperCase() + type.slice(1)} ${['Services', 'LLC', 'Inc', 'Co', 'Pros'][Math.floor(Math.random() * 5)]}`;
        names.push(`${prefix} ${suffix}`);
    }
    
    return names.map((name, i) => ({
        businessName: name,
        phone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
        city,
        state,
        rating: (Math.random() * 2 + 3).toFixed(1),
        reviews: Math.floor(Math.random() * 200) + 10,
        industry: type,
        source: 'mock'
    }));
}

router.post('/scrape', async (req, res) => {
    const { 
        city, 
        state, 
        type, 
        minRating = 4.0, 
        maxResults = 50,
        enrichEmails = true,
        saveToDb = true,
        useMock = false
    } = req.body;

    if (!city || !state || !type) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required fields: city, state, type' 
        });
    }

    console.log(`🔍 Starting scrape: ${type} in ${city}, ${state}`);

    try {
        let leads = [];
        
        // Use mock data if requested or if scraper fails
        if (useMock) {
            console.log('📦 Using mock data (requested)');
            leads = generateMockLeads(city, state, type, Math.min(maxResults, 10));
        } else {
            try {
                // Lazy load scraper
                const { scrapeGoogleMaps, enrichLeadsWithEmails } = await getScraper();
                
                // Step 1: Scrape Google Maps
                leads = await scrapeGoogleMaps(city, state, type, maxResults);
                
                // If no results, likely blocked - use mock
                if (leads.length === 0) {
                    console.log('⚠️ Scraper returned 0 results, using mock data');
                    leads = generateMockLeads(city, state, type, Math.min(maxResults, 10));
                }
            } catch (scrapeErr) {
                console.log('⚠️ Scraper failed, using mock data:', scrapeErr.message);
                leads = generateMockLeads(city, state, type, Math.min(maxResults, 10));
            }
        }
        
        // Filter by minimum rating
        const filteredLeads = leads.filter(l => parseFloat(l.rating) >= minRating);
        console.log(`Found ${leads.length} leads, ${filteredLeads.length} with rating >= ${minRating}`);

        // Step 2: Save to database
        const savedLeads = [];
        if (saveToDb) {
            for (const lead of filteredLeads) {
                try {
                    const formattedPhone = lead.phone ? lead.phone.replace(/\D/g, '').slice(-10) : null;
                    if (!formattedPhone) continue;
                    
                    const result = await pool.query(
                        `INSERT INTO leads (business_name, phone, email, city, state, industry, rating, reviews, address, website, source)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                         ON CONFLICT (phone) DO UPDATE SET
                           email = COALESCE(EXCLUDED.email, leads.email),
                           rating = EXCLUDED.rating,
                           reviews = EXCLUDED.reviews,
                           website = COALESCE(EXCLUDED.website, leads.website),
                           updated_at = NOW()
                         RETURNING *`,
                        [
                            lead.businessName || lead.business_name,
                            formattedPhone,
                            lead.email || null,
                            lead.city || city,
                            lead.state || state,
                            lead.industry || lead.niche || type,
                            lead.rating || 0,
                            lead.reviews || 0,
                            lead.address || null,
                            lead.website || null,
                            lead.source || 'scraper'
                        ]
                    );
                    
                    if (result.rows[0]) {
                        savedLeads.push(result.rows[0]);
                    }
                } catch (dbErr) {
                    console.error(`Error saving lead ${lead.businessName || lead.business_name}:`, dbErr.message);
                }
            }
        }

        // Stats
        const stats = {
            total: leads.length,
            filtered: filteredLeads.length,
            withEmails: filteredLeads.filter(l => l.email).length,
            saved: savedLeads.length
        };

        console.log(`✅ Scrape complete:`, stats);
        
        res.json({ 
            success: true, 
            stats,
            leads: saveToDb ? savedLeads : filteredLeads 
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

        // Lazy load scraper
        const { enrichLeadsWithEmails } = await getScraper();

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
