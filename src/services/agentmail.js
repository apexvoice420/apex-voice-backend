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
        body.reply_to_message_id = replyToMessageId;
    }
    
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${INBOX_ID}/messages`, {
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
    searchMessages
};
