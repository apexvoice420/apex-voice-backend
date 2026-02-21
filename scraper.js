const { chromium } = require('playwright');

/**
 * Scrape Google Maps for local businesses
 * @param {string} city - City name
 * @param {string} state - State abbreviation
 * @param {string} type - Business type (roofing, plumber, hvac, etc.)
 * @param {number} maxResults - Maximum results to return
 * @returns {Array} Array of lead objects
 */
async function scrapeGoogleMaps(city, state, type, maxResults = 20) {
    console.log(`Starting scrape for ${type} in ${city}, ${state}...`);
    
    let browser = null;
    const leads = [];

    try {
        // Launch browser with proper config for Railway/Docker
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        const page = await context.newPage();

        // Build search query
        const query = `${type} near ${city}, ${state}`;
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

        console.log(`Navigating to: ${searchUrl}`);
        
        await page.goto(searchUrl, {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Wait for results to load
        await page.waitForTimeout(2000);

        // Scroll to load more results
        try {
            await page.evaluate(async () => {
                const feed = document.querySelector('div[role="feed"]') || 
                            document.querySelector('[data-result-id]')?.parentElement?.parentElement;
                
                if (feed) {
                    for (let i = 0; i < 8; i++) {
                        feed.scrollTop = feed.scrollHeight;
                        await new Promise(r => setTimeout(r, 800));
                    }
                }
            });
        } catch (scrollErr) {
            console.log('Scroll failed, continuing with visible results');
        }

        // Extract business listings
        const listings = await page.$$('div[role="article"], [data-item-id], .Nv2PK');
        console.log(`Found ${listings.length} potential listings`);

        for (const listing of listings) {
            if (leads.length >= maxResults) break;

            try {
                // Click to expand
                await listing.click();
                await page.waitForTimeout(500);

                // Extract data
                const data = await page.evaluate(() => {
                    const getText = (selector) => {
                        const el = document.querySelector(selector);
                        return el ? el.textContent.trim() : null;
                    };

                    // Business name
                    const name = getText('h1.DUwDvf-SPZz6') || 
                                 getText('[data-item-id*="title"]') ||
                                 getText('.fontHeadlineSmall');

                    // Phone number
                    const phoneEl = document.querySelector('[data-item-id*="phone:tel"]');
                    const phone = phoneEl ? phoneEl.getAttribute('data-item-id')?.replace('phone:tel:', '') : null;

                    // Rating
                    const ratingEl = document.querySelector('[role="img"][aria-label*="stars"]');
                    const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/(\d\.\d)/);
                    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

                    // Reviews count
                    const reviewsEl = document.querySelector('[role="link"][aria-label*="review"]');
                    const reviewsMatch = reviewsEl?.textContent?.match(/\((\d+)\)/);
                    const reviews = reviewsMatch ? parseInt(reviewsMatch[1]) : 0;

                    // Address
                    const address = getText('[data-item-id*="address"]') || getText('.rogA2c');

                    // Website
                    const websiteEl = document.querySelector('[data-item-id*="authority"] a');
                    const website = websiteEl ? websiteEl.href : null;

                    return { name, phone, rating, reviews, address, website };
                });

                if (data.name && data.phone) {
                    // Clean phone number
                    const cleanPhone = data.phone.replace(/[^\d+()-]/g, '').trim();
                    
                    leads.push({
                        businessName: data.name,
                        phone: cleanPhone,
                        city: city,
                        state: state,
                        rating: data.rating || 0,
                        reviews: data.reviews || 0,
                        address: data.address,
                        website: data.website,
                        industry: type,
                        source: 'Google Maps',
                        scrapedAt: new Date().toISOString()
                    });

                    console.log(`✓ ${data.name} - ${cleanPhone}`);
                }
            } catch (itemErr) {
                console.log('Error extracting listing:', itemErr.message);
            }
        }

    } catch (error) {
        console.error('Scraping error:', error.message);
        
        // Return partial results if we have any
        if (leads.length === 0) {
            throw error;
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    console.log(`Scraped ${leads.length} leads`);
    return leads;
}

/**
 * Alternative scraper using Yelp (fallback if Google Maps blocked)
 */
async function scrapeYelp(city, state, type, maxResults = 20) {
    let browser = null;
    const leads = [];

    try {
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        const query = `${type} ${city} ${state}`;
        await page.goto(`https://www.yelp.com/search?find_desc=${encodeURIComponent(query)}`, {
            waitUntil: 'networkidle'
        });

        await page.waitForTimeout(2000);

        const listings = await page.$$('[data-testid="serp-ia-card"]');
        
        for (const listing of listings.slice(0, maxResults)) {
            try {
                const text = await listing.innerText();
                const lines = text.split('\n');
                
                const phoneMatch = text.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
                const ratingMatch = text.match(/(\d\.\d)\s+star/);

                if (phoneMatch && lines[0]) {
                    leads.push({
                        businessName: lines[0],
                        phone: phoneMatch[0],
                        city: city,
                        state: state,
                        rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
                        industry: type,
                        source: 'Yelp',
                        scrapedAt: new Date().toISOString()
                    });
                }
            } catch (e) {
                // Skip failed listings
            }
        }

    } catch (error) {
        console.error('Yelp scraping error:', error.message);
    } finally {
        if (browser) await browser.close();
    }

    return leads;
}

module.exports = { scrapeGoogleMaps, scrapeYelp };
