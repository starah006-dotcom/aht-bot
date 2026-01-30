/**
 * Cloudflare Pages Function: Address Search
 * POST /api/address - Search property appraiser by address
 */

const ARCGIS_URL = 'https://www25.swfwmd.state.fl.us/arcgiswmis/rest/services/r27/LocationInfo/MapServer/71/query';

const OUT_FIELDS = [
  'SITEADD', 'OWNNAME', 'OWNERNAME', 'PARNO', 'FOLIONUM',
  'SCITY', 'SZIP', 'MAILADD', 'MCITY', 'MSTATE', 'MZIP',
  'PARVAL', 'LANDVAL', 'IMPROVVAL', 'ZONING', 'YRBLT_ACT',
  'LEGDECFULL', 'SALE1_AMT', 'SALE1_DATE'
].join(',');

export async function onRequestPost(context) {
  try {
    const { address } = await context.request.json();
    
    if (!address || address.trim().length < 3) {
      return new Response(JSON.stringify({ 
        error: 'Address must be at least 3 characters' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Clean and prepare the address for SQL LIKE query
    const cleanAddress = address.trim().toUpperCase().replace(/['"]/g, '');
    
    // Build the where clause
    const whereClause = `UPPER(SITEADD) LIKE '%${cleanAddress}%'`;
    
    const params = new URLSearchParams({
      where: whereClause,
      outFields: OUT_FIELDS,
      returnGeometry: 'false',
      f: 'json',
      resultRecordCount: '25'
    });
    
    const response = await fetch(`${ARCGIS_URL}?${params.toString()}`);
    
    if (!response.ok) {
      throw new Error(`ArcGIS API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'ArcGIS query error');
    }
    
    // Transform results
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
          attrs.MAILADD, attrs.MCITY, attrs.MSTATE, attrs.MZIP
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
    
    return new Response(JSON.stringify({ 
      results,
      count: results.length 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Address search error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Search failed' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
