/**
 * PDF Text Extraction
 * Extracts text from PDF documents for analysis
 */

import pdfParse from 'pdf-parse';
import { downloadPdf } from '../api/hillsborough.js';

/**
 * Extract text from a document by its ID
 * @param {string} documentId The encoded document ID
 * @returns {Promise<Object>} Extracted text and metadata
 */
export async function extractTextFromDocument(documentId) {
  try {
    // Download the PDF
    const pdfBuffer = await downloadPdf(documentId);
    
    // Parse the PDF
    const data = await pdfParse(Buffer.from(pdfBuffer));
    
    return {
      success: true,
      text: data.text,
      numPages: data.numpages,
      info: data.info,
      metadata: data.metadata
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Extract key information from deed text
 * @param {string} text Raw PDF text
 * @returns {Object} Extracted information
 */
export function parseDeedText(text) {
  const info = {
    grantors: [],
    grantees: [],
    legalDescription: null,
    consideration: null,
    propertyAddress: null
  };
  
  // Look for common patterns in deed text
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  
  // Find "THIS INDENTURE" or "WARRANTY DEED" patterns
  // This is a simplified parser - real implementation would be more robust
  
  // Look for consideration amount
  const considerationMatch = text.match(/\$[\d,]+\.?\d*/);
  if (considerationMatch) {
    info.consideration = considerationMatch[0];
  }
  
  // Look for legal description (often follows specific patterns)
  const legalMatch = text.match(/(?:LOT|BLOCK|UNIT|PARCEL)\s+[\d\w\-]+/gi);
  if (legalMatch) {
    info.legalDescription = legalMatch[0];
  }
  
  return info;
}

/**
 * Extract key information from mortgage text
 * @param {string} text Raw PDF text
 * @returns {Object} Extracted information
 */
export function parseMortgageText(text) {
  const info = {
    mortgagor: null,
    mortgagee: null,
    principalAmount: null,
    propertyAddress: null
  };
  
  // Look for principal amount
  const amountMatch = text.match(/principal\s+(?:sum|amount)?\s*(?:of)?\s*\$[\d,]+/i);
  if (amountMatch) {
    const numMatch = amountMatch[0].match(/\$[\d,]+/);
    if (numMatch) {
      info.principalAmount = numMatch[0];
    }
  }
  
  return info;
}

export default {
  extractTextFromDocument,
  parseDeedText,
  parseMortgageText
};
