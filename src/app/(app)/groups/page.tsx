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
        <div className="flex gap-2 w-full sm:w-auto font-sans text-xs">
          <Button
            size="sm"
            onClick={() => setIsJoinOpen(true)}
            variant="outline"
            className="flex items-center gap-1.5 rounded-lg border-neutral-800 hover:bg-neutral-900 text-foreground font-semibold tracking-wide"
          >
            <LogIn className="h-4 w-4 text-primary" />
            Join Lobby
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 rounded-lg font-semibold tracking-wide"
          >
            <Plus className="h-4 w-4" />
            New Lobby
          </Button>
        </div>
      }
    >
      <div className="space-y-6 font-sans text-sm">
        
        {/* Search & Filter Controls */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-neutral-950/40 p-4 rounded-xl border border-neutral-900">
          <div className="w-full md:max-w-md">
            <SearchBar value={search} onChange={setSearch} placeholder="Search lobbies..." />
          </div>
          
          <div className="flex rounded-lg border border-neutral-900 p-0.5 bg-black">
            {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
                  filter === type
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {type === 'ALL' ? 'All' : type === 'ACTIVE' ? 'Active' : 'Archived'}
              </button>
            ))}
          </div>
        </div>

        {/* Groups Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-xs uppercase tracking-widest font-semibold">Syncing your lobbies...</p>
          </div>
        ) : filteredGroups.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="relative overflow-hidden flex flex-col justify-between rounded-xl border border-neutral-900 bg-neutral-950/20 hover:border-primary/50 transition-all shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-base font-bold text-foreground font-heading tracking-wide uppercase">{group.name}</CardTitle>
                    {group.status === 'ARCHIVED' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        <FolderArchive className="h-3 w-3" />
                        Archived
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-primary border border-primary/20">
                        <Activity className="h-3 w-3" />
                        {group.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <CardDescription className="line-clamp-2 text-xs text-muted-foreground mt-2 min-h-[32px] font-light">
                    {group.description || 'No description provided.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1.5 pb-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <span>{group.memberCount} Members joined</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-primary">Invite Code:</span>
                    <span className="font-mono text-foreground font-bold">{group.inviteCode}</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-3 border-t border-neutral-900/60 flex justify-end bg-neutral-950/20 px-6 pb-4 rounded-b-xl">
                  <Link
                    href={`/groups/${group.id}`}
                    className={buttonVariants({
                      variant: 'ghost',
                      size: 'sm',
                      className: 'text-primary hover:underline font-bold p-0 hover:bg-transparent text-xs tracking-wide flex items-center gap-1',
                    })}
                  >
                    Open Workspace <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-neutral-950/20 rounded-xl border border-neutral-900">
            <Users className="h-8 w-8 text-neutral-800 mx-auto mb-3" />
            <h3 className="text-base font-bold text-foreground">No Lobbies Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 font-light">
              Create a lobby or enter an invite code to start collaborating with friends.
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
