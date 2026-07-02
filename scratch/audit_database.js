const Database = require('better-sqlite3');
const db = new Database('local.db');

const badNameKeywords = [
  'association', 'samiti', 'federation', 'chamber of', 'board of',
  'banquet', 'banquets', 'marriage lawn', 'party lawn', 'marriage hall', 'banquet hall',
  'supermarket', 'mart ', ' mart', 'chemist', 'pharmacy', 'grocery', 'groceries', 'wholesaler', 'distributor',
  'mobile shop', 'mobile store', 'mobile center', 'mobile care', 'telecom', 'cellular',
  'electrician', 'plumber', 'repair', 'service point', 'service center', 'service station', 'mechanic', 'tyre', 'wheel alignment', 'garage', 'auto care',
  'checkpoint', 'check point', 'safety check',
  'consultancy', 'consulting', 'advisory', 'advisor', 'associates', 'law ', 'chamber', 'atm', 'courier', 'cargo', 'transport', 'logistics', 'packer', 'mover',
  'classes', 'tuition', 'coaching', 'tutorial', 'polytechnic',
  'clinic', 'diagnostic', 'laboratory', ' lab ', 'hospital', 'nursing', 'medical', 'chemist', 'dispensary', 'dental', 'ortho', 'eyecare',
  'temple', 'mandir', 'masjid', 'mosque', 'church', 'gurudwara', 'ashram', 'devalaya',
  'co-op', 'developer', 'builder', 'realty', 'real estate',
  'hardware', 'electrical', 'paint ', 'sanitary', 'plywood', 'timber', 'steel', 'metal', 'auto parts', 'battery',
  'tailor', 'boutique', 'saree', 'textile', 'jeweller', 'jewelry',
  'dry cleaner', 'laundry', 'car wash', 'bike wash',
  'ahmed shop', 'ananda stores', 'arihant mobile', 'electrician service', 'ahar |'
];

const hangoutWords = [
  'cafe', 'coffee', 'tea', 'bake', 'dessert', 'ice cream', 'waffle', 'cake', 'book', 'game', 'toy', 'sweet', 'chocolate', 'pastry', 'gelato',
  'restaurant', 'hotel', 'pub', 'bar', 'club', 'mall', 'dhaba', 'bistro', 'lounge', 'dining', 'kitchen', 'eatery', 'grill', 'house', 'garden', 'park', 'museum', 'gallery', 'theater', 'cinema', 'stadium', 'ground', 'turf', 'parlour', 'parlor', 'pizza', 'burger', 'momos', 'biryani', 'kitchen', 'food'
];

const studioHangoutWords = ['cake', 'dessert', 'pottery', 'art', 'paint', 'clay', 'craft', 'music', 'dance', 'screen', 'acting', 'cooking', 'ceramic', 'ceramics', 'cafe', 'café', 'coffee', 'food', 'brew', 'kitchen', 'bakery', 'patisserie', 'dessert'];

const places = db.prepare("SELECT id, name, address, source_name FROM places WHERE source_name = 'GOOGLE'").all();
console.log(`Loaded ${places.length} Google places.`);

const toDelete = [];

for (const p of places) {
  const nameLower = p.name.toLowerCase();
  
  // 1. Check exact blacklisted words in name
  let matchedKeyword = badNameKeywords.find(kw => {
    // Avoid false positives like chemistry/smart/patisserie labs
    if (kw === 'chemist' && nameLower.includes('chemistry')) return false;
    if ((kw === 'mart ' || kw === ' mart') && nameLower.includes('smart')) return false;
    if (kw === ' lab ' && (nameLower.includes('cafe') || nameLower.includes('café') || nameLower.includes('bakery') || nameLower.includes('patisserie') || nameLower.includes('coffee') || nameLower.includes('bistro') || nameLower.includes('dessert'))) return false;
    return nameLower.includes(kw);
  });
  
  // 2. Filter generic shops / stores
  if (!matchedKeyword) {
    if (nameLower.includes('store') || nameLower.includes('shop')) {
      const hasHangoutIndicator = hangoutWords.some(hw => nameLower.includes(hw));
      if (!hasHangoutIndicator) {
        matchedKeyword = 'Generic store or retail shop (no hangout keywords in name)';
      }
    }
  }

  // 3. Filter generic studio words unless it's a creative hangout studio (pottery, baking)
  if (!matchedKeyword) {
    if (nameLower.includes('studio') && !nameLower.includes('studios')) {
      const isHangoutStudio = studioHangoutWords.some(hw => nameLower.includes(hw));
      if (!isHangoutStudio) {
        matchedKeyword = 'Commercial photo/print/design studio (no creative hangout keywords in name)';
      }
    }
  }

  // 4. Filter raw locality descriptors / street names (e.g. "Airoli sec 3", "BelapurMG")
  if (!matchedKeyword) {
    // Use word boundaries or space matches for locality patterns to avoid suffix matches in Borivali / Dombivali
    const localityPatterns = [
      /\bsec\b/i, /\bsector\b/i, /\broad\b/i, /\blane\b/i, /\bstreet\b/i, /\bmarg\b/i, /\bnagar\b/i, /\bpada\b/i, /\bgaon\b/i, /\bvillage\b/i, /\bcolony\b/i, /\blayout\b/i, /\bphase\b/i, /\bplot\b/i
    ];
    const hasLocalityPattern = localityPatterns.some(pat => pat.test(p.name));
    const hasHangoutIndicator = hangoutWords.some(hw => nameLower.includes(hw));
    
    if (hasLocalityPattern && !hasHangoutIndicator) {
      matchedKeyword = 'Locality or street name descriptor';
    }
  }

  if (matchedKeyword) {
    toDelete.push({
      id: p.id,
      name: p.name,
      address: p.address,
      reason: matchedKeyword
    });
  }
}

console.log(`\nFound ${toDelete.length} places matching blacklist criteria:\n`);
for (const p of toDelete.slice(0, 100)) {
  console.log(`- [${p.id}] ${p.name} | Address: ${p.address} | Reason: ${p.reason}`);
}

if (toDelete.length > 100) {
  console.log(`... and ${toDelete.length - 100} more.`);
}

console.log(`\nTo run actual cleanup, execute with command argument "--execute"`);

if (process.argv.includes('--execute')) {
  console.log('\nStarting database execution and cleanup...');
  const deleteStmt = db.prepare("DELETE FROM places WHERE id = ?");
  const deleteCat = db.prepare("DELETE FROM place_categories WHERE place_id = ?");
  const deleteCost = db.prepare("DELETE FROM place_costs WHERE place_id = ?");
  const deleteScore = db.prepare("DELETE FROM place_scores WHERE place_id = ?");
  
  const fs = require('fs');
  let sqlContent = '';
  
  db.transaction(() => {
    for (const p of toDelete) {
      deleteStmt.run(p.id);
      deleteCat.run(p.id);
      deleteCost.run(p.id);
      deleteScore.run(p.id);
      sqlContent += `DELETE FROM places WHERE id = '${p.id}';\n`;
      sqlContent += `DELETE FROM place_categories WHERE place_id = '${p.id}';\n`;
      sqlContent += `DELETE FROM place_costs WHERE place_id = '${p.id}';\n`;
      sqlContent += `DELETE FROM place_scores WHERE place_id = '${p.id}';\n`;
    }
  })();
  
  fs.writeFileSync('cleanup.sql', sqlContent);
  console.log(`Successfully deleted ${toDelete.length} places from local.db.`);
  console.log(`Generated cleanup.sql for remote D1 execution.`);
}
