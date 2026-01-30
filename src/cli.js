#!/usr/bin/env node
/**
 * ClearView Title Search CLI
 * Command-line interface for title searches
 */

import { performTitleSearch } from './search/titleSearch.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
ClearView Title Search CLI

Usage:
  node src/cli.js <owner_name> [years_back]

Examples:
  node src/cli.js "SMITH JOHN"
  node src/cli.js "SMITH JOHN" 20
  node src/cli.js "BANK OF AMERICA" 10
    `);
    process.exit(0);
  }
  
  const ownerName = args[0];
  const yearsBack = parseInt(args[1]) || 30;
  
  console.log('\n' + '═'.repeat(60));
  console.log('  CLEARVIEW TITLE SEARCH');
  console.log('  Hillsborough County, Florida');
  console.log('═'.repeat(60) + '\n');
  
  try {
    const results = await performTitleSearch({ ownerName, yearsBack });
    
    // Print summary
    console.log('\n📊 SUMMARY');
    console.log('─'.repeat(40));
    console.log(`Total Documents: ${results.summary.totalDocuments}`);
    console.log(`Chain of Title:  ${results.summary.chainOfTitleLength} deeds`);
    console.log(`Open Mortgages:  ${results.summary.openMortgages}`);
    console.log(`Open Liens:      ${results.summary.openLiens}`);
    console.log(`Risk Level:      ${results.summary.riskLevel}`);
    
    // Print flags
    if (results.flags.length > 0) {
      console.log('\n⚠️  FLAGS');
      console.log('─'.repeat(40));
      for (const flag of results.flags) {
        const icon = flag.severity === 'high' ? '🔴' : '🟡';
        console.log(`${icon} ${flag.type.toUpperCase()}: ${flag.message}`);
      }
    }
    
    // Print chain of title
    if (results.chainOfTitle.length > 0) {
      console.log('\n📜 CHAIN OF TITLE');
      console.log('─'.repeat(40));
      for (const deed of results.chainOfTitle) {
        console.log(`${deed.sequence}. ${deed.date}`);
        console.log(`   ${deed.grantors.substring(0, 40)}`);
        console.log(`   → ${deed.grantees.substring(0, 40)}`);
        if (deed.salesPrice && deed.salesPrice > 0) {
          console.log(`   $${deed.salesPrice.toLocaleString()}`);
        }
        console.log();
      }
    }
    
    // Print open mortgages
    if (results.mortgageAnalysis.open.length > 0) {
      console.log('\n💰 OPEN MORTGAGES');
      console.log('─'.repeat(40));
      for (const mtg of results.mortgageAnalysis.open) {
        console.log(`• ${mtg.recordDate} - ${mtg.grantors.slice(0, 2).join(', ')}`);
      }
    }
    
    // Print open liens
    if (results.openLiens.length > 0) {
      console.log('\n⚡ OPEN LIENS');
      console.log('─'.repeat(40));
      for (const lien of results.openLiens) {
        console.log(`• ${lien.recordDate} - ${lien.docType}`);
        console.log(`  Parties: ${lien.grantors.slice(0, 2).join(', ')}`);
      }
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log(`Search completed at ${new Date().toLocaleString()}`);
    console.log('═'.repeat(60) + '\n');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
