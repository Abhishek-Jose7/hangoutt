'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import SearchBar from '@/components/shared/SearchBar';
import CreateGroupDialog from '@/components/shared/CreateGroupDialog';
import JoinGroupDialog from '@/components/shared/JoinGroupDialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Users, Plus, LogIn, ArrowRight, FolderArchive, Activity, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { getUserGroupsAction } from '@/actions/groups';
import { toast } from 'sonner';

export default function GroupsPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  const loadGroups = async () => {
    try {
      const res = await getUserGroupsAction();
      if (res.success) {
        setGroups(res.data);
      } else {
        toast.error(res.error.message || 'Failed to fetch groups');
      }
    } catch (err) {
      console.error(err);
      toast.error('An error occurred while loading lobbies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGroups();
  }, []);

  // Filter & Search Logic
  const filteredGroups = groups.filter((group) => {
    if (group.status === 'DELETED') return false;
    
    const matchesSearch = group.name.toLowerCase().includes(search.toLowerCase()) || 
      (group.description && group.description.toLowerCase().includes(search.toLowerCase()));
    
    if (filter === 'ALL') {
      return matchesSearch && group.status !== 'ARCHIVED';
    }
    if (filter === 'ACTIVE') {
      return matchesSearch && group.status !== 'ARCHIVED';
    }
    if (filter === 'ARCHIVED') {
      return matchesSearch && group.status === 'ARCHIVED';
    }
    return matchesSearch;
  });

  return (
    <PageContainer
      title="Outing Lobbies"
      subtitle="Find your planning groups or start a new outing workspace."
      actions={
        <div className="flex gap-3 w-full sm:w-auto font-mono text-[10px]">
          <Button
            size="sm"
            onClick={() => setIsJoinOpen(true)}
            variant="outline"
            className="flex items-center gap-1.5 rounded-[8px] border-stone-800 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 font-bold uppercase tracking-widest px-4 py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <LogIn className="h-3.5 w-3.5 text-[#EB690B]" />
            Join Lobby
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="bg-[#EB690B] hover:bg-[#D4590A] text-white flex items-center gap-1.5 rounded-[8px] font-bold uppercase tracking-widest px-4 py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            New Lobby
          </Button>
        </div>
      }
    >
      <div className="space-y-6 text-sm font-sans">
        
        {/* Search & Filter Controls */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-stone-950/40 p-4 rounded-[12px] border border-stone-900/60 backdrop-blur-md">
          <div className="w-full md:max-w-md">
            <SearchBar value={search} onChange={setSearch} placeholder="Search lobbies..." />
          </div>
          
          <div className="flex rounded-[8px] border border-stone-900 p-0.5 bg-stone-950">
            {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-4 py-2 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[6px] transition cursor-pointer ${
                  filter === type
                    ? 'bg-[#EB690B] text-white shadow-md'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {type === 'ALL' ? 'All' : type === 'ACTIVE' ? 'Active' : 'Archived'}
              </button>
            ))}
          </div>
        </div>

        {/* Groups Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
            <Loader2 className="h-7 w-7 animate-spin text-[#EB690B] mb-4" />
            <p className="text-[10px] font-mono uppercase tracking-widest font-bold">Syncing Lobbies...</p>
          </div>
        ) : filteredGroups.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="relative overflow-hidden flex flex-col justify-between rounded-[12px] border border-stone-900/60 bg-stone-950/45 hover:border-[#EB690B]/30 hover:bg-stone-950/85 transition-all duration-300 shadow-lg group">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-sm font-bold text-white font-campus tracking-widest uppercase">{group.name}</CardTitle>
                    {group.status === 'ARCHIVED' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-900 border border-stone-850 px-2 py-0.5 text-[8px] font-mono font-bold uppercase text-neutral-500">
                        <FolderArchive className="h-2.5 w-2.5" />
                        Archived
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#00E5A0]/10 px-2 py-0.5 text-[8px] font-mono font-bold uppercase text-[#00E5A0] border border-[#00E5A0]/20">
                        <Activity className="h-2.5 w-2.5" />
                        {group.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <CardDescription className="line-clamp-2 text-xs text-neutral-450 mt-2 min-h-[32px] font-sans font-light">
                    {group.description || 'No description provided.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-[11px] font-mono text-neutral-400 space-y-2 pb-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-[#EB690B]" />
                    <span>{group.memberCount} Members joined</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] uppercase font-bold tracking-wider text-neutral-500">Invite Code:</span>
                    <span className="text-[#00E5A0] font-bold tracking-widest">{group.inviteCode}</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-3.5 border-t border-stone-900/40 flex justify-end bg-stone-950/20 px-6 pb-4 rounded-b-[12px]">
                  <Link
                    href={`/groups/${group.id}`}
                    className={buttonVariants({
                      variant: 'ghost',
                      size: 'sm',
                      className: 'text-[#EB690B] hover:text-[#EB690B]/80 font-mono font-bold p-0 hover:bg-transparent text-[10px] uppercase tracking-widest flex items-center gap-1 transition-all group-hover:translate-x-0.5',
                    })}
                  >
                    Open Workspace <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-stone-950/20 rounded-[12px] border border-stone-900/60 backdrop-blur-md">
            <Users className="h-8 w-8 text-stone-850 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-campus">No Lobbies Found</h3>
            <p className="text-[10px] text-neutral-500 max-w-xs mx-auto mt-1 font-mono uppercase tracking-wider">
              Create a lobby or enter an invite code to start collaborating.
            </p>
          </div>
        )}
      </div>

      {/* Interactive dialogues */}
      <CreateGroupDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <JoinGroupDialog isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </PageContainer>
  );
}
