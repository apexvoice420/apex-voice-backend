const fetch = require('node-fetch');

const APOLLO_API_URL = 'https://api.apollo.io/v1';

/**
 * Get Apollo API key
 */
function getApolloApiKey() {
    return process.env.APOLLO_API_KEY;
}

/**
 * Search for people/leads in Apollo
 */
async function searchPeople(options = {}) {
    const apiKey = getApolloApiKey();
    if (!apiKey) {
        console.log('APOLLO_API_KEY not configured');
        return { people: [], pagination: null };
    }

    try {
        const res = await fetch(`${APOLLO_API_URL}/mixed_people/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': apiKey
            },
            body: JSON.stringify({
                page: options.page || 1,
                per_page: options.perPage || 25,
                person_titles: options.titles || [],
                person_locations: options.locations || [],
                organization_locations: options.orgLocations || [],
                q_organization_domains: options.domains || [],
                contact_email_status: options.emailStatus || ['verified'],
                ...options
            })
        });

        if (!res.ok) {
            const error = await res.text();
            console.error('Apollo API error:', error);
            return { people: [], pagination: null, error };
        }

        const data = await res.json();
        return {
            people: data.people || [],
            pagination: data.pagination || null
        };
    } catch (error) {
        console.error('Error searching Apollo:', error);
        return { people: [], pagination: null, error: error.message };
    }
}

/**
 * Enrich a person/lead with Apollo data
 */
async function enrichPerson(email) {
    const apiKey = getApolloApiKey();
    if (!apiKey) return null;

    try {
        const res = await fetch(`${APOLLO_API_URL}/people/match`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': apiKey
            },
            body: JSON.stringify({
                email: email
            })
        });

        if (!res.ok) {
            return null;
        }

        const data = await res.json();
        return data.person || null;
    } catch (error) {
        console.error('Error enriching person:', error);
        return null;
    }
}

/**
 * Format Apollo person for CRM lead
 */
function formatPersonForLead(person) {
    return {
        businessName: person.organization?.name || person.name || '',
        name: person.name || '',
        phone: person.phone_numbers?.[0]?.raw_number || person.sanitized_phone || '',
        email: person.email || '',
        city: person.city || person.organization?.city || '',
        state: person.state || person.organization?.state || '',
        title: person.title || '',
        company: person.organization?.name || '',
        linkedin: person.linkedin_url || '',
        industry: person.organization?.industry || '',
        website: person.organization?.website_url || '',
        source: 'apollo'
    };
}

/**
 * Get organization by domain
 */
async function getOrganization(domain) {
    const apiKey = getApolloApiKey();
    if (!apiKey) return null;

    try {
        const res = await fetch(`${APOLLO_API_URL}/organizations/enrich`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': apiKey
            },
            body: JSON.stringify({
                domain: domain
            })
        });

        if (!res.ok) return null;

        const data = await res.json();
        return data.organization || null;
    } catch (error) {
        console.error('Error getting organization:', error);
        return null;
    }
}

module.exports = {
    getApolloApiKey,
    searchPeople,
    enrichPerson,
    formatPersonForLead,
    getOrganization
};
