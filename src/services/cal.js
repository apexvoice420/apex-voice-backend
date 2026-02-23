const fetch = require('node-fetch');

const CAL_API_URL = 'https://api.cal.com/v1';

/**
 * Get Cal.com API key
 */
function getCalApiKey() {
    return process.env.CAL_API_KEY;
}

/**
 * Get bookings from Cal.com
 */
async function getBookings(options = {}) {
    const apiKey = getCalApiKey();
    if (!apiKey) {
        console.log('CAL_API_KEY not configured');
        return [];
    }

    try {
        const params = new URLSearchParams({
            apiKey: apiKey,
            ...options.status && { status: options.status },
            ...options.afterStartDate && { afterStartDate: options.afterStartDate },
            ...options.beforeStartDate && { beforeStartDate: options.beforeStartDate },
        });

        const res = await fetch(`${CAL_API_URL}/bookings?${params}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            }
        });

        if (!res.ok) {
            const error = await res.text();
            console.error('Cal.com API error:', error);
            return [];
        }

        const data = await res.json();
        return data.bookings || [];
    } catch (error) {
        console.error('Error fetching Cal.com bookings:', error);
        return [];
    }
}

/**
 * Get event types (services)
 */
async function getEventTypes() {
    const apiKey = getCalApiKey();
    if (!apiKey) return [];

    try {
        const res = await fetch(`${CAL_API_URL}/event-types?apiKey=${apiKey}`);
        
        if (!res.ok) {
            console.error('Failed to fetch event types');
            return [];
        }

        const data = await res.json();
        return data.event_types || [];
    } catch (error) {
        console.error('Error fetching event types:', error);
        return [];
    }
}

/**
 * Format booking for CRM display
 */
function formatBooking(booking) {
    const startTime = new Date(booking.startTime);
    const endTime = new Date(booking.endTime);
    
    return {
        id: booking.id.toString(),
        time: startTime.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        }),
        endTime: endTime.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        }),
        name: booking.responses?.name || booking.title || 'Unknown',
        email: booking.responses?.email || null,
        phone: booking.responses?.phone || null,
        notes: booking.responses?.notes || null,
        service: booking.eventType?.title || booking.title || 'Appointment',
        status: booking.status || 'confirmed',
        date: startTime.toISOString().split('T')[0],
        startTime: booking.startTime,
        endTime: booking.endTime,
        raw: booking
    };
}

module.exports = {
    getCalApiKey,
    getBookings,
    getEventTypes,
    formatBooking
};
