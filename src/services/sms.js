const twilio = require('twilio');

/**
 * Get Twilio client (reads fresh from env each time)
 */
function getTwilioClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
        return null;
    }
    
    return twilio(accountSid, authToken);
}

/**
 * Get Twilio phone number
 */
function getTwilioPhoneNumber() {
    return process.env.TWILIO_PHONE_NUMBER || null;
}

/**
 * Send SMS notification to business owner after a call
 */
async function sendCallSummarySMS(toPhone, summary, clientName) {
    const client = getTwilioClient();
    const fromPhone = getTwilioPhoneNumber();
    
    if (!client || !fromPhone) {
        console.log('Twilio not configured, skipping SMS');
        return { success: false, error: 'Twilio not configured' };
    }
    
    try {
        // Clean phone number
        const cleanTo = toPhone.replace(/\D/g, '');
        const formattedTo = cleanTo.length === 10 ? `+1${cleanTo}` : `+${cleanTo}`;
        
        // Create concise message
        const message = `📱 New call for ${clientName}:\n\n${summary.slice(0, 200)}${summary.length > 200 ? '...' : ''}\n\n- Apex Voice AI`;
        
        const result = await client.messages.create({
            body: message,
            from: fromPhone,
            to: formattedTo
        });
        
        console.log(`✅ SMS sent: ${result.sid}`);
        return { success: true, sid: result.sid };
        
    } catch (error) {
        console.error('SMS send error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send SMS to a lead
 */
async function sendLeadSMS(toPhone, message, businessName) {
    const client = getTwilioClient();
    const fromPhone = getTwilioPhoneNumber();
    
    if (!client || !fromPhone) {
        console.log('Twilio not configured, skipping SMS');
        return { success: false, error: 'Twilio not configured' };
    }
    
    try {
        const cleanTo = toPhone.replace(/\D/g, '');
        const formattedTo = cleanTo.length === 10 ? `+1${cleanTo}` : `+${cleanTo}`;
        
        const fullMessage = `${message}\n\n- ${businessName}`;
        
        const result = await client.messages.create({
            body: fullMessage,
            from: fromPhone,
            to: formattedTo
        });
        
        console.log(`✅ SMS sent to lead: ${result.sid}`);
        return { success: true, sid: result.sid };
        
    } catch (error) {
        console.error('SMS send error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send booking confirmation SMS
 */
async function sendBookingConfirmation(toPhone, details) {
    const client = getTwilioClient();
    const fromPhone = getTwilioPhoneNumber();
    
    if (!client || !fromPhone) {
        console.log('Twilio not configured, skipping SMS');
        return { success: false, error: 'Twilio not configured' };
    }
    
    try {
        const cleanTo = toPhone.replace(/\D/g, '');
        const formattedTo = cleanTo.length === 10 ? `+1${cleanTo}` : `+${cleanTo}`;
        
        const message = `📅 Appointment Confirmed!\n\n${details.businessName}\n${details.date} at ${details.time}\n${details.address || ''}\n\nQuestions? Call us!`;
        
        const result = await client.messages.create({
            body: message,
            from: fromPhone,
            to: formattedTo
        });
        
        console.log(`✅ Booking confirmation sent: ${result.sid}`);
        return { success: true, sid: result.sid };
        
    } catch (error) {
        console.error('SMS send error:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    getTwilioClient,
    getTwilioPhoneNumber,
    sendCallSummarySMS,
    sendLeadSMS,
    sendBookingConfirmation
};
