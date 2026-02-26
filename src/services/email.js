const fetch = require('node-fetch');

/**
 * Agent E - Email Outreach Service
 * Powered by Resend
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'maurice.pinnock@apexvoicesolutions.com';
const TEST_FROM_EMAIL = 'onboarding@resend.dev'; // Resend's test domain

/**
 * Send email via Resend API
 */
async function sendEmail({ to, subject, html, text }) {
    if (!RESEND_API_KEY) {
        console.log('Resend not configured, skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: FROM_EMAIL,
                to: Array.isArray(to) ? to : [to],
                subject,
                html,
                text: text || html.replace(/<[^>]*>/g, '')
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('Resend error:', result);
            return { success: false, error: result.message || 'Email send failed' };
        }

        console.log(`✅ Email sent: ${result.id}`);
        return { success: true, id: result.id };

    } catch (error) {
        console.error('Email send error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Omni-Strategist Email Templates
 */

// Cold intro email for new leads
function getColdIntroTemplate(firstName, businessType) {
    const subject = `${firstName}, your ${businessType || 'service'} business is missing calls`;
    
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p style="font-size: 16px; line-height: 1.6;">Hey ${firstName},</p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                Quick question: What happens when a potential customer calls your ${businessType || 'service'} business at 9 PM?
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                If you're like most local service businesses, that call goes to voicemail. And that customer? They're calling your competitor next.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                <strong>Every missed call is lost revenue.</strong>
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                We built Apex Voice Solutions to fix this. Our AI receptionists:
            </p>
            
            <ul style="font-size: 16px; line-height: 1.8;">
                <li>Answer every call 24/7</li>
                <li>Qualify leads while you sleep</li>
                <li>Book jobs directly into your calendar</li>
                <li>Sound indistinguishable from a human</li>
            </ul>
            
            <p style="font-size: 16px; line-height: 1.6;">
                No more missed calls. No more lost jobs. Just more revenue.
            </p>
            
            <p style="margin: 30px 0;">
                <a href="https://apexvoicesolutions.org" style="background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">Hear It In Action →</a>
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                Or reply to this email and I'll show you exactly how it works for your business.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; margin-top: 30px;">
                Best,<br>
                Maurice Pinnock<br>
                Apex Voice Solutions
            </p>
        </div>
    `;

    return { subject, html };
}

// Warm lead - demo requested
function getDemoConfirmationTemplate(firstName, scheduledTime) {
    const subject = `Confirmed: Your Apex Voice Demo ${scheduledTime ? `- ${scheduledTime}` : ''}`;
    
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p style="font-size: 16px; line-height: 1.6;">Hey ${firstName},</p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                Your demo is confirmed! 🎉
            </p>
            
            ${scheduledTime ? `
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 18px; font-weight: bold;">📅 ${scheduledTime}</p>
            </div>
            ` : ''}
            
            <p style="font-size: 16px; line-height: 1.6;">
                During our call, I'll show you:
            </p>
            
            <ul style="font-size: 16px; line-height: 1.8;">
                <li>How our AI handles real calls</li>
                <li>Custom setup for your business type</li>
                <li>Pricing that fits your budget</li>
            </ul>
            
            <p style="font-size: 16px; line-height: 1.6;">
                <a href="https://cal.com/maurice-pinnock-lrwndd" style="color: #6366f1;">Need to reschedule? Click here</a>
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; margin-top: 30px;">
                Talk soon,<br>
                Maurice
            </p>
        </div>
    `;

    return { subject, html };
}

// Follow-up after no response
function getFollowUpTemplate(firstName, businessType) {
    const subject = `Still interested in never missing a call, ${firstName}?`;
    
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p style="font-size: 16px; line-height: 1.6;">Hey ${firstName},</p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                I reached out a few days ago about solving the missed call problem for your ${businessType || 'service'} business.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                Quick math: If you miss just 2 calls a week at an average job value of $500, that's <strong>$52,000 in lost revenue per year</strong>.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                Our AI receptionist costs less than a single missed job per month.
            </p>
            
            <p style="margin: 30px 0;">
                <a href="https://apexvoicesolutions.org" style="background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">See How It Works →</a>
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                Or just reply "call me" and I'll reach out personally.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; margin-top: 30px;">
                Best,<br>
                Maurice Pinnock<br>
                Apex Voice Solutions
            </p>
        </div>
    `;

    return { subject, html };
}

// Reactivation for cold leads
function getReactivationTemplate(firstName, businessType) {
    const subject = `${firstName}, are you still running your ${businessType || 'service'} business?`;
    
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p style="font-size: 16px; line-height: 1.6;">Hey ${firstName},</p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                I wanted to check in — are you still taking on new customers for your ${businessType || 'service'} business?
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                If so, I'd love to show you something that's been working really well for businesses like yours.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                <a href="https://cal.com/maurice-pinnock-lrwndd" style="color: #6366f1;">Pick a 15-min time that works →</a>
            </p>
            
            <p style="font-size: 16px; line-height: 1.6;">
                No pressure — just wanted to keep the door open.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; margin-top: 30px;">
                Best,<br>
                Maurice
            </p>
        </div>
    `;

    return { subject, html };
}

/**
 * Send test email using Resend's test domain
 * Works without domain verification
 */
async function sendTestEmail(to, template = 'cold_intro') {
    const testLead = {
        firstName: 'Maurice',
        businessType: 'Roofing',
        business_name: 'Test Roofing Co',
        city: 'Daytona Beach',
        rating: 4.8,
        reviews: 127
    };

    let subject, html;
    
    switch (template) {
        case 'follow_up':
            ({ subject, html } = getFollowUpTemplate(testLead.firstName, testLead.businessType));
            break;
        case 'demo':
            ({ subject, html } = getDemoConfirmationTemplate(testLead.firstName, 'Tomorrow at 2pm'));
            break;
        case 'reactivation':
            ({ subject, html } = getReactivationTemplate(testLead.firstName, testLead.businessType));
            break;
        default:
            ({ subject, html } = getColdIntroTemplate(testLead.firstName, testLead.businessType));
    }

    // Add test banner
    html = `
        <div style="background: #fef3c7; padding: 10px; text-align: center; font-weight: bold;">
            🧪 TEST EMAIL FROM AGENT E
        </div>
        ${html}
    `;

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: TEST_FROM_EMAIL,
                to: [to],
                subject: `[TEST] ${subject}`,
                html,
                text: html.replace(/<[^>]*>/g, '')
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('Resend error:', result);
            return { success: false, error: result.message || 'Email send failed' };
        }

        console.log(`✅ Test email sent: ${result.id}`);
        return { success: true, id: result.id };

    } catch (error) {
        console.error('Test email error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send cold intro email to new lead
 */
async function sendColdIntro(lead) {
    const template = getColdIntroTemplate(lead.firstName || lead.name || 'there', lead.businessType);
    return sendEmail({
        to: lead.email,
        subject: template.subject,
        html: template.html
    });
}

/**
 * Send demo confirmation
 */
async function sendDemoConfirmation(lead, scheduledTime) {
    const template = getDemoConfirmationTemplate(lead.firstName || lead.name || 'there', scheduledTime);
    return sendEmail({
        to: lead.email,
        subject: template.subject,
        html: template.html
    });
}

/**
 * Send follow-up (no response)
 */
async function sendFollowUp(lead) {
    const template = getFollowUpTemplate(lead.firstName || lead.name || 'there', lead.businessType);
    return sendEmail({
        to: lead.email,
        subject: template.subject,
        html: template.html
    });
}

/**
 * Send reactivation email
 */
async function sendReactivation(lead) {
    const template = getReactivationTemplate(lead.firstName || lead.name || 'there', lead.businessType);
    return sendEmail({
        to: lead.email,
        subject: template.subject,
        html: template.html
    });
}

/**
 * Process lead with Agent E
 * Classifies and sends appropriate email
 */
async function processLeadWithAgentE(lead) {
    const status = lead.status?.toLowerCase() || 'new';
    
    console.log(`📧 Agent E processing lead: ${lead.email} (${status})`);
    
    let result;
    
    switch (status) {
        case 'new':
        case 'cold':
            result = await sendColdIntro(lead);
            break;
        case 'demo':
        case 'demo_requested':
            result = await sendDemoConfirmation(lead);
            break;
        case 'follow_up':
        case 'no_response':
            result = await sendFollowUp(lead);
            break;
        case 'cold_lead':
        case 'reactivation':
            result = await sendReactivation(lead);
            break;
        default:
            result = await sendColdIntro(lead);
    }
    
    return result;
}

module.exports = {
    sendEmail,
    sendTestEmail,
    sendColdIntro,
    sendDemoConfirmation,
    sendFollowUp,
    sendReactivation,
    processLeadWithAgentE,
    getColdIntroTemplate,
    getDemoConfirmationTemplate,
    getFollowUpTemplate,
    getReactivationTemplate
};
