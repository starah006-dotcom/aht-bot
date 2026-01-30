# ClearView Title Search Bot

Automated title search bot for Hillsborough County, Florida public records.

## Features

- 🔍 Search by property owner name
- 📋 Automatic document categorization (Deeds, Mortgages, Liens, etc.)
- ⛓️ Chain of title builder
- 💰 Open mortgage detection
- ⚠️ Risk flagging (lis pendens, judgments, quick flips)
- 📄 PDF viewing via county records
- 🌐 Modern web interface

## Quick Start

```bash
# Install dependencies
npm install

# Start the web server
npm start
```

Then open http://localhost:3000 in your browser.

## CLI Usage

```bash
# Search for an owner
npm run search "SMITH JOHN"

# Search with custom year range
npm run search "SMITH JOHN" 20
```

## Example Output

```
📊 SUMMARY
────────────────────────────────────────
Total Documents: 436
Chain of Title:  140 deeds
Open Mortgages:  1
Open Liens:      0
Risk Level:      HIGH

⚠️  FLAGS
────────────────────────────────────────
🔴 LIS_PENDENS: Found 3 lis pendens
🔴 JUDGMENT: Found 88 judgment(s)
```

## Project Structure

```
clearview-title/
├── src/
│   ├── api/           # Hillsborough County API client
│   ├── search/        # Search orchestration
│   ├── documents/     # PDF download and processing
│   ├── analysis/      # Chain of title analysis
│   └── web/           # Express web server
├── output/            # Downloaded documents
├── public/            # Static web files
└── package.json
```

## API Documentation

### Hillsborough County Public Records API

**Base URL:** `https://publicaccess.hillsclerk.com`

**Search Endpoint:** `POST /Public/ORIUtilities/DocumentSearch/api/Search`

**Query Parameters:**
- `PartyName`: Array of name variations to search
- `DocType`: Array of document types (optional)
- `RecordDateBegin`: Start date MM/DD/YYYY (optional)
- `RecordDateEnd`: End date MM/DD/YYYY (optional)

**Document Types:**
- `(D) DEED` - Deeds
- `(MTG) MORTGAGE` - Mortgages
- `(SAT) SATISFACTION` - Mortgage satisfactions
- `(LN) LIEN` - Liens
- `(LP) LIS PENDENS` - Lis Pendens
- `(EAS) EASEMENT` - Easements
- `(RES) RESTRICTIONS` - Restrictions
- `(JUD) JUDGMENT` - Judgments
- `(REL) RELEASE` - Releases
- `(ASG) ASSIGNMENT` - Assignments

**PDF Download:** `GET /Public/ORIUtilities/OverlayWatermark/api/Watermark/{documentId}`

## License

MIT
