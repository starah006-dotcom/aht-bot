/**
 * Hillsborough County Property Appraiser API Client
 * Uses SWFWMD (Southwest Florida Water Management District) ArcGIS service
 * which contains Hillsborough County parcel data from Florida DOR
 */

const ARCGIS_URL = 'https://www25.swfwmd.state.fl.us/arcgiswmis/rest/services/r27/LocationInfo/MapServer/71/query';

// Fields we want from the parcel data
const OUT_FIELDS = [
  'SITEADD',      // Full Site Address
  'OWNNAME',      // Full Owner Name (200 chars)
  'OWNERNAME',    // Owner Name (80 chars)
  'PARNO',        // Local Parcel Number
  'FOLIONUM',     // Folio Number
  'SCITY',        // Site City
  'SZIP',         // Site Zip
  'MAILADD',      // Mailing Address
  'MCITY',        // Mailing City
  'MSTATE',       // Mailing State
  'MZIP',         // Mailing Zip
  'PARVAL',       // Total Parcel Value
  'LANDVAL',      // Land Value
  'IMPROVVAL',    // Improved Value
  'ZONING',       // Zoning
  'YRBLT_ACT',    // Year Built
  'LEGDECFULL',   // Legal Description
  'SALE1_AMT',    // Most Recent Sale Amount
  'SALE1_DATE',   // Most Recent Sale Date
].join(',');

/**
 * Search for parcels by address
 * @param {string} address - Address to search for (partial match supported)
 * @returns {Promise<Object[]>} Array of parcel results
 */
export async function searchByAddress(address) {
  if (!address || address.trim().length < 3) {
    throw new Error('Address must be at least 3 characters');
  }
  
  // Clean and prepare the address for SQL LIKE query
  const cleanAddress = address.trim().toUpperCase().replace(/['"]/g, '');
  
  // Build the where clause - search for address containing the input
  const whereClause = `UPPER(SITEADD) LIKE '%${cleanAddress}%'`;
  
  const params = new URLSearchParams({
    where: whereClause,
    outFields: OUT_FIELDS,
    returnGeometry: 'false',
    f: 'json',
    resultRecordCount: '25'  // Limit results
  });
  
  try {
    const response = await fetch(`${ARCGIS_URL}?${params.toString()}`);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'ArcGIS query error');
    }
    
    // Transform the results into a cleaner format
    const results = (data.features || []).map(feature => {
      const attrs = feature.attributes;
      return {
        address: attrs.SITEADD || '',
        city: attrs.SCITY || '',
        zip: attrs.SZIP || '',
        ownerName: attrs.OWNNAME || attrs.OWNERNAME || '',
        parcelNumber: attrs.PARNO || '',
        folioNumber: attrs.FOLIONUM || '',
        mailingAddress: [
          attrs.MAILADD,
          attrs.MCITY,
          attrs.MSTATE,
          attrs.MZIP
        ].filter(Boolean).join(', '),
        totalValue: attrs.PARVAL || 0,
        landValue: attrs.LANDVAL || 0,
        improvedValue: attrs.IMPROVVAL || 0,
        zoning: attrs.ZONING || '',
        yearBuilt: attrs.YRBLT_ACT || null,
        legalDescription: attrs.LEGDECFULL || '',
        lastSaleAmount: attrs.SALE1_AMT || 0,
        lastSaleDate: attrs.SALE1_DATE || ''
      };
    });
    
    return results;
  } catch (error) {
    console.error('Property Appraiser search error:', error);
    throw error;
  }
}

/**
 * Get a single parcel by folio number
 * @param {string} folio - Folio number to lookup
 * @returns {Promise<Object|null>} Parcel data or null if not found
 */
export async function getParcelByFolio(folio) {
  if (!folio) {
    throw new Error('Folio number is required');
  }
  
  // Clean folio - remove dashes
  const cleanFolio = folio.replace(/[^0-9]/g, '');
  
  const params = new URLSearchParams({
    where: `FOLIONUM = '${cleanFolio}'`,
    outFields: OUT_FIELDS,
    returnGeometry: 'false',
    f: 'json'
  });
  
  try {
    const response = await fetch(`${ARCGIS_URL}?${params.toString()}`);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'ArcGIS query error');
    }
    
    const features = data.features || [];
    if (features.length === 0) {
      return null;
    }
    
    const attrs = features[0].attributes;
    return {
      address: attrs.SITEADD || '',
      city: attrs.SCITY || '',
      zip: attrs.SZIP || '',
      ownerName: attrs.OWNNAME || attrs.OWNERNAME || '',
      parcelNumber: attrs.PARNO || '',
      folioNumber: attrs.FOLIONUM || '',
      mailingAddress: [
        attrs.MAILADD,
        attrs.MCITY,
        attrs.MSTATE,
        attrs.MZIP
      ].filter(Boolean).join(', '),
      totalValue: attrs.PARVAL || 0,
      landValue: attrs.LANDVAL || 0,
      improvedValue: attrs.IMPROVVAL || 0,
      zoning: attrs.ZONING || '',
      yearBuilt: attrs.YRBLT_ACT || null,
      legalDescription: attrs.LEGDECFULL || '',
      lastSaleAmount: attrs.SALE1_AMT || 0,
      lastSaleDate: attrs.SALE1_DATE || ''
    };
  } catch (error) {
    console.error('Property Appraiser folio lookup error:', error);
    throw error;
  }
}

/**
 * Extract just the owner name(s) from an address
 * Convenience method for address → owner → name search flow
 * @param {string} address - Address to search
 * @returns {Promise<string[]>} Array of unique owner names found
 */
export async function getOwnersByAddress(address) {
  const results = await searchByAddress(address);
  
  // Extract unique owner names
  const owners = [...new Set(
    results
      .map(r => r.ownerName)
      .filter(name => name && name.trim().length > 0)
  )];
  
  return owners;
}

export default {
  searchByAddress,
  getParcelByFolio,
  getOwnersByAddress
};
