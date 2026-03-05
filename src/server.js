const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.locals.db = pool;

app.use(cors());
app.use(express.json());

// ===================
// FILE UPLOAD CONFIG
// ===================

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const clientDir = path.join(uploadsDir, req.params.clientId || 'temp');
        if (!fs.existsSync(clientDir)) {
            fs.mkdirSync(clientDir, { recursive: true });
        }
        cb(null, clientDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'text/plain', 'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/csv', 'application/vnd.ms-excel'];
        if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('text/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. PDF, DOC, DOCX, TXT, CSV allowed.'));
        }
    }
});

const JWT_SECRET = process.env.JWT_SECRET || 'apex-voice-secret-key-2026';

// ===================
// HEALTH CHECKS
// ===================

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Apex Voice Solutions API 🚀',
        version: '2.6.0',
        endpoints: {
            auth: ['/api/auth/login', '/api/auth/register'],
            leads: ['/leads', '/leads/:id'],
            clients: ['/api/clients'],
            scrape: ['POST /scrape']
        }
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===================
// AUTH ROUTES
// ===================

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
            expiresIn: '7d',
        });

        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
            [email, hashedPassword]
        );

        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Could not create user' });
    }
});

// ===================
// LEADS ROUTES
// ===================

app.get('/leads', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/leads/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/leads', async (req, res) => {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads)) return res.status(400).json({ error: 'Invalid data' });

    let savedCount = 0;
    for (const lead of leads) {
        try {
            await pool.query(`
                INSERT INTO leads (business_name, phone, email, city, state, rating, reviews, website, industry, source, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'New Lead')
                ON CONFLICT (phone) DO NOTHING
            `, [
                lead.businessName || lead.name, 
                lead.phoneNumber || lead.phone, 
                lead.email || null,
                lead.city, 
                lead.state || null,
                lead.rating || 0,
                lead.reviews || null,
                lead.website || null,
                lead.industry || lead.businessType || null,
                lead.source || 'scraper'
            ]);
            savedCount++;
        } catch (e) {
            console.error('Error saving lead:', e);
        }
    }
    res.json({ success: true, count: savedCount });
});

