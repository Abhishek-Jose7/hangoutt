import type { Mood, Place } from '@/types';
import { haversineDistance } from './transit';

interface CuratedVenue extends Place {
  areas: string[];
  moods: Mood[];
  openDays?: number[]; // 0 = Sunday ... 6 = Saturday (IST)
}

const MUMBAI_VENUES: CuratedVenue[] = [
  { name: 'Prithvi Cafe', type: 'cafe', lat: 19.1087, lng: 72.8266, description: 'Open-air cafe for relaxed conversations before or after a show.', estimated_cost: 320, source: 'osm_fallback', relevance_score: 0.93, areas: ['juhu', 'versova', 'andheri'], moods: ['chill', 'romantic', 'fun'] },
  { name: 'Juhu Beach Sunset Walk', type: 'outdoor', lat: 19.0981, lng: 72.8267, description: 'Classic beach walk and sunset stop with street snacks nearby.', estimated_cost: 120, source: 'osm_fallback', relevance_score: 0.95, areas: ['juhu'], moods: ['chill', 'romantic', 'fun'] },
  { name: 'Candies, Bandra', type: 'cafe', lat: 19.0612, lng: 72.8334, description: 'Casual all-day cafe popular for long conversations and group catch-ups.', estimated_cost: 350, source: 'osm_fallback', relevance_score: 0.94, areas: ['bandra', 'khar'], moods: ['fun', 'chill', 'romantic'] },
  { name: 'McDonald\'s Linking Road', type: 'restaurant', lat: 19.0642, lng: 72.8368, description: 'Low-cost quick bite option to keep budgets balanced around premium activities.', estimated_cost: 220, source: 'osm_fallback', relevance_score: 0.86, areas: ['bandra', 'khar'], moods: ['fun', 'chill', 'adventure'] },
  { name: 'Burger King Bandra', type: 'restaurant', lat: 19.0609, lng: 72.8333, description: 'Budget-friendly food stop for groups before or after an activity.', estimated_cost: 240, source: 'osm_fallback', relevance_score: 0.84, areas: ['bandra'], moods: ['fun', 'chill'] },
  { name: 'Carter Road Promenade', type: 'outdoor', lat: 19.0656, lng: 72.8264, description: 'Seafront promenade for walks, sunsets, and snack stops.', estimated_cost: 140, source: 'osm_fallback', relevance_score: 0.92, areas: ['bandra'], moods: ['chill', 'romantic', 'fun'] },
  { name: 'Theobroma Bandra', type: 'cafe', lat: 19.0598, lng: 72.8324, description: 'Dessert stop and coffee break with easy group seating.', estimated_cost: 280, source: 'osm_fallback', relevance_score: 0.9, areas: ['bandra', 'khar'], moods: ['fun', 'chill'] },
  { name: 'Bonobo', type: 'activity', lat: 19.0578, lng: 72.8395, description: 'Music-led evening hangout with a social, lively atmosphere.', estimated_cost: 700, source: 'osm_fallback', relevance_score: 0.84, areas: ['bandra'], moods: ['fun'] },
  { name: 'Kitab Khana', type: 'activity', lat: 18.9498, lng: 72.8347, description: 'Independent bookstore and calm browsing stop for slow hangouts.', estimated_cost: 180, source: 'osm_fallback', relevance_score: 0.88, areas: ['fort', 'churchgate', 'csmt'], moods: ['chill', 'romantic'] },
  { name: 'Kala Ghoda Art Precinct', type: 'activity', lat: 18.9322, lng: 72.8327, description: 'Gallery walk, art browsing, and a city-culture stop.', estimated_cost: 250, source: 'osm_fallback', relevance_score: 0.9, areas: ['fort', 'colaba', 'churchgate'], moods: ['chill', 'romantic', 'fun'] },
  { name: 'Marine Drive Promenade', type: 'outdoor', lat: 18.9439, lng: 72.8234, description: 'Iconic sea-facing walk with chai and people-watching.', estimated_cost: 100, source: 'osm_fallback', relevance_score: 0.95, areas: ['churchgate', 'colaba', 'fort'], moods: ['chill', 'romantic'] },
  { name: 'The Table', type: 'restaurant', lat: 18.9237, lng: 72.8331, description: 'Premium dinner stop for a polished hangout and good conversation.', estimated_cost: 1100, source: 'osm_fallback', relevance_score: 0.8, areas: ['colaba', 'fort'], moods: ['romantic', 'fun'] },
  { name: 'Le15 Patisserie', type: 'cafe', lat: 18.9246, lng: 72.8327, description: 'Dessert-first meetup spot near Colaba for sweet-tooth groups.', estimated_cost: 260, source: 'osm_fallback', relevance_score: 0.86, areas: ['colaba'], moods: ['romantic', 'fun', 'chill'] },
  { name: 'Bademiya Colaba', type: 'restaurant', lat: 18.9243, lng: 72.8318, description: 'Late-night food stop that feels classic and lively.', estimated_cost: 450, source: 'osm_fallback', relevance_score: 0.88, areas: ['colaba'], moods: ['fun'] },
  { name: 'Sassy Spoon Lower Parel', type: 'restaurant', lat: 18.9989, lng: 72.8288, description: 'Brunch-to-dinner restaurant with a polished group dining vibe.', estimated_cost: 900, source: 'osm_fallback', relevance_score: 0.86, areas: ['lower parel'], moods: ['fun', 'romantic'] },
  { name: 'Phoenix Palladium Arcade', type: 'activity', lat: 18.9941, lng: 72.8254, description: 'Indoor arcade and retail break for easy group downtime.', estimated_cost: 500, source: 'osm_fallback', relevance_score: 0.82, areas: ['lower parel'], moods: ['fun', 'adventure'] },
  { name: 'The Nutcracker Lower Parel', type: 'cafe', lat: 18.9987, lng: 72.8286, description: 'Brunch cafe with a calm pace for longer conversations.', estimated_cost: 380, source: 'osm_fallback', relevance_score: 0.89, areas: ['lower parel'], moods: ['chill', 'fun'] },
  { name: 'Powai Lake Promenade', type: 'outdoor', lat: 19.1175, lng: 72.9062, description: 'Lakeside walk for slow, scenic group time.', estimated_cost: 90, source: 'osm_fallback', relevance_score: 0.88, areas: ['powai'], moods: ['chill', 'romantic'] },
  { name: 'The Yogis Cafe Powai', type: 'cafe', lat: 19.1162, lng: 72.9079, description: 'Healthy cafe stop with easy seating and a laid-back mood.', estimated_cost: 300, source: 'osm_fallback', relevance_score: 0.87, areas: ['powai'], moods: ['chill', 'fun'] },
  { name: 'Hakone Entertainment Centre', type: 'activity', lat: 19.1187, lng: 72.9103, description: 'Go-karts, games, and group-friendly activities.', estimated_cost: 750, source: 'osm_fallback', relevance_score: 0.92, areas: ['powai'], moods: ['fun', 'adventure'] },
  { name: 'SMAAASH Lower Parel (Kamala Mills)', type: 'activity', lat: 19.0048, lng: 72.8264, description: 'Ticketed bowling and arcade zone inside Kamala Mills for adventure groups.', estimated_cost: 850, source: 'osm_fallback', relevance_score: 0.93, areas: ['lower parel', 'worli'], moods: ['adventure', 'fun'] },
  { name: 'The Game Palacio, High Street Phoenix', type: 'activity', lat: 18.9949, lng: 72.8245, description: 'Bowling + arcade inside the High Street Phoenix complex.', estimated_cost: 900, source: 'osm_fallback', relevance_score: 0.92, areas: ['lower parel', 'mahalaxmi'], moods: ['adventure', 'fun'] },
  { name: 'Mystery Rooms Andheri', type: 'activity', lat: 19.1189, lng: 72.8468, description: 'Escape room with ticketed team slots in Andheri West.', estimated_cost: 950, source: 'osm_fallback', relevance_score: 0.94, areas: ['andheri', 'versova'], moods: ['adventure', 'fun'] },
  { name: 'Breakout Escape Room, Bandra', type: 'activity', lat: 19.0621, lng: 72.8348, description: 'Scenario-based escape room in Bandra with timed ticket sessions.', estimated_cost: 880, source: 'osm_fallback', relevance_score: 0.9, areas: ['bandra', 'khar'], moods: ['adventure', 'fun'] },
  { name: 'Bounce Inc Mumbai (Infinity Mall Malad)', type: 'activity', lat: 19.1845, lng: 72.8349, description: 'Ticketed trampoline and freestyle activity venue inside Infinity Mall, Malad.', estimated_cost: 1100, source: 'osm_fallback', relevance_score: 0.95, areas: ['malad', 'goregaon', 'andheri'], moods: ['adventure', 'fun'] },
  { name: 'Snow World Mumbai, Phoenix Marketcity Kurla', type: 'activity', lat: 19.0864, lng: 72.8897, description: 'Ticketed indoor snow activity in Phoenix Marketcity Kurla.', estimated_cost: 1200, source: 'osm_fallback', relevance_score: 0.88, areas: ['kurla', 'sion', 'chembur'], moods: ['adventure', 'fun'] },
  { name: 'Global Vipassana Pagoda Walk', type: 'outdoor', lat: 19.2268, lng: 72.7922, description: 'Quiet scenic outing for a slower, reflective group plan.', estimated_cost: 150, source: 'osm_fallback', relevance_score: 0.76, areas: ['borivali'], moods: ['chill', 'romantic'] },
  { name: 'Cubic Mall Game Zone', type: 'activity', lat: 19.0112, lng: 72.8269, description: 'Arcade-style hangout for playful indoor time.', estimated_cost: 450, source: 'osm_fallback', relevance_score: 0.79, areas: ['kurla', 'sion'], moods: ['fun', 'adventure'] },
  { name: 'Caffe Madras Matunga', type: 'cafe', lat: 19.0269, lng: 72.8476, description: 'Classic coffee-and-snack stop with easy group seating.', estimated_cost: 220, source: 'osm_fallback', relevance_score: 0.85, areas: ['dadar', 'matunga'], moods: ['chill', 'fun'] },
  { name: 'Shivaji Park Evening Walk', type: 'outdoor', lat: 19.0288, lng: 72.8412, description: 'Green open-air walk for a low-key city hangout.', estimated_cost: 80, source: 'osm_fallback', relevance_score: 0.86, areas: ['dadar', 'matunga'], moods: ['chill', 'fun'] },
  { name: 'Tryst Mumbai', type: 'activity', lat: 19.1212, lng: 72.8449, description: 'Lively night-out venue for an energetic social vibe.', estimated_cost: 900, source: 'osm_fallback', relevance_score: 0.81, areas: ['andheri'], moods: ['fun'] },
  { name: 'Versova Social', type: 'restaurant', lat: 19.1321, lng: 72.8134, description: 'Casual all-day dining spot with a social, energetic feel.', estimated_cost: 650, source: 'osm_fallback', relevance_score: 0.88, areas: ['andheri', 'versova'], moods: ['fun', 'chill'] },
  { name: 'McDonald\'s Andheri West', type: 'restaurant', lat: 19.1301, lng: 72.8322, description: 'Reliable low-cost group meal option in Andheri.', estimated_cost: 230, source: 'osm_fallback', relevance_score: 0.84, areas: ['andheri', 'versova'], moods: ['fun', 'chill', 'adventure'] },
  { name: 'Lokhandwala High Street', type: 'activity', lat: 19.1347, lng: 72.8268, description: 'Shopping lane and easy roaming spot for a flexible group plan.', estimated_cost: 200, source: 'osm_fallback', relevance_score: 0.84, areas: ['andheri'], moods: ['fun', 'chill'] },
  { name: 'AER Mumbai', type: 'activity', lat: 19.0134, lng: 72.8204, description: 'Skyline lounge for a premium romantic or celebratory evening.', estimated_cost: 1400, source: 'osm_fallback', relevance_score: 0.77, areas: ['worli', 'lower parel'], moods: ['romantic', 'fun'] },
  { name: 'Mahim Causeway Street Food', type: 'restaurant', lat: 19.0342, lng: 72.8421, description: 'Street-food stop with multiple quick bites for groups.', estimated_cost: 260, source: 'osm_fallback', relevance_score: 0.8, areas: ['mahim', 'dadar'], moods: ['fun'] },
  { name: 'Goregaon Film City Viewing Point', type: 'activity', lat: 19.1556, lng: 72.8494, description: 'Offbeat city activity stop for curious groups.', estimated_cost: 400, source: 'osm_fallback', relevance_score: 0.74, areas: ['goregaon'], moods: ['adventure', 'fun'] },
];

