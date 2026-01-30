/**
 * Cloudflare Pages Function: PDF Proxy for Scanning
 * POST /api/scan - Fetch raw PDF bytes for client-side text extraction
 */

const BASE_URL = 'https://publicaccess.hillsclerk.com';
const PDF_API = '/Public/ORIUtilities/OverlayWatermark/api/Watermark';

export async function onRequestPost(context) {
  try {
    const { documentId } = await context.request.json();
    
    if (!documentId) {
      return new Response(JSON.stringify({ error: 'documentId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const pdfUrl = `${BASE_URL}${PDF_API}/${documentId}`;
    
    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf'
      }
    });
    
    if (!response.ok) {
      return new Response(JSON.stringify({ error: `PDF fetch failed: ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const pdfData = await response.arrayBuffer();
    
    // Return as base64 for easier JavaScript handling
    const base64 = btoa(String.fromCharCode(...new Uint8Array(pdfData)));
    
    return new Response(JSON.stringify({ 
      success: true,
      pdf: base64,
      size: pdfData.byteLength
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
    
  } catch (error) {
    console.error('PDF scan error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
