export interface LatLng {
  lat: number;
  lng: number;
}

export interface MarkerOptions {
  title: string;
  color?: string;
  popup?: string;
}

export interface MarkerHandle {
  remove: () => void;
}

export interface MapAdapter {
  init(container: HTMLElement, center: LatLng, zoom: number): Promise<void>;
  addMarker(position: LatLng, options: MarkerOptions): MarkerHandle;
  addPolyline(points: LatLng[], color: string): void;
  fitBounds(bounds: LatLng[]): void;
  destroy(): void;
}
