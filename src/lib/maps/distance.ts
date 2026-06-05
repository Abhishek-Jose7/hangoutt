import 'server-only';


export interface DistanceMatrixItem {
  distanceMeters: number;
  durationSeconds: number;
}

export async function getDistanceMatrix(
  origins: { lat: number; lng: number }[],
  destinations: { lat: number; lng: number }[]
): Promise<DistanceMatrixItem[][]> {
  // Real endpoint: POST /routing/v1/distancematrix
  // For Phase 1, return stub distances
  return origins.map(() =>
    destinations.map(() => ({
      distanceMeters: 1500,
      durationSeconds: 300,
    }))
  );
}