app.put('/leads/:id', async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    try {
        const result = await pool.query(
            'UPDATE leads SET status = COALESCE($1, status), notes = COALESCE($2, notes) WHERE id = $3 RETURNING *',
            [status, notes, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ===================
// CLIENTS ROUTES
// ===================

app.get('/api/clients', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
        res.json({ clients: result.rows });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

app.get('/api/clients/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        res.json({ client: result.rows[0] });
    } catch (error) {
        console.error('Error fetching client:', error);
        res.status(500).json({ error: 'Failed to fetch client' });
    }
});

app.post('/api/clients', async (req, res) => {
    const {
        businessName, industry, city, state,
        contactName, contactPhone, contactEmail, businessPhone,
        escalationPhone, greeting, voiceStyle, services, faq
    } = req.body;

    if (!businessName || !contactEmail) {
        return res.status(400).json({ error: 'Business name and contact email are required' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO clients (
                business_name, industry, city, state,
                contact_name, contact_phone, contact_email, business_phone,
                escalation_phone, greeting, voice_style, services, faq, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
            RETURNING *
        `, [
            businessName, industry, city, state,
            contactName, contactPhone, contactEmail, businessPhone,
            escalationPhone, greeting, voiceStyle, services, faq
        ]);

        const client = result.rows[0];

        // Try to create VAPI assistant (non-blocking)
        try {
            const { createAssistant, provisionPhoneNumber } = require('./services/vapi');
            
            const assistant = await createAssistant(client);
            
            if (assistant && assistant.id) {
                // Update client with VAPI agent ID
                await pool.query(
                    'UPDATE clients SET vapi_agent_id = $1, status = $2 WHERE id = $3',
                    [assistant.id, 'active', client.id]
                );
                client.vapi_agent_id = assistant.id;
                client.status = 'active';

                // Try to provision phone number
                const phone = await provisionPhoneNumber(assistant.id);
                if (phone && phone.number) {
                    await pool.query(
                        'UPDATE clients SET vapi_phone = $1 WHERE id = $2',
                        [phone.number, client.id]
                    );
                    client.vapi_phone = phone.number;
                }
            }
        } catch (vapiError) {
            console.log('VAPI provisioning skipped:', vapiError.message);
            // Client still created, just without VAPI integration
        }

        res.status(201).json({ client });
    } catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

app.put('/api/clients/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        const fields = [];
        const values = [id];
        let paramCount = 2;

        const fieldMap = {
            businessName: 'business_name', industry: 'industry', city: 'city', state: 'state',
            contactName: 'contact_name', contactPhone: 'contact_phone', contactEmail: 'contact_email',
            businessPhone: 'business_phone', escalationPhone: 'escalation_phone',
            greeting: 'greeting', voiceStyle: 'voice_style', services: 'services', faq: 'faq',
            status: 'status', vapiPhone: 'vapi_phone', vapiAgentId: 'vapi_agent_id'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = $${paramCount}`);
                values.push(updates[key]);
                paramCount++;
            }
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        fields.push('updated_at = NOW()');
        const query = `UPDATE clients SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ client: result.rows[0] });
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});

app.delete('/api/clients/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        res.json({ success: true, message: 'Client deleted' });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});

// ===================
// CLIENT DOCUMENTS ROUTES
// ===================

// Get all documents for a client
app.get('/api/clients/:clientId/documents', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM client_documents WHERE client_id = $1 ORDER BY uploaded_at DESC',
            [req.params.clientId]
        );
        res.json({ documents: result.rows });
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Upload document for client
app.post('/api/clients/:clientId/documents', upload.single('document'), async (req, res) => {
    const { clientId } = req.params;
    const { documentType } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    if (!documentType) {
        return res.status(400).json({ error: 'Document type is required' });
    }
    
    try {
        // Verify client exists
        const clientCheck = await pool.query('SELECT id FROM clients WHERE id = $1', [clientId]);
        if (clientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        const result = await pool.query(`
            INSERT INTO client_documents (client_id, document_type, file_name, file_path, file_size, mime_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            clientId,
            documentType,
            req.file.originalname,
            req.file.path,
            req.file.size,
            req.file.mimetype
        ]);
        
        res.status(201).json({ document: result.rows[0] });
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

// Delete document
app.delete('/api/clients/:clientId/documents/:docId', async (req, res) => {
    const { clientId, docId } = req.params;
    
    try {
        const docResult = await pool.query(
            'SELECT * FROM client_documents WHERE id = $1 AND client_id = $2',
            [docId, clientId]
        );
        
        if (docResult.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        
        const doc = docResult.rows[0];
        
        // Delete file from filesystem
        if (fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
        }
        
        // Delete from database
        await pool.query('DELETE FROM client_documents WHERE id = $1', [docId]);
        
        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

// Download document
app.get('/api/clients/:clientId/documents/:docId/download', async (req, res) => {
    const { clientId, docId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT * FROM client_documents WHERE id = $1 AND client_id = $2',
            [docId, clientId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }
        
        const doc = result.rows[0];
        
        if (!fs.existsSync(doc.file_path)) {
            return res.status(404).json({ error: 'File not found on server' });
        }
        
        res.download(doc.file_path, doc.file_name);
    } catch (error) {
        console.error('Error downloading document:', error);
        res.status(500).json({ error: 'Failed to download document' });
    }
});

// ===================
// STATS ROUTE
// ===================

app.get('/api/stats', async (req, res) => {
    try {
        const [leadsCount, clientsCount, callsCount] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM leads'),
            pool.query('SELECT COUNT(*) FROM clients'),
            pool.query('SELECT COUNT(*) FROM calls')
        ]);

        const newLeads = await pool.query("SELECT COUNT(*) FROM leads WHERE status = 'New Lead'");
        const bookedCalls = await pool.query("SELECT COUNT(*) FROM calls WHERE outcome LIKE '%booked%'");

        res.json({
            totalLeads: parseInt(leadsCount.rows[0].count),
            totalCalls: parseInt(callsCount.rows[0].count),
            newLeads: parseInt(newLeads.rows[0].count),
            bookedCalls: parseInt(bookedCalls.rows[0].count),
            totalClients: parseInt(clientsCount.rows[0].count),
            conversionRate: '0'
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.json({
            totalLeads: 0,
            totalCalls: 0,
            newLeads: 0,
            bookedCalls: 0,
            totalClients: 0,
            conversionRate: '0'
        });
    }
});

// ===================
// VAPI ROUTES
// ===================

app.get('/api/vapi/assistants', async (req, res) => {
    try {
        const { listAssistants } = require('./services/vapi');
        const assistants = await listAssistants();
        res.json({ assistants });
    } catch (error) {
        console.error('VAPI list error:', error);
        res.json({ assistants: [] });
    }
});

// ===================
// SCRAPER ROUTE
// ===================

app.post('/scrape', async (req, res) => {
    const { city, state, type, maxResults } = req.body;
    console.log(`Scraping request: ${type} in ${city}, ${state}`);

    try {
        // Dynamic import to avoid issues if playwright not available
        const { scrapeGoogleMaps } = require('./scraper');
        
        const leads = await scrapeGoogleMaps(city, state, type, maxResults || 10);

        let savedCount = 0;
        for (const lead of leads) {
            try {
                const saved = await pool.query(`
                    INSERT INTO leads (business_name, phone, city, rating, status)
                    VALUES ($1, $2, $3, $4, 'New Lead')
                    ON CONFLICT (phone) DO NOTHING
                    RETURNING id
                `, [lead.businessName, lead.phone, lead.city, lead.rating || 0]);
                if (saved.rowCount > 0) savedCount++;
            } catch (e) {
                console.error('Error saving lead:', e);
            }
        }

        res.json({ success: true, found: leads.length, saved: savedCount, leads });
    } catch (err) {
        console.error('Scraping failed:', err);
        res.status(500).json({ error: 'Scraping failed', details: err.message });
    }
});

// ===================
// MIGRATION ENDPOINT
// ===================

const { runMigration } = require('./migrate');

app.post('/api/migrate', async (req, res) => {
    const result = await runMigration();
    res.json(result);
});

// ===================
// AGENT E WORKFLOW ROUTES
// ===================

const workflowService = require('./services/workflow');

// Get workflow types
app.get('/api/workflows/types', (req, res) => {
    res.json({
        workflows: Object.entries(workflowService.WORKFLOWS).map(([key, value]) => ({
            type: key,
            name: value.name,
            steps: value.steps.length
        }))
    });
});

// Get workflow status for lead
app.get('/api/workflows/lead/:leadId', async (req, res) => {
    try {
        const status = await workflowService.getWorkflowStatus(req.params.leadId);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start workflow
app.post('/api/workflows/start', async (req, res) => {
    try {
        const { leadId, workflowType } = req.body;
        const result = await workflowService.startWorkflow(leadId, workflowType);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel workflow
app.post('/api/workflows/:id/cancel', async (req, res) => {
    try {
        const result = await workflowService.cancelWorkflow(req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Process pending (cron)
app.post('/api/workflows/process', async (req, res) => {
    try {
        const result = await workflowService.processPendingSteps();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send email to lead
app.post('/api/leads/:id/email', async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body;
        
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
        if (leadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        const lead = leadResult.rows[0];
        const emailService = require('./services/email');
        
        const leadData = {
            ...lead,
            firstName: lead.name?.split(' ')[0] || lead.business_name?.split(' ')[0] || 'there',
            businessType: lead.business_type || lead.niche
        };
        
        let result;
        switch (type) {
            case 'cold_intro': result = await emailService.sendColdIntro(leadData); break;
            case 'demo': result = await emailService.sendDemoConfirmation(leadData); break;
            case 'follow_up': result = await emailService.sendFollowUp(leadData); break;
            case 'reactivation': result = await emailService.sendReactivation(leadData); break;
            default: result = await emailService.sendColdIntro(leadData);
        }
        
        if (result.success) {
            await pool.query(
                'UPDATE leads SET email_sent = true, email_type = $1, email_sent_at = NOW() WHERE id = $2',
                [type || 'manual', id]
            );
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test Agent E email (send test email without lead)
app.post('/api/email/test', async (req, res) => {
    try {
        const { to, template } = req.body;
        const emailService = require('./services/email');
        
        const result = await emailService.sendTestEmail(
            to || 'maurice.pinnock@apexvoicesolutions.com',
            template || 'cold_intro'
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk email
app.post('/api/leads/bulk-email', async (req, res) => {
    try {
        const { leadIds, type } = req.body;
        const emailService = require('./services/email');
        
        const result = await pool.query('SELECT * FROM leads WHERE id = ANY($1)', [leadIds]);
        const leads = result.rows;
        
        const results = [];
        for (const lead of leads) {
            const leadData = {
                ...lead,
                firstName: lead.name?.split(' ')[0] || 'there',
                businessType: lead.business_type
            };
            
            let emailResult;
            switch (type) {
                case 'follow_up': emailResult = await emailService.sendFollowUp(leadData); break;
                case 'reactivation': emailResult = await emailService.sendReactivation(leadData); break;
                default: emailResult = await emailService.sendColdIntro(leadData);
            }
            
            results.push({ leadId: lead.id, email: lead.email, ...emailResult });
        }
        
        res.json({ sent: results.filter(r => r.success).length, results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================
// VAPI WEBHOOK
// ===================

app.post('/webhooks/vapi', async (req, res) => {
    const callData = req.body.message || req.body;
    console.log('VAPI Webhook:', callData.type);

    try {
        if (callData.type === 'end-of-call-report') {
            const { call, transcript, summary } = callData;

            if (call.customer && call.customer.number) {
                console.log(`Call completed for ${call.customer.number}: ${summary}`);
                
                await pool.query(`
                    INSERT INTO calls (phone, transcript, outcome, duration, raw_data)
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    call.customer.number,
                    transcript || '',
                    summary || 'Completed',
                    call.duration || 0,
                    JSON.stringify(callData)
                ]);
            }
        }
    } catch (err) {
        console.error('Webhook error:', err);
    }

    res.json({ received: true });
});

// ===================
// AGENTMAIL WEBHOOK (Incoming Emails)
// ===================

const agentmailService = require('./services/agentmail');
const aiReplyService = require('./services/ai-reply');

app.post('/webhooks/agentmail', async (req, res) => {
    console.log('📨 AgentMail Webhook received');
    
    try {
        const payload = agentmailService.parseWebhookPayload(req.body);
        const { from, to, subject, body, messageId, inReplyTo, threadId } = payload;
        
        console.log(`📧 Email from: ${from}`);
        console.log(`   Subject: ${subject}`);
        
        // Extract email address
        const fromEmail = agentmailService.extractEmailAddress(from);
        const senderName = agentmailService.extractSenderName(from);
        
        // Detect intent
        const intent = agentmailService.detectIntent(subject, body);
        console.log(`   Intent: ${intent}`);
        
        // Find matching lead in database
        const leadResult = await pool.query(
            'SELECT * FROM leads WHERE email = $1 OR email = $2 LIMIT 1',
            [fromEmail, fromEmail.toLowerCase()]
        );
        const lead = leadResult.rows[0] || null;
        
        // Store incoming email
        const emailResult = await pool.query(`
            INSERT INTO emails (direction, from_email, to_email, subject, body, message_id, in_reply_to, thread_id, status, raw_data)
            VALUES ('inbound', $1, $2, $3, $4, $5, $6, $7, 'received', $8)
            RETURNING *
        `, [
            fromEmail,
            to,
            subject,
            body,
            messageId,
            inReplyTo,
            threadId,
            JSON.stringify(req.body)
        ]);
        
        const savedEmail = emailResult.rows[0];
        
        // Generate AI suggested reply
        const aiResult = await aiReplyService.generateSuggestedReply(
            { from, subject, body, intent },
            lead
        );
        
        // Store AI suggestion
        await pool.query(`
            UPDATE emails 
            SET ai_suggested_reply = $1, ai_reply_generated_at = NOW()
            WHERE id = $2
        `, [aiResult.suggestedReply, savedEmail.id]);
        
        console.log(`   AI Confidence: ${aiResult.confidence}`);
        
        // Check if we should auto-reply
        const shouldAutoReply = aiReplyService.shouldAutoReply(intent, aiResult.confidence);
        
        if (shouldAutoReply && aiResult.suggestedReply) {
            console.log(`   🤖 Sending auto-reply...`);
            
            const emailService = require('./services/email');
            const replyResult = await emailService.sendEmail({
                to: fromEmail,
                subject: `Re: ${subject}`,
                html: aiResult.suggestedReply.replace(/\n/g, '<br>')
            });
            
            if (replyResult.success) {
                // Log the auto-reply
                await pool.query(`
                    INSERT INTO emails (direction, from_email, to_email, subject, body, in_reply_to, thread_id, status, auto_reply_sent, auto_reply_rule)
                    VALUES ('outbound', $1, $2, $3, $4, $5, $6, 'sent', TRUE, $7)
                `, [
                    process.env.FROM_EMAIL || 'maurice.pinnock@apexvoicesolutions.com',
                    fromEmail,
                    `Re: ${subject}`,
                    aiResult.suggestedReply,
                    messageId,
                    threadId,
                    intent
                ]);
                
                // Mark original email as replied
                await pool.query(
                    'UPDATE emails SET status = $1 WHERE id = $2',
                    ['replied', savedEmail.id]
                );
                
                // Update lead status if exists
                if (lead) {
                    const newStatus = intent === 'interested' ? 'Hot Lead' : 
                                     intent === 'demo_request' ? 'Demo Requested' :
                                     intent === 'pricing_request' ? 'Engaged' : lead.status;
                    
                    await pool.query(
                        'UPDATE leads SET status = $1, notes = COALESCE(notes, $2) WHERE id = $3',
                        [newStatus, `Auto-replied to ${intent} email`, lead.id]
                    );
                }
                
                console.log(`   ✅ Auto-reply sent to ${fromEmail}`);
            }
        }
        
        res.json({ 
            received: true, 
            emailId: savedEmail.id,
            intent,
            aiSuggested: !!aiResult.suggestedReply,
            autoReplied: shouldAutoReply
        });
        
    } catch (err) {
        console.error('AgentMail webhook error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ===================
// EMAILS API ROUTES
// ===================

// Get all emails (with optional filters)
app.get('/api/emails', async (req, res) => {
    try {
        const { direction, status, limit = 50 } = req.query;
        
        let query = 'SELECT * FROM emails';
        const conditions = [];
        const params = [];
        let paramCount = 1;
        
        if (direction) {
            conditions.push(`direction = $${paramCount++}`);
            params.push(direction);
        }
        if (status) {
            conditions.push(`status = $${paramCount++}`);
            params.push(status);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
        params.push(parseInt(limit));
        
        const result = await pool.query(query, params);
        res.json({ emails: result.rows });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ error: 'Failed to fetch emails' });
    }
});

// Get email thread
app.get('/api/emails/thread/:threadId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM emails WHERE thread_id = $1 ORDER BY created_at ASC',
            [req.params.threadId]
        );
        res.json({ thread: result.rows });
    } catch (error) {
        console.error('Error fetching thread:', error);
        res.status(500).json({ error: 'Failed to fetch thread' });
    }
});

// Get emails for a specific lead
app.get('/api/leads/:id/emails', async (req, res) => {
    try {
        // First get the lead's email
        const leadResult = await pool.query('SELECT email FROM leads WHERE id = $1', [req.params.id]);
        
        if (leadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        const leadEmail = leadResult.rows[0].email;
        
        if (!leadEmail) {
            return res.json({ emails: [] });
        }
        
        const result = await pool.query(
            `SELECT * FROM emails 
             WHERE from_email = $1 OR to_email = $1 
             ORDER BY created_at DESC`,
            [leadEmail]
        );
        
        res.json({ emails: result.rows });
    } catch (error) {
        console.error('Error fetching lead emails:', error);
        res.status(500).json({ error: 'Failed to fetch emails' });
    }
});

// Send manual reply (approve AI suggestion or custom)
app.post('/api/emails/:id/reply', async (req, res) => {
    try {
        const { id } = req.params;
        const { message, useAiSuggestion } = req.body;
        
        // Get original email
        const emailResult = await pool.query('SELECT * FROM emails WHERE id = $1', [id]);
        
        if (emailResult.rows.length === 0) {
            return res.status(404).json({ error: 'Email not found' });
        }
        
        const originalEmail = emailResult.rows[0];
        
        // Determine reply content
        let replyBody = message;
        if (useAiSuggestion && originalEmail.ai_suggested_reply) {
            replyBody = originalEmail.ai_suggested_reply;
        }
        
        if (!replyBody) {
            return res.status(400).json({ error: 'No message provided' });
        }
        
        // Send reply via Resend
        const emailService = require('./services/email');
        const result = await emailService.sendEmail({
            to: originalEmail.from_email,
            subject: `Re: ${originalEmail.subject}`,
            html: replyBody.replace(/\n/g, '<br>')
        });
        
        if (result.success) {
            // Log the reply
            await pool.query(`
                INSERT INTO emails (direction, from_email, to_email, subject, body, in_reply_to, thread_id, status)
                VALUES ('outbound', $1, $2, $3, $4, $5, $6, 'sent')
            `, [
                process.env.FROM_EMAIL || 'maurice.pinnock@apexvoicesolutions.com',
                originalEmail.from_email,
                `Re: ${originalEmail.subject}`,
                replyBody,
                originalEmail.message_id,
                originalEmail.thread_id
            ]);
            
            // Mark original as replied
            await pool.query('UPDATE emails SET status = $1 WHERE id = $2', ['replied', id]);
            
            res.json({ success: true, messageId: result.id });
        } else {
            res.status(500).json({ error: result.error || 'Failed to send reply' });
        }
    } catch (error) {
        console.error('Error sending reply:', error);
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

// Regenerate AI suggestion
app.post('/api/emails/:id/regenerate-suggestion', async (req, res) => {
    try {
        const { id } = req.params;
        
        const emailResult = await pool.query('SELECT * FROM emails WHERE id = $1', [id]);
        
        if (emailResult.rows.length === 0) {
            return res.status(404).json({ error: 'Email not found' });
        }
        
        const email = emailResult.rows[0];
        const intent = agentmailService.detectIntent(email.subject, email.body);
        
        const aiResult = await aiReplyService.generateSuggestedReply(
            { from: email.from_email, subject: email.subject, body: email.body, intent }
        );
        
        await pool.query(`
            UPDATE emails 
            SET ai_suggested_reply = $1, ai_reply_generated_at = NOW()
            WHERE id = $2
        `, [aiResult.suggestedReply, id]);
        
        res.json({ 
            suggestedReply: aiResult.suggestedReply,
            confidence: aiResult.confidence 
        });
    } catch (error) {
        console.error('Error regenerating suggestion:', error);
        res.status(500).json({ error: 'Failed to regenerate suggestion' });
    }
});

// Get auto-reply rules
app.get('/api/email-rules', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM email_auto_reply_rules ORDER BY priority DESC'
        );
        res.json({ rules: result.rows });
    } catch (error) {
        console.error('Error fetching rules:', error);
        res.status(500).json({ error: 'Failed to fetch rules' });
    }
});

// Update auto-reply rule
app.put('/api/email-rules/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        
        const result = await pool.query(
            'UPDATE email_auto_reply_rules SET is_active = $1 WHERE id = $2 RETURNING *',
            [is_active, id]
        );
        
        res.json({ rule: result.rows[0] });
    } catch (error) {
        console.error('Error updating rule:', error);
        res.status(500).json({ error: 'Failed to update rule' });
    }
});

// ===================
// SEED DEFAULT USER
// ===================

const seedDefaultUser = async () => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM users');
        const count = parseInt(result.rows[0].count);
        
        if (count === 0) {
            console.log('Creating default admin user...');
            const hashedPassword = await bcrypt.hash('password123', 10);
            await pool.query(
                'INSERT INTO users (email, password) VALUES ($1, $2)',
                ['apexvoicesolutions@gmail.com', hashedPassword]
            );
            console.log('✅ Default user: apexvoicesolutions@gmail.com / password123');
        }
    } catch (error) {
        console.log('Users table not found - run schema migration first');
    }
};

// ===================
// START SERVER
// ===================

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    await seedDefaultUser();
});
