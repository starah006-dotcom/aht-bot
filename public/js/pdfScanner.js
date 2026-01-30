/**
 * PDF Text Scanner (Client-side)
 * Uses PDF.js to extract text from PDFs for mortgage/satisfaction matching
 */

// Load PDF.js library
const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;

// Configure PDF.js worker
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/**
 * Extract text from a PDF document
 * @param {string} documentId - The encoded document ID
 * @returns {Promise<Object>} Extraction result
 */
export async function extractTextFromDocument(documentId) {
  if (!pdfjsLib) {
    return { success: false, error: 'PDF.js not loaded', needsManualReview: true };
  }
  
  try {
    // Fetch PDF through our proxy to avoid CORS (using POST with JSON body)
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId })
    });
    
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Download failed: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.success || !data.pdf) {
      throw new Error('No PDF data returned');
    }
    
    // Convert base64 back to ArrayBuffer
    const binaryString = atob(data.pdf);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;
    
    // Load PDF with PDF.js
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    const numPages = pdf.numPages;
    
    // Extract text from each page
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }
    
    // Check if we got meaningful text (not a scanned image)
    const hasText = fullText.trim().length > 100;
    
    return {
      success: true,
      text: fullText,
      numPages,
      hasText,
      needsManualReview: !hasText
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
 * @param {string} text - Raw PDF text
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
    // "principal sum of $X" or "principal amount of $X"
    /PRINCIPAL\s+(?:SUM|AMOUNT)\s+(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // "in the amount of $X"
    /IN\s+THE\s+AMOUNT\s+OF\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // "$X.00 (dollars)"
    /\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)\s*(?:\(|DOLLARS)/i,
    // "face amount $X"
    /FACE\s+AMOUNT\s*(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // "loan amount $X"
    /LOAN\s+AMOUNT\s*(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // Just a large dollar amount (fallback)
    /\$[\s,]*([1-9][0-9]{4,}(?:\.[0-9]{2})?)/i
  ];
  
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      // Sanity check: mortgages typically between $10k and $50M
      if (amount >= 10000 && amount <= 50000000) {
        info.principalAmount = amount;
        break;
      }
    }
  }
  
  // ===== LENDER NAME EXTRACTION =====
  const lenderPatterns = [
    // "MORTGAGEE: Name" or "Lender: Name"
    /(?:MORTGAGEE|LENDER)\s*[:\s]+([A-Z][A-Z0-9\s,\.&'-]+?)(?:\s*[,\n]|$)/i,
    // "in favor of Name"
    /IN\s+FAVOR\s+OF\s+([A-Z][A-Z0-9\s,\.&'-]+?)(?:\s*[,\n]|ITS|A\s+)/i,
    // Common bank names
    /(WELLS\s+FARGO[A-Z\s,\.&'-]*BANK|BANK\s+OF\s+AMERICA[A-Z\s,\.&'-]*|CHASE\s+[A-Z\s,\.&'-]*BANK|JPMORGAN[A-Z\s,\.&'-]*|QUICKEN\s+LOANS|ROCKET\s+MORTGAGE|UNITED\s+SHORE|CALIBER\s+HOME|FREEDOM\s+MORTGAGE|PENNYMAC|GUILD\s+MORTGAGE|CROSSCOUNTRY\s+MORTGAGE|MOVEMENT\s+MORTGAGE|LOAN\s*DEPOT|NAVY\s+FEDERAL|USAA|FIFTH\s+THIRD|PNC\s+BANK|REGIONS\s+BANK|SUNTRUST|TRUIST|CITIZENS\s+BANK)/i,
    // "National Association" banks
    /([A-Z][A-Z\s&'-]+,?\s*N\.?A\.?)/i
  ];
  
  for (const pattern of lenderPatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      // Filter out common false positives
      if (name.length > 3 && !name.match(/^(THE|AND|FOR|THIS|THAT)$/i)) {
        info.lenderName = name;
        break;
      }
    }
  }
  
  // ===== INSTRUMENT REFERENCE EXTRACTION =====
  // Look for references to prior instruments (for refinances/modifications)
  const refPatterns = [
    // "Instrument No. XXXXXXXX" or "Inst# XXXXXXXX"
    /INSTRUMENT\s*(?:NO\.?|NUMBER|#)\s*:?\s*([0-9]{6,})/gi,
    // "recorded in OR Book XXX, Page XXX"
    /(?:RECORDED\s+IN\s+)?(?:OR\s+)?BOOK\s+([0-9]+)\s*,?\s*PAGE\s+([0-9]+)/gi,
    // "CFN XXXXXXXX" (Clerk's File Number)
    /CFN\s*(?:#|NO\.?)?\s*([0-9]{6,})/gi,
    // "Document No. XXXXXXXX"
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
 * @param {string} text - Raw PDF text
 * @returns {Object} Extracted deed info
 */
export function parseDeedText(text) {
  const info = {
    consideration: null,
    legalDescription: null,
    propertyAddress: null,
    deedType: null,
    confidence: 'low'
  };
  
  if (!text || text.trim().length < 50) {
    return info;
  }
  
  const normalizedText = text.toUpperCase();
  
  // ===== CONSIDERATION/SALE PRICE =====
  const considerationPatterns = [
    // "for and in consideration of $X"
    /FOR\s+AND\s+IN\s+CONSIDERATION\s+OF\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // "consideration of $X"
    /CONSIDERATION\s+(?:OF\s+)?\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // "sum of $X"
    /SUM\s+OF\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i,
    // Documentary stamp tax (can calculate sale price from this)
    /DOCUMENTARY\s+STAMP(?:S)?\s+\$[\s,]*([0-9,]+(?:\.[0-9]{2})?)/i
  ];
  
  for (const pattern of considerationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount >= 1000) { // Reasonable minimum
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
    // Lot/Block format
    /(LOT\s+[0-9A-Z]+,?\s*(?:OF\s+)?BLOCK\s+[0-9A-Z]+[^.]*)/i,
    // Unit/Condo format
    /(UNIT\s+(?:NO\.?\s*)?[0-9A-Z-]+[^.]*(?:CONDOMINIUM|CONDO)[^.]*)/i,
    // Section/Township/Range
    /(SEC(?:TION)?\s+[0-9]+[^.]*TOWNSHIP\s+[0-9]+[^.]*RANGE\s+[0-9]+[^.]*)/i,
    // Parcel ID
    /PARCEL\s+(?:ID|IDENTIFICATION|NUMBER|NO\.?)?\s*:?\s*([0-9-]+)/i
  ];
  
  for (const pattern of legalPatterns) {
    const match = text.match(pattern);
    if (match) {
      info.legalDescription = match[1].trim().substring(0, 200); // Limit length
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
 * @param {string} text - Raw PDF text
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
    // "Instrument No. XXXXXXXX"
    /(?:MORTGAGE|INSTRUMENT|DOCUMENT)\s*(?:NO\.?|NUMBER|#)\s*:?\s*([0-9]{6,})/gi,
    // "recorded in Book XXX, Page XXX"
    /(?:RECORDED\s+)?(?:IN\s+)?(?:O\.?R\.?\s+)?BOOK\s+([0-9]+)\s*,?\s*PAGE\s+([0-9]+)/gi,
    // "CFN XXXXXXXX"
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
    // Common bank names
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
 * Batch scan documents for text extraction
 * @param {Array} documents - Documents to scan (mortgages and satisfactions)
 * @param {Function} onProgress - Progress callback (scanned, total, current)
 * @returns {Promise<Object>} Scan results with extracted data
 */
export async function batchScanDocuments(documents, onProgress = () => {}) {
  const results = {
    scanned: 0,
    successful: 0,
    failed: 0,
    needsManualReview: 0,
    documents: []
  };
  
  const total = documents.length;
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    onProgress(i, total, doc);
    
    try {
      const extraction = await extractTextFromDocument(doc.documentId);
      
      const result = {
        ...doc,
        extraction: {
          success: extraction.success,
          hasText: extraction.hasText,
          needsManualReview: extraction.needsManualReview
        }
      };
      
      if (extraction.success && extraction.hasText) {
        // Parse based on document type
        if (doc.docTypeShort === 'MTG' || doc.docTypeShort?.includes('MTG')) {
          result.extractedData = parseMortgageText(extraction.text);
        } else if (doc.docTypeShort === 'SAT' || doc.docTypeShort?.includes('SAT')) {
          result.extractedData = parseSatisfactionText(extraction.text);
        } else if (doc.docTypeShort === 'D') {
          result.extractedData = parseDeedText(extraction.text);
        }
        
        results.successful++;
      } else {
        results.needsManualReview++;
      }
      
      results.documents.push(result);
      
    } catch (error) {
      console.error(`Error scanning ${doc.instrumentNumber}:`, error);
      results.documents.push({
        ...doc,
        extraction: { success: false, error: error.message, needsManualReview: true }
      });
      results.failed++;
    }
    
    results.scanned++;
    
    // Small delay to prevent overwhelming the browser
    await new Promise(r => setTimeout(r, 100));
  }
  
  onProgress(total, total, null);
  
  return results;
}

/**
 * Match satisfactions to mortgages using extracted data
 * @param {Array} mortgages - Mortgages with extracted data
 * @param {Array} satisfactions - Satisfactions with extracted data
 * @returns {Array} Matched pairs with confidence scores
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
        if (satData.satisfiedInstrumentNumber === mtg.instrumentNumber) {
          score += 100;
          matchReasons.push('Instrument # exact match');
        }
      }
      
      // Method 2: Book/Page match
      if (satData.satisfiedBookPage && mtg.bookNum && mtg.pageNum) {
        const mtgBookPage = `Book ${mtg.bookNum}, Page ${mtg.pageNum}`;
        if (satData.satisfiedBookPage.includes(mtg.bookNum) && 
            satData.satisfiedBookPage.includes(mtg.pageNum)) {
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
      
      // Method 5: Name match (fallback - parties involved)
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
      
      // Method 6: Date logic (satisfaction must be after mortgage)
      if (sat.recordTimestamp > mtg.recordTimestamp) {
        score += 5;
      } else {
        score -= 20; // Penalty if satisfaction is before mortgage
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { mortgage: mtg, index: i, matchReasons };
      }
    }
    
    // Require minimum score for a match
    if (bestMatch && bestScore >= 30) {
      matches.push({
        satisfaction: sat,
        mortgage: bestMatch.mortgage,
        score: bestScore,
        confidence: bestScore >= 90 ? 'high' : bestScore >= 50 ? 'medium' : 'low',
        matchReasons: bestMatch.matchReasons
      });
      
      // Remove from unmatched
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

// Export for browser use
window.PdfScanner = {
  extractTextFromDocument,
  parseMortgageText,
  parseDeedText,
  parseSatisfactionText,
  batchScanDocuments,
  matchSatisfactionsToMortgages
};
