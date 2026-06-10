'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MarkerData {
  id: string;
  lngLat: [number, number];
  popupText?: string;
  isActive?: boolean;
}

interface MapProps {
  /**
   * The longitude and latitude coordinates to center the map on.
   * Format: [lng, lat]
   * @default [72.8777, 19.076] (Mumbai)
   */
  center?: [number, number];
  
  /**
   * Initial zoom level of the map.
   * @default 11
   */
  zoom?: number;
  
  /**
   * Height of the map container.
   * @default '500px'
   */
  height?: string;
  
  /**
   * Width of the map container.
   * @default '100%'
   */
  width?: string;
  
  /**
   * List of dynamic markers to display.
   */
  markers?: MarkerData[];
  
  /**
   * Callback when a marker is clicked.
   */
  onMarkerClick?: (markerId: string) => void;

  /**
   * Additional CSS classes for the map wrapper container.
   */
  className?: string;
}

export default function Map({
  center = [72.8777, 19.076],
  zoom = 11,
  height = '500px',
  width = '100%',
  markers = [],
  onMarkerClick,
  className = '',
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const activeMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Initialize the Map once
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      cooperativeGestures: true,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: center,
      zoom: zoom,
    });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []); // Run once on mount

  // Fly/pan to center when center or zoom changes
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    map.easeTo({
      center: center,
      zoom: zoom,
      duration: 1200
    });
  }, [center[0], center[1], zoom]);

  // Update markers dynamically when markers array changes
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Remove old markers
    activeMarkersRef.current.forEach(marker => marker.remove());
    activeMarkersRef.current = [];

    // Add new markers
    markers.forEach((markerData) => {
      // Create HTML element for custom styled marker
      const el = document.createElement('div');
      el.className = 'custom-marker-wrapper';
      
      // Outer active ring
      if (markerData.isActive) {
        el.innerHTML = `
          <div style="position: relative; width: 24px; height: 24px; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 20px; height: 20px; border-radius: 50%; border: 1px solid #DC143C; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; opacity: 0.75; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>
            <div style="width: 10px; height: 10px; border-radius: 50%; background-color: #DC143C; border: 2px solid #0D0A08; box-shadow: 0 0 5px #DC143C;"></div>
          </div>
        `;
      } else {
        el.innerHTML = `
          <div style="position: relative; width: 24px; height: 24px; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div style="width: 14px; height: 14px; border-radius: 50%; background-color: #00E5A0; border: 2.5px solid #0D0A08; box-shadow: 0 0 6px #00E5A0;"></div>
          </div>
        `;
      }

      el.addEventListener('click', () => {
        if (onMarkerClick) {
          onMarkerClick(markerData.id);
        }
      });

      const mapMarker = new maplibregl.Marker({ element: el })
        .setLngLat(markerData.lngLat)
        .addTo(map);

      // Add popup on hover/click if popupText exists
      if (markerData.popupText) {
        const popup = new maplibregl.Popup({ offset: 15, closeButton: false })
          .setHTML(`<div style="color: black; font-family: monospace; font-size: 11px; padding: 2px; font-weight: bold;">${markerData.popupText}</div>`);
        mapMarker.setPopup(popup);
      }

      activeMarkersRef.current.push(mapMarker);
    });
  }, [markers, onMarkerClick]);

  return (
    <div
      ref={mapContainer}
      className={`relative w-full h-full ${className}`}
      style={{ width, height }}
    />
  );
}