const HUB_ALIASES: Record<string, string[]> = {
  bandra: ['bandra', 'khar', 'santacruz', 'mahim'],
  juhu: ['juhu', 'vile parle', 'andheri', 'versova'],
  andheri: ['andheri', 'versova', 'juhu', 'vile parle'],
  'lower parel': ['lower parel', 'worli', 'mahalaxmi', 'prabhadevi'],
  colaba: ['colaba', 'fort', 'churchgate', 'marine drive'],
  churchgate: ['churchgate', 'fort', 'marine drive', 'colaba'],
  csmt: ['csmt', 'fort', 'marine drive', 'kalaghoda'],
  dadar: ['dadar', 'matunga', 'mahim', 'prabhadevi'],
  powai: ['powai', 'marol', 'andheri east'],
  borivali: ['borivali', 'kandivali', 'malad'],
  kurla: ['kurla', 'chembur', 'sion'],
  mahalaxmi: ['mahalaxmi', 'worli', 'lower parel'],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function currentMumbaiWeekday(): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const day = formatter.format(new Date());
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[day] ?? new Date().getDay();
}

function defaultCost(type: Place['type'], budget: number): number {
  const cap = Math.max(200, budget);
  const defaults: Record<Place['type'], number> = {
    cafe: Math.round(cap * 0.3),
    activity: Math.round(cap * 0.35),
    restaurant: Math.round(cap * 0.42),
    outdoor: Math.round(cap * 0.12),
  };
  return defaults[type];
}

