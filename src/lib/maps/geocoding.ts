import 'server-only';


export interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export async function geocodeAddress(address: string): Promise<GeocodingResult> {
  // Stub or actual call helper
  console.log(`Geocoding query address: ${address}`);
  
  // Real endpoint: GET /places/v1/geocode?address=...
  // For Phase 1 Foundation, return stub Koramangala coordinate
  return {
    lat: 12.9348,
    lng: 77.6189,
    formattedAddress: 'Koramangala, Bengaluru, Karnataka, India',
  };
}

export async function reverseGeocode(_lat: number, _lng: number): Promise<string> {
  // Real endpoint: GET /places/v1/reverse-geocode?lat=...&lng=...
  return 'Koramangala 5th Block, Bengaluru, India';
}
