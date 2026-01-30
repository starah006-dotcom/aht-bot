/**
 * Title Search Orchestration
 * Coordinates searches across document types to build a complete title package
 */

import { searchByName, parseRecord, TITLE_DOC_TYPES, DOC_TYPES } from '../api/hillsborough.js';
import { 
  batchExtractDocuments, 
  parseMortgageText, 
  parseSatisfactionText,
  matchSatisfactionsToMortgages 
} from '../documents/pdfExtractor.js';

/**
 * Perform a comprehensive title search for a property
 * @param {Object} params Search parameters
 * @param {string} params.ownerName Current property owner name
 * @param {number} params.yearsBack How many years to search (default 30)
 * @param {boolean} params.scanDocuments Whether to scan PDFs for text extraction (default false)
 * @param {Function} params.onProgress Progress callback for scanning
 * @returns {Promise<Object>} Complete search results
 */
export async function performTitleSearch(params) {
  const { ownerName, yearsBack = 30, scanDocuments = false, onProgress } = params;
  
  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - yearsBack);
  
  const dateRange = {
    startDate: formatDateForApi(startDate),
    endDate: formatDateForApi(endDate)
  };
  
  console.log(`\nSearching for: ${ownerName}`);
  console.log(`Date range: ${dateRange.startDate} to ${dateRange.endDate}`);
  
  // Search for all title-related documents
  const results = await searchByName({
    name: ownerName.toUpperCase(),
    docTypes: TITLE_DOC_TYPES,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate
  });
  
  console.log(`Found ${results.length} records`);
  
  // Parse and categorize results
  const documents = results.map(parseRecord);
  
  // Group by document type
  const grouped = groupByDocType(documents);
  
  // Build chain of title from deeds
  const chainOfTitle = buildChainOfTitle(grouped.deeds || []);
  
  // Initial mortgage analysis (name-based matching)
  let mortgageAnalysis = analyzeMortgages(
    grouped.mortgages || [],
    grouped.satisfactions || []
  );
  
  // PDF Scanning (optional)
  let scanResults = null;
  if (scanDocuments && (grouped.mortgages.length > 0 || grouped.satisfactions.length > 0)) {
    console.log('\nScanning mortgages and satisfactions for text extraction...');
    
    const docsToScan = [...grouped.mortgages, ...grouped.satisfactions];
    scanResults = await batchExtractDocuments(docsToScan, onProgress);
    
    console.log(`Scan complete: ${scanResults.successful} extracted, ${scanResults.needsManualReview} need review`);
    
    // Extract scanned mortgages and satisfactions
    const scannedMortgages = scanResults.documents.filter(d => 
      d.docTypeShort === 'MTG' || (d.docTypeShort && d.docTypeShort.includes('MTG'))
    );
    const scannedSatisfactions = scanResults.documents.filter(d => 
      d.docTypeShort === 'SAT' || (d.docTypeShort && d.docTypeShort.includes('SAT'))
    );
    
    // Re-analyze mortgages with extracted data
    const matchResults = matchSatisfactionsToMortgages(scannedMortgages, scannedSatisfactions);
    
    // Update mortgage analysis with better matching
    mortgageAnalysis = {
      total: grouped.mortgages.length,
      satisfied: matchResults.matches.length,
      open: matchResults.unmatchedMortgages,
      satisfiedList: matchResults.matches.map(m => ({
        mortgage: m.mortgage,
        satisfaction: m.satisfaction,
        confidence: m.confidence,
        matchReasons: m.matchReasons
      })),
      unmatchedSatisfactions: matchResults.unmatchedSatisfactions,
      scanData: scanResults
    };
  }
  
  // Identify open liens
  const openLiens = identifyOpenLiens(
    grouped.liens || [],
    grouped.releases || []
  );
  
  // Flag unusual items
  const flags = identifyFlags(documents);
  
  return {
    searchParams: {
      ownerName,
      yearsBack,
      searchDate: new Date().toISOString(),
      recordCount: documents.length,
      scanned: scanDocuments
    },
    documents,
    grouped,
    chainOfTitle,
    mortgageAnalysis,
    openLiens,
    flags,
    scanResults,
    summary: generateSummary(documents, chainOfTitle, mortgageAnalysis, openLiens, flags)
  };
}