export function getCuratedVenues(
  hubName: string,
  hubLocation: { lat: number; lng: number },
  mood: Mood,
  budget: number,
  limit = 10
): Place[] {
  const hub = normalize(hubName);
  const aliases = HUB_ALIASES[hub] || [hub];
  const weekday = currentMumbaiWeekday();

  return MUMBAI_VENUES
    .filter((venue) => {
      if (venue.openDays && !venue.openDays.includes(weekday)) {
        return false;
      }
      const venueAreaMatch = venue.areas.some((area) => aliases.some((alias) => normalize(area).includes(alias) || alias.includes(normalize(area))));
      const closeEnough = typeof venue.lat === 'number' && typeof venue.lng === 'number'
        ? haversineDistance(hubLocation, { lat: venue.lat, lng: venue.lng }) <= 14
        : false;
      return venueAreaMatch || closeEnough;
    })
    .map((venue) => ({
      ...venue,
      estimated_cost: venue.estimated_cost || defaultCost(venue.type, budget),
      relevance_score: venue.moods.includes(mood) ? Math.max(venue.relevance_score, 0.9) : venue.relevance_score,
    }))
    .sort((a, b) => {
      const moodBoostA = a.moods?.includes(mood) ? 1 : 0;
      const moodBoostB = b.moods?.includes(mood) ? 1 : 0;
      const distanceA = haversineDistance(hubLocation, { lat: a.lat || hubLocation.lat, lng: a.lng || hubLocation.lng });
      const distanceB = haversineDistance(hubLocation, { lat: b.lat || hubLocation.lat, lng: b.lng || hubLocation.lng });
      const scoreA = moodBoostA * 2 + a.relevance_score - distanceA / 20;
      const scoreB = moodBoostB * 2 + b.relevance_score - distanceB / 20;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}
