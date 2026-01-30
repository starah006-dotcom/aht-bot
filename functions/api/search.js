/**
 * Cloudflare Pages Function: Title Search
 * POST /api/search - Search Clerk records by owner name
 */

const BASE_URL = 'https://publicaccess.hillsclerk.com';
const SEARCH_API = '/Public/ORIUtilities/DocumentSearch/api/Search';

// Title search document types
const TITLE_DOC_TYPES = [
  '(D) DEED',
  '(MTG) MORTGAGE',
  '(SAT) SATISFACTION',
  '(LN) LIEN',
  '(LP) LIS PENDENS',
  '(EAS) EASEMENT',
  '(RES) RESTRICTIONS',
  '(JUD) JUDGMENT',
  '(REL) RELEASE',
  '(ASG) ASSIGNMENT',
  '(TAXDEED) TAX DEED'
];

export async function onRequestPost(context) {
  try {
    const { ownerName, yearsBack = 30 } = await context.request.json();
    
    if (!ownerName) {
      return new Response(JSON.stringify({ error: 'ownerName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - parseInt(yearsBack));
    
    const dateRange = {
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate)
    };
    
    // Search for all title-related documents
    const query = {
      PartyName: [ownerName.toUpperCase()],
      DocType: TITLE_DOC_TYPES,
      RecordDateBegin: dateRange.startDate,
      RecordDateEnd: dateRange.endDate
    };
    
    const response = await fetch(`${BASE_URL}${SEARCH_API}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    
    const data = await response.json();
    const results = data.ResultList || data || [];
    
    // Parse and categorize results
    const documents = results.map(parseRecord);
    const grouped = groupByDocType(documents);
    const chainOfTitle = buildChainOfTitle(grouped.deeds || []);
    const mortgageAnalysis = analyzeMortgages(grouped.mortgages || [], grouped.satisfactions || []);
    const openLiens = identifyOpenLiens(grouped.liens || [], grouped.releases || []);
    const flags = identifyFlags(documents);
    
    return new Response(JSON.stringify({
      searchParams: {
        ownerName,
        yearsBack,
        searchDate: new Date().toISOString(),
        recordCount: documents.length
      },
      documents,
      grouped,
      chainOfTitle,
      mortgageAnalysis,
      openLiens,
      flags,
      summary: generateSummary(documents, chainOfTitle, mortgageAnalysis, openLiens, flags)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function formatDateForApi(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

function parseRecord(record) {
  return {
    instrumentNumber: record.Instrument,
    grantors: record.PartiesOne || [],
    grantees: record.PartiesTwo || [],
    recordDate: formatDate(record.RecordDate),
    recordTimestamp: record.RecordDate,
    docType: record.DocType,
    docTypeShort: record.DocType?.match(/\(([^)]+)\)/)?.[1] || record.DocType,
    legalDescription: record.Legal,
    salesPrice: record.SalesPrice,
    pageCount: record.PageCount,
    documentId: record.ID,
    uuid: record.UUID,
    bookNum: record.BookNum,
    pageNum: record.PageNum
  };
}

function groupByDocType(documents) {
  const groups = {
    deeds: [], mortgages: [], satisfactions: [], liens: [],
    lisPendens: [], easements: [], restrictions: [], judgments: [],
    releases: [], assignments: [], other: []
  };
  
  for (const doc of documents) {
    const type = doc.docTypeShort;
    switch (type) {
      case 'D': groups.deeds.push(doc); break;
      case 'MTG': case 'MTGREV': case 'MTGNDOC': case 'MTGNT': case 'MTGNIT':
        groups.mortgages.push(doc); break;
      case 'SAT': case 'SATCORPTX': groups.satisfactions.push(doc); break;
      case 'LN': case 'MEDLN': case 'LNCORPTX': groups.liens.push(doc); break;
      case 'LP': groups.lisPendens.push(doc); break;
      case 'EAS': groups.easements.push(doc); break;
      case 'RES': groups.restrictions.push(doc); break;
      case 'JUD': groups.judgments.push(doc); break;
      case 'REL': case 'RELLP': groups.releases.push(doc); break;
      case 'ASG': case 'ASGT': case 'ASINT': groups.assignments.push(doc); break;
      default: groups.other.push(doc);
    }
  }
  
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.recordTimestamp - a.recordTimestamp);
  }
  return groups;
}

function buildChainOfTitle(deeds) {
  if (deeds.length === 0) return [];
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

function analyzeMortgages(mortgages, satisfactions) {
  const analysis = { total: mortgages.length, satisfied: 0, open: [], satisfiedList: [] };
  for (const mtg of mortgages) {
    const grantors = mtg.grantors.join(' ').toLowerCase();
    const matchingSat = satisfactions.find(sat => {
      const satGrantors = sat.grantors.join(' ').toLowerCase();
      return satGrantors.includes(grantors.split(' ')[0]) || grantors.includes(satGrantors.split(' ')[0]);
    });
    if (matchingSat) {
      analysis.satisfied++;
      analysis.satisfiedList.push({ mortgage: mtg, satisfaction: matchingSat });
    } else {
      analysis.open.push(mtg);
    }
  }
  return analysis;
}

function identifyOpenLiens(liens, releases) {
  const openLiens = [];
  for (const lien of liens) {
    const grantors = lien.grantors.join(' ').toLowerCase();
    const hasRelease = releases.some(rel => {
      const relGrantors = rel.grantors.join(' ').toLowerCase();
      return relGrantors.includes(grantors.split(' ')[0]) || grantors.includes(relGrantors.split(' ')[0]);
    });
    if (!hasRelease) openLiens.push(lien);
  }
  return openLiens;
}

function identifyFlags(documents) {
  const flags = [];
  
  const lisPendens = documents.filter(d => d.docTypeShort === 'LP');
  if (lisPendens.length > 0) {
    flags.push({ severity: 'high', type: 'lis_pendens', 
      message: `Found ${lisPendens.length} lis pendens (pending litigation)`, documents: lisPendens });
  }
  
  const judgments = documents.filter(d => d.docTypeShort === 'JUD');
  if (judgments.length > 0) {
    flags.push({ severity: 'high', type: 'judgment', 
      message: `Found ${judgments.length} judgment(s)`, documents: judgments });
  }
  
  const taxLiens = documents.filter(d => d.docTypeShort === 'LNCORPTX' || d.docType.includes('TAX'));
  if (taxLiens.length > 0) {
    flags.push({ severity: 'high', type: 'tax_lien', 
      message: `Found ${taxLiens.length} tax-related lien(s)`, documents: taxLiens });
  }
  
  const deeds = documents.filter(d => d.docTypeShort === 'D');
  if (deeds.length >= 2) {
    const sorted = [...deeds].sort((a, b) => b.recordTimestamp - a.recordTimestamp);
    const daysBetween = (sorted[0].recordTimestamp - sorted[1].recordTimestamp) / 86400;
    if (daysBetween < 90) {
      flags.push({ severity: 'medium', type: 'quick_flip', 
        message: `Property sold twice within ${Math.round(daysBetween)} days`, documents: [sorted[0], sorted[1]] });
    }
  }
  
  return flags;
}

function generateSummary(documents, chainOfTitle, mortgageAnalysis, openLiens, flags) {
  const highFlags = flags.filter(f => f.severity === 'high');
  const mediumFlags = flags.filter(f => f.severity === 'medium');
  return {
    totalDocuments: documents.length,
    chainOfTitleLength: chainOfTitle.length,
    totalMortgages: mortgageAnalysis.total,
    openMortgages: mortgageAnalysis.open.length,
    openLiens: openLiens.length,
    highSeverityFlags: highFlags.length,
    mediumSeverityFlags: mediumFlags.length,
    riskLevel: highFlags.length > 0 ? 'HIGH' : (mediumFlags.length > 0 || openLiens.length > 0) ? 'MEDIUM' : 'LOW'
  };
}
