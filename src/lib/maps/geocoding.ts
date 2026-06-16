import 'server-only';
import { fetchOlaMaps } from './olaClient';
import { ValidationError } from '../errors';

export interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export async function geocodeAddress(address: string): Promise<GeocodingResult> {
  console.log(`Geocoding query address: ${address}`);
  
  const apiKey = process.env.OLA_MAPS_API_KEY;
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');
  
  if (!isPlaceholder) {
    try {
      const res = await fetchOlaMaps<any>(`/places/v1/geocode?address=${encodeURIComponent(address)}`);
      if (res && res.geocodingResults && res.geocodingResults[0]) {
        const first = res.geocodingResults[0];
        return {
          lat: first.geometry.location.lat,
          lng: first.geometry.location.lng,
          formattedAddress: first.formatted_address || address,
        };
      }
    } catch (err) {
      console.error('Ola Maps Geocoding failed, falling back to simulator:', err);
    }
  }

  // Simulation fallback matching prominent hubs in Mumbai, Navi Mumbai, and Thane
  const lower = address.toLowerCase().trim();
  const coordinateMatch = lower.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lng = Number(coordinateMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    }
  }

  if (lower.includes('dadar')) {
    return { lat: 19.0178, lng: 72.8478, formattedAddress: 'Dadar, Mumbai, Maharashtra, India' };
  } else if (lower.includes('lower parel')) {
    return { lat: 19.0034, lng: 72.8276, formattedAddress: 'Lower Parel, Mumbai, Maharashtra, India' };
  } else if (lower.includes('worli')) {
    return { lat: 19.0176, lng: 72.8179, formattedAddress: 'Worli, Mumbai, Maharashtra, India' };
  } else if (lower.includes('juhu')) {
    return { lat: 19.1075, lng: 72.8263, formattedAddress: 'Juhu, Mumbai, Maharashtra, India' };
  } else if (lower.includes('powai')) {
    return { lat: 19.1176, lng: 72.9060, formattedAddress: 'Powai, Mumbai, Maharashtra, India' };
  } else if (lower.includes('borivali')) {
    return { lat: 19.2290, lng: 72.8570, formattedAddress: 'Borivali, Mumbai, Maharashtra, India' };
  } else if (lower.includes('malad')) {
    return { lat: 19.1860, lng: 72.8485, formattedAddress: 'Malad, Mumbai, Maharashtra, India' };
  } else if (lower.includes('colaba')) {
    return { lat: 18.9067, lng: 72.8147, formattedAddress: 'Colaba, Mumbai, Maharashtra, India' };
  } else if (lower.includes('fort') || lower.includes('kala ghoda')) {
    return { lat: 18.9322, lng: 72.8325, formattedAddress: 'Fort, Mumbai, Maharashtra, India' };
  } else if (lower.includes('kurla')) {
    return { lat: 19.0607, lng: 72.8826, formattedAddress: 'Kurla, Mumbai, Maharashtra, India' };
  } else if (lower.includes('vashi')) {
    return { lat: 19.0745, lng: 72.9978, formattedAddress: 'Vashi, Navi Mumbai, Maharashtra, India' };
  } else if (lower.includes('ghatkopar')) {
    return { lat: 19.0860, lng: 72.9082, formattedAddress: 'Ghatkopar, Mumbai, Maharashtra, India' };
  } else if (lower.includes('andheri')) {
    return { lat: 19.1136, lng: 72.8697, formattedAddress: 'Andheri, Mumbai, Maharashtra, India' };
  } else if (lower.includes('belapur')) {
    return { lat: 19.0180, lng: 73.0392, formattedAddress: 'Belapur, Navi Mumbai, Maharashtra, India' };
  } else if (lower.includes('bandra')) {
    return { lat: 19.0596, lng: 72.8295, formattedAddress: 'Bandra, Mumbai, Maharashtra, India' };
  } else if (lower.includes('mumbai')) {
    return { lat: 19.0760, lng: 72.8777, formattedAddress: 'Mumbai, Maharashtra, India' };
  } else if (lower.includes('ulhasnagar')) {
    return { lat: 19.2215, lng: 73.1644, formattedAddress: 'Ulhasnagar, Thane District, Maharashtra, India' };
  } else if (lower.includes('panvel')) {
    return { lat: 18.9894, lng: 73.1175, formattedAddress: 'Panvel, Navi Mumbai, Maharashtra, India' };
  } else if (lower.includes('cst') || lower.includes('chhatrapati shivaji') || lower.includes('terminus')) {
    return { lat: 18.9400, lng: 72.8354, formattedAddress: 'Chhatrapati Shivaji Terminus (CST), Mumbai, Maharashtra, India' };
  } else if (lower.includes('thane')) {
    return { lat: 19.2183, lng: 72.9781, formattedAddress: 'Thane, Maharashtra, India' };
  }

  // No silent moves — reject unresolvable addresses
  throw new ValidationError(`Could not resolve coordinates for "${address}". Please try a different location or check the spelling.`);
}

