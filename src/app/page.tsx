'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-stone-950 border border-stone-850 z-0">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#DC143C] mb-2" />
      <span className="text-stone-500 font-mono text-[10px] uppercase tracking-widest">Booting Cartography Engine...</span>
    </div>
  ),
});
import { useAuth } from '@clerk/nextjs';
import {
  Plus,
  Minus,
  Target,
  CloudSun,
  Navigation,
  Phone,
  MapPin,
  Sparkles,
  Activity,
} from 'lucide-react';
import { Card } from '@/components/ui/card';

// ── 1. Scroll Progress Bar (Top of Viewport) ──
// ── 2. Scroll Reveal Component (IntersectionObserver) ──
function ScrollReveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-1000 ease-out transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
        } ${className}`}
    >
      {children}
    </div>
  );
}

// ── 3. Cursor-Glow Card (Bento Cards) ──
interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}

function GlowCard({ children, className = '', glowColor = 'rgba(220, 20, 60, 0.12)' }: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative overflow-hidden bg-stone-950/80 border border-stone-900/60 p-8 flex flex-col justify-between transition-all duration-300 rounded-[12px] group hover:border-stone-800 ${className}`}
    >
      {isHovered && (
        <div
          className="absolute pointer-events-none transition-opacity duration-300 opacity-100 mix-blend-screen"
          style={{
            width: '280px',
            height: '280px',
            background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
            left: `${coords.x - 140}px`,
            top: `${coords.y - 140}px`,
          }}
        />
      )}
      <div className="relative z-10 w-full h-full flex flex-col justify-between">
        {children}
      </div>
    </div>
  );
}

