'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, ArrowUpDown, RefreshCw, SlidersHorizontal, MapPin, Star, IndianRupee, Eye, EyeOff, Plus, Edit, Trash2 } from 'lucide-react';
import { getAdminPlaces, curatePlaceAction, addPlaceAction, updatePlaceAction, deletePlaceAction } from '@/actions/admin';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
  isFeatured: number;
  isHidden: number;
  boostFactor: number;
}

type SortField = 'name' | 'rating' | 'mandatoryCost' | 'overall';
type SortOrder = 'asc' | 'desc';

const initialFormValues = {
  name: '',
  address: '',
  lat: '',
  lng: '',
  rating: '4.5',
  reviewCount: '50',
  mandatoryCost: '0',
  optionalCostMin: '0',
  optionalCostMax: '0',
  categories: 'CAFE',
  isFeatured: false,
  isHidden: false,
  boostFactor: '1.0',
};

export default function AdminPlacesPage() {
  const [places, setPlaces] = useState<PlaceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState(initialFormValues);
  const [actionLoading, setActionLoading] = useState(false);

  const startEdit = (place: PlaceData) => {
    setEditingPlaceId(place.id);
    setFormValues({
      name: place.name || '',
      address: place.address || '',
      lat: String(place.lat || ''),
      lng: String(place.lng || ''),
      rating: String(place.rating || '4.0'),
      reviewCount: String(place.reviewCount || '0'),
      mandatoryCost: String(place.mandatoryCost || '0'),
      optionalCostMin: String(place.optionalCostMin || '0'),
      optionalCostMax: String(place.optionalCostMax || '0'),
      categories: place.categories || '',
      isFeatured: place.isFeatured === 1,
      isHidden: place.isHidden === 1,
      boostFactor: String(place.boostFactor || '1.0'),
    });
    setIsEditOpen(true);
  };

  const handleDelete = async (placeId: string) => {
    if (!confirm('Are you sure you want to delete this place? This will permanently remove it from both local SQLite and remote D1 databases.')) {
      return;
    }
    const previousPlaces = [...places];
    setPlaces(prev => prev.filter(p => p.id !== placeId));
    try {
      const res = await deletePlaceAction(placeId);
      if (res.success) {
        toast.success('Place deleted successfully.');
      } else {
        toast.error(res.error?.message || 'Failed to delete place.');
        setPlaces(previousPlaces);
      }
    } catch (err) {
      console.error('Delete action failed:', err);
      toast.error('An unexpected error occurred during deletion.');
      setPlaces(previousPlaces);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await addPlaceAction({
        name: formValues.name,
        address: formValues.address,
        lat: parseFloat(formValues.lat),
        lng: parseFloat(formValues.lng),
        rating: parseFloat(formValues.rating || '0'),
        reviewCount: parseInt(formValues.reviewCount || '0'),
        mandatoryCost: parseInt(formValues.mandatoryCost || '0'),
        optionalCostMin: parseInt(formValues.optionalCostMin || '0'),
        optionalCostMax: parseInt(formValues.optionalCostMax || '0'),
        categories: formValues.categories,
        isFeatured: formValues.isFeatured ? 1 : 0,
        isHidden: formValues.isHidden ? 1 : 0,
        boostFactor: parseFloat(formValues.boostFactor || '1.0'),
      });
      if (res.success) {
        toast.success('Place added successfully.');
        setIsCreateOpen(false);
        setFormValues(initialFormValues);
        fetchPlaces();
      } else {
        toast.error(res.error?.message || 'Failed to create place.');
      }
    } catch (err) {
      console.error('Create failed:', err);
      toast.error('An unexpected error occurred.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlaceId) return;
    setActionLoading(true);
    try {
      const res = await updatePlaceAction(editingPlaceId, {
        name: formValues.name,
        address: formValues.address,
        lat: parseFloat(formValues.lat),
        lng: parseFloat(formValues.lng),
        rating: parseFloat(formValues.rating || '0'),
        reviewCount: parseInt(formValues.reviewCount || '0'),
        mandatoryCost: parseInt(formValues.mandatoryCost || '0'),
        optionalCostMin: parseInt(formValues.optionalCostMin || '0'),
        optionalCostMax: parseInt(formValues.optionalCostMax || '0'),
        categories: formValues.categories,
        isFeatured: formValues.isFeatured ? 1 : 0,
        isHidden: formValues.isHidden ? 1 : 0,
        boostFactor: parseFloat(formValues.boostFactor || '1.0'),
      });
      if (res.success) {
        toast.success('Place updated successfully.');
        setIsEditOpen(false);
        setEditingPlaceId(null);
        setFormValues(initialFormValues);
        fetchPlaces();
      } else {
        toast.error(res.error?.message || 'Failed to update place.');
      }
    } catch (err) {
      console.error('Update failed:', err);
      toast.error('An unexpected error occurred.');
    } finally {
      setActionLoading(false);
    }
  };

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

  const handleCurate = async (placeId: string, updates: { isFeatured?: number; isHidden?: number; boostFactor?: number }) => {
    // Optimistic local update
    setPlaces(prev => prev.map(p => {
      if (p.id === placeId) {
        return {
          ...p,
          isFeatured: updates.isFeatured !== undefined ? updates.isFeatured : p.isFeatured,
          isHidden: updates.isHidden !== undefined ? updates.isHidden : p.isHidden,
          boostFactor: updates.boostFactor !== undefined ? updates.boostFactor : p.boostFactor,
        };
      }
      return p;
    }));

    // Find current record to merge
    const place = places.find(p => p.id === placeId);
    if (!place) return;

    const finalFeatured = updates.isFeatured !== undefined ? updates.isFeatured : place.isFeatured;
    const finalHidden = updates.isHidden !== undefined ? updates.isHidden : place.isHidden;
    const finalBoost = updates.boostFactor !== undefined ? updates.boostFactor : place.boostFactor;

    try {
      const res = await curatePlaceAction(placeId, finalFeatured, finalHidden, finalBoost);
      if (res.success) {
        toast.success('Curation parameters updated.');
      } else {
        toast.error(res.error?.message || 'Failed to update curation parameters.');
        fetchPlaces(); // Revert state
      }
    } catch (err) {
      console.error('Curation action failed:', err);
      toast.error('An unexpected error occurred during curation.');
      fetchPlaces(); // Revert state
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

                {/* Add Place button */}
                <Button
                  onClick={() => {
                    setFormValues(initialFormValues);
                    setIsCreateOpen(true);
                  }}
                  variant="outline"
                  size="sm"
                  className="border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-3.5 py-2 flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Add Place</span>
                </Button>

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
                      <th className="py-3 px-4 font-semibold">Featured</th>
                      <th className="py-3 px-4 font-semibold">Visibility</th>
                      <th className="py-3 px-4 font-semibold">Boost Factor</th>
                      <th className="py-3 px-4 font-semibold text-center">Actions</th>
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

                        {/* Featured */}
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleCurate(place.id, { isFeatured: place.isFeatured === 1 ? 0 : 1 })}
                            className="p-1 hover:bg-stone-900/40 rounded-[6px] transition-colors"
                          >
                            <Star 
                              className={`h-4 w-4 ${
                                place.isFeatured === 1 
                                  ? 'fill-amber-500 text-amber-500' 
                                  : 'text-stone-600 hover:text-stone-400'
                              }`} 
                            />
                          </button>
                        </td>

                        {/* Visibility */}
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleCurate(place.id, { isHidden: place.isHidden === 1 ? 0 : 1 })}
                            className="p-1 hover:bg-stone-900/40 rounded-[6px] transition-colors"
                          >
                            {place.isHidden === 1 ? (
                              <EyeOff className="h-4 w-4 text-rose-500 hover:text-rose-400" />
                            ) : (
                              <Eye className="h-4 w-4 text-emerald-500 hover:text-emerald-400" />
                            )}
                          </button>
                        </td>

                        {/* Boost Factor */}
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="10.0"
                            key={`${place.id}_${place.boostFactor}`}
                            defaultValue={place.boostFactor}
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val !== place.boostFactor) {
                                handleCurate(place.id, { boostFactor: val });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const val = parseFloat((e.target as HTMLInputElement).value);
                                if (!isNaN(val) && val !== place.boostFactor) {
                                  handleCurate(place.id, { boostFactor: val });
                                  (e.target as HTMLInputElement).blur();
                                }
                              }
                            }}
                            className="w-16 bg-stone-950/80 border border-stone-850 text-white rounded-[6px] text-xs font-mono p-1 text-center focus:ring-1 focus:ring-[#DC143C] outline-none"
                          />
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => startEdit(place)}
                              className="p-1 hover:bg-stone-900/40 rounded-[6px] transition-colors text-blue-400 hover:text-blue-300"
                              title="Edit venue"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(place.id)}
                              className="p-1 hover:bg-stone-900/40 rounded-[6px] transition-colors text-rose-500 hover:text-rose-450"
                              title="Delete venue"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create Place Modal */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-md bg-stone-950/95 border border-stone-900 shadow-2xl backdrop-blur-md rounded-[12px] p-6 text-white text-xs">
            <DialogHeader>
              <DialogTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">
                Add New Place
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateSubmit} className="space-y-3 mt-3">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Venue Name</label>
                <Input
                  required
                  placeholder="e.g. Creeda Board Game Cafe"
                  value={formValues.name}
                  onChange={(e) => setFormValues(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Address</label>
                <Input
                  placeholder="e.g. Fort, Mumbai"
                  value={formValues.address}
                  onChange={(e) => setFormValues(prev => ({ ...prev, address: e.target.value }))}
                  className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Latitude</label>
                  <Input
                    required
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 19.0178"
                    value={formValues.lat}
                    onChange={(e) => setFormValues(prev => ({ ...prev, lat: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Longitude</label>
                  <Input
                    required
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 72.8478"
                    value={formValues.lng}
                    onChange={(e) => setFormValues(prev => ({ ...prev, lng: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Category</label>
                  <select
                    value={formValues.categories}
                    onChange={(e) => setFormValues(prev => ({ ...prev, categories: e.target.value }))}
                    className="w-full bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 px-2 text-xs font-mono tracking-wider focus:outline-none"
                  >
                    <option value="CAFE">CAFE</option>
                    <option value="RESTAURANT">RESTAURANT</option>
                    <option value="BOWLING">BOWLING</option>
                    <option value="ARCADE">ARCADE</option>
                    <option value="MUSEUM">MUSEUM</option>
                    <option value="PARK">PARK</option>
                    <option value="MALL">MALL</option>
                    <option value="BOARD_GAMES">BOARD_GAMES</option>
                    <option value="ESCAPE_ROOM">ESCAPE_ROOM</option>
                    <option value="POTTERY">POTTERY</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Rating (0-5)</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={formValues.rating}
                    onChange={(e) => setFormValues(prev => ({ ...prev, rating: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Review Count</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.reviewCount}
                    onChange={(e) => setFormValues(prev => ({ ...prev, reviewCount: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Mandatory Cost (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.mandatoryCost}
                    onChange={(e) => setFormValues(prev => ({ ...prev, mandatoryCost: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Boost Factor</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={formValues.boostFactor}
                    onChange={(e) => setFormValues(prev => ({ ...prev, boostFactor: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Optional Min (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.optionalCostMin}
                    onChange={(e) => setFormValues(prev => ({ ...prev, optionalCostMin: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Optional Max (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.optionalCostMax}
                    onChange={(e) => setFormValues(prev => ({ ...prev, optionalCostMax: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 py-1.5 select-none">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formValues.isFeatured}
                    onChange={(e) => setFormValues(prev => ({ ...prev, isFeatured: e.target.checked }))}
                    className="accent-[#DC143C] h-4 w-4 bg-stone-950 border border-stone-850 rounded"
                  />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400">Featured Place</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formValues.isHidden}
                    onChange={(e) => setFormValues(prev => ({ ...prev, isHidden: e.target.checked }))}
                    className="accent-[#DC143C] h-4 w-4 bg-stone-950 border border-stone-850 rounded"
                  />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400">Hidden / Disabled</span>
                </label>
              </div>

              <DialogFooter className="-mx-6 -mb-6 mt-4 p-4 border-t border-stone-900 bg-stone-950/60 rounded-b-[12px] flex items-center justify-end gap-2">
                <Button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  variant="outline"
                  className="border-stone-850 hover:bg-stone-900 text-white font-mono uppercase tracking-wider text-[10px] h-8 rounded-[6px]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={actionLoading}
                  className="bg-[#DC143C] hover:bg-[#B22222] text-white font-mono uppercase tracking-wider text-[10px] h-8 rounded-[6px] px-4 flex items-center gap-1"
                >
                  {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Save Place</span>
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit Place Modal */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-md bg-stone-950/95 border border-stone-900 shadow-2xl backdrop-blur-md rounded-[12px] p-6 text-white text-xs">
            <DialogHeader>
              <DialogTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">
                Edit Place Details
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditSubmit} className="space-y-3 mt-3">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Venue Name</label>
                <Input
                  required
                  placeholder="e.g. Creeda Board Game Cafe"
                  value={formValues.name}
                  onChange={(e) => setFormValues(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Address</label>
                <Input
                  placeholder="e.g. Fort, Mumbai"
                  value={formValues.address}
                  onChange={(e) => setFormValues(prev => ({ ...prev, address: e.target.value }))}
                  className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Latitude</label>
                  <Input
                    required
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 19.0178"
                    value={formValues.lat}
                    onChange={(e) => setFormValues(prev => ({ ...prev, lat: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Longitude</label>
                  <Input
                    required
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 72.8478"
                    value={formValues.lng}
                    onChange={(e) => setFormValues(prev => ({ ...prev, lng: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans placeholder-neutral-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Category</label>
                  <select
                    value={formValues.categories}
                    onChange={(e) => setFormValues(prev => ({ ...prev, categories: e.target.value }))}
                    className="w-full bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 px-2 text-xs font-mono tracking-wider focus:outline-none"
                  >
                    <option value="CAFE">CAFE</option>
                    <option value="RESTAURANT">RESTAURANT</option>
                    <option value="BOWLING">BOWLING</option>
                    <option value="ARCADE">ARCADE</option>
                    <option value="MUSEUM">MUSEUM</option>
                    <option value="PARK">PARK</option>
                    <option value="MALL">MALL</option>
                    <option value="BOARD_GAMES">BOARD_GAMES</option>
                    <option value="ESCAPE_ROOM">ESCAPE_ROOM</option>
                    <option value="POTTERY">POTTERY</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Rating (0-5)</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={formValues.rating}
                    onChange={(e) => setFormValues(prev => ({ ...prev, rating: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Review Count</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.reviewCount}
                    onChange={(e) => setFormValues(prev => ({ ...prev, reviewCount: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Mandatory Cost (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.mandatoryCost}
                    onChange={(e) => setFormValues(prev => ({ ...prev, mandatoryCost: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Boost Factor</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={formValues.boostFactor}
                    onChange={(e) => setFormValues(prev => ({ ...prev, boostFactor: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Optional Min (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.optionalCostMin}
                    onChange={(e) => setFormValues(prev => ({ ...prev, optionalCostMin: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-neutral-450">Optional Max (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    value={formValues.optionalCostMax}
                    onChange={(e) => setFormValues(prev => ({ ...prev, optionalCostMax: e.target.value }))}
                    className="bg-stone-950 border border-stone-850 text-white rounded-[6px] h-8 text-xs font-sans"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 py-1.5 select-none">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formValues.isFeatured}
                    onChange={(e) => setFormValues(prev => ({ ...prev, isFeatured: e.target.checked }))}
                    className="accent-[#DC143C] h-4 w-4 bg-stone-950 border border-stone-850 rounded"
                  />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400">Featured Place</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formValues.isHidden}
                    onChange={(e) => setFormValues(prev => ({ ...prev, isHidden: e.target.checked }))}
                    className="accent-[#DC143C] h-4 w-4 bg-stone-950 border border-stone-850 rounded"
                  />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400">Hidden / Disabled</span>
                </label>
              </div>

              <DialogFooter className="-mx-6 -mb-6 mt-4 p-4 border-t border-stone-900 bg-stone-950/60 rounded-b-[12px] flex items-center justify-end gap-2">
                <Button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  variant="outline"
                  className="border-stone-850 hover:bg-stone-900 text-white font-mono uppercase tracking-wider text-[10px] h-8 rounded-[6px]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={actionLoading}
                  className="bg-[#DC143C] hover:bg-[#B22222] text-white font-mono uppercase tracking-wider text-[10px] h-8 rounded-[6px] px-4 flex items-center gap-1"
                >
                  {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Update Place</span>
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </PageContainer>
  );
}
