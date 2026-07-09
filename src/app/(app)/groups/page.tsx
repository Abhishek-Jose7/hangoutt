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
import { GroupCardSkeleton } from '@/components/shared/BasicSkeleton';

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
      toast.error('An error occurred while loading Groups.');
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
      title="Group Control"
      subtitle="SYNC GROUP WORKSPACES // CREATE OR JOIN A PLANNING PROTOCOL"
      actions={
        <div className="flex gap-3 w-full sm:w-auto font-mono text-[10px]">
          <Button
            size="sm"
            onClick={() => setIsJoinOpen(true)}
            variant="outline"
            className="flex items-center gap-1.5 rounded-[4px] border-[#353534] bg-[#0e0e0e]/70 hover:bg-stone-900 text-neutral-300 font-bold uppercase tracking-widest px-4 py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <LogIn className="h-3.5 w-3.5 text-[#DC143C]" />
            Join Group
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="bg-[#DC143C] hover:bg-[#B80F2E] text-white flex items-center gap-1.5 rounded-[4px] font-bold uppercase tracking-widest px-4 py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-[0_0_15px_rgba(220,20,60,0.25)]"
          >
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      }
    >
      <div className="space-y-6 text-sm font-sans">
        
        {/* Search & Filter Controls */}
        <div className="relative overflow-hidden flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-[#0e0e0e]/70 p-4 rounded-[4px] border border-[#353534] backdrop-blur-md">
          <div className="absolute left-0 top-0 h-full w-1 bg-[#DC143C]" />
          <div className="w-full md:max-w-md">
            <SearchBar value={search} onChange={setSearch} placeholder="Search Groups..." />
          </div>
          
          <div className="flex rounded-[4px] border border-[#353534] p-0.5 bg-black/60">
            {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-4 py-2 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[3px] transition cursor-pointer ${
                  filter === type
                    ? 'bg-[#DC143C] text-white shadow-[0_0_10px_rgba(220,20,60,0.22)]'
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <GroupCardSkeleton />
            <GroupCardSkeleton />
            <GroupCardSkeleton />
          </div>
        ) : filteredGroups.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="relative overflow-hidden flex flex-col justify-between rounded-[4px] border border-[#353534] bg-[#0e0e0e]/70 hover:border-[#DC143C]/50 hover:bg-stone-950/85 transition-all duration-300 shadow-lg group">
                <div className="absolute left-0 top-0 h-full w-1 bg-[#DC143C]/80 opacity-60 group-hover:opacity-100 transition-opacity" />
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-sm font-bold text-white font-mono tracking-widest uppercase">{group.name}</CardTitle>
                    {group.status === 'ARCHIVED' ? (
                      <span className="inline-flex items-center gap-1 rounded-[4px] bg-stone-900 border border-stone-850 px-2 py-0.5 text-[8px] font-mono font-bold uppercase text-neutral-500">
                        <FolderArchive className="h-2.5 w-2.5" />
                        Archived
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#00E5A0]/10 px-2 py-0.5 text-[8px] font-mono font-bold uppercase text-[#00E5A0] border border-[#00E5A0]/20">
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
                    <Users className="h-3.5 w-3.5 text-[#DC143C]" />
                    <span>{group.memberCount} Members joined</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] uppercase font-bold tracking-wider text-neutral-500">Invite Code:</span>
                    <span className="text-[#DC143C] font-bold tracking-widest">{group.inviteCode}</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-3.5 border-t border-[#353534] flex justify-end bg-black/20 px-6 pb-4 rounded-b-[4px]">
                  <Link
                    href={`/groups/${group.id}`}
                    className={buttonVariants({
                      variant: 'ghost',
                      size: 'sm',
                      className: 'text-[#DC143C] hover:text-[#DC143C]/80 font-mono font-bold p-0 hover:bg-transparent text-[10px] uppercase tracking-widest flex items-center gap-1 transition-all group-hover:translate-x-0.5',
                    })}
                  >
                    Open Workspace <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-[#0e0e0e]/70 rounded-[4px] border border-[#353534] backdrop-blur-md">
            <Users className="h-8 w-8 text-stone-850 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">No Groups Found</h3>
            <p className="text-[10px] text-neutral-500 max-w-xs mx-auto mt-1 font-mono uppercase tracking-wider">
              Create a Group or enter an invite code to start collaborating.
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
