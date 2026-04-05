'use client';

import { useEffect, useRef, useState } from 'react';
import { GoogleMapsAdapter } from './GoogleMapsAdapter';
import { LeafletAdapter } from './LeafletAdapter';
import type { LatLng, MapAdapter } from './types';

interface MapViewMarker {
  position: LatLng;
  title: string;
  color?: string;
  popup?: string;
}

interface MapViewProps {
  center: LatLng;
  markers: MapViewMarker[];
  polylines?: LatLng[][];
  className?: string;
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window unavailable'));
  }

  if (window.google?.maps) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=maps,marker,geometry&loading=async`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export function MapView({ center, markers, polylines = [], className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      if (!containerRef.current) return;

      let adapter: MapAdapter;
      const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

      try {
        if (!key) {
          throw new Error('Google Maps key missing');
        }

        await Promise.race([
          loadGoogleMapsScript(key),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Google timeout')), 5000)),
        ]);

        if (cancelled) return;
        adapter = new GoogleMapsAdapter();
        setUsingFallback(false);
      } catch {
        if (cancelled) return;
        adapter = new LeafletAdapter();
        setUsingFallback(true);
      }

      await adapter.init(containerRef.current, center, 12);

      for (const marker of markers) {
        adapter.addMarker(marker.position, {
          title: marker.title,
          color: marker.color,
          popup: marker.popup,
        });
      }

      for (const line of polylines) {
        adapter.addPolyline(line, '#DC143C');
      }

      const bounds = [center, ...markers.map((m) => m.position)];
      adapter.fitBounds(bounds);
      adapterRef.current = adapter;
    }

    initMap();

    return () => {
      cancelled = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [center, markers, polylines]);

  return (
    <div className={className || ''}>
      <div ref={containerRef} className="h-[340px] w-full rounded-2xl border border-[var(--color-border-subtle)]" />
      {usingFallback ? (
        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Using OpenStreetMap fallback</p>
      ) : null}
    </div>
  );
}
