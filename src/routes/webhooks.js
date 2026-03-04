const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const agentmail = require('../services/agentmail');

// POST VAPI Webhook
router.post('/vapi', async (req, res) => {
    const callData = req.body.message || req.body;
    console.log('Webhook received:', callData.type);

    try {
        if (callData.type === 'end-of-call-report') {
            const { call, transcript, summary, analysis } = callData;

            if (call.customer && call.customer.number) {
                // Clean phone
                const phone = call.customer.number.replace(/\D/g, '').slice(-10);

                // Find Lead
                const leadRes = await pool.query('SELECT id FROM leads WHERE phone LIKE $1', [`%${phone}`]);

                if (leadRes.rows.length > 0) {
                    const leadId = leadRes.rows[0].id;

                    // Insert Call Record
                    await pool.query(`
                        INSERT INTO calls (lead_id, vapi_call_id, duration, status, transcript, sentiment, outcome)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [
                        leadId,
                        call.id,
                        Math.round(call.duration || 0),
                        call.status,
                        transcript || '',
                        analysis?.sentiment || 'netural',
                        analysis?.successEvaluation ? 'success' : 'failure'
                    ]);

                    // Update Lead Status
                    await pool.query(`UPDATE leads SET status = 'Called', last_called_at = NOW() WHERE id = $1`, [leadId]);

                    console.log(`✅ Call logged for lead ${leadId}`);
                }
            }
        }
    } catch (err) {
        console.error('Webhook error:', err);
    }

    res.json({ received: true });
});

// POST AgentMail Webhook - Incoming emails
router.post('/agentmail', async (req, res) => {
    const { message, event_type } = req.body;
    console.log('📧 AgentMail webhook:', event_type, message?.subject);

    try {
        if (event_type === 'message.received' && message) {
            // Extract sender email
            const fromEmail = message.from?.match(/<(.+?)>/)?.[1] || message.from;
            
            // Check if this is from a lead
            const leadRes = await pool.query(
                'SELECT id, business_name, status FROM leads WHERE email = $1',
                [fromEmail]
            );
            
            if (leadRes.rows.length > 0) {
                const lead = leadRes.rows[0];
                
                // Store email thread
                await pool.query(`
                    INSERT INTO email_threads (lead_id, thread_id, message_id, direction, subject, preview, from_email, to_email)
                    VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7)
                    ON CONFLICT (message_id) DO NOTHING
                `, [
                    lead.id,
                    message.thread_id,
                    message.message_id,
                    message.subject,
                    message.preview,
                    message.from,
                    message.to?.[0] || 'apexvoicesolutions@agentmail.to'
                ]);
                
                // Update lead status to show they replied
                if (lead.status === 'New Lead' || lead.status === 'Contacted') {
                    await pool.query(`UPDATE leads SET status = 'Replied' WHERE id = $1`, [lead.id]);
                }
                
                console.log(`✅ Email logged for lead ${lead.id} (${lead.business_name})`);
                
                // TODO: Trigger AI to draft a reply
                // For now, just log it for manual review
            } else {
                // Unknown sender - could be spam or new lead
                console.log(`📭 Email from unknown sender: ${fromEmail}`);
                
                // Still store it
                await pool.query(`
                    INSERT INTO email_threads (thread_id, message_id, direction, subject, preview, from_email, to_email)
                    VALUES ($1, $2, 'inbound', $3, $4, $5, $6)
                    ON CONFLICT (message_id) DO NOTHING
                `, [
                    message.thread_id,
                    message.message_id,
                    message.subject,
                    message.preview,
                    message.from,
                    message.to?.[0] || 'apexvoicesolutions@agentmail.to'
                ]);
            }
        }
    } catch (err) {
        console.error('AgentMail webhook error:', err);
    }

    res.json({ received: true });
});

// GET AgentMail messages
router.get('/agentmail/messages', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const messages = await agentmail.getMessages(parseInt(limit));
        res.json(messages);
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET specific message content
router.get('/agentmail/messages/:id/content', async (req, res) => {
    try {
        const content = await agentmail.getMessageContent(req.params.id);
        res.send(content);
    } catch (err) {
        console.error('Error fetching message content:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET thread by ID
router.get('/agentmail/threads/:threadId', async (req, res) => {
    try {
        const thread = await agentmail.getThread(req.params.threadId);
        res.json(thread);
    } catch (err) {
        console.error('Error fetching thread:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST Send reply
router.post('/agentmail/reply', async (req, res) => {
    try {
        const { to, subject, text, html, replyToMessageId, leadId } = req.body;
        
        const result = await agentmail.sendReply({
            to,
            subject,
            text,
            html,
            replyToMessageId
        });
        
        // Log outbound email
        if (leadId && result.message_id) {
            await pool.query(`
                INSERT INTO email_threads (lead_id, thread_id, message_id, direction, subject, preview, from_email, to_email)
                VALUES ($1, $2, $3, 'outbound', $4, $5, 'apexvoicesolutions@agentmail.to', $6)
            `, [
                leadId,
                result.thread_id,
                result.message_id,
                subject,
                text?.substring(0, 200),
                Array.isArray(to) ? to[0] : to
            ]);
        }
        
        res.json({ success: true, result });
    } catch (err) {
        console.error('Error sending reply:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST Mark message as read
router.post('/agentmail/messages/:id/read', async (req, res) => {
    try {
        await agentmail.markAsRead(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Error marking as read:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET unread count
router.get('/agentmail/unread', async (req, res) => {
    try {
        const count = await agentmail.getUnreadCount();
        res.json({ unread: count });
    } catch (err) {
        console.error('Error getting unread count:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET OTP codes - For browser automation
router.get('/agentmail/otp', async (req, res) => {
    try {
        const { from } = req.query;
        const messages = await agentmail.getMessages(20);
        
        // Filter for OTP/verification emails
        const otpKeywords = ['verification', 'code', 'otp', 'pin', 'confirm', 'verify', 'authenticate'];
        const otpMessages = messages.messages?.filter(m => {
            const subject = m.subject?.toLowerCase() || '';
            const preview = m.preview?.toLowerCase() || '';
            const fromMatch = from ? m.from?.toLowerCase().includes(from.toLowerCase()) : true;
            
            return fromMatch && otpKeywords.some(kw => subject.includes(kw) || preview.includes(kw));
        }) || [];
        
        // Extract codes from recent OTP emails
        const codes = otpMessages.map(m => {
            // Look for 4-6 digit codes in preview
            const codeMatch = m.preview?.match(/\b(\d{4,6})\b/);
            return {
                messageId: m.message_id,
                from: m.from,
                subject: m.subject,
                code: codeMatch?.[1] || null,
                timestamp: m.timestamp,
                preview: m.preview
            };
        }).filter(c => c.code);
        
        res.json({ codes, total: codes.length });
    } catch (err) {
        console.error('Error getting OTP codes:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET latest OTP code
router.get('/agentmail/otp/latest', async (req, res) => {
    try {
        const { from } = req.query;
        const messages = await agentmail.getMessages(10);
        
        const otpKeywords = ['verification', 'code', 'otp', 'pin', 'confirm', 'verify', 'authenticate'];
        
        for (const m of messages.messages || []) {
            const subject = m.subject?.toLowerCase() || '';
            const preview = m.preview?.toLowerCase() || '';
            const fromMatch = from ? m.from?.toLowerCase().includes(from.toLowerCase()) : true;
            
            if (fromMatch && otpKeywords.some(kw => subject.includes(kw) || preview.includes(kw))) {
                const codeMatch = m.preview?.match(/\b(\d{4,6})\b/);
                if (codeMatch) {
                    return res.json({
                        code: codeMatch[1],
                        from: m.from,
                        subject: m.subject,
                        timestamp: m.timestamp,
                        messageId: m.message_id
                    });
                }
            }
        }
        
        res.json({ code: null, message: 'No OTP code found' });
    } catch (err) {
        console.error('Error getting latest OTP:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
