const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

const MUMBAI_ZONES = db.prepare('SELECT name, center_lat AS lat, center_lng AS lng FROM zones').all();

function getHaversineDistance(p1, p2) {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
      
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getVenueZone(lat, lng, name, address) {
  const addr = (address || '').toLowerCase();
  const n = name.toLowerCase();
  
  const sortedZonesByLength = [...MUMBAI_ZONES].sort((a, b) => b.name.length - a.name.length);
  for (const zone of sortedZonesByLength) {
    const zName = zone.name.toLowerCase();
    if (zName === 'bkc') {
      if (addr.includes('bkc') || addr.includes('bandra kurla complex')) {
        return 'BKC';
      }
    }
    if (addr.includes(zName) || n.includes(zName)) {
      return zone.name;
    }
  }

  let closestZone = MUMBAI_ZONES[0];
  let minDist = Infinity;
  for (const zone of MUMBAI_ZONES) {
    const d = getHaversineDistance({ lat, lng }, { lat: zone.lat, lng: zone.lng });
    if (d < minDist) {
      minDist = d;
      closestZone = zone;
    }
  }
  return closestZone.name;
}

function run() {
  const targetZones = ['Bhandup', 'Vikhroli', 'Mulund', 'Powai'];
  
  targetZones.forEach(zoneName => {
    const zone = MUMBAI_ZONES.find(z => z.name === zoneName);
    if (!zone) return;
    
    const radiusKm = 6.0;
    const latDiff = radiusKm / 111.0;
    const lngDiff = radiusKm / (111.0 * Math.cos(zone.lat * Math.PI / 180));
    
    const dbPlaces = db.prepare(`
      SELECT p.id, p.name, p.address, p.lat, p.lng, p.rating, p.review_count, pc.category, pc_cost.mandatory_cost, pc_cost.optional_cost_min, p.is_hidden
      FROM places p
      JOIN place_categories pc ON p.id = pc.place_id
      JOIN place_costs pc_cost ON p.id = pc_cost.place_id
      WHERE p.lat BETWEEN ? AND ? AND p.lng BETWEEN ? AND ?
    `).all(zone.lat - latDiff, zone.lat + latDiff, zone.lng - lngDiff, zone.lng + lngDiff);
    
    console.log(`\n--- Zone: ${zoneName} ---`);
    console.log(`Total places in bounding box: ${dbPlaces.length}`);
    
    let hidden = 0, excludedCat = 0, lowIntent = 0, weakHangout = 0, lowQuality = 0, wrongZone = 0, valid = 0;
    
    dbPlaces.forEach(p => {
      if (p.is_hidden === 1) { hidden++; return; }
      
      const category = p.category.toUpperCase();
      if (!['CAFE', 'RESTAURANT', 'DESSERT', 'PARK', 'ARCADE', 'BOWLING', 'MUSEUM', 'MALL', 'SPORTS', 'POTTERY', 'WORKSHOP', 'ESCAPE_ROOM'].includes(category)) {
        excludedCat++;
        return;
      }
      
      const rating = p.rating;
      const reviewCount = p.review_count || 0;
      
      // isHangoutWorthyCandidate check
      const nameLower = p.name.toLowerCase();
      const addressLower = (p.address || '').toLowerCase();
      const normalized = `${nameLower} ${addressLower}`;
      
      const STRONG_HANGOUT_NAME_PATTERNS = [
        'social', 'cafe', 'café', 'coffee', 'bistro', 'bakery', 'patisserie', 'dessert',
        'creamery', 'ice cream', 'gelato', 'waffle', 'theobroma', 'le15',
        'taproom', 'bar', 'brew', 'brewery', 'diner', 'kitchen', 'trattoria',
        'restaurant', 'pizza', 'sushi', 'ramen', 'bbq', 'barbeque',
        'arcade', 'game', 'gaming', 'timezone', 'smaaash', 'bowling', 'escape',
        'museum', 'gallery', 'art', 'studio', 'pottery', 'workshop',
        'promenade', 'beach', 'lake', 'garden', 'fort', 'national park', 'nature park',
        'cinema', 'pvr', 'inox', 'cinepolis', 'theatre', 'mall'
      ];
      
      const LOW_INTENT_CHAIN_PATTERNS = [
        'mcdonald', 'domino', 'kfc', 'subway', 'burger king', 'pizza hut',
        'barbeque nation', 'bbq nation', 'monginis', 'ribbons and balloons',
        'cafe coffee day', 'café coffee day', 'ccd', 'mad over donuts',
        'belgian waffle', 'naturals ice cream', 'starbucks', 'barista', 'mccafé',
        'mccafe', 'coffee day express'
      ];
      
      const WEAK_OR_NON_HANGOUT_PATTERNS = [
        ' pvt ltd', ' pvt. ltd', ' limited', ' ltd.', 'corporate', 'office',
        'apartment', ' housing', ' society', ' co-op', ' chs', 'chs ', 'c.h.s',
        'residency', 'residences', 'tower', 'villa', 'bungalow', 'building', 'bldg',
        'gate no', ' gate 1', ' gate 2', 'transit', 'compound', 'estate',
        'marriage hall', 'banquet hall', 'community hall', 'rickshaw', 'auto stand',
        'parking', 'metro station', 'railway station', 'bus stand', 'bus depot',
        'bus terminal', 'collection', 'boutique', 'clothing', 'designer', 'couture',
        'tailor', 'saree', 'fashion', 'textile', 'dulha', 'bridal', 'jewellers',
        'jewellery', 'jewelers', 'advisory', 'advisor', 'advisors', 'fund ', ' fund',
        'wealth', 'consultancy', 'consulting', 'associates', 'advocates', 'chambers',
        'law firm', 'legal', 'finance', 'financial', 'investments', 'venture',
        'capital', 'foundation', 'trust', 'ngo', 'charity', 'diagnostic', ' clinic',
        'clinic ', 'hospital', 'nursing home', 'dental', 'eyecare', 'enterprises',
        'services', 'store', 'shop', 'mart', 'supermarket', 'medical', 'pharma',
        'pharmacy', 'school', 'college', 'classes', 'tuition', 'hostel', 'pg ',
        'gymkhana', 'club house', 'ground', 'maidan', 'kridangan', 'football turf',
        'cricket ground', 'mandir', 'temple', 'masjid', 'church', 'vihar',
        'holiday', 'holidays', 'travel', 'travels', 'tour', 'tours', 'frame',
        'frames', 'branding', 'conclave', 'dynamic positioning', 'training centre',
        'training center', 'guest house', 'resturant service', 'hotel ', 'max',
        'wholesale', 'exhibition centre'
      ];
      
      const GENERIC_WEAK_FOOD_PATTERNS = [
        'family restaurant', 'veg restaurant', 'pure veg', 'hotel ', 'fast food',
        'snacks corner', 'sweets', 'caterers', 'biryani', 'chinese foods',
        'juice centre', 'cold drinks', 'tea stall', 'dhaba', 'mess'
      ];
      
      const hasAnyPattern = (text, patterns) => patterns.some(p => text.includes(p));
      const strongSignal = hasAnyPattern(normalized, STRONG_HANGOUT_NAME_PATTERNS);
      
      if (hasAnyPattern(normalized, LOW_INTENT_CHAIN_PATTERNS)) { lowIntent++; return; }
      if (hasAnyPattern(normalized, WEAK_OR_NON_HANGOUT_PATTERNS) && !strongSignal) { weakHangout++; return; }
      
      let isWorthy = false;
      const highlyReviewed = reviewCount >= 75;
      const strongRated = rating !== null && rating >= 4.3 && reviewCount >= 40;
      
      if (category === 'RESTAURANT') {
        if (hasAnyPattern(normalized, GENERIC_WEAK_FOOD_PATTERNS) && !strongSignal) { weakHangout++; return; }
        isWorthy = strongSignal || highlyReviewed || strongRated;
      } else if (category === 'PARK') {
        const scenicSignal = hasAnyPattern(normalized, ['promenade', 'beach', 'lake', 'fort', 'national park', 'nature park', 'waterfront', 'viewpoint', 'central park', 'jio world garden']);
        isWorthy = scenicSignal && (reviewCount >= 25 || rating === null || rating >= 4.0);
      } else if (category === 'MALL') {
        isWorthy = strongSignal && reviewCount >= 100;
      } else {
        isWorthy = strongSignal || highlyReviewed || strongRated;
      }
      
      if (!isWorthy) { weakHangout++; return; }
      
      const passedQuality = !(rating && rating > 0 && reviewCount > 0 && (rating < 4.0 || reviewCount < 20));
      if (!passedQuality) { lowQuality++; return; }
      
      const venueZone = getVenueZone(p.lat, p.lng, p.name, p.address);
      if (venueZone !== zoneName) { wrongZone++; return; }
      
      valid++;
    });
    
    console.log(`- Hidden: ${hidden}`);
    console.log(`- Excluded Categories: ${excludedCat}`);
    console.log(`- Low Intent: ${lowIntent}`);
    console.log(`- Weak Hangout: ${weakHangout}`);
    console.log(`- Low Quality: ${lowQuality}`);
    console.log(`- Wrong Zone: ${wrongZone}`);
    console.log(`- Valid Candidate Places: ${valid}`);
  });
  
  db.close();
}

run();
