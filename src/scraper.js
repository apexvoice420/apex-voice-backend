const { chromium } = require('playwright-core');

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

                    // Email - check multiple possible locations
                    let email = null;
                    
                    // Method 1: Check for email in data-item-id
                    const emailEl = document.querySelector('[data-item-id*="email"]');
                    if (emailEl) {
                        const emailText = emailEl.textContent || emailEl.getAttribute('data-item-id');
                        const emailMatch = emailText.match(/[\w.-]+@[\w.-]+\.\w+/);
                        if (emailMatch) email = emailMatch[0];
                    }
                    
                    // Method 2: Search all buttons/links for email pattern
                    if (!email) {
                        const allButtons = document.querySelectorAll('button, a, [role="button"]');
                        for (const btn of allButtons) {
                            const text = btn.textContent || btn.href || '';
                            const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
                            if (match) {
                                email = match[0];
                                break;
                            }
                        }
                    }
                    
                    // Method 3: Check info section text for email
                    if (!email) {
                        const infoSection = document.querySelector('.iP7tXb, .Rfs5Vd, [role="region"]');
                        if (infoSection) {
                            const text = infoSection.textContent;
                            const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
                            if (match) email = match[0];
                        }
                    }

                    return { name, phone, rating, reviews, address, website, email };
                });

                if (data.name && data.phone) {
                    // Clean phone number
                    const cleanPhone = data.phone.replace(/[^\d+()-]/g, '').trim();
                    
                    leads.push({
                        businessName: data.name,
                        phone: cleanPhone,
                        email: data.email || null,
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

                    console.log(`✓ ${data.name} - ${cleanPhone}${data.email ? ` - ${data.email}` : ''}`);
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

/**
 * Scrape a website for email addresses
 * Visits homepage + common contact pages
 */
async function scrapeWebsiteForEmail(websiteUrl, browser = null) {
    let ownBrowser = false;
    let page = null;
    
    if (!browser) {
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        ownBrowser = true;
    }

    const emails = new Set();
    
    try {
        page = await browser.newPage();
        
        // Pages to check for emails (in priority order)
        const urlObj = new URL(websiteUrl);
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        
        const pagesToCheck = [
            websiteUrl,
            `${baseUrl}/contact`,
            `${baseUrl}/contact-us`,
            `${baseUrl}/about`,
            `${baseUrl}/about-us`,
        ];

        for (const url of pagesToCheck) {
            try {
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 10000
                });

                await page.waitForTimeout(500);

                // Extract emails from page content
                const pageEmails = await page.evaluate(() => {
                    const found = [];
                    const text = document.body.innerHTML;
                    
                    // Regex for email patterns
                    const emailRegex = /[\w.-]+@[\w.-]+\.\w{2,}/g;
                    const matches = text.match(emailRegex) || [];
                    
                    // Filter out common false positives
                    const excludePatterns = [
                        'example.com', 'domain.com', 'email.com', 'youremail',
                        'sentry', 'google', 'facebook', 'instagram', 'twitter',
                        'linkedin', 'youtube', 'gmail.com', 'yahoo.com', 'hotmail',
                        'png', 'jpg', 'svg', 'ico', '.js', '.css', 'schema.org',
                        'wixpress', 'godaddy', 'squarespace', 'mailchimp'
                    ];
                    
                    for (const email of matches) {
                        const lower = email.toLowerCase();
                        const isExcluded = excludePatterns.some(p => lower.includes(p));
                        
                        if (!isExcluded && email.includes('.')) {
                            found.push(email.toLowerCase());
                        }
                    }
                    
                    return found;
                });

                pageEmails.forEach(e => emails.add(e));
                
                if (emails.size > 0) {
                    // Found emails, no need to check more pages
                    break;
                }
            } catch (pageErr) {
                // Page doesn't exist or failed to load, continue
            }
        }

    } catch (error) {
        // Site might be down or blocked
    } finally {
        if (page) await page.close();
        if (ownBrowser && browser) await browser.close();
    }

    return Array.from(emails);
}

/**
 * Enrich leads with emails from their websites
 * @param {Array} leads - Array of lead objects from scrapeGoogleMaps
 * @param {number} maxSites - Max websites to scrape (for rate limiting)
 * @returns {Array} Enriched leads with emails populated
 */
async function enrichLeadsWithEmails(leads, maxSites = 50) {
    console.log(`Enriching ${Math.min(leads.length, maxSites)} leads with website emails...`);
    
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    let enriched = 0;

    try {
        for (let i = 0; i < leads.length && i < maxSites; i++) {
            const lead = leads[i];
            
            // Skip if already has email from GMB
            if (lead.email) {
                console.log(`  [${i + 1}/${leads.length}] ${lead.businessName} - already has email`);
                continue;
            }
            
            // Skip if no website
            if (!lead.website) {
                console.log(`  [${i + 1}/${leads.length}] ${lead.businessName} - no website`);
                continue;
            }

            console.log(`  [${i + 1}/${leads.length}] Checking ${lead.website}...`);
            
            try {
                const websiteEmails = await scrapeWebsiteForEmail(lead.website, browser);
                
                if (websiteEmails.length > 0) {
                    // Prioritize info@, contact@, sales@ emails
                    const priorityEmail = websiteEmails.find(e => 
                        e.startsWith('info@') || 
                        e.startsWith('contact@') || 
                        e.startsWith('sales@') ||
                        e.startsWith('admin@')
                    );
                    
                    lead.email = priorityEmail || websiteEmails[0];
                    lead.emailSource = 'website';
                    lead.allEmails = websiteEmails;
                    enriched++;
                    console.log(`    ✓ Found: ${lead.email}`);
                } else {
                    console.log(`    ✗ No emails found`);
                }
                
                // Rate limiting - be nice to servers
                await new Promise(r => setTimeout(r, 800));
                
            } catch (err) {
                console.log(`    ✗ Error: ${err.message}`);
            }
        }
    } finally {
        await browser.close();
    }

    console.log(`Enriched ${enriched} leads with emails from websites`);
    return leads;
}

module.exports = { scrapeGoogleMaps, scrapeYelp, scrapeWebsiteForEmail, enrichLeadsWithEmails };
