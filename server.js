const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csv = require('csv-parser');
const stream = require('stream');
const fetch = require('node-fetch');
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
        version: '2.7.0',
        endpoints: {
            auth: ['/api/auth/login', '/api/auth/register'],
            leads: ['/leads', '/leads/:id', 'POST /api/leads/upload-csv'],
            clients: ['/api/clients'],
            scrape: ['POST /api/scraper/scrape'],
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
    const { leads, ...singleLead } = req.body;
    
    // Handle single lead creation
    if (!leads && singleLead.business_name) {
        try {
            const formattedPhone = singleLead.phone ? singleLead.phone.replace(/\D/g, '').slice(-10) : null;
            if (!formattedPhone) {
                return res.status(400).json({ error: 'Valid phone number required' });
            }
            
            const result = await pool.query(`
                INSERT INTO leads (
                    business_name, phone, email, city, state, industry, 
                    rating, reviews, website, status
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (phone) DO UPDATE SET
                    email = COALESCE(EXCLUDED.email, leads.email),
                    city = COALESCE(EXCLUDED.city, leads.city),
                    state = COALESCE(EXCLUDED.state, leads.state),
                    industry = COALESCE(EXCLUDED.industry, leads.industry),
                    website = COALESCE(EXCLUDED.website, leads.website)
                RETURNING *
            `, [
                singleLead.business_name,
                formattedPhone,
                singleLead.email || null,
                singleLead.city || null,
                singleLead.state || null,
                singleLead.industry || null,
                singleLead.rating || null,
                singleLead.reviews || null,
                singleLead.website || null,
                singleLead.status || 'New Lead'
            ]);
            
            return res.status(201).json({ success: true, lead: result.rows[0] });
        } catch (e) {
            console.error('Error saving lead:', e);
            return res.status(500).json({ error: 'Failed to save lead', details: e.message });
        }
    }
    
    // Handle array of leads (bulk upload)
    if (!leads || !Array.isArray(leads)) {
        return res.status(400).json({ error: 'Invalid data' });
    }

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

// PATCH alias for drag-and-drop pipeline
app.patch('/leads/:id', async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    try {
        const result = await pool.query(
            'UPDATE leads SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3 RETURNING *',
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

// Delete single lead
app.delete('/leads/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        res.json({ success: true, message: 'Lead deleted' });
    } catch (error) {
        console.error('Error deleting lead:', error);
        res.status(500).json({ error: 'Failed to delete lead' });
    }
});

// Delete all leads (fresh start)
app.delete('/leads/all', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM leads RETURNING id');
        res.json({ success: true, message: `Deleted ${result.rows.length} leads` });
    } catch (error) {
        console.error('Error deleting all leads:', error);
        res.status(500).json({ error: 'Failed to delete leads' });
    }
});

// Delete all clients (fresh start)
app.delete('/api/clients/all', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM clients RETURNING id');
        res.json({ success: true, message: `Deleted ${result.rows.length} clients` });
    } catch (error) {
        console.error('Error deleting all clients:', error);
        res.status(500).json({ error: 'Failed to delete clients' });
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
        escalationPhone, greeting, voiceStyle, services, faq,
        serviceTier, setupFee, monthlyFee
    } = req.body;

    if (!businessName || !contactEmail) {
        return res.status(400).json({ error: 'Business name and contact email are required' });
    }

    try {
        // Generate portal token if tier allows self-service
        const portalToken = serviceTier && serviceTier !== 'full-service' 
            ? crypto.randomBytes(32).toString('hex') 
            : null;

        const result = await pool.query(`
            INSERT INTO clients (
                business_name, industry, city, state,
                contact_name, contact_phone, contact_email, business_phone,
                escalation_phone, greeting, voice_style, services, faq, 
                service_tier, setup_fee_amount, monthly_retainer, portal_access_token, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pending')
            RETURNING *
        `, [
            businessName, industry, city, state,
            contactName, contactPhone, contactEmail, businessPhone,
            escalationPhone, greeting, voiceStyle, services, faq,
            serviceTier || 'full-service', setupFee || 1500, monthlyFee || 500, portalToken
        ]);

        const client = result.rows[0];

        // Generate portal URL if token exists
        if (portalToken) {
            client.portal_url = `https://crm.apexvoicesolutions.org/portal?token=${portalToken}`;
        }

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
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Failed to create client', details: error.message, code: error.code });
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
// CLIENT DOCUMENTS ROUTES
// ===================

// Multer config for document uploads
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype) || 
            file.originalname.endsWith('.pdf') || 
            file.originalname.endsWith('.png') || 
            file.originalname.endsWith('.jpg') || 
            file.originalname.endsWith('.jpeg') ||
            file.originalname.endsWith('.doc') ||
            file.originalname.endsWith('.docx') ||
            file.originalname.endsWith('.txt')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed: PDF, PNG, JPG, DOC, DOCX, TXT'), false);
        }
    }
});

