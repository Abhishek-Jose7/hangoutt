'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getGroupDetailsAction, startDetailsCollectionAction, getUserHistoryAction } from '@/actions/groups';
import { submitBudget } from '@/actions/budgets';
import { saveLocation, reverseGeocodeAction } from '@/actions/locations';
import { submitMemberVibes, updateMemberPresenceAction } from '@/actions/members';
import { generatePlan, getPlansForGroupAction } from '@/actions/planner';
import { createVote, closeVoting, countVotes, getUserVoteForGroup } from '@/actions/votes';
import { OutingFeedback } from '@/components/OutingFeedback';
import { Users, DollarSign, MapPin, Sparkles, Share2, Shield, ArrowRight, Loader2, Heart, RefreshCw, Award, Vote, Check, X, Clock, Star, BookOpen, Map, Wallet, Coffee, Utensils, Trees, Cake, Gamepad2, List } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceSkeleton } from '@/components/shared/BasicSkeleton';

const AVAILABLE_VIBES = [
  'CHILL', 'CREATIVE', 'FOODIE', 'CULTURAL', 'COMPETITIVE', 'ROMANTIC', 'LUXURY', 'BUDGET', 'ADVENTUROUS'
];

function getZoneImageUrl(zone: string): string {
  const z = (zone ?? '').toLowerCase();
  if (z.includes('powai')) {
    return 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?q=80&w=600&auto=format&fit=crop';
  }
  if (z.includes('bhandup')) {
    return 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?q=80&w=600&auto=format&fit=crop';
  }
  if (z.includes('vikhroli')) {
    return 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=80&w=600&auto=format&fit=crop';
  }
  if (z.includes('mulund')) {
    return 'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?q=80&w=600&auto=format&fit=crop';
  }
  return 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?q=80&w=600&auto=format&fit=crop';
}

function getPlanBackgroundImage(plan: any): string {
  const orderedSlots = [...(plan.slots ?? [])].sort((a: any, b: any) => a.slotOrder - b.slotOrder);

  // 1. Try to find a slot that has a real Google Maps photo url
  const gmapsSlot = orderedSlots.find(
    (s: any) => s.imageUrl && s.imageUrl.startsWith('/api/places/photo')
  );
  if (gmapsSlot) {
    // Increase size/quality for background image
    return gmapsSlot.imageUrl.replace('maxwidth=300', 'maxwidth=800');
  }

  // 2. Fall back to a live Google Places lookup by venue name so the card
  // always shows the actual place, not a stock/zone placeholder.
  const namedSlot = orderedSlots.find((s: any) => s.name);
  if (namedSlot) {
    const params = new URLSearchParams({
      name: namedSlot.name,
      city: 'Mumbai',
      maxwidth: '800',
    });
    if (namedSlot.category) params.set('category', namedSlot.category);
    return `/api/places/venue-photo?${params.toString()}`;
  }

  // 3. Absolute fallback to zone image
  return getZoneImageUrl(plan.meetupZone);
}

function getFallbackImageUrl(category: string): string {
  const cat = (category ?? '').toUpperCase();
  if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(cat)) {
    return '/images/cafe_active.png';
  }
  return '/images/mumbai_map.png';
}

function getSlotImageUrl(slot: any): string {
  if (slot.imageUrl && !slot.imageUrl.includes('unsplash.com') && !slot.imageUrl.includes('placehold.co') && !slot.imageUrl.includes('mumbai_map.png')) {
    return slot.imageUrl;
  }
  const name = (slot.name || '').toLowerCase();
  const cat = (slot.category || '').toLowerCase();

  // Specific place mappings matching Sapna Ki MKC
  if (name.includes('lake') || name.includes('promenade') || name.includes('carter')) {
    return 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=300&auto=format&fit=crop&q=60';
  }
  if (name.includes('social powai')) {
    return 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=300&auto=format&fit=crop&q=60';
  }
  if (name.includes('cozy café') || name.includes('cozy cafe')) {
    return 'https://images.unsplash.com/photo-1507133750040-4a8f57021571?w=300&auto=format&fit=crop&q=60';
  }
  if (name.includes('vibrant dining')) {
    return 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&auto=format&fit=crop&q=60';
  }
  if (name.includes('pottery') || name.includes('art')) {
    return 'https://images.unsplash.com/photo-1565192647048-f997ded87abf?w=300&auto=format&fit=crop&q=60';
  }
  if (name.includes('game') || name.includes('palacio') || name.includes('bowling') || name.includes('arcade')) {
    return 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300&auto=format&fit=crop&q=60';
  }
  if (name.includes('cheesecake') || name.includes('dessert') || name.includes('cake') || name.includes('poetry')) {
    return 'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?w=300&auto=format&fit=crop&q=60';
  }

  // Category fallbacks
  if (cat.includes('cafe') || cat.includes('coffee') || cat.includes('tea')) {
    return 'https://images.unsplash.com/photo-1498804103079-a6351b050096?w=300&auto=format&fit=crop&q=60';
  }
  if (cat.includes('restaurant') || cat.includes('dining') || cat.includes('food')) {
    return 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=300&auto=format&fit=crop&q=60';
  }
  if (cat.includes('bar') || cat.includes('pub') || cat.includes('nightlife')) {
    return 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=300&auto=format&fit=crop&q=60';
  }
  if (cat.includes('park') || cat.includes('garden') || cat.includes('outdoor')) {
    return 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=300&auto=format&fit=crop&q=60';
  }
  if (cat.includes('museum') || cat.includes('art') || cat.includes('gallery') || cat.includes('culture')) {
    return 'https://images.unsplash.com/photo-1536924940846-227afb31e2a5?w=300&auto=format&fit=crop&q=60';
  }
  if (cat.includes('hotel') || cat.includes('stay')) {
    return 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=300&auto=format&fit=crop&q=60';
  }

  return slot.imageUrl || getFallbackImageUrl(slot.category);
}

function getCategoryIcon(category: string) {
  const cat = (category ?? '').toUpperCase();
  if (['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR', 'NATURE'].includes(cat)) {
    return <Trees className="h-3.5 w-3.5 text-[#00E5A0]" />;
  }
  if (cat === 'CAFE') {
    return <Coffee className="h-3.5 w-3.5 text-[#FFD700]" />;
  }
  if (cat === 'RESTAURANT' || cat === 'DINING') {
    return <Utensils className="h-3.5 w-3.5 text-[#DC143C]" />;
  }
  if (cat === 'DESSERT' || cat === 'BAKERY') {
    return <Cake className="h-3.5 w-3.5 text-[#FF69B4]" />;
  }
  if (['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS', 'MALL', 'ACTIVITY'].includes(cat)) {
    return <Gamepad2 className="h-3.5 w-3.5 text-[#00BFFF]" />;
  }
  return <Sparkles className="h-3.5 w-3.5 text-[#A855F7]" />;
}

