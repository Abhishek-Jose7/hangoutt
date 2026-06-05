import { InsufficientLocationsError } from '../errors';

export function calculateMidpoint(locations: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (locations.length < 2) {
    throw new InsufficientLocationsError();
  }
  
  return {
    lat: locations.reduce((sum, l) => sum + l.lat, 0) / locations.length,
    lng: locations.reduce((sum, l) => sum + l.lng, 0) / locations.length,
  };
}
