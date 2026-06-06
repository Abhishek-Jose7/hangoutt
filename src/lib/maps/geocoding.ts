import 'server-only';
import { fetchOlaMaps } from './olaClient';

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

  // Simulation fallback matching prominent hubs in Mumbai and Bengaluru
  const lower = address.toLowerCase().trim();
  if (lower.includes('dadar')) {
    return { lat: 19.0178, lng: 72.8478, formattedAddress: 'Dadar, Mumbai, Maharashtra, India' };
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
  } else if (lower.includes('koramangala')) {
    return { lat: 12.9348, lng: 77.6189, formattedAddress: 'Koramangala, Bengaluru, Karnataka, India' };
  } else if (lower.includes('indiranagar')) {
    return { lat: 12.9719, lng: 77.6412, formattedAddress: 'Indiranagar, Bengaluru, Karnataka, India' };
  } else if (lower.includes('mg road')) {
    return { lat: 12.9738, lng: 77.6119, formattedAddress: 'MG Road, Bengaluru, Karnataka, India' };
  } else if (lower.includes('jayanagar')) {
    return { lat: 12.9250, lng: 77.5897, formattedAddress: 'Jayanagar, Bengaluru, Karnataka, India' };
  } else if (lower.includes('hsr')) {
    return { lat: 12.9105, lng: 77.6450, formattedAddress: 'HSR Layout, Bengaluru, Karnataka, India' };
  } else if (lower.includes('ulhasnagar')) {
    return { lat: 19.2215, lng: 73.1644, formattedAddress: 'Ulhasnagar, Thane District, Maharashtra, India' };
  } else if (lower.includes('panvel')) {
    return { lat: 18.9894, lng: 73.1175, formattedAddress: 'Panvel, Navi Mumbai, Maharashtra, India' };
  } else if (lower.includes('cst') || lower.includes('chhatrapati shivaji') || lower.includes('terminus')) {
    return { lat: 18.9400, lng: 72.8354, formattedAddress: 'Chhatrapati Shivaji Terminus (CST), Mumbai, Maharashtra, India' };
  } else if (lower.includes('thane')) {
    return { lat: 19.2183, lng: 72.9781, formattedAddress: 'Thane, Maharashtra, India' };
  }

  // General default: Koramangala coordinate
  return {
    lat: 12.9348,
    lng: 77.6189,
    formattedAddress: `${address} (Approximate location)`,
  };
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const apiKey = process.env.OLA_MAPS_API_KEY;
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');
  
  if (!isPlaceholder) {
    try {
      const res = await fetchOlaMaps<any>(`/places/v1/reverse-geocode?latlng=${lat},${lng}`);
      if (res && res.results && res.results[0]) {
        return res.results[0].formatted_address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
    } catch (err) {
      console.error('Ola Maps Reverse Geocoding failed, falling back to simulator:', err);
    }
  }

  // Fallback: match closest coordinate to candidate zone
  const centers = [
    { name: 'Thane, Mumbai', lat: 19.2183, lng: 72.9781 },
    { name: 'Ulhasnagar, Mumbai', lat: 19.2215, lng: 73.1644 },
    { name: 'Panvel, Navi Mumbai', lat: 18.9894, lng: 73.1175 },
    { name: 'CST, Mumbai', lat: 18.9400, lng: 72.8354 },
    { name: 'Dadar, Mumbai', lat: 19.0178, lng: 72.8478 },
    { name: 'Kurla, Mumbai', lat: 19.0607, lng: 72.8826 },
    { name: 'Vashi, Navi Mumbai', lat: 19.0745, lng: 72.9978 },
    { name: 'Ghatkopar, Mumbai', lat: 19.0860, lng: 72.9082 },
    { name: 'Andheri, Mumbai', lat: 19.1136, lng: 72.8697 },
    { name: 'Belapur, Navi Mumbai', lat: 19.0180, lng: 73.0392 },
    { name: 'Bandra, Mumbai', lat: 19.0596, lng: 72.8295 },
    { name: 'Koramangala, Bengaluru', lat: 12.9348, lng: 77.6189 },
    { name: 'Indiranagar, Bengaluru', lat: 12.9719, lng: 77.6412 },
    { name: 'MG Road, Bengaluru', lat: 12.9738, lng: 77.6119 },
    { name: 'Jayanagar, Bengaluru', lat: 12.9250, lng: 77.5897 },
    { name: 'HSR Layout, Bengaluru', lat: 12.9105, lng: 77.6450 },
    { name: 'Whitefield, Bengaluru', lat: 12.9698, lng: 77.7499 },
  ];

  let best = centers[0];
  let minDist = Infinity;
  for (const c of centers) {
    const d = Math.sqrt((c.lat - lat) ** 2 + (c.lng - lng) ** 2);
    if (d < minDist) {
      minDist = d;
      best = c;
    }
  }

  return best.name;
}
