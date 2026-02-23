const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csv = require('csv-parser');
const stream = require('stream');
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

const JWT_SECRET = process.env.JWT_SECRET || 'apex-voice-secret-key-2026';

// Multer config for CSV uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files allowed'), false);
        }
    }
});

// ===================
// HEALTH CHECKS
// ===================

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Apex Voice Solutions API 🚀',
        version: '2.3.2',
        endpoints: {
            auth: ['/api/auth/login', '/api/auth/register'],
            leads: ['/leads', '/leads/:id', 'POST /api/leads/upload-csv'],
            clients: ['/api/clients'],
            scrape: ['POST /scrape'],
            stats: ['/api/stats']
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
    console.log('Login attempt:', email);

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        console.log('Query result:', result.rows.length, 'users found');
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

app.get('/api/auth/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [decoded.userId]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        res.json({ user: { id: result.rows[0].id, email: result.rows[0].email, name: result.rows[0].email.split('@')[0] } });
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ===================
// LEADS ROUTES
// ===================

const leadsRoutes = require('./src/routes/leads');
app.use('/api/leads', leadsRoutes);

// Legacy routes for backwards compatibility
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
                INSERT INTO leads (business_name, phone, city, rating, status)
                VALUES ($1, $2, $3, $4, 'New Lead')
                ON CONFLICT (phone) DO NOTHING
            `, [lead.businessName || lead.name, lead.phoneNumber || lead.phone, lead.city, lead.rating || 0]);
            savedCount++;
        } catch (e) {
            console.error('Error saving lead:', e);
        }
    }
    res.json({ success: true, count: savedCount });
});

// CSV Upload endpoint
app.post('/api/leads/upload-csv', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const leads = [];
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    try {
        await new Promise((resolve, reject) => {
            bufferStream
                .pipe(csv())
                .on('data', (row) => {
                    // Map CSV columns to lead object (flexible column names)
                    const lead = {
                        businessName: row['Business Name'] || row['businessName'] || row['name'] || row['Name'] || row['Company'] || '',
                        phone: row['Phone'] || row['phone'] || row['Phone Number'] || row['phoneNumber'] || row['Number'] || '',
                        email: row['Email'] || row['email'] || row['E-mail'] || null,
                        city: row['City'] || row['city'] || '',
                        state: row['State'] || row['state'] || row['ST'] || '',
                        rating: parseFloat(row['Rating'] || row['rating'] || row['Stars'] || 0),
                        reviews: parseInt(row['Reviews'] || row['reviews'] || 0),
                        address: row['Address'] || row['address'] || row['Street'] || null,
                        website: row['Website'] || row['website'] || row['URL'] || null,
                        industry: row['Industry'] || row['industry'] || row['Category'] || row['Type'] || 'other',
                        source: row['Source'] || row['source'] || 'csv-upload'
                    };
                    
                    // Clean phone number
                    if (lead.phone) {
                        lead.phone = lead.phone.replace(/\D/g, '').slice(-10);
                    }
                    
                    // Only add if we have minimum data
                    if (lead.businessName && lead.phone) {
                        leads.push(lead);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Insert leads into database
        const savedLeads = [];
        const errors = [];
        
        for (const lead of leads) {
            try {
                const result = await pool.query(`
                    INSERT INTO leads (business_name, phone, email, city, state, rating, reviews, address, website, industry, source, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'New Lead')
                    ON CONFLICT (phone) DO UPDATE SET
                        email = COALESCE(EXCLUDED.email, leads.email),
                        rating = EXCLUDED.rating,
                        reviews = EXCLUDED.reviews,
                        website = COALESCE(EXCLUDED.website, leads.website),
                        industry = EXCLUDED.industry,
                        updated_at = NOW()
                    RETURNING *
                `, [lead.businessName, lead.phone, lead.email, lead.city, lead.state, lead.rating, lead.reviews, lead.address, lead.website, lead.industry, lead.source]);
                
                if (result.rows[0]) {
                    savedLeads.push(result.rows[0]);
                }
            } catch (err) {
                errors.push({ lead: lead.businessName, error: err.message });
            }
        }

        res.json({
            success: true,
            stats: {
                total: leads.length,
                saved: savedLeads.length,
                duplicates: leads.length - savedLeads.length - errors.length,
                errors: errors.length
            },
            leads: savedLeads.slice(0, 20), // Return first 20 for preview
            errors: errors.slice(0, 5) // Show first 5 errors
        });

    } catch (error) {
        console.error('CSV upload error:', error);
        res.status(500).json({ error: 'Failed to process CSV', details: error.message });
    }
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
            console.log('🔄 Attempting VAPI provisioning for:', client.business_name);
            const { createAssistant, provisionPhoneNumber } = require('./src/services/vapi');
            
            const assistant = await createAssistant(client);
            console.log('📦 VAPI response:', assistant ? assistant.id : 'null');
            
            if (assistant && assistant.id) {
                // Update client with VAPI agent ID
                await pool.query(
                    'UPDATE clients SET vapi_agent_id = $1, status = $2 WHERE id = $3',
                    [assistant.id, 'active', client.id]
                );
                client.vapi_agent_id = assistant.id;
                client.status = 'active';
                console.log('✅ Client updated with VAPI agent');

                // Try to provision phone number
                const phone = await provisionPhoneNumber(assistant.id);
                if (phone && phone.number) {
                    await pool.query(
                        'UPDATE clients SET vapi_phone = $1 WHERE id = $2',
                        [phone.number, client.id]
                    );
                    client.vapi_phone = phone.number;
                }
            } else {
                console.log('⚠️ VAPI returned no assistant');
            }
        } catch (vapiError) {
            console.log('❌ VAPI provisioning error:', vapiError.message);
            console.log('Stack:', vapiError.stack);
            // Client still created, just without VAPI integration
        }

        res.status(201).json({ client });
    } catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// Provision VAPI for existing client
app.post('/api/clients/:id/provision-vapi', async (req, res) => {
    const { id } = req.params;

    try {
        // Get client
        const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
        const client = result.rows[0];

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        if (client.vapi_agent_id) {
            return res.status(400).json({ error: 'AI already provisioned for this client' });
        }

        // Create VAPI assistant
        const { createAssistant, provisionPhoneNumber } = require('./src/services/vapi');
        
        const assistant = await createAssistant(client);
        
        if (!assistant || !assistant.id) {
            return res.status(500).json({ error: 'Failed to create VAPI assistant' });
        }

        // Update client with agent ID
        await pool.query(
            'UPDATE clients SET vapi_agent_id = $1, status = $2, updated_at = NOW() WHERE id = $3',
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

        res.json({ success: true, client });

    } catch (error) {
        console.error('VAPI provisioning error:', error);
        res.status(500).json({ error: 'Failed to provision AI', message: error.message });
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
        // Direct check - bypass module caching
        const apiKey = process.env.VAPI_API_KEY;
        
        if (!apiKey) {
            return res.json({ 
                assistants: [],
                debug: {
                    hasApiKey: false,
                    keyPrefix: null,
                    allKeys: Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('PASSWORD') && !k.includes('TOKEN')).sort()
                }
            });
        }

        const fetch = require('node-fetch');
        const response = await fetch('https://api.vapi.ai/assistant', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        const assistants = response.ok ? await response.json() : [];
        res.json({ 
            assistants,
            debug: {
                hasApiKey: true,
                keyPrefix: apiKey.slice(0, 8) + '...'
            }
        });
    } catch (error) {
        console.error('VAPI list error:', error);
        res.json({ assistants: [], error: error.message });
    }
});

// Sync VAPI agents to local database
app.post('/api/agents/sync-vapi', async (req, res) => {
    try {
        const { listAssistants } = require('./src/services/vapi');
        const assistants = await listAssistants();

        let syncedCount = 0;
        const results = [];

        for (const assistant of assistants) {
            // Try to match assistant to a client by business name
            const matchResult = await pool.query(
                `SELECT * FROM clients WHERE business_name ILIKE $1`,
                [`%${assistant.name.replace(' Receptionist', '').replace('Receptionist', '').trim()}%`]
            );

            if (matchResult.rows.length > 0) {
                const client = matchResult.rows[0];
                // Update client with VAPI agent ID if not already set
                if (!client.vapi_agent_id) {
                    await pool.query(
                        `UPDATE clients SET vapi_agent_id = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
                        [assistant.id, client.id]
                    );
                    syncedCount++;
                }
                results.push({
                    assistantId: assistant.id,
                    assistantName: assistant.name,
                    matchedClient: client.business_name,
                    synced: !client.vapi_agent_id
                });
            } else {
                results.push({
                    assistantId: assistant.id,
                    assistantName: assistant.name,
                    matchedClient: null,
                    synced: false
                });
            }
        }

        res.json({
            success: true,
            totalAssistants: assistants.length,
            syncedCount,
            results
        });
    } catch (error) {
        console.error('VAPI sync error:', error);
        res.status(500).json({ error: 'Sync failed', message: error.message });
    }
});

