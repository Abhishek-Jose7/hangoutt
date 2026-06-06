'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-stone-950 border border-stone-850 z-0">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#EB690B] mb-2" />
      <span className="text-stone-500 font-mono text-[10px] uppercase tracking-widest">Booting Cartography Engine...</span>
    </div>
  ),
});
import { useAuth } from '@clerk/nextjs';
import {
  Plus,
  Minus,
  Search,
  Menu,
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
function ScrollProgressBar() {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = totalHeight > 0 ? (window.scrollY / totalHeight) * 100 : 0;
      setWidth(pct);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="fixed top-0 left-0 w-full h-[3px] bg-stone-950 z-[100] pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-[#EB690B] via-[#fbbf24] to-[#00E5A0] shadow-[0_0_8px_#EB690B] transition-all duration-100 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

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

function GlowCard({ children, className = '', glowColor = 'rgba(235, 105, 11, 0.12)' }: GlowCardProps) {
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
    { num: '01', phase: 'SETUP', title: 'Create Lobby', desc: 'Initialize a group planning workspace in under 30 seconds and define the category profile parameters.', glow: 'rgba(235, 105, 11, 0.12)' },
    { num: '02', phase: 'SYNC', title: 'Distribute Link', desc: 'Share a unique 8-character invite code. Members enter coordinate pins and budgets privately.', glow: 'rgba(0, 229, 160, 0.12)' },
    { num: '03', phase: 'COMPUTE', title: 'Synthesize', desc: 'Ola Maps calculates travel times. AI layer compiles three tailored, narrative itinerary options.', glow: 'rgba(235, 105, 11, 0.12)' },
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
          className="absolute top-0 w-full bg-gradient-to-b from-[#EB690B] to-[#00E5A0] transition-all duration-150 ease-out shadow-[0_0_8px_#EB690B]"
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
                  ? idx % 2 === 0 ? 'border-[#EB690B] scale-110' : 'border-[#00E5A0] scale-110'
                  : 'border-stone-800'
                }`}
            >
              {isActive && (
                <span className={`w-1.5 h-1.5 rounded-full ${idx % 2 === 0 ? 'bg-[#EB690B]' : 'bg-[#00E5A0]'}`} />
              )}
            </div>

            {/* Glowing step card */}
            <GlowCard
              glowColor={step.glow}
              className={`p-6 md:p-8 bg-stone-950/45 border ${isCurrent
                  ? idx % 2 === 0 ? 'border-[#EB690B]/30' : 'border-[#00E5A0]/30'
                  : 'border-stone-900/30'
                } rounded-[12px]`}
            >
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider block transition-colors duration-300 ${isCurrent
                  ? idx % 2 === 0 ? 'text-[#EB690B]' : 'text-[#00E5A0]'
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

// 24 Dynamic Spots mapped to Mumbai coordinates (North-to-South layout)
const ALL_VENUE_PINS: VenuePin[] = [
  // ── Cafés ──
  {
    id: 'cafe-01',
    name: "Saint's Dark Coffee",
    place: 'Bandra West, Mumbai',
    category: 'Cafés (3)',
    lat: 19.0596,
    lng: 72.8295,
    mapX: 680,
    mapY: 340,
    num: '01',
    address: '52 Carter Rd Promenade, Bandra West',
    phone: '(022) 2605 5437',
    connections: 'Bandra Station // 1.2 km',
    description: 'Intense dark roasts in a cozy library overlooking the Arabian Sea.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'cafe-02',
    name: "Balzac's Roasters Coffee",
    place: 'Worli, Mumbai',
    category: 'Cafés (3)',
    lat: 19.0178,
    lng: 72.8478,
    mapX: 710,
    mapY: 480,
    num: '02',
    address: 'D685 Dr. Annie Besant Rd, Worli',
    phone: '(022) 4202 1190',
    connections: 'Lower Parel Monorail // 800 m',
    description: 'Artisan roasting house featuring lush botanical reading gardens.',
    image: '/images/cafe_2.png',
  },
  {
    id: 'cafe-03',
    name: 'Pergamum Cafe Shop',
    place: 'Fort, Colaba, Mumbai',
    category: 'Cafés (3)',
    lat: 18.9309,
    lng: 72.8382,
    mapX: 740,
    mapY: 620,
    num: '03',
    address: '62 Via 84 A, Fort Heritage Block',
    phone: '(022) 3671 5062',
    connections: 'CSMT Main Terminal // 400 m',
    description: 'Freshly brewed single-origin select. Vibe score 98%.',
    image: '/images/cafe_1.png',
  },

  // ── Restaurants ──
  {
    id: 'rest-01',
    name: 'The Bombay Canteen',
    place: 'Lower Parel, Mumbai',
    category: 'Restaurants',
    lat: 19.0024,
    lng: 72.8285,
    mapX: 690,
    mapY: 440,
    num: '01',
    address: 'Unit-1, Process House, Kamala Mills',
    phone: '(022) 4966 6666',
    connections: 'Lower Parel Station // 600 m',
    description: 'Modern Indian dishes highlighting local micro-seasonal produce.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'rest-02',
    name: 'Trishna Restaurant',
    place: 'Kala Ghoda, Fort, Mumbai',
    category: 'Restaurants',
    lat: 18.9300,
    lng: 72.8330,
    mapX: 730,
    mapY: 610,
    num: '02',
    address: '7 Sai Baba Marg, Kala Ghoda, Fort',
    phone: '(022) 2270 3589',
    connections: 'Churchgate Terminus // 700 m',
    description: 'Famous butter pepper garlic crab and legendary Mangalorean seafood.',
    image: '/images/cafe_2.png',
  },
  {
    id: 'rest-03',
    name: 'Wasabi by Morimoto',
    place: 'Colaba, Mumbai',
    category: 'Restaurants',
    lat: 18.9218,
    lng: 72.8331,
    mapX: 750,
    mapY: 650,
    num: '03',
    address: 'The Taj Mahal Palace, Apollo Bunder',
    phone: '(022) 6665 3366',
    connections: 'Gateway of India Pier // 100 m',
    description: 'World-class contemporary Japanese dining overlooking the historic harbor.',
    image: '/images/cafe_1.png',
  },

  // ── Museums ──
  {
    id: 'mus-01',
    name: 'Dr. Bhau Daji Lad Museum',
    place: 'Byculla, Mumbai',
    category: 'Museums',
    lat: 18.9790,
    lng: 72.8351,
    mapX: 700,
    mapY: 410,
    num: '01',
    address: '91 A, Veermata Jijabai Bhosale Udyan',
    phone: '(022) 2373 1234',
    connections: 'Byculla Station // 300 m',
    description: 'Mumbais oldest museum building housing 19th-century decorative art.',
    image: '/images/cafe_2.png',
  },
  {
    id: 'mus-02',
    name: 'CSMVS Museum',
    place: 'Kala Ghoda, Fort, Mumbai',
    category: 'Museums',
    lat: 18.9269,
    lng: 72.8327,
    mapX: 735,
    mapY: 625,
    num: '02',
    address: '159-161 Mahatma Gandhi Road, Fort',
    phone: '(022) 2284 5547',
    connections: 'CSMT Railway Terminal // 900 m',
    description: 'Grand Indo-Saracenic monument exhibiting ancient Indian sculptures.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'mus-03',
    name: 'National Gallery of Modern Art',
    place: 'Colaba, Mumbai',
    category: 'Museums',
    lat: 18.9258,
    lng: 72.8325,
    mapX: 745,
    mapY: 635,
    num: '03',
    address: 'Sir Cowasji Jehangir Public Hall, Fort',
    phone: '(022) 2288 1969',
    connections: 'Churchgate Terminus // 800 m',
    description: 'Heritage art museum showcasing premium contemporary masterpieces.',
    image: '/images/cafe_1.png',
  },

  // ── Parkings ──
  {
    id: 'prk-01',
    name: 'BKC Parking G-Block',
    place: 'Bandra East, Mumbai',
    category: 'Parkings',
    lat: 19.0600,
    lng: 72.8600,
    mapX: 650,
    mapY: 300,
    num: '01',
    address: 'G Block, Bandra Kurla Complex',
    phone: '1800 220 990',
    connections: 'Bandra-Kurla Connector // 400 m',
    description: 'High-density automated multi-tier parking deck with EV hyperchargers.',
    image: '/images/cafe_2.png',
  },
  {
    id: 'prk-02',
    name: 'Kamala Mills Parking Plaza',
    place: 'Lower Parel, Mumbai',
    category: 'Parkings',
    lat: 19.0020,
    lng: 72.8280,
    mapX: 685,
    mapY: 435,
    num: '02',
    address: 'Senapati Bapat Marg, Lower Parel',
    phone: '1800 220 991',
    connections: 'Lower Parel Station // 500 m',
    description: 'Secure multi-story parking structure convenient for dining & nightlife.',
    image: '/images/cafe_1.png',
  },
  {
    id: 'prk-03',
    name: 'BMC Multilevel Parking Fort',
    place: 'Fort, Mumbai',
    category: 'Parkings',
    lat: 18.9320,
    lng: 72.8350,
    mapX: 725,
    mapY: 590,
    num: '03',
    address: 'Hutatma Chowk, Fort Commercial Zone',
    phone: '1800 220 992',
    connections: 'CSMT Station // 300 m',
    description: 'Fully automated multi-level municipal smart parking terminal.',
    image: '/images/cafe_active.png',
  },

  // ── ATMs ──
  {
    id: 'atm-01',
    name: 'State Bank of India ATM',
    place: 'Bandra West, Mumbai',
    category: 'ATMs',
    lat: 19.0580,
    lng: 72.8280,
    mapX: 670,
    mapY: 330,
    num: '01',
    address: 'Carter Road Promenade, Bandra West',
    phone: '1800 112 211',
    connections: 'Bandra Bus Depot // 1.1 km',
    description: '24-hour ATM and cash dispenser located near the promenade.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'atm-02',
    name: 'ICICI Bank ATM',
    place: 'Worli Seaface, Mumbai',
    category: 'ATMs',
    lat: 19.0200,
    lng: 72.8420,
    mapX: 705,
    mapY: 470,
    num: '02',
    address: 'Worli Sea Face Promenade, Worli',
    phone: '1800 102 424',
    connections: 'Sea Link Exit Ramp // 600 m',
    description: 'High-availability ATM kiosk with premium CCTV security.',
    image: '/images/cafe_2.png',
  },
  {
    id: 'atm-03',
    name: 'HDFC Bank ATM',
    place: 'Nariman Point, Mumbai',
    category: 'ATMs',
    lat: 18.9280,
    lng: 72.8240,
    mapX: 740,
    mapY: 660,
    num: '03',
    address: 'Express Towers Lobby, Nariman Point',
    phone: '1800 224 433',
    connections: 'Churchgate Station // 1 km',
    description: 'Indoor multi-terminal cash facility located in the financial core.',
    image: '/images/cafe_1.png',
  },

  // ── Bus Stops ──
  {
    id: 'bus-01',
    name: 'Bandra Bus Depot',
    place: 'Bandra West, Mumbai',
    category: 'Bus Stops',
    lat: 19.0550,
    lng: 72.8350,
    mapX: 665,
    mapY: 345,
    num: '01',
    address: 'Station Road, Bandra West',
    phone: '(022) 2414 6262',
    connections: 'Bandra Railway Link // 100 m',
    description: 'Core junction for suburban BEST bus loops and auto stands.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'bus-02',
    name: 'Worli Naka Bus Stop',
    place: 'Worli, Mumbai',
    category: 'Bus Stops',
    lat: 19.0150,
    lng: 72.8430,
    mapX: 700,
    mapY: 460,
    num: '02',
    address: 'Dr. Annie Besant Road, Worli',
    phone: '(022) 2414 6262',
    connections: 'Worli Sea Face // 900 m',
    description: 'High-frequency transit stop connecting central office hubs.',
    image: '/images/cafe_1.png',
  },
  {
    id: 'bus-03',
    name: 'Colaba Bus Depot',
    place: 'Colaba, Mumbai',
    category: 'Bus Stops',
    lat: 18.9180,
    lng: 72.8280,
    mapX: 755,
    mapY: 665,
    num: '03',
    address: 'Electric House, Colaba Causeway',
    phone: '(022) 2414 6262',
    connections: 'Gateway of India // 500 m',
    description: 'Southern terminal hub running express buses to Mumbai suburbs.',
    image: '/images/cafe_2.png',
  },

  // ── Emergencies ──
  {
    id: 'emg-01',
    name: 'Lilavati Trauma Center',
    place: 'Bandra West, Mumbai',
    category: 'Emergencies',
    lat: 19.0510,
    lng: 72.8270,
    mapX: 675,
    mapY: 350,
    num: '01',
    address: 'A-791, Bandra Reclamation Road',
    phone: '(022) 2675 1000',
    connections: 'Bandra-Worli Sea Link Entrance // 200 m',
    description: '24/7 high-care trauma ward and cardiac unit services.',
    image: '/images/cafe_1.png',
  },
  {
    id: 'emg-02',
    name: 'KEM Hospital Emergency',
    place: 'Parel, Mumbai',
    category: 'Emergencies',
    lat: 19.0028,
    lng: 72.8423,
    mapX: 695,
    mapY: 400,
    num: '02',
    address: 'Acharya Donde Marg, Parel',
    phone: '(022) 2410 7000',
    connections: 'Parel Central Station // 400 m',
    description: 'Major public healthcare wing equipped with massive trauma facility.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'emg-03',
    name: 'St. George ER Clinic',
    place: 'Fort, Mumbai',
    category: 'Emergencies',
    lat: 18.9380,
    lng: 72.8380,
    mapX: 732,
    mapY: 600,
    num: '03',
    address: 'P D\'Mello Road, Near CSMT Station',
    phone: '(022) 2262 0242',
    connections: 'CSMT Metro Terminal // 150 m',
    description: 'Heritage municipal hospital hosting active primary triage.',
    image: '/images/cafe_2.png',
  },

  // ── Sport Centers ──
  {
    id: 'spt-01',
    name: 'Bandra Gymkhana Club',
    place: 'Bandra West, Mumbai',
    category: 'Sport Centers',
    lat: 19.0585,
    lng: 72.8315,
    mapX: 672,
    mapY: 335,
    num: '01',
    address: '20 St Andrew\'s Road, Bandra West',
    phone: '(022) 2642 8515',
    connections: 'Hill Road Junction // 500 m',
    description: 'Premium colonial-era sporting club hosting clay tennis courts.',
    image: '/images/cafe_2.png',
  },
  {
    id: 'spt-02',
    name: 'NSCI Sports Complex',
    place: 'Worli, Mumbai',
    category: 'Sport Centers',
    lat: 19.0120,
    lng: 72.8460,
    mapX: 715,
    mapY: 490,
    num: '02',
    address: 'Lala Lajpatrai Marg, Worli',
    phone: '(022) 2493 8813',
    connections: 'Mahalaxmi Station // 1.4 km',
    description: 'Elite indoor arena complex featuring squash, pools, and tracks.',
    image: '/images/cafe_active.png',
  },
  {
    id: 'spt-03',
    name: 'Wankhede Stadium Club',
    place: 'Churchgate, Mumbai',
    category: 'Sport Centers',
    lat: 18.9288,
    lng: 72.8258,
    mapX: 738,
    mapY: 640,
    num: '03',
    address: 'D Road, Churchgate, Mumbai',
    phone: '(022) 2281 1729',
    connections: 'Churchgate Terminal // 200 m',
    description: 'Iconic sports venue offering gymnasiums and indoor cricket facilities.',
    image: '/images/cafe_1.png',
  },
];

const CATEGORIES = [
  'Bowling',
  'Arcades',
  'Cafés (3)',
  'Garden',
  'Museums',
  'Beaches',
  'Restaurants',
  'Sport Centers',
];

export default function HomePage() {
  const { isSignedIn } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>('Cafés (3)');
  const [selectedPinId, setSelectedPinId] = useState<string>('cafe-01');

  // Map zoom and center states (Centered on Mumbai)
  const [mapCenter, setMapCenter] = useState<[number, number]>([72.8777, 19.076]);
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
    setMapCenter([72.8777, 19.076]);
    setMapZoom(11);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0C] text-foreground font-sans selection:bg-[#EB690B]/20 selection:text-[#EB690B]">

      {/* ── 0. Sticky Scroll Progress Bar ── */}
      <ScrollProgressBar />

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

        {/* Top Header Navigation */}
        <header className="absolute top-0 left-0 w-full z-20 px-12 py-8 flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-3.5">
            {/* Custom logo shield */}
            <svg viewBox="0 0 24 28" className="w-9 h-10 text-[#EB690B]" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C12 2 20 4 20 10C20 17 12 24 12 24C12 24 4 17 4 10C4 4 12 2 12 2Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="2" />
              <path d="M8 8V13C8 15.2 9.8 17 12 17C14.2 17 16 15.2 16 13V8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div className="text-left leading-none">
              <h1 className="font-campus text-[16px] font-extrabold tracking-[0.1em] text-white uppercase leading-none">Hangoutt</h1>
              <p className="font-campus text-[10px] tracking-[0.2em] text-neutral-400 uppercase mt-1 leading-none">Mumbai Noir</p>
            </div>
          </div>

          {/* Spaced horizontal navigation */}
          <nav className="hidden md:flex items-center gap-10 lg:gap-14 font-campus text-[11px] font-medium tracking-[0.22em] text-neutral-300 select-none uppercase">
            <Link href="#about" className="hover:text-white transition-colors duration-200">About</Link>
            <Link href="#features" className="hover:text-white transition-colors duration-200">Bento Features</Link>
            <Link href="#steps" className="hover:text-white transition-colors duration-200">Protocols</Link>
            {isSignedIn ? (
              <Link href="/groups" className="px-5 py-2.5 bg-gradient-to-r from-[#EB690B] to-[#FBBF24] hover:from-[#F97316] hover:to-[#F5A623] text-black font-mono font-bold text-[10px] tracking-[0.1em] transition-all duration-300 rounded-[8px] hover:scale-105 active:scale-95 shadow-md flex items-center">
                Go to Lobby
              </Link>
            ) : (
              <Link href="/sign-up" className="px-5 py-2.5 bg-gradient-to-r from-[#EB690B] to-[#FBBF24] hover:from-[#F97316] hover:to-[#F5A623] text-black font-mono font-bold text-[10px] tracking-[0.1em] transition-all duration-300 rounded-[8px] hover:scale-105 active:scale-95 shadow-md flex items-center">
                Start Hangout
              </Link>
            )}
          </nav>

          {/* Right Header Controls */}
          <div className="flex items-center gap-6 text-neutral-300">
            <button type="button" className="hover:text-white transition-colors cursor-pointer focus:outline-none">
              <Search className="w-5 h-5" />
            </button>
            <button type="button" className="hover:text-white transition-colors cursor-pointer focus:outline-none">
              <Menu className="w-5.5 h-5.5" />
            </button>
          </div>
        </header>

        {/* Left Side Category Rail */}
        <aside className="absolute left-4 right-4 lg:left-12 lg:right-auto top-[85px] lg:top-[28%] z-20 flex flex-col lg:flex-row items-start lg:items-stretch pointer-events-auto select-none lg:h-[420px]">

          {/* Categories Selector */}
          <div className="flex flex-row lg:flex-col items-center lg:items-start justify-start lg:justify-center gap-3.5 text-left overflow-x-auto w-full no-scrollbar pb-2 lg:pb-0">
            {CATEGORIES.map((cat) => {
              const isActive = cat === activeCategory;
              const cleanName = cat.replace(' (3)', '');
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`text-left transition-all duration-300 relative group cursor-pointer block focus:outline-none whitespace-nowrap ${isActive
                      ? 'text-white py-1 font-bold'
                      : 'text-neutral-500 hover:text-neutral-300 tracking-wider py-1 font-campus text-xs'
                    }`}
                >
                  {isActive ? (
                    <span className="font-serif-display text-2xl lg:text-5xl font-normal tracking-tight relative block leading-none">
                      {cleanName} <span className="text-sm lg:text-xl font-light align-top text-neutral-400 -ml-1">(3)</span>
                    </span>
                  ) : (
                    <span className="font-campus text-xs lg:text-sm">{cleanName}</span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Bottom-Left Telemetry / Weather Widget */}
        <footer className="hidden lg:flex absolute bottom-10 left-12 z-20 pointer-events-auto select-none items-center gap-10 bg-stone-950/60 backdrop-blur-md px-6 py-4 border border-stone-900/60 shadow-lg rounded-[12px]">
          <div className="flex items-center gap-4">
            <CloudSun className="w-9 h-9 text-[#EB690B]" />
            <div className="flex items-start gap-1">
              <span className="font-sans text-[38px] font-light text-white leading-none">28°</span>
              <div className="text-[8px] font-mono text-neutral-500 uppercase tracking-widest leading-tight">
                <div>NNW ↗</div>
                <div>13 km/h</div>
              </div>
            </div>
          </div>

          <div className="text-left font-mono text-[9px] text-neutral-400 tracking-wider leading-relaxed">
            <div>Mon, 05 Aug, 2019</div>
            <div className="text-neutral-600 mt-0.5">02:21 pm</div>
          </div>

          <div className="w-[1px] h-8 bg-stone-800" />

          <div className="text-left font-mono text-[9px] tracking-widest uppercase leading-relaxed">
            <div className="text-neutral-500">Spots</div>
            <div className="text-[#00E5A0] font-bold">{filteredPins.length} / 3</div>
          </div>
        </footer>

        {/* Right Selected Pins Carousel (Filtered dynamically, vertical stack) */}
        <div className="absolute bottom-[220px] sm:bottom-[160px] lg:bottom-[165px] right-4 lg:right-12 z-20 flex flex-col gap-2.5 pointer-events-auto max-w-[calc(100vw-32px)] sm:max-w-[360px] py-1 items-end">
          {carouselVenues.map((venue) => {
            return (
              <button
                key={venue.id}
                type="button"
                onClick={() => setSelectedPinId(venue.id)}
                className="flex items-center gap-3 px-3 py-1.5 border border-stone-850 bg-stone-950/90 backdrop-blur-md text-left transition-all duration-300 cursor-pointer hover:border-[#00E5A0]/40 hover:bg-stone-900/90 opacity-85 hover:opacity-100 hover:scale-[1.03] rounded-[10px] w-full sm:w-auto sm:min-w-[220px]"
              >
                {/* Thumbnail with overlay badge */}
                <div className="relative w-7 h-7 flex-shrink-0">
                  <img
                    src={venue.image}
                    alt={venue.name}
                    className="w-full h-full rounded-full object-cover grayscale border border-[#00E5A0]"
                  />
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-mono font-bold bg-[#18392B] text-[#00E5A0] border border-[#00E5A0]">
                    {venue.num}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <p className="font-campus text-[9px] font-bold text-white uppercase tracking-wider leading-none">{venue.name}</p>
                  <p className="font-mono text-[7px] text-neutral-400 leading-none">{venue.address}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Bottom-Center Map Controls Stack (Horizontal Layout) */}
        <div className="absolute bottom-4 lg:bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-row gap-3 pointer-events-auto items-center bg-stone-950/70 backdrop-blur-md px-4 py-2 border border-stone-850 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          <button
            type="button"
            onClick={handleRecenter}
            title="Recenter Map Viewport"
            className="w-10 h-10 rounded-full bg-white hover:bg-neutral-100 text-neutral-900 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer focus:outline-none border border-neutral-300"
          >
            <MapPin className="w-4.5 h-4.5" />
          </button>

          <button
            type="button"
            onClick={handleRecenter}
            title="Recenter"
            className="w-10 h-10 bg-[#EB690B] hover:bg-[#D4590A] text-white flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer focus:outline-none rounded-[8px]"
          >
            <Target className="w-4.5 h-4.5" />
          </button>

          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In"
            className="w-10 h-10 bg-white hover:bg-neutral-100 text-neutral-900 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer font-bold text-lg focus:outline-none rounded-[8px]"
          >
            <Plus className="w-4.5 h-4.5" />
          </button>

          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out"
            className="w-10 h-10 bg-white hover:bg-neutral-100 text-neutral-900 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer font-bold text-lg focus:outline-none rounded-[8px]"
          >
            <Minus className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Bottom-Right Selected Venue Details Card (aligned right on desktop, stacked on mobile) */}
        <div className="absolute bottom-[72px] sm:bottom-6 right-4 left-4 sm:left-auto sm:right-12 z-20 pointer-events-auto flex justify-center lg:justify-end">
          {activeVenue && (
            <Card
              className="p-4 bg-stone-950/95 border border-stone-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.85)] flex flex-col justify-between w-full sm:w-[360px] h-[130px] sm:h-[135px] backdrop-blur-md rounded-[12px] text-left"
            >
              <div className="space-y-0.5">
                <span className="font-mono text-[6.5px] sm:text-[7px] text-[#EB690B] tracking-[0.25em] uppercase font-bold">SELECTED MIDPOINT JUNCTION</span>
                <h3 className="font-campus text-sm sm:text-base font-bold text-white tracking-wide leading-tight mt-0.5">{activeVenue.name}</h3>
                <p className="text-[8px] sm:text-[8.5px] text-neutral-400 font-mono leading-none tracking-wider uppercase mt-1">{activeVenue.address}, {activeVenue.place}</p>
              </div>

              <div className="flex items-center gap-3 text-[8px] sm:text-[8.5px] font-mono text-neutral-400 my-0.5">
                <span className="flex items-center gap-1 sm:gap-1.5">
                  <Navigation className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#EB690B] transform rotate-45" />
                  <span className="truncate max-w-[120px]">{activeVenue.connections}</span>
                </span>
                <span className="flex items-center gap-1 sm:gap-1.5">
                  <Phone className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#EB690B]" />
                  <span>{activeVenue.phone}</span>
                </span>
              </div>

              <Link href={isSignedIn ? '/groups' : '/sign-up'} passHref className="w-full">
                <button
                  type="button"
                  className="w-full py-1.5 sm:py-2 bg-[#FBEBE2] hover:bg-[#F2D6C5] text-[#1E1511] font-mono text-[8px] sm:text-[8.5px] font-bold uppercase tracking-[0.25em] hover:tracking-[0.28em] transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] rounded-[6px]"
                >
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

        {/* Scroll Indicator */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-0.5 text-[8.5px] font-mono text-neutral-500 animate-bounce pointer-events-none uppercase tracking-widest">
          <span>Scroll to explore</span>
          <span className="text-xs">▼</span>
        </div>

      </section>

      {/* ── SECTION 2: THE CORE COORDINATION TECHNOLOGY (BENTO GRID WITH GLOW) ── */}
      <section id="about" className="bg-[#0A0A0C] py-24 md:py-32 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#EB690B]/5 rounded-full filter blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#00E5A0]/2 rounded-full filter blur-[100px] pointer-events-none" />

        <div className="mx-auto max-w-7xl px-8 relative z-10" id="features">
          <ScrollReveal className="text-center max-w-3xl mx-auto mb-20 space-y-4">
            <span className="inline-block text-xs font-bold uppercase tracking-widest text-[#EB690B] font-mono">
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
              <GlowCard glowColor="rgba(235, 105, 11, 0.15)" className="h-full">
                <div className="absolute top-4 right-4 font-mono text-[9px] text-[#EB690B]/30 tracking-widest">PROTO_01</div>
                <div>
                  <div className="w-10 h-10 rounded-lg bg-[#EB690B]/10 border border-[#EB690B]/30 flex items-center justify-center mb-6">
                    <Navigation className="w-5 h-5 text-[#EB690B] transform rotate-45" />
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
                  <span className="text-[#EB690B] group-hover:translate-x-1 transition-transform">→</span>
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
              <GlowCard glowColor="rgba(235, 105, 11, 0.15)" className="h-full">
                <div className="absolute top-4 right-4 font-mono text-[9px] text-[#EB690B]/30 tracking-widest">PROTO_03</div>
                <div>
                  <div className="w-10 h-10 rounded-lg bg-[#EB690B]/10 border border-[#EB690B]/30 flex items-center justify-center mb-6">
                    <Sparkles className="w-5 h-5 text-[#EB690B]" />
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
                  <span className="text-[#EB690B] group-hover:translate-x-1 transition-transform">→</span>
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
            <span className="inline-block text-xs font-mono font-bold uppercase tracking-widest text-[#EB690B]">
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
                  className="px-14 py-6 bg-gradient-to-r from-[#EB690B] to-[#FBBF24] hover:from-[#F97316] hover:to-[#F5A623] text-black font-mono font-bold text-xs uppercase tracking-[0.25em] transition-all hover:scale-105 active:scale-95 duration-300 cursor-pointer shadow-lg rounded-[8px]"
                >
                  Go to lobbies
                </button>
              </Link>
            ) : (
              <Link href="/sign-up" passHref>
                <button
                  type="button"
                  className="px-14 py-6 bg-gradient-to-r from-[#EB690B] to-[#FBBF24] hover:from-[#F97316] hover:to-[#F5A623] text-black font-mono font-bold text-xs uppercase tracking-[0.25em] transition-all hover:scale-105 active:scale-95 duration-300 cursor-pointer shadow-lg rounded-[8px]"
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
              <span className="font-heading text-2xl text-primary block leading-none">HANGOUTT</span>
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
                <li><Link href="/map" className="text-[#EB690B] hover:text-[#00E5A0] font-bold transition-colors">Live Map</Link></li>
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