// ── 4. Scroll-linked Vertical Progress Timeline ──
function ScrollTimeline() {
  const steps = [
    { num: '01', phase: 'SETUP', title: 'Create Lobby', desc: 'Initialize a group planning workspace in under 30 seconds and define the category profile parameters.', glow: 'rgba(220, 20, 60, 0.12)' },
    { num: '02', phase: 'SYNC', title: 'Distribute Link', desc: 'Share a unique 8-character invite code. Members enter coordinate pins and budgets privately.', glow: 'rgba(0, 229, 160, 0.12)' },
    { num: '03', phase: 'COMPUTE', title: 'Synthesize', desc: 'Ola Maps calculates travel times. AI layer compiles three tailored, narrative itinerary options.', glow: 'rgba(220, 20, 60, 0.12)' },
    { num: '04', phase: 'LOCK', title: 'Consensus', desc: 'Cast votes in the shared planner lobby. The winning plan is confirmed and locked automatically.', glow: 'rgba(0, 229, 160, 0.12)' },
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const totalDistance = rect.height;
      const scrolled = viewportHeight / 2 - rect.top;
      const pct = Math.min(Math.max(scrolled / totalDistance, 0), 1);
      setScrollProgress(pct);

      // Determine active step
      const stepElements = containerRef.current.querySelectorAll('.timeline-step');
      let minDiff = Infinity;
      let currentActive = 0;
      stepElements.forEach((el, index) => {
        const stepRect = el.getBoundingClientRect();
        const diff = Math.abs(stepRect.top + stepRect.height / 2 - viewportHeight / 2);
        if (diff < minDiff) {
          minDiff = diff;
          currentActive = index;
        }
      });
      setActiveStep(currentActive);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Trigger initially
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div ref={containerRef} className="relative max-w-4xl mx-auto pl-12 md:pl-20 py-10 space-y-16">
      {/* Vertical Connection Track */}
      <div className="absolute left-6 md:left-10 top-0 bottom-0 w-[2px] bg-stone-900">
        <div
          className="absolute top-0 w-full bg-gradient-to-b from-[#DC143C] to-[#00E5A0] transition-all duration-150 ease-out shadow-[0_0_8px_#DC143C]"
          style={{ height: `${scrollProgress * 100}%` }}
        />
      </div>

      {steps.map((step, idx) => {
        const isActive = idx <= activeStep;
        const isCurrent = idx === activeStep;
        return (
          <div
            key={step.num}
            className="timeline-step relative transition-all duration-500 transform text-left"
            style={{
              opacity: isCurrent ? 1 : isActive ? 0.85 : 0.4,
              transform: isCurrent ? 'translateX(0px)' : 'translateX(-4px)'
            }}
          >
            {/* Dot Node */}
            <div
              className={`absolute -left-[30px] md:-left-[46px] top-2.5 w-4 h-4 rounded-full bg-stone-950 border-2 transition-all duration-300 flex items-center justify-center ${isActive
                ? idx % 2 === 0 ? 'border-[#DC143C] scale-110' : 'border-[#00E5A0] scale-110'
                : 'border-stone-800'
                }`}
            >
              {isActive && (
                <span className={`w-1.5 h-1.5 rounded-full ${idx % 2 === 0 ? 'bg-[#DC143C]' : 'bg-[#00E5A0]'}`} />
              )}
            </div>

            {/* Glowing step card */}
            <GlowCard
              glowColor={step.glow}
              className={`p-6 md:p-8 bg-stone-950/45 border ${isCurrent
                ? idx % 2 === 0 ? 'border-[#DC143C]/30' : 'border-[#00E5A0]/30'
                : 'border-stone-900/30'
                } rounded-[12px]`}
            >
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider block transition-colors duration-300 ${isCurrent
                ? idx % 2 === 0 ? 'text-[#DC143C]' : 'text-[#00E5A0]'
                : 'text-neutral-500'
                }`}>
                {step.num} / {step.phase}
              </span>
              <h4 className="font-heading text-2xl text-white font-normal uppercase tracking-wide mt-2">{step.title}</h4>
              <p className="font-sans font-light text-neutral-400 text-sm leading-relaxed mt-3 max-w-2xl">{step.desc}</p>
            </GlowCard>
          </div>
        );
      })}
    </div>
  );
}

// ── 5. Venue Telemetry Type ──
interface VenuePin {
  id: string;
  name: string;
  place: string;
  category: string;
  lat: number;
  lng: number;
  mapX: number;
  mapY: number;
  num: string;
  address: string;
  phone: string;
  connections: string;
  description: string;
  image: string;
}

type VenueSeed = {
  name: string;
  place: string;
  address: string;
  lat: number;
  lng: number;
  description: string;
};

const CATEGORY_VENUES: Record<string, VenueSeed[]> = {
  Bowling: [
    { name: 'Smaaash Lower Parel', place: 'Lower Parel, Mumbai', address: 'Kamala Mills Compound, Senapati Bapat Marg', lat: 19.0034, lng: 72.8276, description: 'Bowling lanes, arcade play, and group-friendly dining inside a central mill district.' },
    { name: 'Timezone Inorbit Malad', place: 'Malad West, Mumbai', address: 'Inorbit Mall, Link Road', lat: 19.1731, lng: 72.8355, description: 'Bright bowling and arcade floor suited for casual friend groups.' },
    { name: 'Amoeba Sports Bar', place: 'Bandra West, Mumbai', address: 'Linking Road, Bandra West', lat: 19.0621, lng: 72.8345, description: 'Compact bowling setup near Bandra dining lanes and late-night cafes.' },
    { name: 'Hakone Entertainment Centre', place: 'Powai, Mumbai', address: 'Hiranandani Gardens, Powai', lat: 19.1191, lng: 72.9094, description: 'Bowling, karting, and indoor games for mixed activity plans.' },
    { name: 'The Game Palacio', place: 'Bandra Kurla Complex, Mumbai', address: 'BKC, Bandra East', lat: 19.0678, lng: 72.8672, description: 'Premium gaming venue with boutique bowling and food options.' },
    { name: 'Timezone Phoenix Marketcity', place: 'Kurla, Mumbai', address: 'Phoenix Marketcity, LBS Marg', lat: 19.0865, lng: 72.8897, description: 'Large mall entertainment floor with bowling-style games and arcades.' },
    { name: 'Shott Mumbai', place: 'Andheri West, Mumbai', address: 'Fun Republic Lane, Andheri West', lat: 19.1352, lng: 72.8311, description: 'Social gaming venue with bowling, pool, and party-ready seating.' },
    { name: 'Smaaash R City', place: 'Ghatkopar West, Mumbai', address: 'R City Mall, LBS Marg', lat: 19.0997, lng: 72.9169, description: 'Accessible central-suburban bowling and arcade hub.' },
    { name: 'Game Ranch', place: 'Thane West, Mumbai', address: 'Korum Mall, Eastern Express Highway', lat: 19.2054, lng: 72.9712, description: 'Group gaming stop for northern Mumbai and Thane meetups.' },
    { name: 'Namco Funscape', place: 'Vashi, Navi Mumbai', address: 'Inorbit Mall, Vashi', lat: 19.0651, lng: 72.9986, description: 'Family-friendly bowling and arcade option near the harbour side.' },
  ],
  Arcades: [
    { name: 'The Game Palacio', place: 'Bandra Kurla Complex, Mumbai', address: 'BKC, Bandra East', lat: 19.0678, lng: 72.8672, description: 'Upscale arcade games, bowling, and food in a polished group setting.' },
    { name: 'Smaaash Lower Parel', place: 'Lower Parel, Mumbai', address: 'Kamala Mills Compound', lat: 19.0034, lng: 72.8276, description: 'VR rides, cricket simulators, arcades, and bowling under one roof.' },
    { name: 'Timezone Oberoi Mall', place: 'Goregaon East, Mumbai', address: 'Oberoi Mall, Western Express Highway', lat: 19.1738, lng: 72.8607, description: 'Reliable arcade floor for competitive games and quick mall food.' },
    { name: 'Timezone Phoenix Marketcity', place: 'Kurla, Mumbai', address: 'Phoenix Marketcity, LBS Marg', lat: 19.0865, lng: 72.8897, description: 'Large arcade selection near cinemas and restaurants.' },
    { name: 'Timezone R City Mall', place: 'Ghatkopar West, Mumbai', address: 'R City Mall, LBS Marg', lat: 19.0997, lng: 72.9169, description: 'Central arcade pick with easy access from eastern suburbs.' },
    { name: 'Shott Mumbai', place: 'Andheri West, Mumbai', address: 'Fun Republic Lane', lat: 19.1352, lng: 72.8311, description: 'Games, bowling, and social challenges for energetic groups.' },
    { name: 'Amoeba Sports Bar', place: 'Bandra West, Mumbai', address: 'Linking Road', lat: 19.0621, lng: 72.8345, description: 'Classic arcade and bowling stop close to Bandra food streets.' },
    { name: 'Busters', place: 'Andheri West, Mumbai', address: 'Infiniti Mall, New Link Road', lat: 19.1413, lng: 72.8314, description: 'Arcade machines and quick games inside a busy mall circuit.' },
    { name: 'Funky Monkeys Play Center', place: 'Lower Parel, Mumbai', address: 'Palladium, High Street Phoenix', lat: 18.9942, lng: 72.8248, description: 'Good option for family outings with younger players.' },
    { name: 'Namco Funscape', place: 'Vashi, Navi Mumbai', address: 'Inorbit Mall, Vashi', lat: 19.0651, lng: 72.9986, description: 'Arcade and redemption games for Navi Mumbai meetups.' },
  ],
  Cafes: [
    { name: 'Subko Coffee', place: 'Bandra West, Mumbai', address: 'Chapel Road, Bandra West', lat: 19.0555, lng: 72.8292, description: 'Specialty coffee, baked goods, and a strong creative-neighborhood feel.' },
    { name: 'Blue Tokai Coffee Roasters', place: 'Mahalaxmi, Mumbai', address: 'Mahalaxmi, Mumbai', lat: 18.9827, lng: 72.8228, description: 'Reliable specialty coffee and quiet seating for pre-plan meetups.' },
    { name: 'Kala Ghoda Cafe', place: 'Fort, Mumbai', address: 'Ropewalk Lane, Kala Ghoda', lat: 18.9282, lng: 72.8324, description: 'Compact heritage cafe with easy access to museums and galleries.' },
    { name: 'Leaping Windows', place: 'Andheri West, Mumbai', address: 'Yari Road, Versova', lat: 19.1329, lng: 72.8147, description: 'Comic-book cafe with a relaxed basement library vibe.' },
    { name: 'Prithvi Cafe', place: 'Juhu, Mumbai', address: 'Prithvi Theatre, Juhu Church Road', lat: 19.1066, lng: 72.8258, description: 'Open-air cultural cafe attached to one of Mumbais beloved theatres.' },
    { name: 'Candies', place: 'Bandra West, Mumbai', address: 'Pali Hill, Bandra West', lat: 19.0627, lng: 72.8267, description: 'Layered terrace cafe good for low-pressure group conversations.' },
    { name: 'The Nutcracker', place: 'Kala Ghoda, Mumbai', address: 'Modern House, Dr VB Gandhi Marg', lat: 18.9297, lng: 72.8325, description: 'All-day cafe known for brunch plates and dessert-led plans.' },
    { name: 'Birdsong Organic Cafe', place: 'Bandra West, Mumbai', address: 'Waroda Road, Bandra West', lat: 19.0535, lng: 72.8286, description: 'Organic cafe with warm interiors and easy walking access.' },
    { name: 'Bastian Cafe', place: 'Bandra West, Mumbai', address: 'Linking Road, Bandra West', lat: 19.0632, lng: 72.8347, description: 'Polished cafe-dining stop for elevated casual plans.' },
    { name: 'Suzette Creperie', place: 'Nariman Point, Mumbai', address: 'Atlanta Building, Nariman Point', lat: 18.9254, lng: 72.8238, description: 'French-style crepes and coffee near the sea-facing business district.' },
  ],
  Garden: [
    { name: 'Hanging Gardens', place: 'Malabar Hill, Mumbai', address: 'Ridge Road, Malabar Hill', lat: 18.9567, lng: 72.8054, description: 'Terraced garden with sunset views over Marine Drive.' },
    { name: 'Priyadarshini Park', place: 'Napean Sea Road, Mumbai', address: 'Napean Sea Road', lat: 18.9612, lng: 72.7995, description: 'Sea-facing green space for breezy walks and low-cost plans.' },
    { name: 'Five Gardens', place: 'Dadar Parsi Colony, Mumbai', address: 'Dadar East', lat: 19.0191, lng: 72.8537, description: 'Leafy heritage garden cluster suited for quieter daytime meetups.' },
    { name: 'Horniman Circle Garden', place: 'Fort, Mumbai', address: 'Horniman Circle, Fort', lat: 18.9322, lng: 72.8347, description: 'Historic garden ring near cafes, galleries, and offices.' },
    { name: 'Joggers Park', place: 'Bandra West, Mumbai', address: 'Carter Road, Bandra West', lat: 19.0701, lng: 72.8224, description: 'Promenade-side garden for casual evening walks.' },
    { name: 'Powai Garden', place: 'Powai, Mumbai', address: 'Hiranandani Gardens', lat: 19.1197, lng: 72.9116, description: 'Planned green spaces close to Powai cafes and restaurants.' },
    { name: 'Maharashtra Nature Park', place: 'Dharavi, Mumbai', address: 'Near Sion-Bandra Link Road', lat: 19.0445, lng: 72.8547, description: 'Urban nature park with trails near the citys geographic middle.' },
    { name: 'Sanjay Gandhi National Park', place: 'Borivali East, Mumbai', address: 'Western Express Highway', lat: 19.2147, lng: 72.9106, description: 'Large forested park for outdoorsy groups and day plans.' },
    { name: 'Veermata Jijabai Bhosale Udyan', place: 'Byculla, Mumbai', address: 'Dr Babasaheb Ambedkar Road', lat: 18.979, lng: 72.8351, description: 'Historic botanical grounds next to the Bhau Daji Lad Museum.' },
    { name: 'Sagar Upvan', place: 'Colaba, Mumbai', address: 'Sassoon Dock, Colaba', lat: 18.9143, lng: 72.8234, description: 'Quiet botanical garden near the southern waterfront.' },
  ],
  Museums: [
    { name: 'CSMVS Museum', place: 'Kala Ghoda, Mumbai', address: 'Mahatma Gandhi Road, Fort', lat: 18.9269, lng: 72.8327, description: 'Major Indo-Saracenic museum covering art, sculpture, and history.' },
    { name: 'Dr Bhau Daji Lad Museum', place: 'Byculla, Mumbai', address: 'Jijamata Udyan, Byculla', lat: 18.979, lng: 72.8351, description: 'Mumbais oldest museum, excellent for culture-first itineraries.' },
    { name: 'National Gallery of Modern Art', place: 'Fort, Mumbai', address: 'Sir Cowasji Jehangir Public Hall', lat: 18.9258, lng: 72.8325, description: 'Modern and contemporary art in a heritage gallery building.' },
    { name: 'Mani Bhavan Gandhi Museum', place: 'Gamdevi, Mumbai', address: 'Laburnum Road, Gamdevi', lat: 18.9596, lng: 72.8117, description: 'Historic Gandhi residence with archives and intimate exhibits.' },
    { name: 'RBI Monetary Museum', place: 'Fort, Mumbai', address: 'Amar Building, Sir PM Road', lat: 18.9326, lng: 72.8361, description: 'Compact museum for currency, banking, and finance history.' },
    { name: 'Nehru Science Centre', place: 'Worli, Mumbai', address: 'Dr E Moses Road, Worli', lat: 18.9908, lng: 72.8174, description: 'Interactive science exhibits for families and curious groups.' },
    { name: 'Bandra-Worli Sea Link View Gallery', place: 'Bandra Reclamation, Mumbai', address: 'Bandra Reclamation Promenade', lat: 19.0467, lng: 72.8193, description: 'Infrastructure-view stop that pairs well with seaside walks.' },
    { name: 'BEST Transport Museum', place: 'Wadala, Mumbai', address: 'Anik Depot, Wadala', lat: 19.0265, lng: 72.8768, description: 'Transit-history museum for transport and city-planning fans.' },
    { name: 'Bhau Daji Lad Special Exhibits', place: 'Byculla, Mumbai', address: 'Rani Baug, Byculla', lat: 18.9789, lng: 72.835, description: 'Rotating exhibits in a restored Victorian museum interior.' },
    { name: 'CST Heritage Gallery', place: 'Fort, Mumbai', address: 'Chhatrapati Shivaji Maharaj Terminus', lat: 18.9402, lng: 72.8356, description: 'Railway heritage and architecture inside a UNESCO precinct.' },
  ],
  Beaches: [
    { name: 'Juhu Beach', place: 'Juhu, Mumbai', address: 'Juhu Tara Road', lat: 19.0988, lng: 72.8267, description: 'Classic beach hangout with street food and sunset walks.' },
    { name: 'Girgaum Chowpatty', place: 'Marine Drive, Mumbai', address: 'Queens Necklace, Girgaum', lat: 18.9543, lng: 72.8121, description: 'Central seaside stop for snacks and skyline views.' },
    { name: 'Versova Beach', place: 'Andheri West, Mumbai', address: 'Versova, Andheri West', lat: 19.1351, lng: 72.8119, description: 'Longer shoreline near cafes and creative neighborhoods.' },
    { name: 'Aksa Beach', place: 'Malad West, Mumbai', address: 'Aksa Village, Malad West', lat: 19.175, lng: 72.7956, description: 'Wide beach option for relaxed day trips from the suburbs.' },
    { name: 'Madh Island Beach', place: 'Madh, Mumbai', address: 'Madh Island', lat: 19.1477, lng: 72.7958, description: 'Quieter coastal stretch suited for slower plans.' },
    { name: 'Gorai Beach', place: 'Borivali West, Mumbai', address: 'Gorai, Borivali West', lat: 19.2317, lng: 72.7822, description: 'Northern beach outing often paired with ferry rides.' },
    { name: 'Marve Beach', place: 'Malad West, Mumbai', address: 'Marve Road', lat: 19.1862, lng: 72.7829, description: 'Suburban beach with access toward Manori and Gorai.' },
    { name: 'Dadar Chowpatty', place: 'Dadar West, Mumbai', address: 'Shivaji Park seafront', lat: 19.019, lng: 72.8122, description: 'Convenient central beach walk near Shivaji Park.' },
    { name: 'Worli Sea Face', place: 'Worli, Mumbai', address: 'Worli Sea Face Promenade', lat: 19.0169, lng: 72.8174, description: 'Windy promenade and sea-link views for quick meetups.' },
    { name: 'Carter Road Promenade', place: 'Bandra West, Mumbai', address: 'Carter Road, Bandra West', lat: 19.0705, lng: 72.8223, description: 'Rocky seafront promenade with cafes nearby.' },
  ],
  Restaurants: [
    { name: 'The Bombay Canteen', place: 'Lower Parel, Mumbai', address: 'Kamala Mills, Lower Parel', lat: 19.0024, lng: 72.8285, description: 'Inventive Indian plates and a polished group-dining room.' },
    { name: 'Trishna', place: 'Kala Ghoda, Mumbai', address: 'Sai Baba Marg, Fort', lat: 18.9301, lng: 72.833, description: 'Famous seafood restaurant known for crab and coastal dishes.' },
    { name: 'Britannia and Co.', place: 'Ballard Estate, Mumbai', address: 'Wakefield House, Ballard Estate', lat: 18.9346, lng: 72.8407, description: 'Historic Parsi restaurant with old-Bombay character.' },
    { name: 'Khyber', place: 'Fort, Mumbai', address: 'Mahatma Gandhi Road, Kala Ghoda', lat: 18.9287, lng: 72.8321, description: 'North Indian dining in a heritage art district.' },
    { name: 'Bademiya', place: 'Colaba, Mumbai', address: 'Tulloch Road, Colaba', lat: 18.9236, lng: 72.8328, description: 'Late-night kebab institution for casual groups.' },
    { name: 'Masque', place: 'Mahalaxmi, Mumbai', address: 'Laxmi Woollen Mill, Mahalaxmi', lat: 18.9829, lng: 72.8242, description: 'Modern tasting-menu restaurant for premium plans.' },
    { name: 'O Pedro', place: 'BKC, Mumbai', address: 'Jet Airways Godrej BKC, Bandra East', lat: 19.0663, lng: 72.8671, description: 'Goan-inspired food and cocktails in a lively central hub.' },
    { name: 'Yauatcha', place: 'BKC, Mumbai', address: 'Raheja Tower, Bandra Kurla Complex', lat: 19.0609, lng: 72.8626, description: 'Dim sum and tea-house dining for refined group meals.' },
    { name: 'Leopold Cafe', place: 'Colaba, Mumbai', address: 'Colaba Causeway', lat: 18.9226, lng: 72.8317, description: 'Iconic casual restaurant on the Colaba walking circuit.' },
    { name: 'Cafe Madras', place: 'Matunga East, Mumbai', address: 'Bhaudaji Road, Matunga', lat: 19.0278, lng: 72.8554, description: 'Legendary South Indian breakfast and filter coffee spot.' },
  ],
  'Sport Centers': [
    { name: 'NSCI Dome', place: 'Worli, Mumbai', address: 'Lala Lajpatrai Marg, Worli', lat: 19.012, lng: 72.846, description: 'Indoor sports and events complex close to central Mumbai.' },
    { name: 'Bandra Gymkhana', place: 'Bandra West, Mumbai', address: 'St Andrews Road, Bandra West', lat: 19.0585, lng: 72.8315, description: 'Historic club with courts and social sports facilities.' },
    { name: 'Khar Gymkhana', place: 'Khar West, Mumbai', address: '13th Road, Khar West', lat: 19.0716, lng: 72.8343, description: 'Neighborhood club with racquet sports and swimming.' },
    { name: 'Wankhede Stadium', place: 'Churchgate, Mumbai', address: 'D Road, Churchgate', lat: 18.9288, lng: 72.8258, description: 'Iconic cricket venue near Marine Drive and Churchgate.' },
    { name: 'Brabourne Stadium', place: 'Churchgate, Mumbai', address: 'Veer Nariman Road', lat: 18.9322, lng: 72.824, description: 'Classic sports ground and club near the south Mumbai core.' },
    { name: 'Andheri Sports Complex', place: 'Andheri West, Mumbai', address: 'JP Road, Andheri West', lat: 19.1292, lng: 72.8374, description: 'Large public sports complex with track and indoor facilities.' },
    { name: 'Juhu Vile Parle Gymkhana', place: 'Juhu, Mumbai', address: 'Juhu Scheme, Vile Parle West', lat: 19.1074, lng: 72.8378, description: 'Suburban club with sports courts and social spaces.' },
    { name: 'MIG Cricket Club', place: 'Bandra East, Mumbai', address: 'Gandhi Nagar, Bandra East', lat: 19.0612, lng: 72.8497, description: 'Cricket-focused club near BKC and Bandra East.' },
    { name: 'Priyadarshini Park Track', place: 'Napean Sea Road, Mumbai', address: 'Priyadarshini Park', lat: 18.9612, lng: 72.7995, description: 'Outdoor track and sports-friendly green space by the sea.' },
    { name: 'Goregaon Sports Club', place: 'Malad West, Mumbai', address: 'Link Road, Malad West', lat: 19.1783, lng: 72.8386, description: 'Large club facility for northern suburban meetups.' },
  ],
};

const CATEGORY_IMAGES = ['/images/cafe_active.png', '/images/cafe_2.png', '/images/cafe_1.png'];

const ALL_VENUE_PINS: VenuePin[] = Object.entries(CATEGORY_VENUES).flatMap(([category, venues]) =>
  venues.map((venue, index) => ({
    ...venue,
    id: category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + String(index + 1).padStart(2, '0'),
    category,
    mapX: 640 + index * 12,
    mapY: 300 + index * 18,
    num: String(index + 1).padStart(2, '0'),
    phone: 'Listing varies',
    connections: 'Mumbai transit // dynamic',
    image: CATEGORY_IMAGES[index % CATEGORY_IMAGES.length],
  }))
);

const CATEGORIES = [
  'Bowling',
  'Arcades',
  'Cafes',
  'Garden',
  'Museums',
  'Beaches',
  'Restaurants',
  'Sport Centers',
];

export default function HomePage() {
  const { isSignedIn } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>('Cafes');
  const [selectedPinId, setSelectedPinId] = useState<string>('cafes-01');
  const [currentDateTime, setCurrentDateTime] = useState<{ date: string; time: string } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; windSpeed: number; windDirection: string } | null>(null);

  // Map zoom and center states (Centered on Mumbai)
  const [mapCenter, setMapCenter] = useState<[number, number]>([72.895, 19.076]);
  const [mapZoom, setMapZoom] = useState<number>(11);

  // Filter spots belonging to the currently active category
  const filteredPins = useMemo(() => {
    return ALL_VENUE_PINS.filter((pin) => pin.category === activeCategory);
  }, [activeCategory]);

  // Handle auto-switching of selected pin when category shifts
  useEffect(() => {
    if (filteredPins.length > 0) {
      const isAlreadySelected = filteredPins.some((p) => p.id === selectedPinId);
      if (!isAlreadySelected) {
        setSelectedPinId(filteredPins[0].id);
      }
    }
  }, [activeCategory, filteredPins, selectedPinId]);

  const activeVenue = useMemo(() => {
    return ALL_VENUE_PINS.find((v) => v.id === selectedPinId) || filteredPins[0] || ALL_VENUE_PINS[0];
  }, [selectedPinId, filteredPins]);

  // Synchronize map center and zoom when the active venue changes
  useEffect(() => {
    if (activeVenue) {
      setMapCenter([activeVenue.lng, activeVenue.lat]);
      setMapZoom(13.5);
    }
  }, [activeVenue?.id]);

  // Carousel options: display only inactive spots in active category
  const carouselVenues = useMemo(() => {
    return filteredPins.filter((v) => v.id !== selectedPinId);
  }, [filteredPins, selectedPinId]);

  const mapMarkers = useMemo(() => {
    return filteredPins.map(pin => ({
      id: pin.id,
      lngLat: [pin.lng, pin.lat] as [number, number],
      popupText: pin.name,
      isActive: pin.id === selectedPinId
    }));
  }, [filteredPins, selectedPinId]);

  const handleZoomIn = () => {
    setMapZoom((z) => Math.min(18, z + 1));
  };

  const handleZoomOut = () => {
    setMapZoom((z) => Math.max(9, z - 1));
  };

  const handleRecenter = () => {
    setMapCenter([72.895, 19.076]);
    setMapZoom(11);
  };

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentDateTime({
        date: new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }).format(now),
        time: new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(now),
      });
    };

    updateDateTime();
    const timer = window.setInterval(updateDateTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchWeather() {
      try {
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=19.076&longitude=72.8777&current=temperature_2m,wind_speed_10m,wind_direction_10m&timezone=Asia%2FKolkata');
        if (!response.ok) return;
        const data = await response.json();
        if (!isMounted || !data?.current) return;

        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const directionIndex = Math.round((Number(data.current.wind_direction_10m || 0) % 360) / 45) % directions.length;
        setWeather({
          temp: Math.round(Number(data.current.temperature_2m)),
          windSpeed: Math.round(Number(data.current.wind_speed_10m)),
          windDirection: directions[directionIndex],
        });
      } catch {
        // Keep the telemetry widget readable if live weather is blocked.
      }
    }

    fetchWeather();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0C] text-foreground font-sans selection:bg-[#DC143C]/20 selection:text-[#DC143C]">

      {/* ── SECTION 1: FULL VIEWPORT INTERACTIVE MAP CONSOLE ── */}
      <section className="h-screen w-screen relative overflow-hidden bg-[#0D0A08] border-b border-stone-900/60 z-20">

        {/* Full-Bleed Map Canvas */}
        <Map
          center={mapCenter}
          zoom={mapZoom}
          height="100%"
          width="100%"
          markers={mapMarkers}
          onMarkerClick={setSelectedPinId}
          className="z-0"
        />

        {/* Viewport Overlay Vignette Layer */}
        <div className="absolute inset-0 pointer-events-none z-10 bg-radial-vignette opacity-50" />

        {/* HUD Info Helper Top Right */}
        <div className="absolute top-24 right-12 z-20 font-mono text-[9px] text-neutral-400 tracking-wider bg-stone-950/60 backdrop-blur-md px-3 py-1.5 border border-stone-900/60 pointer-events-none select-none hidden sm:block">
          DRAG TO PAN // MOUSE WHEEL TO ZOOM
        </div>

        <header className="absolute top-0 left-0 w-full z-20 px-4 py-6 sm:px-8 lg:px-12 lg:py-8 flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-3.5">
            <Link href="/">
              <div className="text-left leading-none">
                <h1 className="font-campus text-[16px] font-extrabold tracking-[0.1em] text-white uppercase leading-none">HANG<span className="text-[#DC143C] font-serif-display lowercase italic font-normal">out</span></h1>
              </div>
            </Link>
          </div>

          {/* Centered horizontal navigation */}
          <nav className="hidden md:flex items-center gap-10 lg:gap-14 font-campus text-[11px] font-medium tracking-[0.22em] text-neutral-300 select-none uppercase absolute left-1/2 -translate-x-1/2">
            <Link href="#about" className="hover:text-white transition-colors duration-200">About</Link>
            <Link href="#features" className="hover:text-white transition-colors duration-200">Bento Features</Link>
            <Link href="#steps" className="hover:text-white transition-colors duration-200">Protocols</Link>
          </nav>

          <div className="hidden md:flex items-center">
            {isSignedIn ? (
              <Link href="/groups" className="px-5 py-2.5 bg-gradient-to-r from-[#DC143C] to-[#FB7185] hover:from-[#E11D48] hover:to-[#F43F5E] text-black font-mono font-bold text-[10px] tracking-[0.1em] transition-all duration-300 rounded-[8px] hover:scale-105 active:scale-95 shadow-md flex items-center">
                Go to Lobby
              </Link>
            ) : (
              <Link href="/sign-up" className="px-5 py-2.5 bg-gradient-to-r from-[#DC143C] to-[#FB7185] hover:from-[#E11D48] hover:to-[#F43F5E] text-black font-mono font-bold text-[10px] tracking-[0.1em] transition-all duration-300 rounded-[8px] hover:scale-105 active:scale-95 shadow-md flex items-center">
                Start Hangout
              </Link>
            )}
          </div>
        </header>

        {/* Left Side Category Rail */}
        <aside className="absolute left-6 sm:left-8 lg:left-20 xl:left-24 top-[85px] lg:top-[28%] z-20 flex flex-row items-stretch pointer-events-auto select-none lg:h-[420px]">
          {/* Sidebar vertical rail */}
          <div className="hidden lg:flex flex-col gap-28 items-center mr-10 border-r border-stone-800/40 pr-8 justify-center">
            <span className="transform -rotate-90 origin-center whitespace-nowrap text-[9px] tracking-[0.35em] font-mono text-neutral-500 uppercase">• .</span>
            <span className="transform -rotate-90 origin-center whitespace-nowrap text-[9px] tracking-[0.35em] font-mono text-neutral-500 uppercase">• .</span>
          </div>
          {/* Categories Selector */}
          <div className="flex flex-row lg:flex-col items-center lg:items-start justify-start lg:justify-center gap-4 text-left overflow-x-auto w-full no-scrollbar pb-2 lg:pb-0">
            {CATEGORIES.map((cat) => {
              const isActive = cat === activeCategory;
              const categoryCount = CATEGORY_VENUES[cat]?.length || 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`text-left transition-all duration-300 relative group cursor-pointer block focus:outline-none whitespace-nowrap ${isActive ? 'text-white py-1 font-bold' : 'text-neutral-500 hover:text-neutral-300 tracking-wider py-1 font-campus text-xs'}`}
                >
                  {isActive ? (
                    <span className="font-serif-display text-2xl lg:text-5xl font-normal tracking-tight relative block leading-none">
                      {cat} <span className="text-sm lg:text-xl font-light align-top text-neutral-400 -ml-1">({categoryCount})</span>
                    </span>
                  ) : (
                    <span className="font-campus text-xs lg:text-sm">{cat}</span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Bottom-Left Telemetry / Weather Widget */}
        <footer className="hidden lg:flex absolute bottom-10 left-12 z-20 pointer-events-auto select-none items-center gap-10 bg-stone-950/60 backdrop-blur-md px-6 py-4 border border-stone-900/60 shadow-lg rounded-[12px]">
          <div className="flex items-center gap-4">
            <CloudSun className="w-9 h-9 text-[#DC143C]" />
            <div className="flex items-start gap-1">
              <span className="font-sans text-[38px] font-light text-white leading-none">{weather ? `${weather.temp}\u00b0` : '--\u00b0'}</span>
              <div className="text-[8px] font-mono text-neutral-500 uppercase tracking-widest leading-tight">
                <div>{weather?.windDirection || 'LIVE'}</div>
                <div>{weather ? `${weather.windSpeed} km/h` : 'loading'}</div>
              </div>
            </div>
          </div>
          <div className="text-left font-mono text-[9px] text-neutral-400 tracking-wider leading-relaxed">
            <div>{currentDateTime?.date || 'Loading date'}</div>
            <div className="text-neutral-600 mt-0.5">{currentDateTime?.time || 'Loading time'}</div>
          </div>
          <div className="w-[1px] h-8 bg-stone-800" />
          <div className="text-left font-mono text-[9px] tracking-widest uppercase leading-relaxed">
            <div className="text-neutral-500">Spots</div>
            <div className="text-[#00E5A0] font-bold">{filteredPins.length} / {CATEGORY_VENUES[activeCategory]?.length || filteredPins.length}</div>
          </div>
        </footer>

        {/* Right Selected Pins Carousel */}
        <div className="absolute top-[116px] right-4 lg:right-12 z-20 flex max-h-[calc(100vh-330px)] flex-col gap-3.5 overflow-y-auto pr-1 pointer-events-auto sm:w-[320px] py-1 items-stretch">
          {carouselVenues.map((venue) => (
            <button
              key={venue.id}
              type="button"
              onClick={() => setSelectedPinId(venue.id)}
              className="flex items-center gap-4 px-5 py-3.5 border border-stone-850 bg-stone-950/90 backdrop-blur-md text-left transition-all duration-300 cursor-pointer hover:border-[#00E5A0]/40 hover:bg-stone-900/90 opacity-85 hover:opacity-100 hover:scale-[1.02] rounded-[12px] w-full"
            >
              <div className="relative w-10 h-10 flex-shrink-0">
                <img src={venue.image} alt={venue.name} className="w-full h-full rounded-full object-cover grayscale border-2 border-[#00E5A0]" />
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[8.5px] font-mono font-bold bg-[#18392B] text-[#00E5A0] border-2 border-[#00E5A0]">{venue.num}</span>
              </div>
              <div className="space-y-1 flex-1 min-w-0">
                <p className="font-campus text-[10px] font-bold text-white uppercase tracking-wider leading-none truncate">{venue.name}</p>
                <p className="font-mono text-[8px] text-neutral-400 leading-none truncate">{venue.address}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Bottom-Center Map Controls */}
        <div className="absolute bottom-4 lg:bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-row gap-3 pointer-events-auto items-center bg-stone-950/70 backdrop-blur-md px-4 py-2 border border-stone-850 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          <button type="button" onClick={handleRecenter} title="Recenter Map Viewport" className="w-10 h-10 rounded-full bg-white hover:bg-neutral-100 text-neutral-900 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer focus:outline-none border border-neutral-300">
            <MapPin className="w-4.5 h-4.5" />
          </button>
          <button type="button" onClick={handleRecenter} title="Recenter" className="w-10 h-10 bg-[#DC143C] hover:bg-[#B80F2E] text-white flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer focus:outline-none rounded-[8px]">
            <Target className="w-4.5 h-4.5" />
          </button>
          <button type="button" onClick={handleZoomIn} title="Zoom In" className="w-10 h-10 bg-white hover:bg-neutral-100 text-neutral-900 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer font-bold text-lg focus:outline-none rounded-[8px]">
            <Plus className="w-4.5 h-4.5" />
          </button>
          <button type="button" onClick={handleZoomOut} title="Zoom Out" className="w-10 h-10 bg-white hover:bg-neutral-100 text-neutral-900 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer font-bold text-lg focus:outline-none rounded-[8px]">
            <Minus className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Bottom-Right Selected Venue Details Card */}
        <div className="absolute bottom-[140px] sm:bottom-20 lg:bottom-24 right-4 left-4 sm:left-auto sm:right-12 z-20 pointer-events-auto flex justify-center lg:justify-end">
          {activeVenue && (
            <Card className="p-3 bg-stone-950/95 border border-stone-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.85)] flex flex-col justify-between w-full sm:w-[380px] h-[140px] sm:h-[145px] backdrop-blur-md rounded-[12px] text-left">
              <div className="flex gap-3 items-start">
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-[8px] overflow-hidden flex-shrink-0 border border-stone-800">
                  <img src={activeVenue.image} alt={activeVenue.name} className="w-full h-full object-cover grayscale opacity-85" />
                  <div className="absolute inset-0 bg-[#DC143C]/10 mix-blend-color" />
                </div>
                <div className="space-y-0.5 flex-1 min-w-0">
                  <span className="font-mono text-[6.5px] sm:text-[7px] text-[#DC143C] tracking-[0.25em] uppercase font-bold">SELECTED MIDPOINT JUNCTION</span>
                  <h3 className="font-campus text-sm sm:text-base font-bold text-white tracking-wide leading-tight mt-0.5 truncate">{activeVenue.name}</h3>
                  <p className="text-[8px] sm:text-[8.5px] text-neutral-400 font-mono leading-none tracking-wider uppercase mt-1 truncate">{activeVenue.address}, {activeVenue.place}</p>
                  <div className="flex items-center gap-3 text-[8px] sm:text-[8.5px] font-mono text-neutral-400 mt-1.5">
                    <span className="flex items-center gap-1 sm:gap-1.5">
                      <Navigation className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#DC143C] transform rotate-45" />
                      <span className="truncate max-w-[95px]">{activeVenue.connections}</span>
                    </span>
                    <span className="flex items-center gap-1 sm:gap-1.5">
                      <Phone className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#DC143C]" />
                      <span>{activeVenue.phone}</span>
                    </span>
                  </div>
                </div>
              </div>
              <Link href={isSignedIn ? '/groups' : '/sign-up'} passHref className="w-full mt-2">
                <button type="button" className="w-full py-1.5 sm:py-2 bg-[#FBEBE2] hover:bg-[#F2D6C5] text-[#1E1511] font-mono text-[8px] sm:text-[8.5px] font-bold uppercase tracking-[0.25em] hover:tracking-[0.28em] transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] rounded-[6px]">
                  Get More Information
                </button>
              </Link>
            </Card>
          )}
        </div>

        {/* Map scale indicator */}
        <div className="absolute right-12 bottom-10 z-20 font-mono text-[8.5px] text-neutral-500 flex flex-col items-end pointer-events-none select-none">
          <span>1,000 ft</span>
          <div className="w-16 h-[5px] border-x border-b border-neutral-600 my-0.5" />
          <span>100 m</span>
        </div>

      </section>


      {/* ── SECTION 2: THE CORE COORDINATION TECHNOLOGY (BENTO GRID WITH GLOW) ── */}
      <section id="about" className="bg-[#0A0A0C] py-24 md:py-32 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#DC143C]/5 rounded-full filter blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#00E5A0]/2 rounded-full filter blur-[100px] pointer-events-none" />

        <div className="mx-auto max-w-7xl px-8 relative z-10" id="features">
          <ScrollReveal className="text-center max-w-3xl mx-auto mb-20 space-y-4">
            <span className="inline-block text-xs font-bold uppercase tracking-widest text-[#DC143C] font-mono">
              [ COORDINATION PLATFORM ARCHITECTURE ]
            </span>
            <h2 className="font-heading text-4xl sm:text-6xl text-white font-normal leading-tight italic">
              Resolving the friction of group coordination
            </h2>
            <p className="text-sm font-light text-neutral-400 leading-relaxed font-sans max-w-2xl mx-auto pt-2">
              Hangoutt automates spatial coordinate geography, privacy budget ceilings, and dining preferences. No endless messaging chains. Just optimal consensus itineraries compiled instantly.
            </p>
          </ScrollReveal>

          {/* Bento Grid using GlowCard */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {/* Card 1 */}
            <ScrollReveal>
              <GlowCard glowColor="rgba(220, 20, 60, 0.15)" className="h-full">
                <div className="absolute top-4 right-4 font-mono text-[9px] text-[#DC143C]/30 tracking-widest">PROTO_01</div>
                <div>
                  <div className="w-10 h-10 rounded-lg bg-[#DC143C]/10 border border-[#DC143C]/30 flex items-center justify-center mb-6">
                    <Navigation className="w-5 h-5 text-[#DC143C] transform rotate-45" />
                  </div>
                  <h3 className="font-heading text-2xl text-white font-normal mb-3 uppercase tracking-wide">
                    Fair travel midpoints
                  </h3>
                  <p className="font-sans font-light text-neutral-400 text-sm leading-relaxed">
                    Computes geographic coordinate centroids that minimize travel times. The participant living farthest away is no longer forced to bear all the commute burdens.
                  </p>
                </div>
                <div className="mt-8 border-t border-stone-900/60 pt-4 flex items-center justify-between text-[10px] font-mono text-neutral-500">
                  <span>METRIC: TRAVEL AVERAGES</span>
                  <span className="text-[#DC143C] group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </GlowCard>
            </ScrollReveal>

            {/* Card 2 */}
            <ScrollReveal>
              <GlowCard glowColor="rgba(0, 229, 160, 0.15)" className="h-full border-secondary/20">
                <div className="absolute top-4 right-4 font-mono text-[9px] text-[#00E5A0]/30 tracking-widest">PROTO_02</div>
                <div>
                  <div className="w-10 h-10 rounded-lg bg-[#00E5A0]/10 border border-[#00E5A0]/30 flex items-center justify-center mb-6">
                    <Activity className="w-5 h-5 text-[#00E5A0]" />
                  </div>
                  <h3 className="font-heading text-2xl text-white font-normal mb-3 uppercase tracking-wide">
                    Zero-disclosure limits
                  </h3>
                  <p className="font-sans font-light text-neutral-400 text-sm leading-relaxed">
                    Individual budgets and start coordinates are kept completely private. Only derived averages and lowest-common-denominator caps are passed to recommend options.
                  </p>
                </div>
                <div className="mt-8 border-t border-stone-900/60 pt-4 flex items-center justify-between text-[10px] font-mono text-neutral-500">
                  <span>SECURITY: ENVELOPE SYNC</span>
                  <span className="text-[#00E5A0] group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </GlowCard>
            </ScrollReveal>

            {/* Card 3 */}
            <ScrollReveal>
              <GlowCard glowColor="rgba(220, 20, 60, 0.15)" className="h-full">
                <div className="absolute top-4 right-4 font-mono text-[9px] text-[#DC143C]/30 tracking-widest">PROTO_03</div>
                <div>
                  <div className="w-10 h-10 rounded-lg bg-[#DC143C]/10 border border-[#DC143C]/30 flex items-center justify-center mb-6">
                    <Sparkles className="w-5 h-5 text-[#DC143C]" />
                  </div>
                  <h3 className="font-heading text-2xl text-white font-normal mb-3 uppercase tracking-wide">
                    Itinerary compiler
                  </h3>
                  <p className="font-sans font-light text-neutral-400 text-sm leading-relaxed">
                    Instead of random restaurant listings, venues are processed through our planner layer to generate 3 narrative options. Group members vote in real-time.
                  </p>
                </div>
                <div className="mt-8 border-t border-stone-900/60 pt-4 flex items-center justify-between text-[10px] font-mono text-neutral-500">
                  <span>SYSTEM: COMPILER CORES</span>
                  <span className="text-[#DC143C] group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </GlowCard>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: THE PROTOCOL TIMELINE (SCROLL PROGRESS CONNECTOR) ── */}
      <section id="steps" className="bg-[#0D0D10] py-24 md:py-32 border-t border-stone-900/60 relative">
        <div className="mx-auto max-w-7xl px-8">
          <ScrollReveal className="text-center max-w-3xl mx-auto mb-16 space-y-3">
            <span className="inline-block text-xs font-bold uppercase tracking-widest text-[#00E5A0] font-mono">
              [ EXECUTION PROTOCOLS ]
            </span>
            <h2 className="font-heading text-4xl sm:text-5xl text-white font-normal leading-tight italic">
              How the platform operates
            </h2>
            <p className="text-xs font-mono text-neutral-500 uppercase tracking-widest mt-2">
              Scroll to advance the synchronization sequence
            </p>
          </ScrollReveal>

          {/* Interactive Timeline Component */}
          <ScrollTimeline />
        </div>
      </section>

      {/* ── SECTION 4: CALL TO ACTION EDITORIAL ── */}
      <section id="cta" className="relative py-32 border-t border-stone-900/60 overflow-hidden bg-black text-center">
        <div className="absolute inset-0 z-0">
          {/* Subtle grid accent overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:40px_40px] opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0C] via-transparent to-[#0A0A0C] z-10" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto px-8 space-y-10">
          <ScrollReveal className="space-y-4">
            <span className="inline-block text-xs font-mono font-bold uppercase tracking-widest text-[#DC143C]">
              [ LAUNCH INITIALIZATION ]
            </span>
            <h2 className="font-heading text-5xl sm:text-7xl text-white font-normal italic leading-none">
              Ready for the night?
            </h2>
            <p className="text-sm font-light text-neutral-400 max-w-xl mx-auto pt-2 font-sans">
              Connect your friends, coordinate coordinate maps, and let Hangoutt compile your most optimal outing expedition.
            </p>
          </ScrollReveal>

          <ScrollReveal>
            {isSignedIn ? (
              <Link href="/groups" passHref>
                <button
                  type="button"
                  className="px-14 py-6 bg-gradient-to-r from-[#DC143C] to-[#FB7185] hover:from-[#E11D48] hover:to-[#F43F5E] text-black font-mono font-bold text-xs uppercase tracking-[0.25em] transition-all hover:scale-105 active:scale-95 duration-300 cursor-pointer shadow-lg rounded-[8px]"
                >
                  Go to lobbies
                </button>
              </Link>
            ) : (
              <Link href="/sign-up" passHref>
                <button
                  type="button"
                  className="px-14 py-6 bg-gradient-to-r from-[#DC143C] to-[#FB7185] hover:from-[#E11D48] hover:to-[#F43F5E] text-black font-mono font-bold text-xs uppercase tracking-[0.25em] transition-all hover:scale-105 active:scale-95 duration-300 cursor-pointer shadow-lg rounded-[8px]"
                >
                  START A HANGOUT
                </button>
              </Link>
            )}
          </ScrollReveal>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-[#070709] py-16 border-t border-stone-950 text-xs text-neutral-500 font-mono">
        <div className="max-w-7xl mx-auto px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="md:col-span-2 space-y-4">
              <span className="font-campus text-2xl text-white block leading-none uppercase">HANG<span className="text-[#DC143C] font-serif-display lowercase italic font-normal">out</span></span>
              <p className="text-neutral-500 text-[10px] tracking-wider max-w-sm">
                AI COORDINATION PLATFORM 4.0 // ENGINEERED FOR THE METROPOLIS THAT NEVER SLEEPS.
              </p>
            </div>
            <div>
              <h4 className="text-[10px] text-white uppercase mb-4 tracking-widest border-b border-stone-900 pb-2">Protocols</h4>
              <ul className="space-y-2.5 text-[10px]">
                <li><Link href="#about" className="hover:text-white transition-colors">Venue Discovery</Link></li>
                <li><Link href="#steps" className="hover:text-white transition-colors">Transit Intelligence</Link></li>
                <li><Link href="#cta" className="hover:text-white transition-colors">Group Consensus</Link></li>
                <li><Link href="/map" className="text-[#DC143C] hover:text-[#00E5A0] font-bold transition-colors">Live Map</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] text-white uppercase mb-4 tracking-widest border-b border-stone-900 pb-2">HQ</h4>
              <ul className="space-y-2.5 text-[10px]">
                <li className="text-neutral-500 uppercase">Bandra West, Mumbai</li>
                <li className="text-neutral-600 font-sans">© {new Date().getFullYear()} Hangoutt Technologies Pvt. Ltd.</li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-stone-900/60 flex flex-col md:flex-row justify-between items-center gap-4 text-[9px] text-neutral-600">
            <div className="flex gap-6">
              <span>PRIVACY_ENVELOPE_V4</span>
              <span>TERMS_OF_SERVICE</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00E5A0] animate-pulse shadow-[0_0_8px_#00E5A0]" />
              <span className="uppercase text-[9px] tracking-wider text-neutral-400">PLANNING PROTOCOLS OPERATIONAL</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
