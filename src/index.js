/**
 * ClearView Title Search Bot
 * Main entry point - Express web server
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { performTitleSearch } from './search/titleSearch.js';
import { getPdfUrl, downloadPdf } from './api/hillsborough.js';
import { searchByAddress } from './api/propertyAppraiser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// API Routes

/**
 * POST /api/search
 * Perform a title search
 */
app.post('/api/search', async (req, res) => {
  try {
    const { ownerName, yearsBack = 30 } = req.body;
    
    if (!ownerName) {
      return res.status(400).json({ error: 'ownerName is required' });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Title Search Request: ${ownerName}`);
    console.log(`${'='.repeat(60)}`);
    
    const results = await performTitleSearch({
      ownerName,
      yearsBack: parseInt(yearsBack)
    });
    
    console.log(`\nSearch complete. Found ${results.documents.length} documents.`);
    console.log(`Risk level: ${results.summary.riskLevel}`);
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/address
 * Search property appraiser by address
 */
app.post('/api/address', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address || address.trim().length < 3) {
      return res.status(400).json({ error: 'Address must be at least 3 characters' });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Address Search Request: ${address}`);
    console.log(`${'='.repeat(60)}`);
    
    const results = await searchByAddress(address);
    
    console.log(`Found ${results.length} properties`);
    
    res.json({ results, count: results.length });
  } catch (error) {
    console.error('Address search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/document/:id
 * Get document PDF URL (redirect)
 */
app.get('/api/document/:id', (req, res) => {
  const { id } = req.params;
  const pdfUrl = getPdfUrl(id);
  res.redirect(pdfUrl);
});

/**
 * GET /api/document/:id/download
 * Download and proxy the PDF
 */
app.get('/api/document/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const pdfBuffer = await downloadPdf(id);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="document-${Date.now()}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         ClearView Title Search Bot                        ║
║                                                            ║
║   Server running at http://localhost:${PORT}                 ║
║                                                            ║
║   Endpoints:                                               ║
║   - POST /api/search     - Search by owner name            ║
║   - POST /api/address    - Search by property address      ║
║   - GET  /api/document/:id - View document PDF             ║
║   - GET  /health         - Health check                    ║
╚════════════════════════════════════════════════════════════╝
  `);
});
