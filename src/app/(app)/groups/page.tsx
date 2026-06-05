'use client';

import React, { useState } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import SearchBar from '@/components/shared/SearchBar';
import CreateGroupDialog from '@/components/shared/CreateGroupDialog';
import JoinGroupDialog from '@/components/shared/JoinGroupDialog';
import { MOCK_GROUPS } from '@/lib/utils/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Users, Plus, LogIn, ArrowRight, FolderArchive, Activity } from 'lucide-react';
import Link from 'next/link';

export default function GroupsPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  // Filter & Search Logic
  const filteredGroups = MOCK_GROUPS.filter((group) => {
    const matchesSearch = group.name.toLowerCase().includes(search.toLowerCase()) || 
      (group.description && group.description.toLowerCase().includes(search.toLowerCase()));
    
    if (filter === 'ALL') return matchesSearch;
    return matchesSearch && group.status === filter;
  });

  return (
    <PageContainer
      title="Outing Groups"
      subtitle="Find your planning groups or start a new outing workspace."
      actions={
        <div className="flex gap-2 w-full sm:w-auto">
          <Button
            size="sm"
            onClick={() => setIsJoinOpen(true)}
            variant="outline"
            className="flex items-center gap-1.5"
          >
            <LogIn className="h-4 w-4" />
            Join Group
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            New Group
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Search & Filter Controls */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
          <div className="w-full md:max-w-md">
            <SearchBar value={search} onChange={setSearch} placeholder="Search groups..." />
          </div>
          
          <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
            {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                  filter === type
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {type.charAt(0) + type.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Groups Grid */}
        {filteredGroups.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg font-bold">{group.name}</CardTitle>
                    {group.status === 'ARCHIVED' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        <FolderArchive className="h-3 w-3" />
                        Archived
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-700/10">
                        <Activity className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </div>
                  <CardDescription className="line-clamp-2 text-xs text-slate-500 mt-2 min-h-[32px]">
                    {group.description || 'No description provided.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-slate-600 space-y-1.5 pb-4">
                  <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
                    <Users className="h-4 w-4 text-slate-400" />
                    <span>{group.memberCount} Members joined</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Invite Code: <span className="font-mono font-bold text-slate-600">{group.inviteCode}</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-3 border-t border-slate-100 flex justify-end">
                  <Link
                    href={`/groups/${group.id}`}
                    className={buttonVariants({
                      variant: 'ghost',
                      size: 'sm',
                      className: 'text-indigo-600 hover:text-indigo-700 font-bold p-0 hover:bg-transparent',
                    })}
                  >
                    Open Workspace <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No Groups Found</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1">
              Create a group or enter an invite code to start collaborating with friends.
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
