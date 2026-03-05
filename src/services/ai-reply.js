const fetch = require('node-fetch');

/**
 * AI Reply Generator for Agent E
 * Uses Gemini to generate suggested responses and auto-replies
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Generate AI suggested reply based on incoming email
 */
async function generateSuggestedReply(emailData, leadContext = null) {
    if (!GEMINI_API_KEY) {
        return { suggestedReply: null, error: 'Gemini API key not configured' };
    }

    const { from, subject, body, intent } = emailData;
    const senderName = from.split('<')[0].trim().split(' ')[0] || 'there';

    const prompt = `You are Agent E, the email assistant for Apex Voice Solutions - an AI voice agency that provides 24/7 AI receptionists for local service businesses (roofers, plumbers, HVAC, medical offices).

INCOMING EMAIL:
From: ${from}
Subject: ${subject}
Body: ${body}

INTENT DETECTED: ${intent}

${leadContext ? `LEAD CONTEXT:
Business: ${leadContext.business_name || 'Unknown'}
Industry: ${leadContext.industry || 'Unknown'}
City: ${leadContext.city || 'Unknown'}
Status: ${leadContext.status || 'New'}
` : ''}

YOUR TASK:
Generate a brief, natural reply that sounds like it's from Maurice (the founder). The reply should:
1. Be under 100 words
2. Sound conversational, not corporate
3. Address their specific question/comment
4. Include a clear next step (CTA)
5. Match the intent: ${intent}

INTENT-SPECIFIC GUIDANCE:
- interested: Send calendar link (https://cal.com/maurice-pinnock-lrwndd)
- demo_request: Confirm demo, send calendar link
- pricing_request: Give ballpark ($500-3500 setup, $250-2000/mo) and ask about their call volume
- question: Answer directly, offer to hop on a call
- not_interested: Be gracious, leave door open
- general_reply: Be helpful, ask clarifying question

Reply in this JSON format only:
{
  "suggestedReply": "Your reply text here...",
  "confidence": 0.0-1.0,
  "shouldAutoReply": true/false,
  "reason": "Why this reply fits"
}`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500
                }
            })
        });

        const result = await response.json();
        
        if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
            const text = result.candidates[0].content.parts[0].text;
            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    suggestedReply: parsed.suggestedReply,
                    confidence: parsed.confidence || 0.8,
                    shouldAutoReply: parsed.shouldAutoReply || false,
                    reason: parsed.reason
                };
            }
        }

        // Fallback if JSON parsing fails
        return generateFallbackReply(emailData, senderName);

    } catch (error) {
        console.error('AI reply generation error:', error.message);
        return generateFallbackReply(emailData, senderName);
    }
}

/**
 * Generate fallback reply when AI fails
 */
function generateFallbackReply(emailData, senderName) {
    const { intent } = emailData;
    
    const fallbacks = {
        interested: {
            suggestedReply: `Hey ${senderName}!\n\nGreat to hear you're interested. Let's get a time on the calendar that works for you.\n\n📅 Pick a slot here: https://cal.com/maurice-pinnock-lrwndd\n\nOr just reply with your number and a good time to call.\n\n- Maurice`,
            confidence: 0.9,
            shouldAutoReply: true
        },
        demo_request: {
            suggestedReply: `Hey ${senderName}!\n\nAwesome! Let's get you a demo.\n\n📅 Pick a 15-min slot here: https://cal.com/maurice-pinnock-lrwndd\n\nTalk soon!\n- Maurice`,
            confidence: 0.9,
            shouldAutoReply: true
        },
        pricing_request: {
            suggestedReply: `Hey ${senderName}!\n\nGreat question! Pricing depends on your call volume, but here's the general range:\n\n• Setup: $500-$3,500 (one-time)\n• Monthly: $250-$2,000 (includes AI receptionist + usage)\n\nMost clients see ROI within the first month. Want me to run the numbers for your specific business?\n\n- Maurice`,
            confidence: 0.85,
            shouldAutoReply: true
        },
        not_interested: {
            suggestedReply: `Hey ${senderName},\n\nTotally understand. Timing is everything.\n\nIf anything changes and you want to stop missing those after-hours calls, you know where to find me.\n\nAll the best!\n- Maurice`,
            confidence: 0.8,
            shouldAutoReply: true
        },
        question: {
            suggestedReply: `Hey ${senderName}!\n\nThanks for reaching out. Happy to help answer your questions.\n\nWant to hop on a quick call? I can explain exactly how this would work for your business.\n\n📅 https://cal.com/maurice-pinnock-lrwndd\n\n- Maurice`,
            confidence: 0.7,
            shouldAutoReply: false
        },
        general_reply: {
            suggestedReply: `Hey ${senderName}!\n\nThanks for the reply. I'm here to help.\n\nWhat would you like to know more about - how the AI works, pricing, or setting up a demo?\n\n- Maurice`,
            confidence: 0.6,
            shouldAutoReply: false
        }
    };

    return fallbacks[intent] || fallbacks.general_reply;
}

/**
 * Check if auto-reply should be sent based on rules and confidence
 */
function shouldAutoReply(intent, confidence, businessHoursOnly = true) {
    // Auto-reply rules by intent
    const autoReplyIntents = ['interested', 'demo_request', 'pricing_request'];
    
    if (!autoReplyIntents.includes(intent)) return false;
    if (confidence < 0.8) return false;
    
    // Check business hours if required (9 AM - 8 PM ET)
    if (businessHoursOnly) {
        const now = new Date();
        const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const hour = et.getHours();
        if (hour < 9 || hour >= 20) return false;
    }
    
    return true;
}

module.exports = {
    generateSuggestedReply,
    shouldAutoReply,
    generateFallbackReply
};
