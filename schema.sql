-- Run this in Railway Query Tool

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Clients table (your customers)
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

-- Leads table
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  business_name TEXT,
  phone TEXT UNIQUE,
  email TEXT,
  status TEXT DEFAULT 'New Lead',
  city TEXT,
  state TEXT,
  rating DECIMAL,
  reviews INTEGER,
  address TEXT,
  website TEXT,
  industry TEXT,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Calls table for VAPI webhooks
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

-- Client documents table for onboarding uploads
CREATE TABLE IF NOT EXISTS client_documents (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- 'services_pdf', 'pricing_sheet', 'faq_document', 'custom_script', 'other'
  file_name TEXT NOT NULL,
  file_data TEXT, -- Base64 encoded file data
  file_size INTEGER,
  mime_type TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);
