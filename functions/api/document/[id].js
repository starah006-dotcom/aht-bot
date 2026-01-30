/**
 * Cloudflare Pages Function: Document Redirect
 * GET /api/document/:id - Redirect to PDF
 */

const BASE_URL = 'https://publicaccess.hillsclerk.com';
const PDF_API = '/Public/ORIUtilities/OverlayWatermark/api/Watermark';

export async function onRequestGet(context) {
  const { id } = context.params;
  const pdfUrl = `${BASE_URL}${PDF_API}/${id}`;
  
  return Response.redirect(pdfUrl, 302);
}
