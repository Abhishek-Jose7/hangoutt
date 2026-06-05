'use client';

import React, { useState } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import CreateGroupDialog from '@/components/shared/CreateGroupDialog';
import JoinGroupDialog from '@/components/shared/JoinGroupDialog';
import { MOCK_GROUPS } from '@/lib/utils/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar, Users, ArrowRight, Plus, LogIn, Clock, Compass } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  // Active groups lists (limit to 3 for summary)
  const activeGroups = MOCK_GROUPS.filter(g => g.status === 'ACTIVE').slice(0, 3);
  
  // Hardcoded upcoming plans for showcase
  const upcomingPlans = [
    {
      id: 'upcoming_1',
      groupName: 'Koramangala Weekend Outing',
      planName: 'Chill & Bowl',
      date: 'Saturday, June 6, 2026',
      time: '02:00 PM',
      duration: '3h 15m',
    }
  ];

  return (
    <PageContainer
      title="Welcome to Hangout!"
      subtitle="Coordinate with your friends, check budgets, find midpoints, and generate plans instantly."
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Upcoming Outings */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-indigo-600" />
              Upcoming Outings
            </h2>
            
            {upcomingPlans.length > 0 ? (
              upcomingPlans.map((plan) => (
                <Card key={plan.id} className="border-l-4 border-l-indigo-600 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <CardTitle className="text-lg font-bold">{plan.planName}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                          <Users className="h-3.5 w-3.5" />
                          {plan.groupName}
                        </CardDescription>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
                        Confirmed
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1.5 text-slate-600">
                    <p className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400" />
                      {plan.date} at {plan.time} ({plan.duration})
                    </p>
                  </CardContent>
                  <CardFooter className="pt-2 border-t border-slate-100 flex justify-end">
                    <Link href={`/groups/group_koramangala`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                      View Details <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </CardFooter>
                </Card>
              ))
            ) : (
              <Card className="bg-slate-50 border-dashed text-center p-6">
                <p className="text-sm text-slate-500">No upcoming outings confirmed yet.</p>
              </Card>
            )}
          </div>

          {/* Active Planning Groups */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-600" />
                Active Groups
              </h2>
              <Link href="/groups" className="text-indigo-600 hover:text-indigo-700 text-sm font-semibold">
                See all groups
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {activeGroups.map((group) => (
                <Card key={group.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-bold">{group.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-xs text-slate-500 min-h-[32px]">
                      {group.description || 'No description provided.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-slate-500 space-y-1">
                    <p className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {group.memberCount} members
                    </p>
                    <p className="capitalize">Type: {group.groupType.toLowerCase()}</p>
                  </CardContent>
                  <CardFooter className="pt-3 border-t border-slate-100 flex justify-end">
                    <Link href={`/groups/${group.id}`} className="flex items-center text-indigo-600 font-bold hover:underline text-xs">
                      Open Workspace <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </div>

        </div>

        {/* Quick Actions Panel */}
        <div className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <Compass className="h-5 w-5 text-indigo-600" />
              Quick Actions
            </h2>
            <Card className="shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <Button 
                  onClick={() => setIsCreateOpen(true)}
                  className="w-full justify-start gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  Create Outing Group
                </Button>
                <Button 
                  onClick={() => setIsJoinOpen(true)}
                  variant="outline" 
                  className="w-full justify-start gap-2 border-slate-200 hover:bg-slate-50"
                >
                  <LogIn className="h-4 w-4" />
                  Join via Code
                </Button>
                <Link 
                  href="/history" 
                  className={buttonVariants({ variant: 'ghost', className: 'w-full justify-start gap-2 text-slate-600 hover:bg-slate-50' })}
                >
                  <Clock className="h-4 w-4 text-slate-400" />
                  View Outing History
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>

      </div>

      {/* Interactive dialogues */}
      <CreateGroupDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <JoinGroupDialog isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </PageContainer>
  );
}
