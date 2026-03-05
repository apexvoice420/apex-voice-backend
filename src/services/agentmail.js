const fetch = require('node-fetch');

/**
 * AgentMail Service
 * Handles incoming emails and thread management for Agent E
 * https://docs.agentmail.to
 */

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_BASE_URL = 'https://api.agentmail.to/v0';
const INBOX_ID = process.env.AGENTMAIL_INBOX || 'apexvoicesolutions@agentmail.to';

/**
 * List all inboxes
 */
async function listInboxes() {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes`, {
        headers: { 'Authorization': `Bearer ${AGENTMAIL_API_KEY}` }
    });
    return response.json();
}

/**
 * Get messages from inbox
 */
async function getMessages(limit = 50, before = null) {
    let url = `${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/messages?limit=${limit}`;
    if (before) url += `&before=${before}`;
    
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AGENTMAIL_API_KEY}` }
    });
    return response.json();
}

/**
 * Get a specific message
 */
async function getMessage(messageId) {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/messages/${encodeURIComponent(messageId)}`, {
        headers: { 'Authorization': `Bearer ${AGENTMAIL_API_KEY}` }
    });
    return response.json();
}

/**
 * Get full message content (body)
 */
async function getMessageContent(messageId) {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/messages/${encodeURIComponent(messageId)}/content`, {
        headers: { 'Authorization': `Bearer ${AGENTMAIL_API_KEY}` }
    });
    return response.text();
}

/**
 * Get all messages in a thread
 */
async function getThread(threadId) {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/threads/${threadId}`, {
        headers: { 'Authorization': `Bearer ${AGENTMAIL_API_KEY}` }
    });
    return response.json();
}

/**
 * Send a reply (via AgentMail - uses their domain)
 * For custom domain, we still use Resend
 */
async function sendReply({ to, subject, text, html, replyToMessageId }) {
    const body = {
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html
    };
    
    if (replyToMessageId) {
        body.reply_to = replyToMessageId;
    }
    
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/messages/send`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    return response.json();
}

/**
 * Mark message as read
 */
async function markAsRead(messageId) {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/messages/${encodeURIComponent(messageId)}/labels`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            remove: ['unread']
        })
    });
    return response.json();
}

/**
 * Process incoming email webhook
 * Called when AgentMail receives a new email
 */
async function processIncomingEmail(message) {
    console.log(`📧 Incoming email from: ${message.from}`);
    console.log(`   Subject: ${message.subject}`);
    console.log(`   Thread: ${message.thread_id}`);
    
    // Extract sender email
    const fromEmail = message.from?.match(/<(.+?)>/)?.[1] || message.from;
    
    return {
        success: true,
        message: {
            id: message.message_id,
            threadId: message.thread_id,
            from: message.from,
            fromEmail,
            to: message.to,
            subject: message.subject,
            preview: message.preview,
            timestamp: message.timestamp,
            labels: message.labels,
            unread: message.labels?.includes('unread')
        }
    };
}

/**
 * Get unread count
 */
async function getUnreadCount() {
    const messages = await getMessages(100);
    return messages.messages?.filter(m => m.labels?.includes('unread')).length || 0;
}

/**
 * Search messages
 */
async function searchMessages(query) {
    // AgentMail doesn't have search API yet, so we filter client-side
    const messages = await getMessages(100);
    const lowerQuery = query.toLowerCase();
    
    return messages.messages?.filter(m => 
        m.subject?.toLowerCase().includes(lowerQuery) ||
        m.from?.toLowerCase().includes(lowerQuery) ||
        m.preview?.toLowerCase().includes(lowerQuery)
    ) || [];
}

/**
 * Parse AgentMail webhook payload
 */
function parseWebhookPayload(payload) {
    return {
        from: payload.from || payload.sender,
        to: payload.to || payload.recipient,
        subject: payload.subject,
        body: payload.body || payload.text || payload.html,
        bodyHtml: payload.html,
        messageId: payload.message_id || payload.messageId,
        inReplyTo: payload.in_reply_to || payload.inReplyTo,
        threadId: payload.thread_id || payload.threadId,
        timestamp: payload.timestamp || new Date().toISOString(),
        raw: payload
    };
}

/**
 * Detect intent from email content
 */
function detectIntent(subject, body) {
    const text = `${subject} ${body}`.toLowerCase();
    
    // Interest signals
    const interestKeywords = ['interested', 'sounds good', 'tell me more', 'yes', 'sure', "let's talk", 'can you call', 'call me', 'sign me up'];
    const pricingKeywords = ['price', 'cost', 'how much', 'pricing', 'fee', 'rate', 'charge', 'expensive', 'cheap'];
    const demoKeywords = ['demo', 'see it', 'show me', 'how does it work', 'try it', 'hear it', 'listen'];
    const notInterestedKeywords = ['not interested', 'no thanks', 'not for me', "don't need", 'not right now', 'remove', 'unsubscribe'];
    const questionKeywords = ['?', 'how', 'what', 'when', 'why', 'can you'];
    
    if (interestKeywords.some(kw => text.includes(kw))) return 'interested';
    if (demoKeywords.some(kw => text.includes(kw))) return 'demo_request';
    if (pricingKeywords.some(kw => text.includes(kw))) return 'pricing_request';
    if (notInterestedKeywords.some(kw => text.includes(kw))) return 'not_interested';
    if (questionKeywords.some(kw => text.includes(kw))) return 'question';
    
    return 'general_reply';
}

/**
 * Extract sender name from email
 */
function extractSenderName(fromHeader) {
    const match = fromHeader.match(/^(.+?)\s*<.+?>$/) || fromHeader.match(/^(.+?)@/);
    if (match) {
        return match[1].trim().replace(/['"]/g, '');
    }
    return fromHeader.split('@')[0];
}

/**
 * Extract email address from from header
 */
function extractEmailAddress(fromHeader) {
    const match = fromHeader.match(/<(.+?)>/);
    if (match) return match[1];
    return fromHeader.trim();
}

module.exports = {
    listInboxes,
    getMessages,
    getMessage,
    getMessageContent,
    getThread,
    sendReply,
    markAsRead,
    processIncomingEmail,
    getUnreadCount,
    searchMessages,
    parseWebhookPayload,
    detectIntent,
    extractSenderName,
    extractEmailAddress,
    INBOX_ID
};
