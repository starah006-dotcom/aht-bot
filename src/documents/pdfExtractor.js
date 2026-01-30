/**
 * PDF Text Extraction (Node.js version)
 * Extracts text from PDF documents for analysis
 * Falls back to Tesseract OCR for scanned documents
 */

import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { downloadPdf } from '../api/hillsborough.js';
import { fromBuffer } from 'pdf2pic';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Tesseract worker (reused across calls)
let tesseractWorker = null;

/**
 * Initialize Tesseract worker
 */
async function initTesseract() {
  if (tesseractWorker) return tesseractWorker;
  
  tesseractWorker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r[OCR] ${Math.round(m.progress * 100)}%`);
      }
    }
  });
  
  return tesseractWorker;
}

/**
 * Convert PDF page to image for OCR
 * @param {Buffer} pdfBuffer PDF data
 * @param {number} pageNum Page number (1-indexed)
 * @returns {Promise<Buffer>} Image buffer
 */
async function pdfPageToImage(pdfBuffer, pageNum = 1) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-'));
  
  try {
    const convert = fromBuffer(pdfBuffer, {
      density: 200,
      saveFilename: 'page',
      savePath: tempDir,
      format: 'png',
      width: 1600,
      height: 2000
    });
    
    const result = await convert(pageNum, { responseType: 'buffer' });
    return result.buffer;
  } finally {
    // Clean up temp directory
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file));
      }
      await fs.rmdir(tempDir);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run OCR on an image buffer
 * @param {Buffer} imageBuffer Image data
 * @returns {Promise<string>} Extracted text
 */
async function runOCR(imageBuffer) {
  const worker = await initTesseract();
  const { data: { text } } = await worker.recognize(imageBuffer);
  return text;
}

/**
 * Extract text from a document by its ID
 * @param {string} documentId The encoded document ID
 * @param {Object} options Extraction options
 * @param {boolean} options.enableOCR Enable OCR fallback
 * @param {number} options.maxOCRPages Maximum pages to OCR
 * @returns {Promise<Object>} Extracted text and metadata
 */
export async function extractTextFromDocument(documentId, options = {}) {
  const { enableOCR = true, maxOCRPages = 3 } = options;
  
  try {
    // Download the PDF
    const pdfBuffer = await downloadPdf(documentId);
    const buffer = Buffer.from(pdfBuffer);
    
    // Try pdf-parse first
    const data = await pdfParse(buffer);
    
    // Check if we got meaningful text
    const hasText = data.text && data.text.trim().length > 100;
    
    let text = data.text;
    let usedOCR = false;
    
    // If no text and OCR is enabled, try OCR
    if (!hasText && enableOCR) {
      console.log('\n[Scanner] No text layer found, attempting OCR...');
      
      try {
        text = '';
        const pagesToOCR = Math.min(data.numpages, maxOCRPages);
        
        for (let i = 1; i <= pagesToOCR; i++) {
          console.log(`[OCR] Processing page ${i}/${pagesToOCR}...`);
          
          // Convert page to image
          const imageBuffer = await pdfPageToImage(buffer, i);
          
          // Run OCR
          const pageText = await runOCR(imageBuffer);
          text += pageText + '\n';
          
          console.log(`\n[OCR] Page ${i}: ${pageText.length} chars extracted`);
        }
        
        usedOCR = true;
      } catch (ocrError) {
        console.error('\n[OCR] Failed:', ocrError.message);
        // Continue with empty text
      }
    }
    
    const finalHasText = text && text.trim().length > 100;
    
    return {
      success: true,
      text,
      numPages: data.numpages,
      info: data.info,
      metadata: data.metadata,
      hasText: finalHasText,
      usedOCR,
      needsManualReview: !finalHasText
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    return {
      success: false,
      error: error.message,
      needsManualReview: true
    };
  }
}

/**
 * Parse mortgage document text to extract key information
 * @param {string} text Raw PDF text
 * @returns {Object} Extracted mortgage info
 */
export function parseMortgageText(text) {
  const info = {
    principalAmount: null,
    lenderName: null,
    instrumentReferences: [],
    isModification: false,
    isRefinance: false,
    maturityDate: null,
    interestRate: null,
    propertyAddress: null,
    confidence: 'low'
  };
  
  if (!text || text.trim().length < 50) {
    return info;
  }
  
  const normalizedText = text.toUpperCase();
  
  // ===== PRINCIPAL AMOUNT EXTRACTION =====
  const amountPatterns = [
    /PRINCIPAL\s+(?:SUM|AMOUNT)\s+(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /IN\s+THE\s+AMOUNT\s+OF\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)\s*(?:\(|DOLLARS)/i,
    /FACE\s+AMOUNT\s*(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /LOAN\s+AMOUNT\s*(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /\$[\s,]*([1-9][0-9]{4,}(?:\.[0-9]{2})?)/i
  ];
  
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount >= 10000 && amount <= 50000000) {
        info.principalAmount = amount;
        break;
      }
    }
  }
  
  // ===== LENDER NAME EXTRACTION =====
  const lenderPatterns = [
    /(?:MORTGAGEE|LENDER)\s*[:\s]+([A-Z][A-Z0-9\s,\.&'-]+?)(?:\s*[,\n]|$)/i,
    /IN\s+FAVOR\s+OF\s+([A-Z][A-Z0-9\s,\.&'-]+?)(?:\s*[,\n]|ITS|A\s+)/i,
    /(WELLS\s+FARGO[A-Z\s,\.&'-]*BANK|BANK\s+OF\s+AMERICA[A-Z\s,\.&'-]*|CHASE\s+[A-Z\s,\.&'-]*BANK|JPMORGAN[A-Z\s,\.&'-]*|QUICKEN\s+LOANS|ROCKET\s+MORTGAGE|UNITED\s+SHORE|CALIBER\s+HOME|FREEDOM\s+MORTGAGE|PENNYMAC|GUILD\s+MORTGAGE|CROSSCOUNTRY\s+MORTGAGE|MOVEMENT\s+MORTGAGE|LOAN\s*DEPOT|NAVY\s+FEDERAL|USAA|FIFTH\s+THIRD|PNC\s+BANK|REGIONS\s+BANK|SUNTRUST|TRUIST|CITIZENS\s+BANK)/i,
    /([A-Z][A-Z\s&'-]+,?\s*N\.?A\.?)/i
  ];
  
  for (const pattern of lenderPatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (name.length > 3 && !name.match(/^(THE|AND|FOR|THIS|THAT)$/i)) {
        info.lenderName = name;
        break;
      }
    }
  }
  
  // ===== INSTRUMENT REFERENCE EXTRACTION =====
  const refPatterns = [
    /INSTRUMENT\s*(?:NO\.?|NUMBER|#)\s*:?\s*([0-9]{6,})/gi,
    /(?:RECORDED\s+IN\s+)?(?:OR\s+)?BOOK\s+([0-9]+)\s*,?\s*PAGE\s+([0-9]+)/gi,
    /CFN\s*(?:#|NO\.?)?\s*([0-9]{6,})/gi,
    /DOCUMENT\s*(?:NO\.?|NUMBER|#)\s*:?\s*([0-9]{6,})/gi
  ];
  
  for (const pattern of refPatterns) {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const ref = match[2] ? `Book ${match[1]}, Page ${match[2]}` : match[1];
      if (!info.instrumentReferences.includes(ref)) {
        info.instrumentReferences.push(ref);
      }
    }
  }
  
  // ===== MODIFICATION/REFINANCE DETECTION =====
  info.isModification = /MODIFICATION|LOAN\s+MOD/i.test(normalizedText);
  info.isRefinance = /REFINANC|REFI\s/i.test(normalizedText);
  
  // ===== INTEREST RATE =====
  const rateMatch = text.match(/(?:INTEREST\s+RATE|RATE\s+OF)\s*[:\s]+([0-9]+\.?[0-9]*)\s*%/i);
  if (rateMatch) {
    info.interestRate = parseFloat(rateMatch[1]);
  }
  
  // ===== MATURITY DATE =====
  const maturityMatch = text.match(/MATUR(?:ITY|ES?)\s*(?:DATE)?\s*[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
  if (maturityMatch) {
    info.maturityDate = maturityMatch[1];
  }
  
  // ===== CONFIDENCE SCORING =====
  let confidenceScore = 0;
  if (info.principalAmount) confidenceScore += 3;
  if (info.lenderName) confidenceScore += 2;
  if (info.interestRate) confidenceScore += 1;
  if (info.maturityDate) confidenceScore += 1;
  
  info.confidence = confidenceScore >= 4 ? 'high' : confidenceScore >= 2 ? 'medium' : 'low';
  
  return info;
}

/**
 * Parse deed document text to extract key information
 * @param {string} text Raw PDF text
 * @returns {Object} Extracted deed info
 */
export function parseDeedText(text) {
  const info = {
    consideration: null,
    legalDescription: null,
    propertyAddress: null,
    deedType: null,
    grantors: [],
    grantees: [],
    confidence: 'low'
  };
  
  if (!text || text.trim().length < 50) {
    return info;
  }
  
  const normalizedText = text.toUpperCase();
  
  // ===== CONSIDERATION/SALE PRICE =====
  const considerationPatterns = [
    /FOR\s+AND\s+IN\s+CONSIDERATION\s+OF\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /CONSIDERATION\s+(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /SUM\s+OF\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /DOCUMENTARY\s+STAMP(?:S)?\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i
  ];
  
  for (const pattern of considerationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount >= 1000) {
        info.consideration = amount;
        break;
      }
    }
  }
  
  // If we found doc stamps, calculate sale price (FL rate: $0.70 per $100)
  if (!info.consideration && text.match(/DOCUMENTARY\s+STAMP/i)) {
    const stampMatch = text.match(/\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)\s*(?:DOC|DOCUMENTARY)/i);
    if (stampMatch) {
      const stamps = parseFloat(stampMatch[1].replace(/,/g, ''));
      info.consideration = (stamps / 0.70) * 100;
    }
  }
  
  // ===== LEGAL DESCRIPTION =====
  const legalPatterns = [
    /(LOT\s+[0-9A-Z]+,?\s*(?:OF\s+)?BLOCK\s+[0-9A-Z]+[^.]*)/i,
    /(UNIT\s+(?:NO\.?\s*)?[0-9A-Z-]+[^.]*(?:CONDOMINIUM|CONDO)[^.]*)/i,
    /(SEC(?:TION)?\s+[0-9]+[^.]*TOWNSHIP\s+[0-9]+[^.]*RANGE\s+[0-9]+[^.]*)/i,
    /PARCEL\s+(?:ID|IDENTIFICATION|NUMBER|NO\.?)?\s*:?\s*([0-9-]+)/i
  ];
  
  for (const pattern of legalPatterns) {
    const match = text.match(pattern);
    if (match) {
      info.legalDescription = match[1].trim().substring(0, 200);
      break;
    }
  }
  
  // ===== DEED TYPE =====
  if (/WARRANTY\s+DEED/i.test(normalizedText)) {
    info.deedType = 'WARRANTY';
  } else if (/QUIT\s*CLAIM/i.test(normalizedText)) {
    info.deedType = 'QUIT CLAIM';
  } else if (/SPECIAL\s+WARRANTY/i.test(normalizedText)) {
    info.deedType = 'SPECIAL WARRANTY';
  } else if (/TAX\s+DEED/i.test(normalizedText)) {
    info.deedType = 'TAX DEED';
  } else if (/PERSONAL\s+REPRESENTATIVE/i.test(normalizedText)) {
    info.deedType = 'PR DEED';
  } else if (/TRUSTEE/i.test(normalizedText)) {
    info.deedType = 'TRUSTEE DEED';
  }
  
  // ===== CONFIDENCE =====
  let confidenceScore = 0;
  if (info.consideration) confidenceScore += 2;
  if (info.legalDescription) confidenceScore += 2;
  if (info.deedType) confidenceScore += 1;
  
  info.confidence = confidenceScore >= 4 ? 'high' : confidenceScore >= 2 ? 'medium' : 'low';
  
  return info;
}

/**
 * Parse satisfaction document text
 * @param {string} text Raw PDF text
 * @returns {Object} Extracted satisfaction info
 */
export function parseSatisfactionText(text) {
  const info = {
    satisfiedInstrumentNumber: null,
    satisfiedBookPage: null,
    originalLender: null,
    originalAmount: null,
    satisfiedDate: null,
    confidence: 'low'
  };
  
  if (!text || text.trim().length < 50) {
    return info;
  }
  
  const normalizedText = text.toUpperCase();
  
  // ===== SATISFIED INSTRUMENT REFERENCE =====
  const instrumentPatterns = [
    /(?:MORTGAGE|INSTRUMENT|DOCUMENT)\s*(?:NO\.?|NUMBER|#)\s*:?\s*([0-9]{6,})/gi,
    /(?:RECORDED\s+)?(?:IN\s+)?(?:O\.?R\.?\s+)?BOOK\s+([0-9]+)\s*,?\s*PAGE\s+([0-9]+)/gi,
    /CFN\s*(?:#|NO\.?)?\s*([0-9]{6,})/gi
  ];
  
  for (const pattern of instrumentPatterns) {
    const match = pattern.exec(normalizedText);
    if (match) {
      if (match[2]) {
        info.satisfiedBookPage = `Book ${match[1]}, Page ${match[2]}`;
      } else {
        info.satisfiedInstrumentNumber = match[1];
      }
      break;
    }
  }
  
  // ===== ORIGINAL LENDER =====
  const lenderPatterns = [
    /(?:ORIGINALLY\s+)?(?:MADE|EXECUTED)\s+(?:BY\s+.+?\s+)?(?:TO|IN\s+FAVOR\s+OF)\s+([A-Z][A-Z0-9\s,\.&'-]+?)(?:\s*[,\n]|$)/i,
    /(?:MORTGAGEE|LENDER)\s*(?:WAS|:)\s*([A-Z][A-Z0-9\s,\.&'-]+?)(?:\s*[,\n]|$)/i,
    /(WELLS\s+FARGO|BANK\s+OF\s+AMERICA|CHASE|JPMORGAN|QUICKEN|ROCKET|PENNYMAC|CALIBER|FREEDOM\s+MORTGAGE)[A-Z\s,\.&'-]*/i
  ];
  
  for (const pattern of lenderPatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (name.length > 3) {
        info.originalLender = name;
        break;
      }
    }
  }
  
  // ===== ORIGINAL AMOUNT =====
  const amountPatterns = [
    /(?:ORIGINAL|PRINCIPAL)\s+(?:AMOUNT|SUM)\s*(?:OF|:)?\s*\$[\s,]*([0-9,]+)/i,
    /\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)\s*(?:MORTGAGE|LOAN)/i
  ];
  
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount >= 10000) {
        info.originalAmount = amount;
        break;
      }
    }
  }
  
  // ===== DATE =====
  const dateMatch = text.match(/(?:DATED|RECORDED)\s*:?\s*([A-Z]+\s+[0-9]{1,2},?\s*[0-9]{4}|[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
  if (dateMatch) {
    info.satisfiedDate = dateMatch[1];
  }
  
  // ===== CONFIDENCE =====
  let confidenceScore = 0;
  if (info.satisfiedInstrumentNumber || info.satisfiedBookPage) confidenceScore += 3;
  if (info.originalLender) confidenceScore += 2;
  if (info.originalAmount) confidenceScore += 1;
  
  info.confidence = confidenceScore >= 4 ? 'high' : confidenceScore >= 2 ? 'medium' : 'low';
  
  return info;
}

/**
 * Batch extract text from multiple documents
 * @param {Array} documents Array of document objects with documentId
 * @param {Function} onProgress Progress callback (scanned, total, current)
 * @param {Object} options Extraction options
 * @returns {Promise<Object>} Batch extraction results
 */
export async function batchExtractDocuments(documents, onProgress = () => {}, options = {}) {
  const { enableOCR = true, maxOCRPages = 3 } = options;
  
  const results = {
    scanned: 0,
    successful: 0,
    failed: 0,
    needsManualReview: 0,
    usedOCR: 0,
    documents: []
  };
  
  const total = documents.length;
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    onProgress(i, total, doc);
    
    try {
      const extraction = await extractTextFromDocument(doc.documentId, { enableOCR, maxOCRPages });
      
      const result = {
        ...doc,
        extraction: {
          success: extraction.success,
          hasText: extraction.hasText,
          usedOCR: extraction.usedOCR || false,
          needsManualReview: extraction.needsManualReview
        }
      };
      
      if (extraction.success && extraction.hasText) {
        // Parse based on document type
        const docType = doc.docTypeShort || '';
        if (docType === 'MTG' || docType.includes('MTG')) {
          result.extractedData = parseMortgageText(extraction.text);
        } else if (docType === 'SAT' || docType.includes('SAT')) {
          result.extractedData = parseSatisfactionText(extraction.text);
        } else if (docType === 'D') {
          result.extractedData = parseDeedText(extraction.text);
        }
        
        results.successful++;
        if (extraction.usedOCR) {
          results.usedOCR++;
        }
      } else {
        results.needsManualReview++;
      }
      
      results.documents.push(result);
      
    } catch (error) {
      console.error(`Error extracting ${doc.instrumentNumber}:`, error);
      results.documents.push({
        ...doc,
        extraction: { success: false, error: error.message, needsManualReview: true }
      });
      results.failed++;
    }
    
    results.scanned++;
  }
  
  onProgress(total, total, null);
  
  return results;
}

/**
 * Match satisfactions to mortgages using extracted data
 * @param {Array} mortgages Mortgages with extracted data
 * @param {Array} satisfactions Satisfactions with extracted data
 * @returns {Object} Match results
 */
export function matchSatisfactionsToMortgages(mortgages, satisfactions) {
  const matches = [];
  const unmatchedMortgages = [...mortgages];
  const usedSatisfactions = new Set();
  
  for (const sat of satisfactions) {
    const satData = sat.extractedData || {};
    let bestMatch = null;
    let bestScore = 0;
    
    for (let i = 0; i < unmatchedMortgages.length; i++) {
      const mtg = unmatchedMortgages[i];
      const mtgData = mtg.extractedData || {};
      let score = 0;
      let matchReasons = [];
      
      // Method 1: Instrument number match (strongest)
      if (satData.satisfiedInstrumentNumber && mtg.instrumentNumber) {
        if (satData.satisfiedInstrumentNumber === String(mtg.instrumentNumber)) {
          score += 100;
          matchReasons.push('Instrument # exact match');
        }
      }
      
      // Method 2: Book/Page match
      if (satData.satisfiedBookPage && mtg.bookNum && mtg.pageNum) {
        if (satData.satisfiedBookPage.includes(String(mtg.bookNum)) && 
            satData.satisfiedBookPage.includes(String(mtg.pageNum))) {
          score += 90;
          matchReasons.push('Book/Page match');
        }
      }
      
      // Method 3: Amount match (within 1%)
      if (satData.originalAmount && mtgData.principalAmount) {
        const diff = Math.abs(satData.originalAmount - mtgData.principalAmount);
        const pct = diff / mtgData.principalAmount;
        if (pct < 0.01) {
          score += 30;
          matchReasons.push('Amount match');
        }
      }
      
      // Method 4: Lender name match
      if (satData.originalLender && mtgData.lenderName) {
        const satLender = satData.originalLender.toLowerCase();
        const mtgLender = mtgData.lenderName.toLowerCase();
        if (satLender.includes(mtgLender.split(' ')[0]) || 
            mtgLender.includes(satLender.split(' ')[0])) {
          score += 20;
          matchReasons.push('Lender name partial match');
        }
      }
      
      // Method 5: Name match (fallback)
      const satGrantors = (sat.grantors || []).join(' ').toLowerCase();
      const mtgGrantors = (mtg.grantors || []).join(' ').toLowerCase();
      if (satGrantors && mtgGrantors) {
        const satFirstName = satGrantors.split(' ')[0];
        const mtgFirstName = mtgGrantors.split(' ')[0];
        if (satFirstName === mtgFirstName) {
          score += 10;
          matchReasons.push('Grantor name match');
        }
      }
      
      // Method 6: Date logic
      if (sat.recordTimestamp > mtg.recordTimestamp) {
        score += 5;
      } else {
        score -= 20;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { mortgage: mtg, index: i, matchReasons };
      }
    }
    
    if (bestMatch && bestScore >= 30) {
      matches.push({
        satisfaction: sat,
        mortgage: bestMatch.mortgage,
        score: bestScore,
        confidence: bestScore >= 90 ? 'high' : bestScore >= 50 ? 'medium' : 'low',
        matchReasons: bestMatch.matchReasons
      });
      
      unmatchedMortgages.splice(bestMatch.index, 1);
      usedSatisfactions.add(sat.instrumentNumber);
    }
  }
  
  return {
    matches,
    unmatchedMortgages,
    unmatchedSatisfactions: satisfactions.filter(s => !usedSatisfactions.has(s.instrumentNumber))
  };
}

/**
 * Terminate Tesseract worker to free memory
 */
export async function terminateOCR() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

export default {
  extractTextFromDocument,
  parseDeedText,
  parseMortgageText,
  parseSatisfactionText,
  batchExtractDocuments,
  matchSatisfactionsToMortgages,
  terminateOCR
};
