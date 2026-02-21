const fetch = require('node-fetch');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE_URL = 'https://api.vapi.ai';

/**
 * Create a VAPI assistant for a client
 */
async function createAssistant(client) {
    if (!VAPI_API_KEY) {
        console.log('VAPI_API_KEY not configured, skipping assistant creation');
        return null;
    }

    const greeting = client.greeting || 
        `Thank you for calling ${client.business_name}. This is your AI assistant. How can I help you today?`;

    const systemPrompt = buildSystemPrompt(client);

    const payload = {
        name: `${client.business_name} Receptionist`,
        model: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                }
            ]
        },
        voice: {
            provider: 'elevenlabs',
            voiceId: getVoiceId(client.voice_style || 'professional')
        },
        firstMessage: greeting,
        voicemailMessage: `Thanks for calling ${client.business_name}. Please leave a message and we'll get back to you shortly.`,
        endCallMessage: `Thank you for calling ${client.business_name}. Have a great day!`,
        recordingEnabled: true,
        summaryPrompt: `Summarize the call. Include: caller name, phone number, reason for calling, urgency level (low/medium/high), and any scheduled appointments.`,
        successEvaluationPlan: {
            rubric: 'Did the assistant successfully help the caller? Was an appointment booked or message taken?'
        }
    };

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const error = await res.text();
            console.error('VAPI assistant creation failed:', error);
            return null;
        }

        const assistant = await res.json();
        console.log(`✅ Created VAPI assistant: ${assistant.id}`);
        return assistant;
    } catch (error) {
        console.error('Error creating VAPI assistant:', error);
        return null;
    }
}

/**
 * Buy/provision a phone number for the assistant
 */
async function provisionPhoneNumber(assistantId, areaCode = '386') {
    if (!VAPI_API_KEY) {
        console.log('VAPI_API_KEY not configured, skipping phone provisioning');
        return null;
    }

    try {
        const res = await fetch(`${VAPI_BASE_URL}/phone-number`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                assistantId: assistantId,
                areaCode: areaCode,
                twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
                twilioAuthToken: process.env.TWILIO_AUTH_TOKEN
            })
        });

        if (!res.ok) {
            const error = await res.text();
            console.error('Phone provisioning failed:', error);
            return null;
        }

        const phoneNumber = await res.json();
        console.log(`✅ Provisioned phone: ${phoneNumber.number}`);
        return phoneNumber;
    } catch (error) {
        console.error('Error provisioning phone:', error);
        return null;
    }
}

/**
 * Get existing VAPI assistants
 */
async function listAssistants() {
    if (!VAPI_API_KEY) return [];

    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant`, {
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`
            }
        });

        if (res.ok) {
            return await res.json();
        }
    } catch (error) {
        console.error('Error listing assistants:', error);
    }
    return [];
}

/**
 * Build system prompt based on client config
 */
function buildSystemPrompt(client) {
    const industry = client.industry || 'service';
    const services = client.services || 'general services';
    const faq = client.faq || '';

    return `You are a professional AI receptionist for ${client.business_name}, a ${industry} company in ${client.city || ''}, ${client.state || ''}.

## Your Role
- Answer calls professionally and courteously
- Qualify leads by asking about their needs
- Schedule appointments when appropriate
- Handle emergencies by escalating to the owner
- Take detailed messages when needed

## Services Offered
${services}

## Key Information
- Business hours: 24/7 AI-assisted, with emergency escalation available
- For emergencies: Immediately offer to escalate to the owner
- Always get: caller name, phone number, and reason for calling

## Call Handling Rules
1. Greet the caller warmly
2. Ask how you can help them today
3. Gather essential information (name, phone, issue)
4. If it's an emergency (leak, no AC, no heat, etc.), offer immediate escalation
5. For non-emergencies, try to schedule an appointment
6. Confirm details before ending the call
7. Thank them for calling

## FAQ
${faq}

## Escalation
For emergencies, say: "This sounds urgent. Let me connect you directly to our owner who can help right away."
Then use the escalation workflow.

Always be helpful, professional, and efficient. Never say "I don't know" - instead say "Let me find out for you" or connect them to someone who can help.`;
}

/**
 * Get voice ID based on style preference
 */
function getVoiceId(style) {
    const voices = {
        'professional': '21m00Tcm4TlvDq8ikWAM', // Rachel - professional
        'friendly': 'EXAVITQu4vr4xnSDxMaL',    // Bella - friendly
        'casual': 'AZnzlk1JgcdCRfdmrtbI',      // Domi - casual
    };
    return voices[style] || voices['professional'];
}

module.exports = {
    createAssistant,
    provisionPhoneNumber,
    listAssistants,
    buildSystemPrompt
};