export interface Station {
  name: string;
  lat: number;
  lng: number;
}

// 70+ railway stations in Mumbai, Navi Mumbai, and Thane
export const RAILWAY_STATIONS: Station[] = [
  // South Mumbai / Central
  { name: 'Chhatrapati Shivaji Maharaj Terminus (CSMT) Railway Station', lat: 18.9400, lng: 72.8354 },
  { name: 'Churchgate Railway Station', lat: 18.9345, lng: 72.8272 },
  { name: 'Masjid Railway Station', lat: 18.9515, lng: 72.8380 },
  { name: 'Sandhurst Road Railway Station', lat: 18.9610, lng: 72.8385 },
  { name: 'Byculla Railway Station', lat: 18.9775, lng: 72.8335 },
  { name: 'Charni Road Railway Station', lat: 18.9518, lng: 72.8185 },
  { name: 'Marine Lines Railway Station', lat: 18.9448, lng: 72.8236 },
  { name: 'Grant Road Railway Station', lat: 18.9630, lng: 72.8175 },
  { name: 'Mumbai Central Railway Station', lat: 18.9696, lng: 72.8194 },
  { name: 'Mahalaxmi Railway Station', lat: 18.9825, lng: 72.8242 },
  { name: 'Lower Parel Railway Station', lat: 18.9950, lng: 72.8315 },
  { name: 'Prabhadevi Railway Station', lat: 19.0135, lng: 72.8290 },
  { name: 'Currey Road Railway Station', lat: 18.9958, lng: 72.8338 },
  { name: 'Chinchpokli Railway Station', lat: 18.9875, lng: 72.8322 },
  { name: 'Cotton Green Railway Station', lat: 18.9862, lng: 72.8436 },
  { name: 'Reay Road Railway Station', lat: 18.9735, lng: 72.8405 },
  { name: 'Dockyard Road Railway Station', lat: 18.9665, lng: 72.8398 },
  { name: 'Sewri Railway Station', lat: 19.0002, lng: 72.8550 },
  { name: 'Wadala Road Railway Station', lat: 19.0225, lng: 72.8575 },

  // Dadar / Central Hub
  { name: 'Dadar Railway Station', lat: 19.0178, lng: 72.8478 },
  { name: 'Matunga Railway Station', lat: 19.0268, lng: 72.8495 },
  { name: 'Matunga Road Railway Station', lat: 19.0305, lng: 72.8415 },
  { name: 'Sion Railway Station', lat: 19.0375, lng: 72.8647 },
  { name: 'Mahim Junction Railway Station', lat: 19.0410, lng: 72.8402 },
  { name: 'Bandra Railway Station', lat: 19.0596, lng: 72.8295 },
  { name: 'Khar Road Railway Station', lat: 19.0690, lng: 72.8360 },
  { name: 'Santacruz Railway Station', lat: 19.0822, lng: 72.8415 },
  { name: 'Vile Parle Railway Station', lat: 19.0988, lng: 72.8373 },

  // Western Suburbs
  { name: 'Andheri Railway Station', lat: 19.1136, lng: 72.8697 },
  { name: 'Jogeshwari Railway Station', lat: 19.1360, lng: 72.8488 },
  { name: 'Ram Mandir Railway Station', lat: 19.1510, lng: 72.8472 },
  { name: 'Goregaon Railway Station', lat: 19.1648, lng: 72.8492 },
  { name: 'Malad Railway Station', lat: 19.1860, lng: 72.8485 },
  { name: 'Kandivali Railway Station', lat: 19.2045, lng: 72.8522 },
  { name: 'Borivali Railway Station', lat: 19.2290, lng: 72.8573 },
  { name: 'Dahisar Railway Station', lat: 19.2483, lng: 72.8596 },
  { name: 'Mira Road Railway Station', lat: 19.2815, lng: 72.8559 },
  { name: 'Bhayandar Railway Station', lat: 19.3120, lng: 72.8510 },
  { name: 'Naigaon Railway Station', lat: 19.3490, lng: 72.8435 },
  { name: 'Vasai Road Railway Station', lat: 19.3820, lng: 72.8320 },
  { name: 'Nallasopara Railway Station', lat: 19.4180, lng: 72.8190 },
  { name: 'Virar Railway Station', lat: 19.4570, lng: 72.8110 },

  // Central Suburbs / Central Line
  { name: 'Kurla Railway Station', lat: 19.0607, lng: 72.8826 },
  { name: 'Vidyavihar Railway Station', lat: 19.0792, lng: 72.8968 },
  { name: 'Ghatkopar Railway Station', lat: 19.0860, lng: 72.9082 },
  { name: 'Vikhroli Railway Station', lat: 19.1120, lng: 72.9290 },
  { name: 'Kanjurmarg Railway Station', lat: 19.1300, lng: 72.9460 },
  { name: 'Bhandup Railway Station', lat: 19.1450, lng: 72.9380 },
  { name: 'Nahur Railway Station', lat: 19.1585, lng: 72.9470 },
  { name: 'Mulund Railway Station', lat: 19.1726, lng: 72.9563 },
  { name: 'Thane Railway Station', lat: 19.1860, lng: 72.9630 },
  { name: 'Kalwa Railway Station', lat: 19.1960, lng: 72.9960 },
  { name: 'Mumbra Railway Station', lat: 19.1905, lng: 73.0235 },
  { name: 'Diva Junction Railway Station', lat: 19.1890, lng: 73.0425 },
  { name: 'Kopar Railway Station', lat: 19.2085, lng: 73.0780 },
  { name: 'Dombivli Railway Station', lat: 19.2180, lng: 73.0870 },
  { name: 'Thakurli Railway Station', lat: 19.2290, lng: 73.0990 },
  { name: 'Kalyan Junction Railway Station', lat: 19.2360, lng: 73.1300 },
  { name: 'Ulhasnagar Railway Station', lat: 19.2215, lng: 73.1644 },
  { name: 'Ambernath Railway Station', lat: 19.2060, lng: 73.1850 },
  { name: 'Badlapur Railway Station', lat: 19.1590, lng: 73.2240 },
  { name: 'Shahad Railway Station', lat: 19.2520, lng: 73.1550 },
  { name: 'Ambivli Railway Station', lat: 19.2740, lng: 73.1490 },
  { name: 'Titwala Railway Station', lat: 19.2995, lng: 73.2080 },

  // Harbour / Trans-Harbour / Navi Mumbai
  { name: 'GTB Nagar Railway Station', lat: 19.0375, lng: 72.8680 },
  { name: 'Chunabhatti Railway Station', lat: 19.0490, lng: 72.8790 },
  { name: 'Chembur Railway Station', lat: 19.0620, lng: 72.8980 },
  { name: 'Tilak Nagar Railway Station', lat: 19.0655, lng: 72.8940 },
  { name: 'Govandi Railway Station', lat: 19.0550, lng: 72.9150 },
  { name: 'Mankhurd Railway Station', lat: 19.0515, lng: 72.9320 },
  { name: 'Vashi Railway Station', lat: 19.0745, lng: 72.9978 },
  { name: 'Sanpada Railway Station', lat: 19.0675, lng: 73.0078 },
  { name: 'Juinagar Railway Station', lat: 19.0545, lng: 73.0165 },
  { name: 'Nerul Railway Station', lat: 19.0330, lng: 73.0180 },
  { name: 'Seawoods - Darave Railway Station', lat: 19.0212, lng: 73.0192 },
  { name: 'CBD Belapur Railway Station', lat: 19.0180, lng: 73.0392 },
  { name: 'Kharghar Railway Station', lat: 19.0222, lng: 73.0644 },
  { name: 'Mansarovar Railway Station', lat: 19.0215, lng: 73.0845 },
  { name: 'Khandeshwar Railway Station', lat: 19.0210, lng: 73.0995 },
  { name: 'Panvel Railway Station', lat: 18.9894, lng: 73.1175 },
  { name: 'Turbhe Railway Station', lat: 19.0750, lng: 73.0180 },
  { name: 'Kopar Khairane Railway Station', lat: 19.0980, lng: 73.0090 },
  { name: 'Ghansoli Railway Station', lat: 19.1245, lng: 73.0005 },
  { name: 'Rabale Railway Station', lat: 19.1415, lng: 72.9980 },
  { name: 'Airoli Railway Station', lat: 19.1580, lng: 72.9970 }
];

export function getNearestStation(lat: number, lng: number): Station {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // km
  
  let nearest: Station = RAILWAY_STATIONS[0];
  let minDist = Infinity;
  
  for (const station of RAILWAY_STATIONS) {
    const dLat = toRad(station.lat - lat);
    const dLng = toRad(station.lng - lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat)) *
        Math.cos(toRad(station.lat)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    
    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }
  
  return nearest;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // Always return the nearest railway station name
  const nearest = getNearestStation(lat, lng);
  return nearest.name;
}
