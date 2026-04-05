'use client';

import type { LatLng, MapAdapter, MarkerHandle, MarkerOptions } from './types';

interface GoogleMapInstance {
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
}

interface GoogleMarkerInstance {
  addListener: (eventName: string, handler: () => void) => void;
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GooglePolylineInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleLatLngBounds {
  extend: (point: LatLng) => void;
}

interface GoogleInfoWindowInstance {
  open: (config: { anchor: GoogleMarkerInstance; map: GoogleMapInstance | null }) => void;
}

interface GoogleMapsGlobal {
  maps: {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
    Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
    Polyline: new (options: Record<string, unknown>) => GooglePolylineInstance;
    InfoWindow: new (options: { content: string }) => GoogleInfoWindowInstance;
    LatLngBounds: new () => GoogleLatLngBounds;
    SymbolPath: {
      CIRCLE: unknown;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleMapsGlobal;
  }
}

export class GoogleMapsAdapter implements MapAdapter {
  private map: GoogleMapInstance | null = null;
  private markers: GoogleMarkerInstance[] = [];
  private polylines: GooglePolylineInstance[] = [];

  async init(container: HTMLElement, center: LatLng, zoom: number): Promise<void> {
    if (!window.google?.maps) {
      throw new Error('Google Maps not available');
    }

    this.map = new window.google.maps.Map(container, {
      center,
      zoom,
      disableDefaultUI: false,
      mapId: 'hangout-map',
    });
  }

  addMarker(position: LatLng, options: MarkerOptions): MarkerHandle {
    const googleMaps = window.google?.maps;
    if (!this.map || !googleMaps) {
      return { remove: () => undefined };
    }

    const marker = new googleMaps.Marker({
      position,
      map: this.map,
      title: options.title,
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        fillColor: options.color || '#DC143C',
        fillOpacity: 1,
        strokeColor: '#0C0C0E',
        strokeWeight: 2,
        scale: 8,
      },
    });

    if (options.popup) {
      const infoWindow = new googleMaps.InfoWindow({ content: options.popup });
      marker.addListener('click', () => {
        infoWindow.open({ anchor: marker, map: this.map });
      });
    }

    this.markers.push(marker);

    return {
      remove: () => marker.setMap(null),
    };
  }

  addPolyline(points: LatLng[], color: string): void {
    const googleMaps = window.google?.maps;
    if (!this.map || !googleMaps || points.length < 2) return;

    const polyline = new googleMaps.Polyline({
      path: points,
      geodesic: true,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: 2,
      map: this.map,
    });

    this.polylines.push(polyline);
  }

  fitBounds(bounds: LatLng[]): void {
    const googleMaps = window.google?.maps;
    if (!this.map || !googleMaps || bounds.length === 0) return;

    const gBounds = new googleMaps.LatLngBounds();
    for (const point of bounds) {
      gBounds.extend(point);
    }
    this.map.fitBounds(gBounds, 80);
  }

  destroy(): void {
    for (const marker of this.markers) marker.setMap(null);
    for (const polyline of this.polylines) polyline.setMap(null);
    this.markers = [];
    this.polylines = [];
    this.map = null;
  }
}
