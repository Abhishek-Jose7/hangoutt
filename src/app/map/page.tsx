'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// Use dynamic import with ssr: false to prevent window is not defined errors during build / SSR.
const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[600px] flex flex-col items-center justify-center bg-stone-950 border border-stone-850 rounded-xl">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#DC143C] mb-2" />
      <span className="text-stone-500 font-mono text-[10px] uppercase tracking-widest">Loading Interactive Map...</span>
    </div>
  ),
});

export default function MapPage() {
  return (
    <main className="min-h-screen bg-[#0A0A0C] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-900/60 bg-stone-950/40 backdrop-blur-md sticky top-0 z-50 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link 
            href="/"
            className="flex items-center gap-2 text-stone-400 hover:text-white transition-all text-xs font-mono font-bold uppercase tracking-widest border border-stone-850 bg-stone-950/50 hover:bg-stone-900 rounded-lg px-3.5 py-2"
          >
            <ArrowLeft className="h-4 w-4 text-[#DC143C]" /> Back to Home
          </Link>
          <div>
            <h1 className="font-heading text-lg font-bold tracking-widest text-white uppercase leading-none">Interactive Map</h1>
            <p className="font-mono text-[9px] tracking-wider text-neutral-500 uppercase mt-1">MapLibre GL JS integration centered on Mumbai</p>
          </div>
        </div>
        <div className="font-mono text-[9px] text-[#00E5A0] bg-[#00E5A0]/10 border border-[#00E5A0]/20 px-3 py-1 rounded-md uppercase tracking-wider font-bold">
          System Operational
        </div>
      </header>

      {/* Map Container */}
      <section className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C] font-mono">
            [ Geographic Telemetry ]
          </span>
          <h2 className="text-3xl font-heading font-normal italic tracking-wide text-white">
            Mumbai Explorer
          </h2>
          <p className="text-stone-400 font-sans font-light text-sm max-w-2xl leading-relaxed">
            This map is fully interactive, responsive, and renders high-fidelity vector-driven layers using MapLibre GL JS and OpenStreetMap tiles. Centered at longitude 72.8777, latitude 19.076.
          </p>
        </div>

        {/* The Reusable Map Component */}
        <div className="w-full flex-1 min-h-[500px] h-[60vh]">
          <Map 
            center={[72.8777, 19.076]} 
            zoom={12} 
            height="100%" 
            width="100%" 
            markers={[
              { id: 'center', lngLat: [72.8777, 19.076], popupText: "Mumbai Center", isActive: true },
              { id: 'cafe-01', lngLat: [72.8295, 19.0596], popupText: "Saint's Dark Coffee, Bandra West" },
              { id: 'cafe-02', lngLat: [72.8478, 19.0178], popupText: "Balzac's Roasters Coffee, Worli" },
              { id: 'cafe-03', lngLat: [72.8382, 18.9309], popupText: "Pergamum Cafe Shop, Fort" },
              { id: 'rest-01', lngLat: [72.8285, 19.0024], popupText: "The Bombay Canteen, Lower Parel" },
              { id: 'rest-02', lngLat: [72.8330, 18.9300], popupText: "Trishna Restaurant, Kala Ghoda" }
            ]}
          />
        </div>

        {/* Legend / Info card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs mt-2">
          <div className="bg-stone-950/45 border border-stone-900/60 p-4 rounded-xl backdrop-blur-md">
            <h3 className="font-bold text-white uppercase tracking-wider mb-2 text-[#DC143C]">Center Coordinate</h3>
            <p className="text-neutral-400 font-light text-[11px] leading-relaxed">
              Mumbai Centroid:<br />
              Lng: 72.8777<br />
              Lat: 19.076
            </p>
          </div>
          <div className="bg-stone-950/45 border border-stone-900/60 p-4 rounded-xl backdrop-blur-md">
            <h3 className="font-bold text-white uppercase tracking-wider mb-2 text-[#00E5A0]">OpenStreetMap Tiles</h3>
            <p className="text-neutral-400 font-light text-[11px] leading-relaxed">
              Powered by MapLibre GL JS using standard OpenStreetMap raster tiles rendered on the client with customized styling markers.
            </p>
          </div>
          <div className="bg-stone-950/45 border border-stone-900/60 p-4 rounded-xl backdrop-blur-md">
            <h3 className="font-bold text-white uppercase tracking-wider mb-2 text-[#DC143C]">Interactive Controls</h3>
            <p className="text-neutral-400 font-light text-[11px] leading-relaxed">
              Drag to pan the viewport. Use mouse scroll wheel to zoom or use the top-right controls to adjust zoom and orientation.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