// Upload document for a client
app.post('/api/clients/:id/documents', documentUpload.single('document'), async (req, res) => {
    const { id } = req.params;
    const { documentType } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!documentType) {
        return res.status(400).json({ error: 'Document type is required' });
    }

    try {
        // Check if client exists
        const clientCheck = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
        if (clientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Convert file to base64
        const fileData = req.file.buffer.toString('base64');
        const fileName = req.file.originalname;
        const fileSize = req.file.size;
        const mimeType = req.file.mimetype;

        const result = await pool.query(`
            INSERT INTO client_documents (client_id, document_type, file_name, file_data, file_size, mime_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, document_type, file_name, file_size, mime_type, uploaded_at
        `, [id, documentType, fileName, fileData, fileSize, mimeType]);

        res.status(201).json({ 
            success: true, 
            document: result.rows[0] 
        });
    } catch (error) {
        console.error('Document upload error:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

// Get all documents for a client
app.get('/api/clients/:id/documents', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(`
            SELECT id, document_type, file_name, file_size, mime_type, uploaded_at 
            FROM client_documents 
            WHERE client_id = $1 
            ORDER BY uploaded_at DESC
        `, [id]);

        res.json({ documents: result.rows });
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Get a specific document (with file data for download)
app.get('/api/clients/:clientId/documents/:docId', async (req, res) => {
    const { clientId, docId } = req.params;

    try {
        const result = await pool.query(`
            SELECT * FROM client_documents 
            WHERE id = $1 AND client_id = $2
        `, [docId, clientId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const doc = result.rows[0];
        
        // Return the file for download
        const buffer = Buffer.from(doc.file_data, 'base64');
        res.setHeader('Content-Type', doc.mime_type);
        res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error fetching document:', error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

// Delete a document
app.delete('/api/clients/:clientId/documents/:docId', async (req, res) => {
    const { clientId, docId } = req.params;

    try {
        const result = await pool.query(`
            DELETE FROM client_documents 
            WHERE id = $1 AND client_id = $2 
            RETURNING id
        `, [docId, clientId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Failed to delete document' });
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
// APOLLO.IO ROUTES
// ===================

// Search for leads in Apollo
app.post('/api/apollo/search', async (req, res) => {
    try {
        const { searchPeople, formatPersonForLead } = require('./src/services/apollo');
        
        const result = await searchPeople(req.body);
        
        if (result.error) {
            return res.status(500).json({ error: result.error });
        }

        const leads = result.people.map(formatPersonForLead);
        
        res.json({ 
            success: true,
            leads,
            pagination: result.pagination,
            total: result.people.length
        });
    } catch (error) {
        console.error('Apollo search error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Enrich a lead with Apollo data
app.post('/api/apollo/enrich', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    try {
        const { enrichPerson, formatPersonForLead } = require('./src/services/apollo');
        
        const person = await enrichPerson(email);
        
        if (!person) {
            return res.json({ success: false, error: 'Person not found' });
        }

        const lead = formatPersonForLead(person);
        
        res.json({ success: true, lead });
    } catch (error) {
        console.error('Apollo enrich error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Import Apollo leads to CRM database
app.post('/api/apollo/import', async (req, res) => {
    const { leads } = req.body;
    
    if (!leads || !Array.isArray(leads)) {
        return res.status(400).json({ error: 'Leads array required' });
    }

    try {
        const savedLeads = [];
        
        for (const lead of leads) {
            if (!lead.email && !lead.phone) continue;
            
            try {
                const formattedPhone = lead.phone ? lead.phone.replace(/\D/g, '').slice(-10) : null;
                
                const result = await pool.query(`
                    INSERT INTO leads (business_name, phone, email, city, state, industry, website, source, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'New Lead')
                    ON CONFLICT (phone) DO UPDATE SET
                        email = COALESCE(EXCLUDED.email, leads.email),
                        updated_at = NOW()
                    RETURNING *
                `, [
                    lead.businessName || lead.company || lead.name,
                    formattedPhone,
                    lead.email,
                    lead.city,
                    lead.state,
                    lead.industry,
                    lead.website,
                    'apollo'
                ]);
                
                if (result.rows[0]) {
                    savedLeads.push(result.rows[0]);
                }
            } catch (err) {
                console.error('Error saving Apollo lead:', err.message);
            }
        }

        res.json({ 
            success: true, 
            imported: savedLeads.length,
            leads: savedLeads 
        });
    } catch (error) {
        console.error('Apollo import error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================
// CAL.COM ROUTES
// ===================

app.get('/api/calendar/bookings', async (req, res) => {
    try {
        const { getBookings, formatBooking } = require('./src/services/cal');
        
        const today = new Date();
        const afterStartDate = today.toISOString();
        
        // Get next 7 days
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const beforeStartDate = nextWeek.toISOString();

        const bookings = await getBookings({ 
            status: 'confirmed',
            afterStartDate,
            beforeStartDate
        });

        const formatted = bookings.map(formatBooking);
        
        res.json({ bookings: formatted });
    } catch (error) {
        console.error('Calendar fetch error:', error);
        res.json({ bookings: [] });
    }
});

app.get('/api/calendar/event-types', async (req, res) => {
    try {
        const { getEventTypes } = require('./src/services/cal');
        const eventTypes = await getEventTypes();
        res.json({ eventTypes });
    } catch (error) {
        console.error('Event types fetch error:', error);
        res.json({ eventTypes: [] });
    }
});

// ===================
// APOLLO ROUTES
// ===================

app.post('/api/apollo/search', async (req, res) => {
    try {
        const { searchPeople, formatPersonForLead } = require('./src/services/apollo');
        
        const { titles, locations, page, perPage } = req.body;
        
        const result = await searchPeople({
            titles: titles || [],
            locations: locations || [],
            page: page || 1,
            perPage: perPage || 25
        });

        const leads = result.people.map(formatPersonForLead);
        
        res.json({ 
            leads,
            pagination: result.pagination,
            total: result.pagination?.total_entries || 0
        });
    } catch (error) {
        console.error('Apollo search error:', error);
        res.status(500).json({ error: 'Search failed', leads: [] });
    }
});

app.post('/api/apollo/import', async (req, res) => {
    try {
        const { leads } = req.body;
        
        if (!leads || !Array.isArray(leads)) {
            return res.status(400).json({ error: 'Leads array required' });
        }

        let imported = 0;
        const errors = [];

        for (const lead of leads) {
            try {
                if (!lead.email && !lead.phone) continue;
                
                const formattedPhone = lead.phone ? lead.phone.replace(/\D/g, '').slice(-10) : null;
                
                await pool.query(`
                    INSERT INTO leads (business_name, phone, email, city, state, industry, website, source, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'apollo', 'New Lead')
                    ON CONFLICT (phone) DO UPDATE SET
                        email = COALESCE(EXCLUDED.email, leads.email),
                        industry = COALESCE(EXCLUDED.industry, leads.industry),
                        website = COALESCE(EXCLUDED.website, leads.website),
                        updated_at = NOW()
                `, [
                    lead.businessName || lead.company || lead.name,
                    formattedPhone,
                    lead.email,
                    lead.city,
                    lead.state,
                    lead.industry,
                    lead.website
                ]);
                
                imported++;
            } catch (err) {
                errors.push({ lead: lead.businessName, error: err.message });
            }
        }

        res.json({ 
            success: true, 
            imported, 
            errors: errors.slice(0, 5) 
        });
    } catch (error) {
        console.error('Apollo import error:', error);
        res.status(500).json({ error: 'Import failed' });
    }
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

// Delete all leads (nuclear option)
app.delete('/api/leads/all', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM leads RETURNING id');
        res.json({ 
            success: true, 
            deleted: result.rowCount,
            message: `Deleted ${result.rowCount} leads`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete leads' });
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
                service_tier TEXT DEFAULT 'full-service',
                setup_fee_amount DECIMAL DEFAULT 1500,
                monthly_retainer DECIMAL DEFAULT 500,
                portal_access_token TEXT,
                stripe_customer_id TEXT,
                setup_fee_paid BOOLEAN DEFAULT FALSE,
                subscription_id TEXT,
                subscription_status TEXT,
                business_hours TEXT DEFAULT '24/7',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Add missing columns to clients table if they don't exist (for existing databases)
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_tier TEXT DEFAULT 'full-service'`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS setup_fee_amount DECIMAL DEFAULT 1500`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_retainer DECIMAL DEFAULT 500`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_access_token TEXT`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS setup_fee_paid BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_id TEXT`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS subscription_status TEXT`);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_hours TEXT DEFAULT '24/7'`);

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

        // Campaigns table for Agent E
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'draft',
                emails_sent INTEGER DEFAULT 0,
                open_rate DECIMAL,
                reply_rate DECIMAL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                started_at TIMESTAMP
            );
        `);

        // Campaign leads junction table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaign_leads (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
                lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'pending',
                added_at TIMESTAMP DEFAULT NOW(),
                sent_at TIMESTAMP,
                opened_at TIMESTAMP,
                UNIQUE(campaign_id, lead_id)
            );
        `);

        // Email logs for tracking
        await pool.query(`
            CREATE TABLE IF NOT EXISTS email_logs (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
                campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
                to_email TEXT NOT NULL,
                subject TEXT,
                body TEXT,
                status TEXT DEFAULT 'sent',
                resend_id TEXT,
                error_message TEXT,
                sent_at TIMESTAMP DEFAULT NOW(),
                opened_at TIMESTAMP
            );
        `);

        // Client documents for onboarding
        await pool.query(`
            CREATE TABLE IF NOT EXISTS client_documents (
                id SERIAL PRIMARY KEY,
                client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                document_type TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_data TEXT,
                file_size INTEGER,
                mime_type TEXT,
                uploaded_at TIMESTAMP DEFAULT NOW()
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
// AGENT E MIGRATION
// ===================

app.post('/api/migrate', async (req, res) => {
    console.log('🔄 Running Agent E migration...');
    
    try {
        // Add email tracking columns to leads
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT false`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_type VARCHAR(50)`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP`);
        
        console.log('✅ Added email columns to leads table');
        
        // Create workflow tracking tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lead_workflows (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER REFERENCES leads(id),
                workflow_type VARCHAR(50),
                workflow_name VARCHAR(100),
                status VARCHAR(20) DEFAULT 'active',
                current_step INTEGER DEFAULT 0,
                total_steps INTEGER,
                started_at TIMESTAMP,
                last_executed_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        `);
        
        console.log('✅ Created lead_workflows table');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS workflow_steps (
                id SERIAL PRIMARY KEY,
                workflow_id INTEGER REFERENCES lead_workflows(id),
                lead_id INTEGER,
                step_index INTEGER,
                step_type VARCHAR(20),
                template VARCHAR(50),
                scheduled_at TIMESTAMP,
                executed_at TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending',
                result JSONB
            )
        `);
        
        console.log('✅ Created workflow_steps table');
        
        // Verify tables exist
        const tables = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('leads', 'lead_workflows', 'workflow_steps')
        `);
        
        // Check leads columns
        const columns = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'leads' AND column_name LIKE 'email%'
        `);
        
        res.json({ 
            success: true, 
            message: 'Migration complete',
            tables: tables.rows.map(r => r.table_name),
            emailColumns: columns.rows.map(r => r.column_name)
        });
        
    } catch (error) {
        console.error('❌ Migration error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================
// AGENT E EMAIL SERVICE
// ===================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'maurice.pinnock@apexvoicesolutions.com';
const TEST_FROM_EMAIL = 'onboarding@resend.dev'; // Resend's test domain (works without verification)

async function sendEmail({ to, subject, html, text, useTestDomain = false }) {
    if (!RESEND_API_KEY) {
        console.log('Resend not configured, skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    const fromAddress = useTestDomain ? TEST_FROM_EMAIL : FROM_EMAIL;

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromAddress,
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

// Email test endpoint - uses Resend's test domain
app.post('/api/email/test', async (req, res) => {
    const { to, template } = req.body;
    
    if (!to) {
        return res.status(400).json({ error: 'Email address required' });
    }
    
    const firstName = 'Maurice';
    const businessType = 'Roofing';
    
    const templates = {
        cold_intro: {
            subject: `${firstName}, your ${businessType} business is missing calls`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px;">
                    <div style="background: #fef3c7; padding: 10px; text-align: center; font-weight: bold;">
                        🧪 TEST EMAIL FROM AGENT E
                    </div>
                    <p>Hey ${firstName},</p>
                    <p>Quick question: What happens when a potential customer calls your ${businessType} business at 9 PM?</p>
                    <p>If you're like most local service businesses, that call goes to voicemail. And that customer? They're calling your competitor next.</p>
                    <p><strong>Every missed call is lost revenue.</strong></p>
                    <p>We built Apex Voice Solutions to fix this. Our AI receptionists:</p>
                    <ul>
                        <li>Answer every call 24/7</li>
                        <li>Qualify leads while you sleep</li>
                        <li>Book jobs directly into your calendar</li>
                        <li>Sound indistinguishable from a human</li>
                    </ul>
                    <p style="margin: 30px 0;">
                        <a href="https://apexvoicesolutions.org" style="background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px;">Hear It In Action →</a>
                    </p>
                    <p>Best,<br>Maurice Pinnock<br>Apex Voice Solutions</p>
                </div>
            `
        },
        follow_up: {
            subject: `Still interested in never missing a call, ${firstName}?`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px;">
                    <div style="background: #fef3c7; padding: 10px; text-align: center; font-weight: bold;">
                        🧪 TEST FOLLOW-UP EMAIL
                    </div>
                    <p>Hey ${firstName},</p>
                    <p>I reached out a few days ago about solving the missed call problem for your ${businessType} business.</p>
                    <p>Quick math: If you miss just 2 calls a week at an average job value of $500, that's <strong>$52,000 in lost revenue per year</strong>.</p>
                    <p>Our AI receptionist costs less than a single missed job per month.</p>
                    <p>Best,<br>Maurice Pinnock<br>Apex Voice Solutions</p>
                </div>
            `
        }
    };
    
    const selectedTemplate = templates[template] || templates.cold_intro;
    
    const result = await sendEmail({
        to,
        subject: `[TEST] ${selectedTemplate.subject}`,
        html: selectedTemplate.html,
        useTestDomain: true  // Uses onboarding@resend.dev
    });
    
    res.json(result);
});

// Send cold intro to lead
app.post('/api/email/cold-intro', async (req, res) => {
    const { leadId } = req.body;
    
    try {
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
        const lead = leadResult.rows[0];
        
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        const firstName = lead.business_name?.split(' ')[0] || 'there';
        const subject = `${firstName}, your business is missing calls`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
                <p>Hey ${firstName},</p>
                <p>Quick question: What happens when a potential customer calls your business at 9 PM?</p>
                <p>If you're like most local service businesses, that call goes to voicemail. And that customer? They're calling your competitor next.</p>
                <p><strong>Every missed call is lost revenue.</strong></p>
                <p>We built Apex Voice Solutions to fix this. Our AI receptionists:</p>
                <ul>
                    <li>Answer every call 24/7</li>
                    <li>Qualify leads while you sleep</li>
                    <li>Book jobs directly into your calendar</li>
                    <li>Sound indistinguishable from a human</li>
                </ul>
                <p style="margin: 30px 0;">
                    <a href="https://apexvoicesolutions.org" style="background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px;">Hear It In Action →</a>
                </p>
                <p>Best,<br>Maurice Pinnock<br>Apex Voice Solutions</p>
            </div>
        `;
        
        const result = await sendEmail({
            to: lead.email,
            subject,
            html
        });
        
        if (result.success) {
            await pool.query(
                'UPDATE leads SET email_sent = true, email_type = $1, email_sent_at = NOW() WHERE id = $2',
                ['cold_intro', leadId]
            );
        }
        
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get email status for leads
app.get('/api/email/status', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, business_name, email, email_sent, email_type, email_sent_at 
            FROM leads 
            WHERE email IS NOT NULL 
            ORDER BY id DESC 
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================
// WORKFLOW ROUTES (Agent E)
// ===================

// Get active workflows
app.get('/api/workflows/active', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT lw.*, 
                   l.business_name as lead_name, 
                   l.email as lead_email,
                   (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = lw.id AND status = 'completed')::int as completed_steps
            FROM lead_workflows lw
            LEFT JOIN leads l ON lw.lead_id = l.id
            ORDER BY lw.started_at DESC
            LIMIT 100
        `);
        res.json({ workflows: result.rows });
    } catch (error) {
        console.error('Error fetching workflows:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get workflow types
app.get('/api/workflows/types', (req, res) => {
    res.json({
        workflows: [
            { type: 'NEW_LEAD', name: 'New Lead Sequence', steps: 4 },
            { type: 'DEMO_REQUESTED', name: 'Demo Confirmation', steps: 4 },
            { type: 'NO_ANSWER', name: 'No Answer Follow-up', steps: 2 },
            { type: 'COLD_LEAD', name: 'Reactivation Sequence', steps: 2 }
        ]
    });
});

// Start a workflow for a lead
app.post('/api/workflows/start', async (req, res) => {
    const { leadId, workflowType } = req.body;
    
    if (!leadId || !workflowType) {
        return res.status(400).json({ error: 'leadId and workflowType required' });
    }
    
    try {
        // Get lead
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
        if (leadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        const workflowNames = {
            'NEW_LEAD': 'New Lead Sequence',
            'DEMO_REQUESTED': 'Demo Confirmation',
            'NO_ANSWER': 'No Answer Follow-up',
            'COLD_LEAD': 'Reactivation Sequence'
        };
        
        const workflowSteps = {
            'NEW_LEAD': 4,
            'DEMO_REQUESTED': 4,
            'NO_ANSWER': 2,
            'COLD_LEAD': 2
        };
        
        // Create workflow instance
        const result = await pool.query(`
            INSERT INTO lead_workflows (lead_id, workflow_type, workflow_name, status, current_step, total_steps, started_at)
            VALUES ($1, $2, $3, 'active', 0, $4, NOW())
            RETURNING *
        `, [leadId, workflowType, workflowNames[workflowType] || workflowType, workflowSteps[workflowType] || 4]);
        
        res.json({ success: true, workflow: result.rows[0] });
    } catch (error) {
        console.error('Error starting workflow:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cancel a workflow
app.post('/api/workflows/:id/cancel', async (req, res) => {
    try {
        await pool.query('UPDATE lead_workflows SET status = $1 WHERE id = $2', ['cancelled', req.params.id]);
        await pool.query('UPDATE workflow_steps SET status = $1 WHERE workflow_id = $2 AND status = $3', ['cancelled', req.params.id, 'pending']);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Process pending workflow steps (cron endpoint)
app.post('/api/workflows/process', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT workflow_id FROM workflow_steps 
            WHERE status = 'pending' AND scheduled_at <= NOW()
        `);
        
        // For each pending workflow, we'd execute the step
        // This is a simplified version - the full logic is in services/workflow.js
        
        res.json({ processed: result.rows.length, workflows: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get workflow status for a lead
app.get('/api/workflows/lead/:leadId', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM lead_workflows 
            WHERE lead_id = $1 
            ORDER BY started_at DESC
        `, [req.params.leadId]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================
// CAMPAIGN ROUTES
// ===================

// Get all campaigns
app.get('/api/campaigns', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, 
                   (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id)::int as leads_count
            FROM campaigns c
            ORDER BY c.created_at DESC
        `);
        res.json({ campaigns: result.rows });
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create campaign
app.post('/api/campaigns', async (req, res) => {
    const { name } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Campaign name required' });
    }
    
    try {
        const result = await pool.query(`
            INSERT INTO campaigns (name, status, created_at)
            VALUES ($1, 'draft', NOW())
            RETURNING *
        `, [name]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating campaign:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get campaign by ID
app.get('/api/campaigns/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, 
                   (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id)::int as leads_count
            FROM campaigns c
            WHERE c.id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update campaign
app.put('/api/campaigns/:id', async (req, res) => {
    const { name, status } = req.body;
    
    try {
        const fields = [];
        const values = [req.params.id];
        let paramCount = 2;
        
        if (name) {
            fields.push(`name = $${paramCount}`);
            values.push(name);
            paramCount++;
        }
        if (status) {
            fields.push(`status = $${paramCount}`);
            values.push(status);
            paramCount++;
        }
        
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        fields.push('updated_at = NOW()');
        
        const result = await pool.query(
            `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
            values
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete campaign
app.delete('/api/campaigns/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM campaign_leads WHERE campaign_id = $1', [req.params.id]);
        await pool.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add leads to campaign
app.post('/api/campaigns/:id/leads', async (req, res) => {
    const { leadIds } = req.body;
    
    if (!leadIds || !Array.isArray(leadIds)) {
        return res.status(400).json({ error: 'leadIds array required' });
    }
    
    try {
        for (const leadId of leadIds) {
            await pool.query(`
                INSERT INTO campaign_leads (campaign_id, lead_id, added_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT DO NOTHING
            `, [req.params.id, leadId]);
        }
        res.json({ success: true, added: leadIds.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================
// EMAIL ROUTES (Agent E - Resend)
// ===================

// Send single email via Resend
app.post('/api/emails/send', async (req, res) => {
    const { to, subject, body, lead_id, from } = req.body;
    
    if (!to || !subject || !body) {
        return res.status(400).json({ error: 'to, subject, and body are required' });
    }

    const resendApiKey = process.env.RESEND_API_KEY || 're_HaPE2CB6_LhrU8TBUV9sopDKfZYyFB2yn';
    const senderEmail = from || 'maurice.pinnock@apexvoicesolutions.com';

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: senderEmail,
                to: to,
                subject: subject,
                text: body,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Resend error:', data);
            return res.status(500).json({ error: data.message || 'Failed to send email' });
        }

        // Log email in database
        if (lead_id) {
            await pool.query(`
                UPDATE leads 
                SET email_sent = true, 
                    email_type = 'cold_outreach',
                    email_sent_at = NOW()
                WHERE id = $1
            `, [lead_id]);

            // Create email log
            await pool.query(`
                INSERT INTO email_logs (lead_id, to_email, subject, status, resend_id, sent_at)
                VALUES ($1, $2, $3, 'sent', $4, NOW())
            `, [lead_id, to, subject, data.id]);
        }

        res.json({ 
            success: true, 
            message: 'Email sent successfully',
            email_id: data.id 
        });
    } catch (error) {
        console.error('Email send error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get email logs
app.get('/api/emails/logs', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT el.*, l.business_name 
            FROM email_logs el
            LEFT JOIN leads l ON el.lead_id = l.id
            ORDER BY el.sent_at DESC
            LIMIT 100
        `);
        res.json({ logs: result.rows });
    } catch (error) {
        // Table might not exist yet
        res.json({ logs: [] });
    }
});

// Bulk send emails
app.post('/api/emails/bulk', async (req, res) => {
    const { emails } = req.body; // Array of { to, subject, body, lead_id }
    
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'emails array is required' });
    }

    const resendApiKey = process.env.RESEND_API_KEY || 're_HaPE2CB6_LhrU8TBUV9sopDKfZYyFB2yn';
    const senderEmail = 'maurice.pinnock@apexvoicesolutions.com';
    const results = [];

    for (const email of emails) {
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: senderEmail,
                    to: email.to,
                    subject: email.subject,
                    text: email.body,
                }),
            });

            const data = await response.json();
            results.push({ 
                to: email.to, 
                success: response.ok, 
                id: data.id,
                error: data.message 
            });

            if (email.lead_id) {
                await pool.query(`
                    UPDATE leads 
                    SET email_sent = true, email_sent_at = NOW()
                    WHERE id = $1
                `, [email.lead_id]);
            }
        } catch (err) {
            results.push({ to: email.to, success: false, error: err.message });
        }
    }

    const sent = results.filter(r => r.success).length;
    res.json({ 
        success: true, 
        total: emails.length, 
        sent,
        failed: emails.length - sent,
        results 
    });
});

// ===================
// STRIPE ROUTES (Kevin's Treasury)
// ===================

const stripeService = require('./src/services/stripe');

// Create Stripe customer for client
app.post('/api/stripe/customers', async (req, res) => {
    const { client_id, email, name } = req.body;
    
    if (!email || !name) {
        return res.status(400).json({ error: 'email and name required' });
    }
    
    const result = await stripeService.createCustomer(email, name, { client_id });
    
    if (result.success) {
        // Update client with Stripe customer ID
        await pool.query(
            'UPDATE clients SET stripe_customer_id = $1 WHERE id = $2',
            [result.customer.id, client_id]
        );
        res.json({ success: true, customer: result.customer });
    } else {
        res.status(500).json({ error: result.error });
    }
});

// Create payment link for setup fee
app.post('/api/stripe/payment-links', async (req, res) => {
    const { client_id, amount, description } = req.body;
    
    if (!client_id || !amount) {
        return res.status(400).json({ error: 'client_id and amount required' });
    }
    
    const result = await stripeService.createSetupPaymentLink(client_id, amount, description || 'AI Receptionist Setup');
    res.json(result);
});

// Create monthly subscription
app.post('/api/stripe/subscriptions', async (req, res) => {
    const { customer_id, amount, client_id } = req.body;
    
    if (!customer_id || !amount) {
        return res.status(400).json({ error: 'customer_id and amount required' });
    }
    
    // Create price first
    const price = await stripeService.stripe.prices.create({
        unit_amount: amount * 100,
        currency: 'usd',
        recurring: { interval: 'month' },
        product_data: { name: 'Monthly AI Receptionist Retainer' }
    });
    
    const result = await stripeService.createSubscription(customer_id, price.id, { client_id });
    res.json(result);
});

// Get revenue stats (Kevin's dashboard)
app.get('/api/stripe/stats', async (req, res) => {
    const result = await stripeService.getRevenueStats();
    res.json(result);
});

// Get client payments
app.get('/api/stripe/payments/:customer_id', async (req, res) => {
    const result = await stripeService.getClientPayments(req.params.customer_id);
    res.json(result);
});

// Stripe webhook handler
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    const result = stripeService.verifyWebhookSignature(req.body, sig, webhookSecret);
    
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    
    const event = result.event;
    
    // Handle different event types
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            const clientId = session.metadata?.client_id;
            if (clientId) {
                await pool.query(
                    'UPDATE clients SET setup_paid = true, setup_paid_at = NOW() WHERE id = $1',
                    [clientId]
                );
                console.log(`✅ Setup fee paid for client ${clientId}`);
            }
            break;
            
        case 'invoice.paid':
            const invoice = event.data.object;
            console.log(`✅ Invoice paid: ${invoice.id}`);
            break;
            
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            console.log(`❌ Payment failed: ${failedInvoice.id}`);
            // TODO: Notify Maurice, pause service
            break;
            
        case 'customer.subscription.deleted':
            const sub = event.data.object;
            console.log(`⚠️ Subscription cancelled: ${sub.id}`);
            break;
    }
    
    res.json({ received: true });
});

// ===================
// KEVIN CFO ROUTES
// ===================

// Get aggregated financial data for Kevin's dashboard
app.get('/api/kevin/financials', async (req, res) => {
    try {
        // Get Stripe revenue
        const stripeResult = await stripeService.getRevenueStats();
        const stripeData = stripeResult.success ? stripeResult : { available: 0, pending: 0, totalRevenue: 0 };

        // Get VAPI usage (mock for now - would need VAPI API integration)
        // TODO: Wire up actual VAPI usage tracking
        const vapiData = {
            totalMinutes: 0,
            totalCost: 0,
            callsCount: 0
        };

        // Get client stats
        const clientStats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'active') as active,
                COUNT(*) FILTER (WHERE setup_fee_paid = false OR setup_fee_paid IS NULL) as pending_payment
            FROM clients
        `);

        const clients = clientStats.rows[0] || { total: 0, active: 0, pending_payment: 0 };

        // Calculate profit
        const gross = (stripeData.totalRevenue || 0) - (vapiData.totalCost || 0);
        const margin = stripeData.totalRevenue > 0 
            ? Math.round((gross / stripeData.totalRevenue) * 100) 
            : 0;

        res.json({
            stripe: stripeData,
            vapi: vapiData,
            clients: {
                total: parseInt(clients.total) || 0,
                active: parseInt(clients.active) || 0,
                pendingPayment: parseInt(clients.pending_payment) || 0
            },
            profit: {
                gross,
                margin: margin.toString()
            }
        });
    } catch (error) {
        console.error('Kevin financials error:', error);
        res.json({
            stripe: { available: 0, pending: 0, totalRevenue: 0 },
            vapi: { totalMinutes: 0, totalCost: 0, callsCount: 0 },
            clients: { total: 0, active: 0, pendingPayment: 0 },
            profit: { gross: 0, margin: '0' }
        });
    }
});

// Chat with Kevin (CFO assistant)
app.post('/api/kevin/chat', async (req, res) => {
    const { message, financials } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }

    const lowerMessage = message.toLowerCase();
    
    // Kevin's knowledge base - street-smart CFO responses
    let response = '';
    
    if (lowerMessage.includes('how much') && (lowerMessage.includes('make') || lowerMessage.includes('revenue') || lowerMessage.includes('week') || lowerMessage.includes('month'))) {
        const rev = financials?.stripe?.totalRevenue || 0;
        response = rev > 0 
            ? `You've pulled in $${rev.toLocaleString()} so far. ${rev < 1000 ? "But let's be real — that's not enough to scale. Time to close more deals." : "Solid. Keep that momentum going."}`
            : "Zero revenue. You're in the red right now. The tech is ready — you need to get out there and close clients. Time to get that first check.";
    }
    else if (lowerMessage.includes('who') && lowerMessage.includes('paid')) {
        const pending = financials?.clients?.pendingPayment || 0;
        response = pending > 0 
            ? `You got ${pending} client(s) waiting on payment. Send them the Stripe link and get that money secured.`
            : "Everyone's paid up — or you got no clients yet. Either way, stack more wins.";
    }
    else if (lowerMessage.includes('vapi') || lowerMessage.includes('burn') || lowerMessage.includes('cost')) {
        const cost = financials?.vapi?.totalCost || 0;
        response = cost > 0 
            ? `VAPI's burned $${cost.toFixed(2)} so far. That's your operating cost. Make sure your pricing covers this plus profit margin.`
            : "No VAPI costs yet. Means you got no calls happening. Get clients active, then we'll track the burn rate.";
    }
    else if (lowerMessage.includes('profit') || lowerMessage.includes('margin')) {
        const profit = financials?.profit?.gross || 0;
        const margin = financials?.profit?.margin || '0';
        response = profit >= 0 
            ? `Gross profit: $${profit.toLocaleString()} with ${margin}% margin. ${parseInt(margin) < 50 ? "That margin is tight. Raise prices or cut costs." : "Healthy margins. Keep it up."}`
            : `You're in the red by $${Math.abs(profit).toLocaleString()}. VAPI costs are eating your revenue. Time to close more deals or raise prices.`;
    }
    else if (lowerMessage.includes('client') && (lowerMessage.includes('profitable') || lowerMessage.includes('most'))) {
        // TODO: Calculate per-client profitability
        response = "I'll need to track calls per client to tell you who's most profitable. Right now, we don't have that data wired up. Want me to build that?";
    }
    else if (lowerMessage.includes('help') || lowerMessage.includes('what can you')) {
        response = "I'm Kevin, your CFO. I track:\n\n• Revenue (Stripe)\n• Costs (VAPI usage)\n• Client payments\n• Profit margins\n\nAsk me anything about your numbers. I'll keep it real with you.";
    }
    else {
        response = "I track the money — revenue, costs, clients, profit. Ask me something specific like 'How much we make?' or 'What's our burn rate?' and I'll break it down.";
    }

    res.json({ response });
});

// ===================
// CLIENT PORTAL ROUTES
// ===================

const crypto = require('crypto');

// Generate portal access token for a client
app.post('/api/portal/generate-token/:clientId', async (req, res) => {
    const { clientId } = req.params;
    
    try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
        
        await pool.query(
            'UPDATE clients SET portal_access_token = $1 WHERE id = $2',
            [token, clientId]
        );
        
        const portalUrl = `https://crm.apexvoicesolutions.org/portal?token=${token}`;
        
        res.json({ 
            success: true, 
            token,
            portalUrl,
            expiresAt 
        });
    } catch (error) {
        console.error('Error generating portal token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// Get client data for portal
app.get('/api/portal/client', async (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }
    
    try {
        const result = await pool.query(
            'SELECT * FROM clients WHERE portal_access_token = $1',
            [token]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid token' });
        }
        
        const client = result.rows[0];
        
        // Get call stats for this client
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_calls,
                COALESCE(AVG(duration), 0)::int as avg_duration
            FROM calls 
            WHERE lead_id IN (SELECT id FROM leads WHERE phone = $1)
        `, [client.business_phone]);
        
        const stats = {
            totalCalls: parseInt(statsResult.rows[0]?.total_calls) || 0,
            avgDuration: formatDuration(statsResult.rows[0]?.avg_duration || 0),
            missedCalls: 0,
            bookingsCreated: 0
        };
        
        res.json({ client, stats });
    } catch (error) {
        console.error('Error fetching portal client:', error);
        res.status(500).json({ error: 'Failed to fetch client' });
    }
});

// Update client settings from portal
app.post('/api/portal/update', async (req, res) => {
    const { token, greeting, voiceStyle, services, faq, businessHours, escalationPhone } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }
    
    try {
        const result = await pool.query(`
            UPDATE clients 
            SET greeting = COALESCE($1, greeting),
                voice_style = COALESCE($2, voice_style),
                services = COALESCE($3, services),
                faq = COALESCE($4, faq),
                business_hours = COALESCE($5, business_hours),
                escalation_phone = COALESCE($6, escalation_phone),
                updated_at = NOW()
            WHERE portal_access_token = $7
            RETURNING *
        `, [greeting, voiceStyle, services, faq, businessHours, escalationPhone, token]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid token' });
        }
        
        // TODO: Update VAPI assistant with new settings
        
        res.json({ success: true, client: result.rows[0] });
    } catch (error) {
        console.error('Error updating portal:', error);
        res.status(500).json({ error: 'Failed to update' });
    }
});

// Helper function to format duration
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===================
// LEAD ENRICHMENT (Apollo.io)
// ===================

const apolloService = require('./src/services/apollo');

// Enrich single lead
app.post('/api/leads/:id/enrich', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Get the lead
        const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
        if (leadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        
        const lead = leadResult.rows[0];
        
        // Skip if already has email
        if (lead.email && lead.phone) {
            return res.json({ 
                success: true, 
                message: 'Lead already enriched',
                lead 
            });
        }
        
        // Search Apollo for matching business
        let enrichedData = {};
        
        // Try to find by business name + location
        if (lead.business_name && (lead.city || lead.state)) {
            const searchResult = await apolloService.searchPeople({
                q_organization_name: lead.business_name,
                person_locations: [`${lead.city || ''}, ${lead.state || ''}`.trim()].filter(Boolean),
                perPage: 5
            });
            
            if (searchResult.people && searchResult.people.length > 0) {
                const person = searchResult.people[0];
                enrichedData = {
                    email: person.email || lead.email,
                    phone: person.phone_numbers?.[0]?.raw_number || person.sanitized_phone || lead.phone,
                    website: person.organization?.website_url || lead.website,
                    industry: person.organization?.industry || lead.industry,
                    linkedin: person.linkedin_url || null
                };
            }
        }
        
        // Try to find by phone number if no results yet
        if (!enrichedData.email && lead.phone) {
            // Apollo doesn't have reverse phone lookup, but we can try organization search
            // For now, just keep existing data
        }
        
        // Update lead with enriched data
        if (enrichedData.email || enrichedData.phone) {
            const updateResult = await pool.query(`
                UPDATE leads 
                SET email = COALESCE($1, email),
                    phone = COALESCE($2, phone),
                    website = COALESCE($3, website),
                    industry = COALESCE($4, industry),
                    updated_at = NOW()
                WHERE id = $5
                RETURNING *
            `, [enrichedData.email, enrichedData.phone, enrichedData.website, enrichedData.industry, id]);
            
            res.json({ 
                success: true, 
                message: 'Lead enriched',
                enriched: enrichedData,
                lead: updateResult.rows[0]
            });
        } else {
            res.json({ 
                success: false, 
                message: 'No enrichment data found',
                lead 
            });
        }
    } catch (error) {
        console.error('Error enriching lead:', error);
        res.status(500).json({ error: 'Failed to enrich lead' });
    }
});

// Bulk enrich leads
app.post('/api/leads/enrich/bulk', async (req, res) => {
    const { leadIds } = req.body;
    
    if (!leadIds || !Array.isArray(leadIds)) {
        return res.status(400).json({ error: 'leadIds array required' });
    }
    
    const results = {
        total: leadIds.length,
        enriched: 0,
        skipped: 0,
        failed: 0,
        leads: []
    };
    
    for (const id of leadIds) {
        try {
            // Get the lead
            const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
            if (leadResult.rows.length === 0) {
                results.failed++;
                continue;
            }
            
            const lead = leadResult.rows[0];
            
            // Skip if already has email and phone
            if (lead.email && lead.phone) {
                results.skipped++;
                results.leads.push({ id, status: 'skipped', reason: 'Already enriched' });
                continue;
            }
            
            // Search Apollo
            let enrichedData = {};
            
            if (lead.business_name) {
                const searchResult = await apolloService.searchPeople({
                    q_organization_name: lead.business_name,
                    person_locations: lead.city ? [`${lead.city}, ${lead.state || ''}`] : [],
                    perPage: 3
                });
                
                if (searchResult.people && searchResult.people.length > 0) {
                    const person = searchResult.people[0];
                    enrichedData = {
                        email: person.email || null,
                        phone: person.phone_numbers?.[0]?.raw_number || person.sanitized_phone || null
                    };
                }
            }
            
            // Update if found
            if (enrichedData.email || enrichedData.phone) {
                await pool.query(`
                    UPDATE leads 
                    SET email = COALESCE($1, email),
                        phone = COALESCE($2, phone),
                        updated_at = NOW()
                    WHERE id = $3
                `, [enrichedData.email, enrichedData.phone, id]);
                
                results.enriched++;
                results.leads.push({ id, status: 'enriched', data: enrichedData });
            } else {
                results.failed++;
                results.leads.push({ id, status: 'failed', reason: 'No match found' });
            }
            
            // Rate limit: wait 200ms between requests
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (err) {
            results.failed++;
            results.leads.push({ id, status: 'error', error: err.message });
        }
    }
    
    res.json(results);
});

// Enrich all leads missing email
app.post('/api/leads/enrich/all', async (req, res) => {
    try {
        // Get leads without email
        const result = await pool.query(`
            SELECT id FROM leads 
            WHERE email IS NULL OR email = ''
            LIMIT 100
        `);
        
        if (result.rows.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No leads need enrichment' 
            });
        }
        
        const leadIds = result.rows.map(r => r.id);
        
        // Trigger bulk enrichment
        res.json({ 
            success: true, 
            message: `Starting enrichment for ${leadIds.length} leads`,
            leadIds,
            note: 'Use POST /api/leads/enrich/bulk to process'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
// Stripe integration added Feb 28, 2026