/**
 * Format date for API (MM/DD/YYYY)
 */
function formatDateForApi(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Group documents by type
 */
function groupByDocType(documents) {
  const groups = {
    deeds: [],
    mortgages: [],
    satisfactions: [],
    liens: [],
    lisPendens: [],
    easements: [],
    restrictions: [],
    judgments: [],
    releases: [],
    assignments: [],
    modifications: [],
    other: []
  };
  
  for (const doc of documents) {
    const type = doc.docTypeShort;
    
    switch (type) {
      case 'D':
        groups.deeds.push(doc);
        break;
      case 'MTG':
      case 'MTGREV':
      case 'MTGNDOC':
      case 'MTGNT':
      case 'MTGNIT':
        groups.mortgages.push(doc);
        break;
      case 'SAT':
      case 'SATCORPTX':
        groups.satisfactions.push(doc);
        break;
      case 'LN':
      case 'MEDLN':
      case 'LNCORPTX':
        groups.liens.push(doc);
        break;
      case 'LP':
        groups.lisPendens.push(doc);
        break;
      case 'EAS':
        groups.easements.push(doc);
        break;
      case 'RES':
        groups.restrictions.push(doc);
        break;
      case 'JUD':
        groups.judgments.push(doc);
        break;
      case 'REL':
      case 'RELLP':
        groups.releases.push(doc);
        break;
      case 'ASG':
      case 'ASGT':
      case 'ASINT':
        groups.assignments.push(doc);
        break;
      case 'MOD':
        groups.modifications.push(doc);
        break;
      default:
        groups.other.push(doc);
    }
  }
  
  // Sort each group by date (newest first)
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.recordTimestamp - a.recordTimestamp);
  }
  
  return groups;
}

/**
 * Build chain of title from deeds
 */
function buildChainOfTitle(deeds) {
  if (deeds.length === 0) return [];
  
  // Sort by date (oldest first for chain)
  const sorted = [...deeds].sort((a, b) => a.recordTimestamp - b.recordTimestamp);
  
  return sorted.map((deed, index) => ({
    sequence: index + 1,
    date: deed.recordDate,
    instrumentNumber: deed.instrumentNumber,
    grantors: deed.grantors.join(', '),
    grantees: deed.grantees.join(', '),
    salesPrice: deed.salesPrice,
    legalDescription: deed.legalDescription,
    documentId: deed.documentId
  }));
}

/**
 * Analyze mortgages and their satisfactions (name-based fallback)
 */
function analyzeMortgages(mortgages, satisfactions) {
  const analysis = {
    total: mortgages.length,
    satisfied: 0,
    open: [],
    satisfiedList: []
  };
  
  // Create a pool of available satisfactions
  const availableSats = [...satisfactions];
  
  // For each mortgage, check if there's a matching satisfaction
  for (const mtg of mortgages) {
    const mtgGrantors = mtg.grantors.map(g => g.toLowerCase());
    
    // Find the best matching satisfaction
    let bestMatchIndex = -1;
    let bestMatchScore = 0;
    
    for (let i = 0; i < availableSats.length; i++) {
      const sat = availableSats[i];
      const satGrantors = sat.grantors.map(g => g.toLowerCase());
      
      // Calculate match score
      let score = 0;
      
      // Check if satisfaction is after mortgage
      if (sat.recordTimestamp > mtg.recordTimestamp) {
        score += 10;
      }
      
      // Check name overlap
      for (const mtgName of mtgGrantors) {
        const firstName = mtgName.split(' ')[0];
        for (const satName of satGrantors) {
          if (satName.includes(firstName) || firstName.includes(satName.split(' ')[0])) {
            score += 5;
          }
        }
      }
      
      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestMatchIndex = i;
      }
    }
    
    // Require minimum score for a match
    if (bestMatchIndex >= 0 && bestMatchScore >= 10) {
      const matchedSat = availableSats.splice(bestMatchIndex, 1)[0];
      analysis.satisfied++;
      analysis.satisfiedList.push({
        mortgage: mtg,
        satisfaction: matchedSat,
        confidence: 'low', // Name-based matching is low confidence
        matchMethod: 'name'
      });
    } else {
      analysis.open.push(mtg);
    }
  }
  
  return analysis;
}

