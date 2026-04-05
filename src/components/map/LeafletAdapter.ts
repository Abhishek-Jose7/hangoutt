'use client';

import type { LatLng, MapAdapter, MarkerHandle, MarkerOptions } from './types';

type LeafletModule = typeof import('leaflet');

let LRef: LeafletModule | null = null;

async function getLeaflet(): Promise<LeafletModule> {
  if (!LRef) {
    LRef = await import('leaflet');
  }
  return LRef;
}

export class LeafletAdapter implements MapAdapter {
  private map: import('leaflet').Map | null = null;
  private markers: import('leaflet').Marker[] = [];
  private polylines: import('leaflet').Polyline[] = [];

  async init(container: HTMLElement, center: LatLng, zoom: number): Promise<void> {
    const L = await getLeaflet();

    this.map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
    }).setView([center.lat, center.lng], zoom);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
  }

  addMarker(position: LatLng, options: MarkerOptions): MarkerHandle {
    if (!this.map || !LRef) {
      return { remove: () => undefined };
    }

    const L = LRef;
    const marker = L.marker([position.lat, position.lng], {
      icon: L.divIcon({
        className: 'custom-dot-marker',
        html: `<span style="display:block;width:14px;height:14px;border-radius:999px;background:${options.color || '#F5A623'};border:2px solid #0C0C0E"></span>`,
        iconSize: [14, 14],
      }),
      title: options.title,
    }).addTo(this.map);

    if (options.popup) {
      marker.bindPopup(options.popup);
    }

    this.markers.push(marker);

    return {
      remove: () => marker.remove(),
    };
  }

  addPolyline(points: LatLng[], color: string): void {
    if (!this.map || !LRef || points.length < 2) return;

    const L = LRef;
    const polyline = L.polyline(
      points.map((p) => [p.lat, p.lng] as [number, number]),
      {
        color,
        weight: 2,
        opacity: 0.8,
      }
    ).addTo(this.map);

    this.polylines.push(polyline);
  }

  fitBounds(bounds: LatLng[]): void {
    if (!this.map || !LRef || bounds.length === 0) return;

    const L = LRef;
    const leafletBounds = L.latLngBounds(
      bounds.map((p) => [p.lat, p.lng] as [number, number])
    );
    this.map.fitBounds(leafletBounds, { padding: [40, 40] });
  }

  destroy(): void {
    for (const marker of this.markers) marker.remove();
    for (const polyline of this.polylines) polyline.remove();
    this.markers = [];
    this.polylines = [];

    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