// ===================
// SCRAPER ROUTES
// ===================

// Lazy load scraper to avoid Playwright issues at startup
let scraperRoutes = null;
try {
    scraperRoutes = require('./src/routes/scraper');
    app.use('/api/scraper', scraperRoutes);
} catch (err) {
    console.log('⚠️ Scraper routes not loaded:', err.message);
    // Provide fallback routes
    app.post('/api/scraper/scrape', (req, res) => {
        res.status(503).json({ error: 'Scraper not available', details: 'Playwright not configured' });
    });
    app.post('/api/scraper/enrich', (req, res) => {
        res.status(503).json({ error: 'Enrichment not available', details: 'Playwright not configured' });
    });
}

// ===================
// VAPI WEBHOOK
// ===================

app.post('/webhooks/vapi', async (req, res) => {
    const callData = req.body.message || req.body;
    console.log('VAPI Webhook:', callData.type);

    try {
        if (callData.type === 'end-of-call-report') {
            const { call, transcript, summary, analysis } = callData;
            const customerPhone = call.customer?.number;
            const assistantId = call.assistantId;

            console.log(`Call completed for ${customerPhone}: ${summary?.slice(0, 50)}...`);

            // Find client by VAPI agent ID
            let client = null;
            if (assistantId) {
                const clientResult = await pool.query(
                    'SELECT * FROM clients WHERE vapi_agent_id = $1',
                    [assistantId]
                );
                client = clientResult.rows[0];
            }

            // Save call to database
            const callResult = await pool.query(`
                INSERT INTO calls (phone, transcript, outcome, duration, raw_data, client_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [
                customerPhone || 'unknown',
                transcript || '',
                summary || 'Completed',
                call.duration || 0,
                JSON.stringify(callData),
                client?.id || null
            ]);

            // Send SMS notification to business owner
            if (client && client.contact_phone && summary) {
                try {
                    const { sendCallSummarySMS } = require('./src/services/sms');
                    await sendCallSummarySMS(
                        client.contact_phone,
                        `Call from ${customerPhone}: ${summary}`,
                        client.business_name
                    );
                } catch (smsErr) {
                    console.log('SMS notification failed:', smsErr.message);
                }
            }
        }

        // Handle new call started
        if (callData.type === 'call-started') {
            console.log('New call started');
        }

    } catch (err) {
        console.error('Webhook error:', err);
    }

    res.json({ received: true });
});

// ===================
// SMS ROUTES
// ===================

app.post('/api/sms/send', async (req, res) => {
    const { to, message, clientId } = req.body;
    
    if (!to || !message) {
        return res.status(400).json({ error: 'Phone number and message required' });
    }

    try {
        const { sendLeadSMS } = require('./src/services/sms');
        
        let businessName = 'Apex Voice Solutions';
        if (clientId) {
            const clientResult = await pool.query('SELECT business_name FROM clients WHERE id = $1', [clientId]);
            if (clientResult.rows[0]) {
                businessName = clientResult.rows[0].business_name;
            }
        }

        const result = await sendLeadSMS(to, message, businessName);
        
        if (result.success) {
            res.json({ success: true, sid: result.sid });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('SMS error:', error);
        res.status(500).json({ error: 'Failed to send SMS' });
    }
});

// ===================
// INITIALIZE DATABASE
// ===================

// Test SMS endpoint
app.post('/api/test-sms', async (req, res) => {
    try {
        const { sendCallSummarySMS } = require('./src/services/sms');
        
        // Send test SMS to the business owner
        const result = await sendCallSummarySMS(
            '+13862825413', // Your Twilio number for testing
            'Test call from (555) 123-4567: Customer interested in roof repair.',
            'Test Business'
        );
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all calls
app.get('/api/calls', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM calls ORDER BY created_at DESC LIMIT 100');
        res.json({ calls: result.rows });
    } catch (error) {
        console.error('Error fetching calls:', error);
        res.status(500).json({ error: 'Failed to fetch calls' });
    }
});

// Update lead status - FIXED
app.patch('/api/leads/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    try {
        const result = await pool.query(
            'UPDATE leads SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3 RETURNING *',
            [status, notes, parseInt(id)]
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

const initDatabase = async () => {
    try {
        console.log('Initializing database tables...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS clients (
                id SERIAL PRIMARY KEY,
                business_name TEXT NOT NULL,
                industry TEXT DEFAULT 'other',
                city TEXT,
                state TEXT,
                contact_name TEXT,
                contact_phone TEXT,
                contact_email TEXT,
                business_phone TEXT,
                escalation_phone TEXT,
                greeting TEXT,
                voice_style TEXT DEFAULT 'professional',
                services TEXT,
                faq TEXT,
                vapi_phone TEXT,
                vapi_agent_id TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                business_name TEXT,
                phone TEXT UNIQUE,
                email TEXT,
                city TEXT,
                state TEXT,
                rating DECIMAL,
                reviews INTEGER,
                address TEXT,
                website TEXT,
                industry TEXT,
                source TEXT,
                status TEXT DEFAULT 'New Lead',
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Add missing columns if they don't exist (for existing tables)
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reviews INTEGER`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS address TEXT`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry TEXT`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS calls (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER REFERENCES leads(id),
                phone TEXT,
                vapi_call_id TEXT,
                transcript TEXT,
                outcome TEXT,
                duration INTEGER,
                raw_data JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('Database init error:', error.message);
    }
};

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
        console.error('Seed user error:', error.message);
    }
};

// ===================
// START SERVER
// ===================

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    await initDatabase();
    await seedDefaultUser();
});
// Build fix Sat Feb 21 08:14:55 EST 2026
// Force deploy 1771680875