/**
 * Identify liens without releases
 */
function identifyOpenLiens(liens, releases) {
  const openLiens = [];
  const availableReleases = [...releases];
  
  for (const lien of liens) {
    const lienGrantors = lien.grantors.map(g => g.toLowerCase());
    
    let hasRelease = false;
    for (let i = 0; i < availableReleases.length; i++) {
      const rel = availableReleases[i];
      const relGrantors = rel.grantors.map(g => g.toLowerCase());
      
      // Check if release is after lien and names match
      if (rel.recordTimestamp > lien.recordTimestamp) {
        const nameMatch = lienGrantors.some(lienName => {
          const firstName = lienName.split(' ')[0];
          return relGrantors.some(relName => 
            relName.includes(firstName) || firstName.includes(relName.split(' ')[0])
          );
        });
        
        if (nameMatch) {
          availableReleases.splice(i, 1);
          hasRelease = true;
          break;
        }
      }
    }
    
    if (!hasRelease) {
      openLiens.push(lien);
    }
  }
  
  return openLiens;
}

/**
 * Identify items that need attention
 */
function identifyFlags(documents) {
  const flags = [];
  
  // Look for lis pendens (pending litigation)
  const lisPendens = documents.filter(d => d.docTypeShort === 'LP');
  if (lisPendens.length > 0) {
    flags.push({
      severity: 'high',
      type: 'lis_pendens',
      message: `Found ${lisPendens.length} lis pendens (pending litigation)`,
      documents: lisPendens
    });
  }
  
  // Look for judgments
  const judgments = documents.filter(d => d.docTypeShort === 'JUD');
  if (judgments.length > 0) {
    flags.push({
      severity: 'high',
      type: 'judgment',
      message: `Found ${judgments.length} judgment(s)`,
      documents: judgments
    });
  }
  
  // Look for tax liens
  const taxLiens = documents.filter(d => 
    d.docTypeShort === 'LNCORPTX' || d.docType.includes('TAX')
  );
  if (taxLiens.length > 0) {
    flags.push({
      severity: 'high',
      type: 'tax_lien',
      message: `Found ${taxLiens.length} tax-related lien(s)`,
      documents: taxLiens
    });
  }
  
  // Look for recent quick flips (multiple sales in short period)
  const deeds = documents.filter(d => d.docTypeShort === 'D');
  if (deeds.length >= 2) {
    const sorted = [...deeds].sort((a, b) => b.recordTimestamp - a.recordTimestamp);
    const recentDeed = sorted[0];
    const previousDeed = sorted[1];
    const daysBetween = (recentDeed.recordTimestamp - previousDeed.recordTimestamp) / 86400;
    
    if (daysBetween < 90) {
      flags.push({
        severity: 'medium',
        type: 'quick_flip',
        message: `Property sold twice within ${Math.round(daysBetween)} days`,
        documents: [recentDeed, previousDeed]
      });
    }
  }
  
  // Look for multiple open mortgages
  // This will be more accurate after PDF scanning
  
  return flags;
}

/**
 * Generate summary report
 */
function generateSummary(documents, chainOfTitle, mortgageAnalysis, openLiens, flags) {
  const highFlags = flags.filter(f => f.severity === 'high');
  const mediumFlags = flags.filter(f => f.severity === 'medium');
  
  return {
    totalDocuments: documents.length,
    chainOfTitleLength: chainOfTitle.length,
    totalMortgages: mortgageAnalysis.total,
    satisfiedMortgages: mortgageAnalysis.satisfied,
    openMortgages: mortgageAnalysis.open.length,
    openLiens: openLiens.length,
    highSeverityFlags: highFlags.length,
    mediumSeverityFlags: mediumFlags.length,
    riskLevel: highFlags.length > 0 ? 'HIGH' : 
               (mediumFlags.length > 0 || openLiens.length > 0 || mortgageAnalysis.open.length > 1) ? 'MEDIUM' : 'LOW'
  };
}

export default { performTitleSearch };