export default function GroupDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Form states
  const [budgetVal, setBudgetVal] = useState('');
  const [travelIncluded, setTravelIncluded] = useState(true);
  const [latVal, setLatVal] = useState('19.0178'); // default Dadar lat
  const [lngVal, setLngVal] = useState('72.8478'); // default Dadar lng
  const [addressVal, setAddressVal] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  
  const [isSubmittingBudget, setIsSubmittingBudget] = useState(false);
  const [isSubmittingLocation, setIsSubmittingLocation] = useState(false);
  const [isSubmittingVibes, setIsSubmittingVibes] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmittingCollection, setIsSubmittingCollection] = useState(false);
  const [isUpdatingPresence, setIsUpdatingPresence] = useState<string | null>(null);

  // Planner and voting states
  const [plans, setPlans] = useState<any[]>([]);
  const [activePlanIdx, setActivePlanIdx] = useState<number>(0);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [userVotedPlanId, setUserVotedPlanId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [isCasting, setIsCasting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [historyRecord, setHistoryRecord] = useState<any>(null);



  const carouselRef = React.useRef<HTMLDivElement>(null);

  const scrollToPlan = (idx: number) => {
    if (carouselRef.current) {
      const width = carouselRef.current.offsetWidth;
      carouselRef.current.scrollTo({
        left: idx * width,
        behavior: 'smooth'
      });
      setActivePlanIdx(idx);
    }
  };

  const loadData = async () => {
    try {
      const res = await getGroupDetailsAction(groupId);
      if (res.success) {
        setData(res.data);
        if (res.data.currentUser.budget) {
          setBudgetVal(res.data.currentUser.budget.toString());
        }
        if (res.data.currentUser.travelIncluded !== undefined) {
          setTravelIncluded(res.data.currentUser.travelIncluded);
        }
        if (res.data.currentUser.location) {
          setLatVal(res.data.currentUser.location.lat.toString());
          setLngVal(res.data.currentUser.location.lng.toString());
          setAddressVal(res.data.currentUser.location.locationName || `${res.data.currentUser.location.lat}, ${res.data.currentUser.location.lng}`);
        }
        
        // Retrieve vibes of the current user from member registry
        const currentMember = res.data.members.find((m: any) => m.userId === res.data.currentUser.id);
        if (currentMember && currentMember.vibes) {
          try {
            setSelectedVibes(JSON.parse(currentMember.vibes));
          } catch (_e) {}
        }

        // If plans are generated, load plans, vote counts, and user's vote
        if (['VOTING', 'COMPLETED', 'ARCHIVED'].includes(res.data.group.status)) {
          const [plansRes, voteTalliesRes, userVoteRes, historyRes] = await Promise.all([
            getPlansForGroupAction(groupId),
            countVotes(groupId),
            getUserVoteForGroup(groupId),
            ['COMPLETED', 'ARCHIVED'].includes(res.data.group.status) ? getUserHistoryAction() : Promise.resolve(null),
          ]);

          if (plansRes.success) {
            setPlans(plansRes.data);
          }
          if (voteTalliesRes.success) {
            const tallies = voteTalliesRes.data.reduce((acc: any, t: any) => {
              acc[t.planId] = t.count;
              return acc;
            }, {});
            setVotes(tallies);
          }
          if (userVoteRes.success) {
            setUserVotedPlanId(userVoteRes.data);
          }
          if (historyRes && historyRes.success && historyRes.data) {
            const record = historyRes.data.find((h: any) => h.groupId === groupId);
            if (record) setHistoryRecord(record);
          }
        }
      } else {
        toast.error(res.error.message || 'Failed to fetch group details');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Polling interval to reflect live updates (every 5 seconds)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [groupId]);

  const handleVoteCast = async (planId: string) => {
    setIsCasting(true);
    try {
      const res = await createVote({
        groupId: groupId,
        planId: planId,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit vote');
        setIsCasting(false);
        return;
      }

      toast.success('Vote cast successfully!');
      setUserVotedPlanId(planId);

      // Re-fetch tallies to ensure accuracy
      const voteTalliesRes = await countVotes(groupId);
      if (voteTalliesRes.success) {
        const tallies = voteTalliesRes.data.reduce((acc: any, t: any) => {
          acc[t.planId] = t.count;
          return acc;
        }, {});
        setVotes(tallies);
      }

      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting your vote.');
    } finally {
      setIsCasting(false);
    }
  };

  const handleCloseVoting = async () => {
    setIsClosing(true);
    try {
      const res = await closeVoting(groupId);

      if (!res.success) {
        toast.error(res.error.message || 'Failed to close voting');
        setIsClosing(false);
        return;
      }

      toast.success('Voting closed successfully! Winner declared.');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred closing voting.');
    } finally {
      setIsClosing(false);
    }
  };

  const handleBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingBudget(true);
    const amount = parseInt(budgetVal);
    if (isNaN(amount) || amount < 200) {
      alert("The budget you entered is too less. Kindly reconsider for a better experience.");
      setIsSubmittingBudget(false);
      return;
    }
    
    try {
      const res = await submitBudget({
        groupId: groupId,
        maxBudget: amount,
        travelIncluded,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit budget');
        return;
      }

      toast.success('Budget submitted successfully!');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting budget.');
    } finally {
      setIsSubmittingBudget(false);
    }
  };

  const handleStartDetailsCollection = async () => {
    setIsSubmittingCollection(true);
    try {
      const res = await startDetailsCollectionAction(groupId);
      if (!res.success) {
        toast.error(res.error.message || 'Failed to start details collection');
        return;
      }
      toast.success('Group locked! Details collection has started.');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred starting details collection.');
    } finally {
      setIsSubmittingCollection(false);
    }
  };

  const handleAutoDetect = () => {
    if (navigator.geolocation) {
      toast.loading("Detecting your precise location...");
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          try {
            const res = await reverseGeocodeAction(latitude, longitude);
            toast.dismiss();
            if (res.success && res.data) {
              const { name, lat, lng } = res.data;
              setAddressVal(name);
              setLatVal(lat.toString());
              setLngVal(lng.toString());
              toast.success(`Location detected: ${name}! Press save to register.`);
            } else {
              setLatVal(latitude.toString());
              setLngVal(longitude.toString());
              setAddressVal(`Detected Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
              toast.success("Location coordinates detected! Press save to register.");
            }
          } catch (err) {
            toast.dismiss();
            setLatVal(latitude.toString());
            setLngVal(longitude.toString());
            setAddressVal(`Detected Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
            toast.success("Location coordinates detected! Press save to register.");
          }
        },
        (error) => {
          toast.dismiss();
          toast.error("Failed to detect location: " + error.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    } else {
      toast.error("Geolocation is not supported by this browser.");
    }
  };

  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLocation(true);
    let lat: number | undefined = parseFloat(latVal);
    let lng: number | undefined = parseFloat(lngVal);

    try {
      const res = await saveLocation({
        groupId: groupId,
        locationName: addressVal,
        lat,
        lng,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit location');
        return;
      }

      toast.success('Location registered successfully!');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting coordinates.');
    } finally {
      setIsSubmittingLocation(false);
    }
  };

  const handleVibesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingVibes(true);

    try {
      const res = await submitMemberVibes(groupId, selectedVibes);
      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit vibe preferences');
        return;
      }

      toast.success('Vibe preferences saved successfully!');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting vibes.');
    } finally {
      setIsSubmittingVibes(false);
    }
  };

  const [isSubmittingDetails, setIsSubmittingDetails] = useState(false);

  const handleUnifiedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingDetails(true);
    
    try {
      const budgetAmount = parseInt(budgetVal) || 2000;
      if (budgetAmount < 200) {
        alert("The budget you entered is too less. Kindly reconsider for a better experience.");
        setIsSubmittingDetails(false);
        return;
      }
      const budgetRes = await submitBudget({
        groupId: groupId,
        maxBudget: budgetAmount,
        travelIncluded,
      });

      let lat: number | undefined = parseFloat(latVal);
      let lng: number | undefined = parseFloat(lngVal);
      const locationRes = await saveLocation({
        groupId: groupId,
        locationName: addressVal || "My Location",
        lat,
        lng,
      });

      const vibesRes = await submitMemberVibes(groupId, selectedVibes);

      if (budgetRes.success && locationRes.success && vibesRes.success) {
        toast.success("Group details synced successfully!");
      } else {
        const errorMsg = (!budgetRes.success ? (budgetRes as any).error?.message : '') || 
                         (!locationRes.success ? (locationRes as any).error?.message : '') || 
                         (!vibesRes.success ? (vibesRes as any).error?.message : '') || 
                         "Details failed to save";
        toast.error(errorMsg);
      }
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during details submission.");
    } finally {
      setIsSubmittingDetails(false);
    }
  };

  const handlePlanGeneration = async (options: string[] = []) => {
    console.log('handlePlanGeneration triggered for groupId:', groupId, 'options:', options);
    setIsGenerating(true);
    try {
      const res = await generatePlan(groupId, options);
      console.log('generatePlan response:', res);
      
      if (!res.success) {
        toast.error(res.error.message || 'Failed to generate itineraries');
        setIsGenerating(false);
        return;
      }

      toast.success('Itineraries generated successfully! Opening Planner.');
      router.push(`/planner/${groupId}`);
    } catch (err) {
      console.error('handlePlanGeneration error:', err);
      toast.error('An error occurred generating plans.');
      setIsGenerating(false);
    }
  };

  const handleShareCode = () => {
    if (data?.group?.inviteCode) {
      const code = data.group.inviteCode;
      if (navigator.share) {
        navigator.share({
          title: `Join ${data.group.name} on Hangout`,
          text: `Use invite code ${code} to plan our next meetup!`,
          url: window.location.origin + `/join/${code}`,
        }).catch(console.error);
      } else {
        navigator.clipboard.writeText(code);
        toast.success(`Invite code "${code}" copied to clipboard!`);
      }
    }
  };

  const toggleVibe = (vibe: string) => {
    setSelectedVibes(prev => 
      prev.includes(vibe) ? prev.filter(v => v !== vibe) : [...prev, vibe]
    );
  };

  if (loading) {
    return (
      <main className="relative min-h-screen pt-10 pb-24 md:pb-10 bg-black text-[#e5e2e1] overflow-x-hidden">
        <WorkspaceSkeleton />
      </main>
    );
  }

  if (!data) {
    return (
      <PageContainer title="Group Workspace">
        <Card className="border border-stone-900 bg-stone-950/45 text-center p-8 rounded-[12px] backdrop-blur-md">
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-4">Workspace not found or you are not a member.</p>
          <Link href="/groups" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'border-stone-800 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 transition-all' })}>
            Back to Groups
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const { group, members, budgetSummary, submittedBudgetUserIds, locations, currentUser } = data;
  const isAdmin = currentUser.role === 'ADMIN';

  // Retrieve vibes of the current user
  const currentMember = members.find((m: any) => m.userId === currentUser.id);
  let hasVibes = false;
  if (currentMember && currentMember.vibes) {
    try {
      hasVibes = JSON.parse(currentMember.vibes).length > 0;
    } catch (_e) {}
  }

  // State checks
  const isCollectingMembers = group.status === 'COLLECTING_MEMBERS';
  const isCollectingDetails = group.status === 'COLLECTING_DETAILS';
  const isReady = group.status === 'READY_TO_GENERATE';
  const isGeneratingState = group.status === 'GENERATING';
  const isVotingOrClosed = ['VOTING', 'COMPLETED', 'ARCHIVED'].includes(group.status);
  const hasSubmittedSelf = currentUser.budget !== null && currentUser.location !== null;

  return (
    <main className="relative min-h-screen pt-10 pb-24 md:pb-10 bg-black text-[#e5e2e1] overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-6 relative z-10">
        
        {/* Protocol Header */}
        <div className="border-l-4 border-[#DC143C] pl-6 py-3 bg-[#0e0e0e]/40 rounded-r-[4px] flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-in fade-in slide-in-from-top-3 duration-300">
          <div className="flex-1 min-w-0">
            <div className="border border-[#DC143C]/40 bg-[#DC143C]/5 rounded-[4px] px-2.5 py-1 text-[9px] font-mono font-bold tracking-wider text-[#DC143C] flex items-center gap-1.5 w-fit mb-3">
              <Shield className="h-3.5 w-3.5 text-[#DC143C]" />
              <span>STATUS: {group.status.replace('_', ' ')}</span>
            </div>
            <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-white uppercase leading-none tracking-wide">
              GROUP: {group.name}
            </h1>
            <p className="font-mono text-[10px] text-neutral-400 mt-2.5 flex flex-wrap items-center gap-2 uppercase">
              <span>UUID: {group.id.substring(0, 8).toUpperCase()}</span>
              <span className="text-neutral-700">|</span>
              <span>INVITE CODE:</span>
              <code className="bg-[#DC143C]/10 border border-[#DC143C]/30 px-2 py-0.5 rounded-[4px] text-[#DC143C] font-mono select-all font-bold text-[11px] tracking-wide">{group.inviteCode}</code>
            </p>
          </div>
          
          {group.status !== 'COMPLETED' && group.status !== 'ARCHIVED' && group.status !== 'VOTING' ? (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleShareCode} 
                className="border-[#353534] bg-[#1c1b1b]/55 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] px-4 py-2.5 gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
              >
                <Share2 className="h-3.5 w-3.5 text-[#DC143C]" />
                Share Code
              </Button>
            </div>
          ) : (
            isVotingOrClosed && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const el = document.getElementById('vote-distribution');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="border-[#DC143C]/40 bg-[#DC143C]/5 text-[#DC143C] hover:bg-[#DC143C]/15 hover:text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] px-4 py-2.5 gap-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md flex items-center"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DC143C] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#DC143C]"></span>
                  </span>
                  Live Consensus
                </Button>
              </div>
            )
          )}
        </div>



        {/* Status Notification Banner (Cooking status) */}
        {isGeneratingState && (
          <div className="flex items-center gap-3 bg-[#DC143C]/10 border border-[#DC143C]/20 p-4 rounded-[4px] text-[#DC143C] text-[10px] font-bold uppercase tracking-wider animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin text-[#DC143C]" />
            <span>AI Itineraries are currently being cooked. Check back shortly...</span>
            <Button size="xs" variant="ghost" onClick={loadData} className="ml-auto flex items-center gap-1 text-[9px] hover:bg-[#DC143C]/20 text-[#DC143C] hover:text-[#DC143C]">
              <RefreshCw className="h-3 w-3 animate-spin" /> Reload
            </Button>
          </div>
        )}

        {/* If voting status is active but plans list is empty, show a recovery/loading card */}
        {isVotingOrClosed && plans.length === 0 && (
          <Card className="border border-stone-900 bg-stone-950/45 text-center p-8 rounded-[12px] backdrop-blur-md">
            <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mx-auto mb-4" />
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Loading itineraries...</p>
            <p className="text-[10px] text-neutral-500 font-mono">If this takes too long or they failed to generate, please regenerate.</p>
            {isAdmin && (
              <Button
                onClick={() => handlePlanGeneration()}
                disabled={isGenerating}
                className="mt-4 bg-[#DC143C] hover:bg-[#B80F2E] text-black text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] px-4 py-2 flex items-center justify-center mx-auto"
              >
                Regenerate Itineraries
              </Button>
            )}
          </Card>
        )}

        {/* Horizontal Swipe Carousel (Mobile) & Grid (Desktop) of Itineraries */}
        {isVotingOrClosed && plans.length > 0 && (
          <div className="space-y-6">
            {/* Case A: Outing Completed / Winner Declared */}
            {(group.status === 'COMPLETED' || group.status === 'ARCHIVED') ? (
              (() => {
                const winner = plans.find((p: any) => p.id === group.winningPlanId) || plans[0];
                return (
                  <>
                  <Card className="relative overflow-hidden border border-[#00E1AB]/20 rounded-[8px] bg-[#0e0e0e]/80 backdrop-blur-md shadow-lg p-6 space-y-6">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#00E1AB]/5 rounded-full blur-3xl pointer-events-none" />
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#353534] pb-4">
                      <div>
                        <span className="text-[9px] uppercase font-bold text-[#00E1AB] tracking-widest flex items-center gap-1 font-mono">
                          <Award className="h-3.5 w-3.5 text-[#00E1AB]" /> Final Outing Protocol
                        </span>
                        <h2 className="text-lg font-bold text-white mt-1 uppercase tracking-wide font-mono">{winner.name}</h2>
                        <p className="text-xs text-neutral-400 mt-0.5 font-sans leading-relaxed tracking-wide">{winner.tagline}</p>
                      </div>
                      
                      <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 rounded-[4px] flex items-center gap-1.5 text-[9px] font-mono font-bold py-1 px-3 uppercase tracking-widest">
                        <Check className="h-3.5 w-3.5" /> Outing Locked
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Left: Final Itinerary slots flow */}
                      <div className="lg:col-span-2 space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5 font-mono">
                          📍 Primary Node: {winner.meetupZone.toUpperCase()}
                        </h3>
                        
                        <div className="flex flex-col items-stretch justify-start py-2 space-y-3">
                          {winner.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                            <React.Fragment key={sIdx}>
                              <div className="flex items-start gap-4 p-4 bg-[#1c1b1b] border border-[#353534] rounded-[4px]">
                                <span className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#00E1AB]/10 text-[#00E1AB] text-xs font-mono font-bold border border-[#00E1AB]/20 shrink-0">
                                  {slot.slotOrder}
                                </span>
                                <div className="space-y-1">
                                  <h4 className="text-sm font-bold text-white leading-snug font-mono">{slot.name.toUpperCase()}</h4>
                                  <p className="text-[10px] text-neutral-400 uppercase font-mono tracking-widest">
                                    {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}M)
                                  </p>
                                  {slot.note && (
                                    <p className="text-[11px] text-neutral-400 font-sans leading-relaxed italic mt-1.5">
                                      &ldquo;{slot.note}&rdquo;
                                    </p>
                                  )}
                                </div>
                              </div>
                              {sIdx < (winner.slots.length - 1) && (
                                <div className="flex justify-center my-0.5">
                                  <span className="text-[#00E1AB]/60 font-black text-sm">↓</span>
                                </div>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>

                      {/* Right: Summary details */}
                      <div className="space-y-4 bg-[#1c1b1b] border border-[#353534] rounded-[4px] p-5 h-fit text-[11px]">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C] font-mono">Itinerary Analysis</h3>
                        
                        <div className="divide-y divide-[#353534] text-[11px] font-mono space-y-3">
                          <div className="flex justify-between py-2">
                            <span className="text-neutral-400">ESTIMATED COST</span>
                            <span className="font-extrabold text-white">₹{winner.totalEstimatedCostPerHead} / PERSON</span>
                          </div>
                          <div className="flex justify-between py-2">
                            <span className="text-neutral-400">COMMUTE TIME</span>
                            <span className="font-extrabold text-white">~{winner.avgCabTime} MINS</span>
                          </div>
                          <div className="flex justify-between py-2">
                            <span className="text-neutral-400">ITINERARY SCORE</span>
                            <span className="font-extrabold text-[#DC143C]">{(winner.score * 10).toFixed(1)}/10</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-[#353534]">
                            <span className="text-neutral-400">MEETUP ZONE</span>
                            <span className="font-extrabold text-white uppercase">{winner.meetupZone}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Post-outing feedback */}
                  {historyRecord && (
                    <OutingFeedback
                      historyId={historyRecord.id}
                      groupId={groupId}
                      planId={winner?.id}
                      slots={(winner?.slots ?? []).sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((s: any) => ({
                        id: s.id,
                        name: s.name,
                        placeId: s.venueId,
                        category: s.category,
                      }))}
                    />
                  )}
                  </>
                );
              })()
            ) : (
              /* Case B: Voting Phase */
              <div className="space-y-6">
                {/* 1. Mobile Carousel View (block md:hidden) */}
                <div className="block md:hidden space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      ITINERARY OPTIONS
                    </span>
                    <Badge variant="outline" className={`rounded-[4px] py-0.5 px-2.5 text-[9px] font-mono font-bold uppercase tracking-widest ${
                      group.votingStatus === 'OPEN' 
                        ? 'bg-[#DC143C]/10 text-[#DC143C] border-[#DC143C]/20 animate-pulse' 
                        : 'bg-stone-900/40 text-neutral-400 border-stone-850'
                    }`}>
                      VOTING: {group.votingStatus.replace('_', ' ')}
                    </Badge>
                  </div>

                  <div 
                    ref={carouselRef}
                    className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth scrollbar-none pb-4"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    onScroll={(e) => {
                      const container = e.currentTarget;
                      const scrollLeft = container.scrollLeft;
                      const width = container.offsetWidth;
                      const newIdx = Math.round(scrollLeft / width);
                      if (newIdx !== activePlanIdx && newIdx >= 0 && newIdx < plans.length) {
                        setActivePlanIdx(newIdx);
                      }
                    }}
                  >
                    {plans.map((plan, idx) => {
                      const voteCount = votes[plan.id] || 0;
                      const orderedSlots = [...(plan.slots ?? [])].sort((a: any, b: any) => a.slotOrder - b.slotOrder);

                      return (
                        <div key={plan.id} className="w-full shrink-0 snap-center snap-always px-1">
                          <Card 
                            style={{
                              backgroundImage: `linear-gradient(to bottom, rgba(14, 14, 14, 0.4) 0%, rgba(14, 14, 14, 0.95) 75%, rgba(14, 14, 14, 1) 100%), url(${getPlanBackgroundImage(plan)})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center 20%',
                              backgroundRepeat: 'no-repeat',
                            }}
                            className="bg-[#0e0e0e]/95 border border-[#353534] rounded-[12px] p-5 shadow-lg flex flex-col justify-between gap-4 transition-all select-none relative overflow-hidden"
                          >
                            {/* Top row: Image & details */}
                            <div className="flex gap-4 items-start">
                              {/* Left: Square Thumbnail */}
                              <div className="w-[110px] h-[90px] rounded-[8px] overflow-hidden border border-neutral-850 bg-neutral-900 shrink-0">
                                <img
                                  src={orderedSlots.length > 0 ? getSlotImageUrl(orderedSlots[0]) : getFallbackImageUrl('')}
                                  alt={plan.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = getFallbackImageUrl('');
                                  }}
                                />
                              </div>

                              {/* Right: Title, tagline, and badges */}
                              <div className="flex-1 min-w-0 flex flex-col justify-between h-[90px] pr-2 text-left relative">
                                <div>
                                  <div className="flex justify-between items-start gap-1">
                                    <h3 className="text-[13.5px] font-sans font-extrabold text-white leading-tight uppercase tracking-wide truncate max-w-[130px]">
                                      {plan.name} <span className="font-medium text-neutral-400 normal-case">({idx === 0 ? 'Optimal' : plan.meetupZone})</span>
                                    </h3>
                                    
                                    {/* Votes Badge */}
                                    <div className="bg-[#DC143C]/10 border border-[#DC143C]/20 text-[#DC143C] rounded-[4px] flex items-center gap-1 text-[8.5px] font-mono font-bold px-1.5 py-0.5 uppercase tracking-widest shrink-0">
                                      <Vote className="h-3 w-3 text-[#DC143C]" />
                                      <span>{voteCount} votes</span>
                                    </div>
                                  </div>
                                  
                                  <p className="text-[10px] text-neutral-400 font-sans tracking-wide leading-snug line-clamp-2 mt-1">
                                    {plan.tagline}
                                  </p>
                                </div>

                                {/* Recommendation Pills */}
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {idx === 0 && (
                                    <span className="bg-[#DC143C]/10 border border-[#DC143C]/20 text-[#DC143C] text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded-[3px] tracking-wide uppercase flex items-center gap-0.5">
                                      <MapPin className="h-2.5 w-2.5 text-[#DC143C]" />
                                      Lowest Commute
                                    </span>
                                  )}
                                  <span className="bg-purple-950/40 border border-purple-800/35 text-purple-400 text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded-[3px] tracking-wide uppercase flex items-center gap-0.5">
                                    <Heart className="h-2.5 w-2.5 text-purple-400 fill-purple-400" />
                                    Date Friendly
                                  </span>
                                  <span className="bg-cyan-950/40 border border-cyan-800/35 text-cyan-400 text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded-[3px] tracking-wide uppercase flex items-center gap-0.5">
                                    <Sparkles className="h-2.5 w-2.5 text-cyan-400" />
                                    Indoor Friendly
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Stats Grid - 4 Columns */}
                            <div className="border-t border-[#353534]/55 pt-3.5 mt-1 grid grid-cols-4 gap-1 text-center">
                              <div className="space-y-1">
                                <div className="flex items-center justify-center gap-1 text-neutral-500">
                                  <Wallet className="h-3 w-3 text-[#DC143C]" />
                                  <span className="text-[7.5px] font-mono uppercase tracking-wider block font-bold leading-none">COST/HEAD</span>
                                </div>
                                <span className="text-white font-sans font-extrabold text-[12.5px] block leading-tight">₹{plan.totalEstimatedCostPerHead}</span>
                                <span className="text-[7.5px] text-neutral-500 font-sans block leading-none">within ₹{Math.max(100, Math.round(plan.totalEstimatedCostPerHead * 0.9))}-₹{Math.round(plan.totalEstimatedCostPerHead * 1.25)}</span>
                              </div>
                              <div className="space-y-1 border-l border-[#353534]/55">
                                <div className="flex items-center justify-center gap-1 text-neutral-500">
                                  <Clock className="h-3 w-3 text-[#DC143C]" />
                                  <span className="text-[7.5px] font-mono uppercase tracking-wider block font-bold leading-none">AVG COMMUTE</span>
                                </div>
                                <span className="text-white font-sans font-extrabold text-[12.5px] block leading-tight">{plan.avgCabTime} mins</span>
                                <span className="text-[7.5px] text-neutral-500 font-sans block leading-none">({plan.shortestTravelTime || Math.round(plan.avgCabTime * 0.8)}-{plan.longestTravelTime || Math.round(plan.avgCabTime * 1.3)} mins)</span>
                              </div>
                              <div className="space-y-1 border-l border-[#353534]/55">
                                <div className="flex items-center justify-center gap-1 text-neutral-500">
                                  <Clock className="h-3 w-3 text-[#DC143C]" />
                                  <span className="text-[7.5px] font-mono uppercase tracking-wider block font-bold leading-none">DURATION</span>
                                </div>
                                <span className="text-white font-sans font-extrabold text-[12.5px] block leading-tight">
                                  {Math.floor((plan.totalDurationMinutes || 240) / 60)}h {Math.round((plan.totalDurationMinutes || 240) % 60)}m
                                </span>
                                <span className="text-[7.5px] text-neutral-500 font-sans block leading-none">active time</span>
                              </div>
                              <div className="space-y-1 border-l border-[#353534]/55">
                                <div className="flex items-center justify-center gap-1 text-neutral-500">
                                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                  <span className="text-[7.5px] font-mono uppercase tracking-wider block font-bold leading-none">PLAN SCORE</span>
                                </div>
                                <span className="text-[#00E1AB] font-sans font-extrabold text-[12.5px] block leading-tight">{(plan.score * 10).toFixed(1)}/10</span>
                                <span className="text-[7.5px] text-neutral-500 font-sans block leading-none">high rating</span>
                              </div>
                            </div>

                            {/* Horizontal Places Timeline */}
                            <div className="border-t border-[#353534]/55 pt-3.5 flex items-center justify-start gap-1 bg-black/20 p-2.5 rounded-[6px] border border-[#353534]/30 overflow-x-auto scrollbar-none">
                              {orderedSlots.map((slot: any, sIdx: number) => (
                                <React.Fragment key={slot.id || sIdx}>
                                  {sIdx > 0 && (
                                    <div className="flex flex-col items-center shrink-0 mx-1.5">
                                      <span className="text-[#DC143C] font-extrabold text-xs">→</span>
                                      <span className="text-[8px] font-mono text-neutral-500 font-bold leading-none mt-0.5">
                                        {orderedSlots[sIdx - 1].travelToNextMinutes || 15}m
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                                    <div className="w-7 h-7 flex items-center justify-center rounded-[6px] border border-[#353534]/60 bg-stone-950 text-white shrink-0">
                                      {getCategoryIcon(slot.category)}
                                    </div>
                                    <div className="min-w-0 text-left">
                                      <p className="text-[10px] font-sans font-bold text-white truncate max-w-[80px] leading-tight">{slot.name}</p>
                                      <p className="text-[8px] font-mono text-neutral-500 mt-0.5 leading-none">{slot.arrivalTime}</p>
                                    </div>
                                  </div>
                                </React.Fragment>
                              ))}
                            </div>

                            {/* Action Buttons */}
                            <div className="grid grid-cols-2 gap-3 mt-1.5 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedPlanId(plan.id);
                                }}
                                className="w-full bg-[#111] hover:bg-[#1c1b1b] border border-[#353534] text-white font-sans font-bold uppercase tracking-widest text-[9.5px] py-3.5 rounded-[6px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <List className="h-3.5 w-3.5 text-neutral-400" />
                                <span>View Highlights</span>
                              </Button>

                              {group.votingStatus === 'OPEN' ? (
                                <Button
                                  size="sm"
                                  disabled={isCasting || userVotedPlanId === plan.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVoteCast(plan.id);
                                  }}
                                  className={`w-full font-sans font-extrabold rounded-[6px] uppercase tracking-widest text-[9.5px] py-3.5 transition-all duration-200 cursor-pointer ${
                                    userVotedPlanId === plan.id
                                      ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/20 text-[#00E1AB]'
                                      : 'bg-[#DC143C] hover:bg-[#B80F2E] text-black font-black'
                                  }`}
                                >
                                  {userVotedPlanId === plan.id ? (
                                    <>
                                      <Check className="h-3.5 w-3.5 text-[#00E1AB]" /> REGISTERED
                                    </>
                                  ) : (
                                    <>
                                      <Vote className="h-3.5 w-3.5" /> Vote for plan
                                    </>
                                  )}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled
                                  className="w-full bg-[#222] border border-[#333] text-neutral-500 font-sans font-bold rounded-[6px] uppercase tracking-widest text-[9.5px] py-3.5 cursor-not-allowed"
                                >
                                  Voting Closed
                                </Button>
                              )}
                            </div>
                          </Card>
                        </div>
                      );
                    })}
                  </div>

                  {/* Carousel Indicators */}
                  <div className="flex justify-between items-center px-1.5">
                    <Button 
                      variant="outline" 
                      size="xs" 
                      disabled={activePlanIdx === 0} 
                      onClick={() => scrollToPlan(activePlanIdx - 1)}
                      className="border-[#353534] bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] h-7 px-3.5 cursor-pointer animate-none"
                    >
                      Prev
                    </Button>
                    
                    <div className="flex gap-2">
                      {plans.map((_, idx) => (
                        <span 
                          key={idx} 
                          onClick={() => scrollToPlan(idx)}
                          className={`h-2 w-2 rounded-full cursor-pointer transition-all duration-300 ${
                            idx === activePlanIdx ? 'bg-[#DC143C] scale-125' : 'bg-stone-900 hover:bg-stone-850'
                          }`}
                        />
                      ))}
                    </div>

                    <Button 
                      variant="outline" 
                      size="xs" 
                      disabled={activePlanIdx === plans.length - 1} 
                      onClick={() => scrollToPlan(activePlanIdx + 1)}
                      className="border-[#353534] bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] h-7 px-3.5 cursor-pointer animate-none"
                    >
                      Next
                    </Button>
                  </div>

                  {expandedPlanId && (
                    (() => {
                      const activePlan = plans.find((p: any) => p.id === expandedPlanId);
                      if (!activePlan) return null;
                      const detailSlots = [...(activePlan.slots ?? [])].sort((a: any, b: any) => a.slotOrder - b.slotOrder);
                      return (
                        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
                          <div className="bg-[#0e0e0e] border border-[#353534] rounded-lg max-w-xl w-full max-h-[90vh] p-6 relative flex flex-col gap-5 text-white shadow-2xl">
                            
                            {/* Header */}
                            <div className="flex items-center justify-between border-b border-[#353534]/50 pb-3 shrink-0">
                              <div>
                                <p className="text-[9.5px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">Itinerary details</p>
                                <h3 className="mt-1 text-base font-mono font-bold uppercase tracking-wide text-white">{activePlan.name}</h3>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => setExpandedPlanId(null)}
                                className="h-8 w-8 rounded-[6px] border border-[#353534] bg-[#111] text-white hover:bg-[#1c1b1b] cursor-pointer shrink-0"
                              >
                                <X className="h-4 w-4" />
                                <span className="sr-only">Close itinerary details</span>
                              </Button>
                            </div>

                            {/* Body content */}
                            <div className="space-y-5 overflow-y-auto pr-1 flex-1">
                              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-neutral-400">
                                <div className="rounded-[6px] border border-[#353534] bg-[#131313]/95 p-3">
                                  <span className="block text-[8px] uppercase tracking-widest text-neutral-500">Cost / head</span>
                                  <strong className="mt-1 block text-sm text-white">Rs {activePlan.totalEstimatedCostPerHead}</strong>
                                </div>
                                <div className="rounded-[6px] border border-[#353534] bg-[#131313]/95 p-3">
                                  <span className="block text-[8px] uppercase tracking-widest text-neutral-500">Avg commute</span>
                                  <strong className="mt-1 block text-sm text-white">{activePlan.avgTotalTime || activePlan.avgCabTime} mins</strong>
                                </div>
                              </div>

                              <div className="relative ml-3 border-l border-dashed border-[#DC143C]/35 pl-6 space-y-4">
                                {detailSlots.map((slot: any, sIdx: number) => (
                                  <div key={slot.id || sIdx} className="relative pb-5 last:pb-0">
                                    <span className="absolute -left-[37px] top-0 flex h-6 w-6 items-center justify-center rounded-full border border-[#DC143C] bg-black text-[#DC143C] text-[11px] font-mono font-bold">
                                      {sIdx + 1}
                                    </span>
                                    <div className="rounded-[8px] border border-[#353534] bg-black/45 p-4 flex justify-between gap-4 items-start">
                                      <div className="space-y-1.5 flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="bg-[#DC143C] text-black text-[9px] font-mono font-black px-1.5 py-0.5 rounded-[3px] tracking-wide shrink-0">
                                            {slot.arrivalTime}
                                          </span>
                                          <h4 className="text-sm font-mono font-bold uppercase tracking-wide text-white truncate">{slot.name}</h4>
                                        </div>
                                        <p className="text-[9.5px] font-mono text-neutral-400">
                                          {slot.category.toUpperCase()} • ₹{slot.estimatedCostPerHead}/head
                                        </p>
                                        {slot.note && (
                                          <p className="text-[11px] text-neutral-400 leading-normal font-sans">
                                            {slot.note}
                                          </p>
                                        )}
                                      </div>
                                      
                                      <div className="shrink-0 w-[84px] h-[48px] relative rounded-[4px] overflow-hidden border border-neutral-850 bg-neutral-900 self-start mt-0.5">
                                        <img
                                          src={getSlotImageUrl(slot)}
                                          alt={slot.name}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = getFallbackImageUrl(slot.category);
                                          }}
                                        />
                                      </div>
                                    </div>
                                    {sIdx < detailSlots.length - 1 && (
                                      <div className="py-2.5 text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-500 pl-4 border-l border-dashed border-[#DC143C]/20 -ml-6 my-1">
                                        <div>🚗 commute {Math.min(slot.travelToNextMinutes || 15, 12)} mins (~₹{slot.travelToNextCost || Math.max(20, Math.round((slot.travelToNextMinutes || 15) * 1.5))})</div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>

                              <div className="rounded-[8px] border border-[#353534] bg-[#131313]/95 p-4">
                                <p className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#00E1AB]">Detailed Commute & Score Metrics</p>
                                <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-4 text-[10.5px] font-mono text-neutral-400">
                                  <div>Cab Cost: <span className="text-white font-bold">~₹{activePlan.avgCabCost} avg</span></div>
                                  <div>Train Cost: <span className="text-white font-bold">~₹{activePlan.avgTrainCost} avg</span></div>
                                  <div>Avg Train time: <span className="text-white font-bold">~{activePlan.avgTrainTime} mins</span></div>
                                  <div>Fairness Index: <span className="text-white font-bold">{(activePlan.travelFairnessScore * 10).toFixed(1)}/10</span></div>
                                  <div>Experience: <span className="text-white font-bold">{(activePlan.experienceScore * 10).toFixed(1)}/10</span></div>
                                  <div>Budget Match: <span className="text-white font-bold">{(activePlan.budgetScore * 10).toFixed(1)}/10</span></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>

                {/* 2. Desktop Bento View (hidden md:grid) */}
                <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
                  {plans.map((plan, idx) => {
                    const voteCount = votes[plan.id] || 0;
                    const isFeatured = idx === 0;
                    const placesText = plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((s: any) => s.name).join(' → ') || 'No places specified';

                    return (
                      <Card 
                        key={plan.id} 
                        style={{
                          backgroundImage: `linear-gradient(to bottom, rgba(14, 14, 14, 0.4) 0%, rgba(14, 14, 14, 0.95) 60%, rgba(14, 14, 14, 1) 100%), url(${getPlanBackgroundImage(plan)})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center 20%',
                          backgroundRepeat: 'no-repeat',
                        }}
                        className="h-full min-h-[560px] border border-[#353534] bg-[#0e0e0e]/85 p-6 shadow-lg backdrop-blur-md flex flex-col justify-between gap-5 rounded-[12px] hover:border-[#DC143C]/40 transition-all overflow-hidden"
                      >
                        <div className="space-y-4">
                          <div className="flex justify-between items-start gap-2 border-b border-[#353534]/50 pb-3.5">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest font-mono flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5 text-[#DC143C]" /> ZONE: {plan.meetupZone.toUpperCase()}
                                </span>
                                {isFeatured && (
                                  <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[7.5px] font-mono font-bold py-0 px-1.5 uppercase tracking-widest rounded-[3px]">
                                    TOP RECOMMENDATION
                                  </Badge>
                                )}
                              </div>
                              <h3 className="text-[22px] font-sans font-extrabold text-white mt-1.5 uppercase tracking-wide truncate">{plan.name}</h3>
                              <p className="text-[11px] text-neutral-400 font-sans tracking-wide leading-relaxed mt-0.5 line-clamp-1">{plan.tagline}</p>
                            </div>
                            <div className="bg-[#DC143C]/10 border border-[#DC143C]/20 text-[#DC143C] rounded-[4px] flex items-center gap-1.5 text-[9px] font-mono font-bold py-1 px-3 uppercase tracking-widest shrink-0 h-fit">
                              <Vote className="h-3.5 w-3.5" />
                              {voteCount} VOTES
                            </div>
                          </div>

                          <div className="flex justify-between items-center gap-4 bg-black/20 p-2.5 rounded-[6px] border border-[#353534]/30">
                            <div className="min-w-0">
                              <span className="text-[8.5px] uppercase font-mono text-neutral-500 tracking-wider font-bold block">PLACES</span>
                              <p className="text-[11.5px] font-sans font-bold text-white tracking-wide leading-snug truncate mt-0.5">{placesText}</p>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPlanId(plan.id);
                              }}
                              className="h-7 w-7 rounded-[4px] border border-[#353534] bg-stone-950/60 hover:bg-stone-900 text-neutral-400 hover:text-white shrink-0 cursor-pointer"
                            >
                              <BookOpen className="h-3.5 w-3.5 text-[#DC143C]" />
                            </Button>
                          </div>

                          {/* Stats Row */}
                          <div className="grid grid-cols-3 gap-2 bg-[#131313]/95 border border-[#353534]/40 rounded-[8px] p-3 text-[10px] font-mono text-neutral-400">
                            <div className="flex items-center gap-2">
                              <Wallet className="h-4 w-4 text-[#DC143C] shrink-0" />
                              <div>
                                <span className="text-[8px] text-neutral-500 uppercase tracking-wider block leading-none font-mono">COST/HEAD</span>
                                <span className="text-white font-sans font-extrabold text-[13px] mt-0.5 block">₹{plan.totalEstimatedCostPerHead}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 border-l border-[#353534]/50 pl-2">
                              <Clock className="h-4 w-4 text-[#DC143C] shrink-0" />
                              <div>
                                <span className="text-[8px] text-neutral-500 uppercase tracking-wider block leading-none font-mono">AVG CAB TIME</span>
                                <span className="text-white font-sans font-extrabold text-[13px] mt-0.5 block">{plan.avgCabTime} Mins</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 border-l border-[#353534]/50 pl-2">
                              <Star className="h-4 w-4 text-[#DC143C] shrink-0" />
                              <div>
                                <span className="text-[8px] text-neutral-500 uppercase tracking-wider block leading-none font-mono">PLAN SCORE</span>
                                <span className="text-[#DC143C] font-sans font-extrabold text-[13px] mt-0.5 block">{(plan.score * 10).toFixed(1)}/10</span>
                              </div>
                            </div>
                          </div>

                          {/* Timeline Section */}
                          <div className="pt-4 border-t border-[#353534]/55 text-left">
                            <h4 className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#DC143C] mb-3.5">ITINERARY TIMELINE</h4>
                            
                            <div className="relative border-l border-dashed border-[#DC143C]/35 pl-4 ml-1.5 space-y-4">
                              {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).slice(0, 2).map((slot: any, sIdx: number) => (
                                <div key={sIdx} className="relative flex justify-between items-start gap-2.5">
                                  <span className="absolute -left-[26px] top-0.5 w-[20px] h-[20px] flex items-center justify-center bg-[#0e0e0e] border border-[#DC143C] text-[#DC143C] text-[9.5px] font-mono rounded-full shrink-0 font-bold">
                                    {slot.slotOrder}
                                  </span>
                                  <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="bg-[#DC143C] text-black text-[9px] font-mono font-black px-1.5 py-0.5 rounded-[3px] tracking-wide shrink-0">
                                        {slot.arrivalTime}
                                      </span>
                                      <h4 className="text-[11.5px] font-sans font-bold text-white uppercase truncate tracking-wide">
                                        {slot.name}
                                      </h4>
                                    </div>
                                    <p className="text-[9.5px] font-sans text-neutral-400 font-medium">
                                      {slot.category.toUpperCase()} • ₹{slot.estimatedCostPerHead}/head
                                    </p>
                                    {slot.note && (
                                      <p className="text-[10px] text-neutral-400 leading-normal font-sans line-clamp-2">
                                        {slot.note}
                                      </p>
                                    )}
                                  </div>

                                  <div className="shrink-0 w-[84px] h-[48px] relative rounded-[4px] overflow-hidden border border-neutral-850 bg-neutral-900 self-start mt-0.5">
                                    <img
                                      src={getSlotImageUrl(slot)}
                                      alt={slot.name}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = getFallbackImageUrl(slot.category);
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>

                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPlanId(plan.id);
                              }}
                              className="w-full bg-[#111]/80 hover:bg-[#1a1919] border border-[#353534] text-neutral-300 hover:text-white font-sans font-bold uppercase tracking-widest text-[9.5px] py-2.5 rounded-[6px] transition-colors mt-4 cursor-pointer flex items-center justify-center gap-1"
                            >
                              View Full Itinerary <ArrowRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Voting Action */}
                        {group.votingStatus === 'OPEN' && (
                          <Button
                            disabled={isCasting || userVotedPlanId === plan.id}
                            onClick={(e) => {
                               e.stopPropagation();
                               handleVoteCast(plan.id);
                            }}
                            className={`w-full font-sans font-extrabold rounded-[8px] uppercase tracking-widest text-[9.5px] py-3.5 shadow-md transition-all duration-200 cursor-pointer ${
                              userVotedPlanId === plan.id
                                ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/20 text-[#00E1AB]'
                                : 'bg-[#DC143C] hover:bg-[#B80F2E] text-black font-black'
                            }`}
                          >
                            {userVotedPlanId === plan.id ? (
                              <>
                                <Check className="mr-2 h-4 w-4 text-[#00E1AB]" /> VOTE REGISTERED
                              </>
                            ) : (
                              <>
                                <Vote className="mr-2 h-4 w-4" /> VOTE FOR THIS
                              </>
                            )}
                          </Button>
                        )}
                      </Card>
                    );
                  })}

                  {/* 3. Live Vote Distribution Bento Block */}
                  <Card id="vote-distribution" className="border border-[#353534] bg-[#0e0e0e]/85 p-6 shadow-lg rounded-[12px] flex flex-col justify-between gap-5 min-h-[300px]">
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest flex items-center gap-1.5 font-mono">
                        <Vote className="h-3.5 w-3.5 text-[#DC143C]" /> Live Consensus
                      </span>
                      <h3 className="text-base font-sans font-extrabold text-white uppercase tracking-wider">Vote Distribution</h3>
                      <p className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed">
                        Visualizing alignments across proposed routes.
                      </p>
                    </div>

                    <div className="space-y-3.5 flex-1 py-1">
                      {plans.map((p) => {
                        const pVotes = votes[p.id] || 0;
                        const totalVotes = Object.values(votes).reduce((sum, v) => sum + v, 0);
                        const pct = totalVotes > 0 ? (pVotes / totalVotes) * 100 : 0;
                        return (
                          <div key={p.id} className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-white font-sans font-extrabold uppercase truncate max-w-[150px]">{p.name}</span>
                              <span className="text-neutral-400 font-mono font-bold">{pVotes} ({pct.toFixed(0)}%)</span>
                            </div>
                            <div className="h-1.5 bg-neutral-950 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-[#DC143C] transition-all duration-500 rounded-full" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-3.5 border-t border-[#353534]/50 text-center font-mono text-[9px] text-neutral-500 uppercase tracking-widest">
                      TOTAL VOTES REGISTERED: {Object.values(votes).reduce((sum, v) => sum + v, 0)}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Generate Again options for Admin */}
            {isAdmin && group.status !== 'COMPLETED' && group.status !== 'ARCHIVED' && (
              <Card className="border border-stone-900 bg-[#0e0e0e]/80 backdrop-blur-md p-6 rounded-[8px] space-y-4">
                <div className="flex items-center gap-2 border-b border-[#353534] pb-3">
                  <RefreshCw className="h-4.5 w-4.5 text-[#DC143C]" />
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                    Generate Again (Admin Panel)
                  </h3>
                </div>
                <p className="text-[10.5px] text-neutral-400 font-sans leading-relaxed">
                  Unhappy with the current options? Regenerate with specific planning constraints.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                  {[
                    { id: 'Cheaper', label: 'Cheaper outing' },
                    { id: 'More Activities', label: 'More activities' },
                    { id: 'More Food', label: 'More cafes/food' },
                    { id: 'More Romantic', label: 'More romantic' },
                    { id: 'More Indoor', label: 'More indoor places' },
                    { id: 'Less Travel', label: 'Minimize travel' },
                  ].map((opt) => {
                    const isSelected = selectedOptions.includes(opt.id);
                    return (
                      <label key={opt.id} className="cursor-pointer flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-400 select-none">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedOptions(prev =>
                              prev.includes(opt.id) ? prev.filter(x => x !== opt.id) : [...prev, opt.id]
                            );
                          }}
                          className="h-3.5 w-3.5 rounded border-[#353534] bg-black text-[#DC143C] focus:ring-0 accent-[#DC143C] cursor-pointer"
                        />
                        <span className={isSelected ? 'text-[#DC143C]' : 'text-neutral-400'}>
                          {opt.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <Button
                  onClick={() => handlePlanGeneration(selectedOptions)}
                  disabled={isGenerating}
                  className="w-full mt-3 bg-[#DC143C] hover:bg-[#B80F2E] text-black text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] py-3 transition-all cursor-pointer shadow-[0_0_15px_rgba(220,20,60,0.2)] flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-black" />
                      COOKING NEW PLANS...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 text-black" />
                      REGENERATE ITINERARIES
                    </>
                  )}
                </Button>
              </Card>
            )}

            {/* Admin Close Button (rendered at bottom during open voting phase) */}
            {isAdmin && group.votingStatus === 'OPEN' && (
              <div className="pt-2">
                <Button
                  variant="destructive"
                  onClick={handleCloseVoting}
                  disabled={isClosing}
                  className="w-full bg-red-950/45 text-red-500 border border-red-900/50 hover:bg-red-950/80 hover:text-red-400 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] py-3.5 transition-all cursor-pointer"
                >
                  Close Voting & Declare Winner
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 4. Details Submission & Member overview (Locked post-generation to avoid clutter) */}
        {!isVotingOrClosed && (
          <div className="flex flex-col md:grid md:grid-cols-12 gap-6 pt-4 text-left">
            
            {/* Left: Sidebar Member Sync Status */}
            <aside className="md:col-span-3 space-y-6">
              
              {/* Member Sync Card */}
              <div className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] p-6 relative overflow-hidden rounded-[8px]">
                <div className="scanning-line opacity-20" />
                
                <h3 className="font-mono text-xs font-bold text-[#DC143C] uppercase mb-6 flex justify-between items-center tracking-wider">
                  Member Sync
                  <span className="text-neutral-400 text-[9px] font-bold">
                    {members.length > 0 
                      ? Math.round((members.filter((m: any) => submittedBudgetUserIds.includes(m.userId) && locations.some((l: any) => l.userId === m.userId)).length / members.length) * 100)
                      : 0}% ACTIVE
                  </span>
                </h3>

                <ul className="space-y-4">
                  {members.map((member: any) => {
                    const hasBudget = submittedBudgetUserIds.includes(member.userId);
                    const hasLocation = locations.some((l: any) => l.userId === member.userId);
                    const isSynced = hasBudget && hasLocation;

                    return (
                      <li key={member.userId} className={`flex items-center gap-3 transition-all ${isSynced ? '' : 'opacity-75'}`}>
                        <div className={`w-9 h-9 border p-0.5 rounded-[4px] flex-shrink-0 ${isSynced ? 'border-[#DC143C] shadow-[0_0_8px_rgba(220,20,60,0.25)] bg-[#DC143C]/5' : 'border-[#353534]'}`}>
                          {member.imageUrl ? (
                            <img src={member.imageUrl} alt={member.name} className="w-full h-full object-cover rounded-[2px]" />
                          ) : (
                            <div className="w-full h-full bg-stone-900 border border-[#353534] flex items-center justify-center font-mono font-bold text-[10px] uppercase text-[#DC143C] rounded-[2px]">
                              {member.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="font-mono font-bold text-[11px] text-white uppercase truncate">
                              {member.name}
                            </p>
                            {member.userId === currentUser.id && (
                              <span className="text-[7px] font-mono font-bold bg-[#DC143C]/10 text-[#DC143C] px-1 border border-[#DC143C]/20 rounded-[2px]">YOU</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 font-mono text-[8px]">
                            <span className="flex items-center gap-0.5">
                              <span className="text-neutral-500">BUDGET:</span>
                              {hasBudget && member.budget !== undefined && member.budget !== null ? (
                                <span className="text-white font-bold">₹{member.budget}</span>
                              ) : (
                                <span className="text-neutral-600 font-medium italic">PENDING</span>
                              )}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-neutral-850" />
                            <span className="flex items-center gap-0.5">
                              <span className="text-neutral-500">LOC:</span>
                              {hasLocation ? (
                                <span className="text-[#00E1AB] font-bold">SYNCED</span>
                              ) : (
                                <span className="text-neutral-600 font-medium italic">PENDING</span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${isSynced ? 'border-[#00E1AB]/30 bg-[#00E1AB]/5 text-[#00E1AB]' : 'border-[#353534] bg-stone-950 text-neutral-700'}`}>
                            {isSynced ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-neutral-750" />
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {isAdmin && (
                  <div className="pt-6 border-t border-[#353534]/50 mt-6">
                    <Button
                      type="button"
                      onClick={() => handlePlanGeneration()}
                      disabled={isGenerating || members.length === 0}
                      className="w-full bg-[#DC143C] hover:bg-[#B80F2E] text-black text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] py-3.5 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-[0_0_15px_rgba(220,20,60,0.3)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin text-black" />
                          COOKING ITINERARIES...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4 text-black fill-black" />
                          GENERATE ITINERARIES
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

            </aside>

            {/* Center/Right: Data Collection Flow */}
            <form onSubmit={handleUnifiedSubmit} className="md:col-span-9 space-y-6">
              
              {/* Protocol Step 1: Location */}
              <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <span className="text-[#DC143C]"></span>Enter Location
                    {currentUser.location !== null && (
                      <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider">
                        ACCEPTED
                      </Badge>
                    )}
                  </h2>
                  <MapPin className="text-[#DC143C] h-4 w-4" />
                </div>
                <div className="p-5 space-y-4">
                  <div className="relative h-40 w-full bg-[#1c1b1b] border border-[#353534] rounded-[4px] overflow-hidden flex flex-col justify-center px-6 sm:px-10 space-y-5">
                    <div className="absolute inset-0 opacity-20 pointer-events-none"></div>
                    <div className="scanning-line opacity-10"></div>
                    
                    <div className="space-y-1.5 relative z-10">
                      <label className="font-mono text-[8.5px] text-[#DC143C] uppercase tracking-widest font-bold">Enter nearest local station</label>
                      <div className="relative flex items-center">
                        <Input 
                          value={addressVal}
                          onChange={(e) => setAddressVal(e.target.value)}
                          className="w-full bg-black/60 border border-[#353534] py-5 pl-10 pr-24 text-xs font-mono focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] text-white rounded-[4px]" 
                          placeholder="QUERY COORDINATES (CITY, AREA, OR NEIGHBORHOOD)" 
                          type="text"
                          required
                          disabled={isSubmittingDetails}
                        />
                        <button
                          type="button"
                          onClick={handleAutoDetect}
                          disabled={isSubmittingDetails}
                          className="absolute right-2.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-850 text-[8.5px] font-mono font-bold text-neutral-300 rounded-[4px] border border-stone-800 transition-colors uppercase tracking-wider"
                        >
                          Auto Detect
                        </button>
                      </div>
                    </div>
                  </div>

                </div>
              </section>

              <div className="grid md:grid-cols-2 gap-6">
                
                {/* Protocol Step 2: Budget */}
                <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <span className="text-[#DC143C]"></span> Budget
                      {currentUser.budget !== null && (
                        <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider">
                          ACCEPTED
                        </Badge>
                      )}
                    </h2>
                    <DollarSign className="text-[#DC143C] h-4 w-4" />
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-center space-y-2">
                    <label className="font-mono text-[8.5px] text-neutral-500 uppercase tracking-widest font-bold">Max Budget (INR)</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-neutral-400 font-mono text-xs">₹</span>
                      <Input 
                        value={budgetVal}
                        onChange={(e) => setBudgetVal(e.target.value)}
                        className="w-full bg-black/60 border border-[#353534] py-5 pl-7 pr-4 text-xs font-mono focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] text-white rounded-[4px]" 
                        placeholder="Enter your maximum budget" 
                        type="number"
                        min="50"
                        max="100000"
                        required
                        disabled={isSubmittingDetails}
                      />
                    </div>
                    <div className="flex items-center space-x-2 pt-2">
                      <input
                        id="travelIncluded"
                        type="checkbox"
                        checked={travelIncluded}
                        onChange={(e) => setTravelIncluded(e.target.checked)}
                        disabled={isSubmittingDetails}
                        className="h-3.5 w-3.5 rounded border-[#353534] bg-black text-[#DC143C] focus:ring-0 accent-[#DC143C] cursor-pointer"
                      />
                      <Label htmlFor="travelIncluded" className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-neutral-400 cursor-pointer">
                        Travel cost included? (Yes / No)
                      </Label>
                    </div>
                  </div>
                </section>

                {/* Protocol Step 3: Vibes */}
                <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <span className="text-[#DC143C]"></span>Vibe
                      {hasVibes && (
                        <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider">
                          ACCEPTED
                        </Badge>
                      )}
                    </h2>
                    <Heart className="text-[#DC143C] h-4 w-4" />
                  </div>
                  <div className="p-5 flex-1 flex flex-wrap gap-2 content-center items-center justify-start bg-[#0e0e0e]/40">
                    {AVAILABLE_VIBES.map((vibe) => {
                      const isSelected = selectedVibes.includes(vibe);
                      return (
                        <label key={vibe} className="cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => toggleVibe(vibe)}
                            disabled={isSubmittingDetails}
                            className="peer sr-only" 
                          />
                          <span className="inline-block px-3 py-1.5 font-mono text-[9px] font-bold border border-[#353534] bg-[#1c1b1b] text-neutral-400 peer-checked:border-[#DC143C] peer-checked:text-[#DC143C] peer-checked:bg-[#DC143C]/10 transition-all uppercase rounded-[4px] hover:border-stone-850">
                            {vibe}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>

              </div>

              {/* Submission Action */}
              <div className="flex flex-col md:flex-row items-center gap-6 pt-5 border-t border-[#353534]/50">
                <div className="flex-1 text-left">
                  <p className="text-[10px] text-neutral-500 font-sans italic mt-1.5 leading-normal">
                    Your location, budget threshold, and vibe criteria are compiled privately to isolate a coordinates centroid and optimal itineraries.
                  </p>
                </div>
                
                <Button 
                  type="submit" 
                  disabled={isSubmittingDetails || isSubmittingBudget || isSubmittingLocation || isSubmittingVibes}
                  className={`w-full md:w-auto px-10 py-5 font-mono font-bold text-sm uppercase tracking-widest hover:scale-105 active:scale-95 transition-all rounded-[4px] flex items-center justify-center gap-3 cursor-pointer ${
                    hasSubmittedSelf 
                      ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/30 text-[#00E1AB] hover:bg-[#00E1AB]/20 shadow-[0_0_15px_rgba(0,225,171,0.15)]'
                      : 'bg-[#DC143C] hover:bg-[#B80F2E] text-black shadow-[0_0_15px_rgba(220,20,60,0.3)] hover:shadow-[0_0_20px_rgba(220,20,60,0.55)]'
                  }`}
                >
                  {isSubmittingDetails ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-black" />
                      SYNCING DETAILS...
                    </>
                  ) : hasSubmittedSelf ? (
                    <>
                      <Check className="h-4 w-4 text-[#00E1AB]" />
                      DETAILS SYNCED & ACCEPTED
                    </>
                  ) : (
                    <>
                      SUBMIT MY DETAILS
                      <ArrowRight className="h-4 w-4 text-black" />
                    </>
                  )}
                </Button>
              </div>

            </form>
          </div>
        )}
      </div>
    </main>
  );
}
