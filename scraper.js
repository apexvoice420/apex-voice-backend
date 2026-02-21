const fetch = require('node-fetch');

/**
 * Scrape Yelp for local businesses (no browser needed)
 */
async function scrapeYelp(city, state, type, maxResults = 20) {
    console.log(`Scraping Yelp for ${type} in ${city}, ${state}...`);
    
    const leads = [];
    
    try {
        const query = `${type} ${city} ${state}`;
        const url = `https://www.yelp.com/search/snippet?find_desc=${encodeURIComponent(query)}&find_loc=${encodeURIComponent(city + ', ' + state)}`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        
        const data = await response.json();
        
        if (data.searchPageProps && data.searchPageProps.searchResultsProps) {
            const results = data.searchPageProps.searchResultsProps.searchResults || [];
            
            for (const result of results.slice(0, maxResults)) {
                const biz = result.searchResultBusiness;
                
                if (biz && biz.name) {
                    leads.push({
                        businessName: biz.name,
                        phone: biz.phone || '',
                        city: city,
                        state: state,
                        rating: biz.rating || 0,
                        reviews: biz.reviewCount || 0,
                        address: biz.addressLines ? biz.addressLines.join(', ') : '',
                        website: biz.businessUrl ? `https://yelp.com${biz.businessUrl}` : '',
                        industry: type,
                        source: 'Yelp',
                        scrapedAt: new Date().toISOString()
                    });
                }
            }
        }
        
        console.log(`Found ${leads.length} leads from Yelp`);
        
    } catch (error) {
        console.error('Yelp scrape error:', error.message);
    }
    
    return leads;
}

/**
 * Generate demo leads for testing
 */
function generateDemoLeads(city, state, type, maxResults = 20) {
    console.log(`Generating ${maxResults} demo leads for ${type} in ${city}, ${state}...`);
    
    const prefixes = {
        'roofing': ['Elite', 'Premier', 'Top', 'A+', 'Quality', 'Professional', 'Expert', 'Reliable'],
        'plumber': ['Quick', 'Affordable', '24/7', 'Emergency', 'Pro', 'Master', 'City', 'All-Star'],
        'hvac': ['Cool', 'Comfort', 'Climate', 'Air', 'Temperature', 'Heating & Cooling', 'AC Pro', 'Total'],
        'electrician': ['Bright', 'Power', 'Sparky', 'Electric', 'Lighthouse', 'Circuit', 'Wire Pro', 'Energy']
    };
    
    const suffixes = ['Services', 'Solutions', 'Company', 'Experts', 'Pros', 'Group', 'LLC', 'Inc'];
    
    const areaCodes = {
        'FL': ['386', '904', '321', '407', '863', '941', '813', '727'],
        'NY': ['718', '347', '929', '212', '646', '917', '516', '631'],
        'CA': ['310', '424', '323', '213', '818', '747', '408', '669']
    };
    
    const typePrefixes = prefixes[type] || prefixes['roofing'];
    const codes = areaCodes[state] || areaCodes['FL'];
    
    const leads = [];
    
    for (let i = 0; i < maxResults; i++) {
        const prefix = typePrefixes[Math.floor(Math.random() * typePrefixes.length)];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        
        const areaCode = codes[Math.floor(Math.random() * codes.length)];
        const phone = `(${areaCode}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`;
        
        const rating = (3.5 + Math.random() * 1.5).toFixed(1);
        const reviews = Math.floor(Math.random() * 200) + 10;
        
        leads.push({
            businessName: `${prefix} ${type.charAt(0).toUpperCase() + type.slice(1)} ${suffix}`,
            phone: phone,
            city: city,
            state: state,
            rating: parseFloat(rating),
            reviews: reviews,
            address: `${Math.floor(Math.random() * 9000) + 100} Main St, ${city}, ${state}`,
            website: '',
            industry: type,
            source: 'Demo',
            scrapedAt: new Date().toISOString()
        });
    }
    
    return leads;
}

/**
 * Main scraper function - tries Yelp, falls back to demo
 */
async function scrapeGoogleMaps(city, state, type, maxResults = 20) {
    // Try Yelp first
    let leads = await scrapeYelp(city, state, type, maxResults);
    
    // If Yelp fails or returns nothing, use demo data
    if (leads.length === 0) {
        console.log('Yelp returned no results, generating demo leads...');
        leads = generateDemoLeads(city, state, type, maxResults);
    }
    
    return leads;
}

module.exports = { scrapeGoogleMaps, scrapeYelp, generateDemoLeads };
