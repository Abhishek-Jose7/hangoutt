'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, ArrowUpDown, RefreshCw, SlidersHorizontal, MapPin, Star, IndianRupee } from 'lucide-react';
import { getAdminPlaces } from '@/actions/admin';
import { toast } from 'sonner';

interface PlaceData {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  mandatoryCost: number;
  optionalCostMin: number;
  optionalCostMax: number;
  popularity: number;
  budgetFriendliness: number;
  overall: number;
  categories: string;
}

type SortField = 'name' | 'rating' | 'mandatoryCost' | 'overall';
type SortOrder = 'asc' | 'desc';

export default function AdminPlacesPage() {
  const [places, setPlaces] = useState<PlaceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const fetchPlaces = async () => {
    setLoading(true);
    try {
      const res = await getAdminPlaces();
      if (res.success) {
        setPlaces(res.data);
      } else {
        toast.error(res.error.message || 'Failed to fetch places from database.');
      }
    } catch (err) {
      console.error('Error fetching places:', err);
      toast.error('An unexpected error occurred while fetching places.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaces();
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc'); // default to descending for new fields
    }
  };

  // Get unique categories from all places
  const allCategories = React.useMemo(() => {
    const cats = new Set<string>();
    places.forEach((p) => {
      if (p.categories) {
        p.categories.split(',').forEach((c) => {
          const trimmed = c.trim().toUpperCase();
          if (trimmed) cats.add(trimmed);
        });
      }
    });
    return ['ALL', ...Array.from(cats)];
  }, [places]);

  // Filter & Sort places
  const filteredAndSortedPlaces = React.useMemo(() => {
    let result = [...places];

    // Search term filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.address?.toLowerCase().includes(term) ||
          p.categories?.toLowerCase().includes(term)
      );
    }

    // Category filter
    if (selectedCategory !== 'ALL') {
      result = result.filter((p) =>
        p.categories?.toUpperCase().includes(selectedCategory)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'rating') {
        comparison = (a.rating || 0) - (b.rating || 0);
      } else if (sortField === 'mandatoryCost') {
        comparison = a.mandatoryCost - b.mandatoryCost;
      } else if (sortField === 'overall') {
        comparison = (a.overall || 0) - (b.overall || 0);
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [places, searchTerm, selectedCategory, sortField, sortOrder]);

  return (
    <PageContainer
      title="Database Places"
      subtitle="View, search, and verify all discovery venues and experiences registered in the Hangout engine."
    >
      <div className="space-y-6 relative z-10 text-sm font-sans text-white pb-20">
        
        {/* Controls Card */}
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
              
              {/* Search input */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                <Input
                  placeholder="Search by name, address, or category..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 bg-stone-950/80 border border-stone-850 text-white rounded-[8px] text-xs font-mono uppercase tracking-wider focus-visible:ring-1 focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] h-9"
                />
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Category Selector */}
                <div className="flex items-center gap-1.5 bg-stone-950 border border-stone-850 px-3 py-1.5 rounded-[8px]">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-neutral-500" />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-transparent text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-350 outline-none cursor-pointer"
                  >
                    {allCategories.map((cat) => (
                      <option key={cat} value={cat} className="bg-stone-950 text-white">
                        {cat.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Total Count */}
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 px-3 py-2 bg-stone-900/40 rounded-[8px] border border-stone-900">
                  Total: {filteredAndSortedPlaces.length} / {places.length}
                </span>

                {/* Refresh button */}
                <Button
                  onClick={fetchPlaces}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-3.5 py-2"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-[#DC143C] ${loading ? 'animate-spin' : ''}`} />
                </Button>

              </div>

            </div>
          </CardContent>
        </Card>

        {/* Tabular Data Panel */}
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md overflow-hidden">
          <CardHeader className="border-b border-stone-900/40 pb-4">
            <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">
              Venues Table
            </CardTitle>
            <CardDescription className="text-xs text-neutral-450 font-sans font-light">
              Interactive grid listing details, costs, and scoring metrics for all verified places.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mb-4" />
                <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono font-bold">Querying Places Database...</p>
              </div>
            ) : filteredAndSortedPlaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
                <MapPin className="h-10 w-10 text-neutral-600 mb-2" />
                <p className="text-xs font-mono uppercase tracking-wider">No venues found in database</p>
                <p className="text-[10px] text-neutral-600 font-sans mt-1">Try refreshing or run the discovery pipeline.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-900/80 bg-stone-950/80 text-[10px] font-mono uppercase tracking-widest text-neutral-500 select-none">
                      <th className="py-3 px-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('name')}>
                        <div className="flex items-center gap-1.5">
                          Name
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="py-3 px-4 font-semibold">Category</th>
                      <th className="py-3 px-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('rating')}>
                        <div className="flex items-center gap-1.5">
                          Rating
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="py-3 px-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('mandatoryCost')}>
                        <div className="flex items-center gap-1.5">
                          Mandatory Cost
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="py-3 px-4 font-semibold">Optional Range</th>
                      <th className="py-3 px-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('overall')}>
                        <div className="flex items-center gap-1.5">
                          Overall Score
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="py-3 px-4 font-semibold">Address</th>
                      <th className="py-3 px-4 font-semibold">Coords</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-900/45 text-neutral-300 font-sans text-xs">
                    {filteredAndSortedPlaces.map((place) => (
                      <tr 
                        key={place.id} 
                        className="hover:bg-stone-900/20 transition-colors group"
                      >
                        {/* Name */}
                        <td className="py-3 px-4 font-semibold text-white group-hover:text-[#DC143C] transition-colors max-w-xs truncate">
                          {place.name}
                        </td>
                        
                        {/* Category */}
                        <td className="py-3 px-4 font-mono text-[9px] uppercase tracking-wider text-neutral-450">
                          {place.categories || '-'}
                        </td>
                        
                        {/* Rating */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                            <span className="font-mono text-white">{Number(place.rating || 0).toFixed(1)}</span>
                            <span className="text-[10px] text-neutral-500">({place.reviewCount || 0})</span>
                          </div>
                        </td>
                        
                        {/* Mandatory Cost */}
                        <td className="py-3 px-4 font-mono text-neutral-200">
                          <div className="flex items-center">
                            <IndianRupee className="h-3 w-3 text-neutral-500 mr-0.5" />
                            {place.mandatoryCost}
                          </div>
                        </td>

                        {/* Optional Cost */}
                        <td className="py-3 px-4 font-mono text-neutral-450 text-[11px]">
                          <div className="flex items-center">
                            <IndianRupee className="h-2.5 w-2.5 text-neutral-500 mr-0.5" />
                            {place.optionalCostMin} - {place.optionalCostMax}
                          </div>
                        </td>

                        {/* Overall Score */}
                        <td className="py-3 px-4 font-mono">
                          <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-bold ${
                            place.overall >= 0.8 
                              ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/60'
                              : place.overall >= 0.5
                              ? 'bg-amber-950/40 text-amber-400 border border-amber-900/60'
                              : 'bg-stone-900 text-neutral-400 border border-stone-800'
                          }`}>
                            {Number(place.overall || 0).toFixed(2)}
                          </span>
                        </td>

                        {/* Address */}
                        <td className="py-3 px-4 text-neutral-400 max-w-xs truncate text-[11px]" title={place.address}>
                          {place.address || '-'}
                        </td>

                        {/* Coords */}
                        <td className="py-3 px-4 font-mono text-[10px] text-neutral-500 whitespace-nowrap">
                          {Number(place.lat).toFixed(4)}, {Number(place.lng).toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </PageContainer>
  );
}
