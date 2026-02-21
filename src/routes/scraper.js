const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { chromium } = require('playwright-core');

// ANTIGRAVITY-POWERED SCRAPER
router.post('/scrape', async (req, res) => {
    const { city, state, type, minRating = 4.0, maxResults = 100 } = req.body;

    console.log(`🔍 Starting Antigravity scrape: ${type} in ${city}, ${state}`);

    let browser;
    try {
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(type)}+in+${encodeURIComponent(city)}+${state}`;

        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('[role="article"]', { timeout: 10000 });

        // Scroll
        const scrollPanel = await page.$('[role="feed"]');
        if (scrollPanel) {
            for (let i = 0; i < 5; i++) {
                await scrollPanel.evaluate(el => el.scrollBy(0, 1000));
                await page.waitForTimeout(1000);
            }
        }

        const results = [];
        const listings = await page.$$('[role="article"]');
        const actualMax = Math.min(listings.length, maxResults);

        for (let i = 0; i < actualMax; i++) {
            try {
                const listing = listings[i];
                const name = await listing.evaluate(el => el.getAttribute('aria-label') || el.innerText.split('\n')[0]);

                if (!name) continue;

                // Extract rating
                const ratingText = await listing.evaluate(el => {
                    const r = el.querySelector('.fontBodyMedium span[role="img"]');
                    return r ? r.getAttribute('aria-label') : '0 stars';
                });
                const rating = parseFloat(ratingText);

                if (rating >= minRating) {
                    await listing.click();
                    await page.waitForTimeout(1000);

                    const phone = await page.evaluate(() => {
                        const el = document.querySelector('[data-item-id*="phone"]');
                        return el ? el.textContent.trim() : null;
                    });

                    if (phone) {
                        const formattedPhone = phone.replace(/\D/g, '').slice(-10);
                        // Insert into DB
                        const result = await pool.query(
                            `INSERT INTO leads (business_name, phone, city, state, niche, rating, source)
                         VALUES ($1, $2, $3, $4, $5, $6, 'Google Maps')
                         ON CONFLICT (phone) DO NOTHING
                         RETURNING *`,
                            [name, formattedPhone, city, state, type, rating]
                        );

                        if (result.rows.length > 0) results.push(result.rows[0]);
                    }
                }
            } catch (e) { console.error(e); }
        }

        await browser.close();
        res.json({ success: true, found: results.length, leads: results });

    } catch (error) {
        if (browser) await browser.close();
        console.error('❌ Scraping error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
