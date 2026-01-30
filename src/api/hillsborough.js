/**
 * Hillsborough County Public Records API Client
 */

const BASE_URL = 'https://publicaccess.hillsclerk.com';
const SEARCH_API = '/Public/ORIUtilities/DocumentSearch/api/Search';
const PDF_API = '/Public/ORIUtilities/OverlayWatermark/api/Watermark';

// Document types relevant to title searches
export const DOC_TYPES = {
  DEED: '(D) DEED',
  MORTGAGE: '(MTG) MORTGAGE',
  SATISFACTION: '(SAT) SATISFACTION',
  LIEN: '(LN) LIEN',
  LIS_PENDENS: '(LP) LIS PENDENS',
  EASEMENT: '(EAS) EASEMENT',
  RESTRICTIONS: '(RES) RESTRICTIONS',
  JUDGMENT: '(JUD) JUDGMENT',
  RELEASE: '(REL) RELEASE',
  ASSIGNMENT: '(ASG) ASSIGNMENT',
  MODIFICATION: '(MOD) MODIFICATION',
  TAX_DEED: '(TAXDEED) TAX DEED',
  MEDICAID_LIEN: '(MEDLN) MEDICAID LIEN',
  CORP_TAX_LIEN: '(LNCORPTX) CORP TAX LIEN FOR STATE OF FLORIDA',
  AFFIDAVIT: '(AFF) AFFIDAVIT',
  NOTICE_COMMENCEMENT: '(NOC) NOTICE OF COMMENCEMENT',
  COURT_PAPER: '(CP) COURT PAPER'
};

// Title search document types
export const TITLE_DOC_TYPES = [
  DOC_TYPES.DEED,
  DOC_TYPES.MORTGAGE,
  DOC_TYPES.SATISFACTION,
  DOC_TYPES.LIEN,
  DOC_TYPES.LIS_PENDENS,
  DOC_TYPES.EASEMENT,
  DOC_TYPES.RESTRICTIONS,
  DOC_TYPES.JUDGMENT,
  DOC_TYPES.RELEASE,
  DOC_TYPES.ASSIGNMENT,
  DOC_TYPES.TAX_DEED
];

/**
 * Search public records by party name
 * @param {Object} params Search parameters
 * @param {string|string[]} params.name Party name(s) to search
 * @param {string[]} params.docTypes Document types to filter (optional)
 * @param {string} params.startDate Start date MM/DD/YYYY (optional)
 * @param {string} params.endDate End date MM/DD/YYYY (optional)
 * @param {string} params.partyType 'PARTY 1' (grantor) or 'PARTY 2' (grantee) (optional)
 * @returns {Promise<Object[]>} Search results
 */
export async function searchByName(params) {
  const { name, docTypes, startDate, endDate, partyType } = params;
  
  // Build name array (handle variations)
  const names = Array.isArray(name) ? name : [name.toUpperCase()];
  
  const query = {
    PartyName: names
  };
  
  if (docTypes && docTypes.length > 0) {
    query.DocType = docTypes;
  }
  
  if (startDate) {
    query.RecordDateBegin = startDate;
  }
  
  if (endDate) {
    query.RecordDateEnd = endDate;
  }
  
  if (partyType) {
    query.PartyType = partyType;
  }
  
  try {
    const response = await fetch(`${BASE_URL}${SEARCH_API}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(query)
    });
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.text();
    
    // Parse the response (may be truncated)
    try {
      const parsed = JSON.parse(data);
      return parsed.ResultList || parsed || [];
    } catch (e) {
      // Response might be truncated or malformed
      console.error('Failed to parse response:', e.message);
      return [];
    }
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

/**
 * Get PDF download URL for a document
 * @param {string} documentId The encoded document ID
 * @returns {string} Full URL to download PDF
 */
export function getPdfUrl(documentId) {
  return `${BASE_URL}${PDF_API}/${documentId}`;
}

/**
 * Download a document PDF
 * @param {string} documentId The encoded document ID
 * @returns {Promise<ArrayBuffer>} PDF binary data
 */
export async function downloadPdf(documentId) {
  const url = getPdfUrl(documentId);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`PDF download failed: ${response.status}`);
  }
  
  return response.arrayBuffer();
}

/**
 * Convert Unix timestamp to readable date
 * @param {number} timestamp Unix timestamp
 * @returns {string} Formatted date string
 */
export function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

/**
 * Parse document record into structured format
 * @param {Object} record Raw record from API
 * @returns {Object} Parsed document info
 */
export function parseRecord(record) {
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

export default {
  searchByName,
  downloadPdf,
  getPdfUrl,
  formatDate,
  parseRecord,
  DOC_TYPES,
  TITLE_DOC_TYPES
};
