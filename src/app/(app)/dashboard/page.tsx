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
      title="Welcome to Hangout"
      subtitle="Coordinate with your friends, check budgets, find midpoints, and generate plans instantly."
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans text-sm">
        
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Upcoming Outings */}
          <div className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Upcoming Outings
            </h2>
            
            {upcomingPlans.length > 0 ? (
              upcomingPlans.map((plan) => (
                <Card key={plan.id} className="border-l-4 border-l-primary border border-border bg-card shadow-sm rounded-xl">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <CardTitle className="text-base font-bold text-foreground font-heading tracking-wide uppercase">{plan.planName}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                          <Users className="h-3 w-3" />
                          {plan.groupName}
                        </CardDescription>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase text-primary border border-primary/20">
                        Confirmed
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1.5 text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      {plan.date} at {plan.time} ({plan.duration})
                    </p>
                  </CardContent>
                  <CardFooter className="pt-2 border-t border-border flex justify-end">
                    <Link 
                      href={`/groups/group_koramangala`} 
                      className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-xs font-semibold tracking-wide hover:bg-primary/10 hover:text-primary rounded-lg' })}
                    >
                      View Details <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </CardFooter>
                </Card>
              ))
            ) : (
              <Card className="bg-card border-dashed border-border rounded-xl text-center p-6 text-xs text-muted-foreground">
                <p>No upcoming outings confirmed yet.</p>
              </Card>
            )}
          </div>

          {/* Active Planning Groups */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Active Planning Groups
              </h2>
              <Link href="/groups" className="text-primary hover:underline text-xs font-semibold tracking-wide">
                See all groups
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {activeGroups.map((group) => (
                <Card key={group.id} className="hover:border-primary/50 transition-all border border-border bg-card rounded-xl shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-bold text-foreground tracking-wide font-heading uppercase">{group.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-xs text-muted-foreground min-h-[32px] font-light mt-1">
                      {group.description || 'No description provided.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1 pt-2 font-medium">
                    <p className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      {group.memberCount} members
                    </p>
                    <p className="capitalize">Type: {group.groupType.toLowerCase()}</p>
                  </CardContent>
                  <CardFooter className="pt-3 border-t border-border flex justify-end">
                    <Link href={`/groups/${group.id}`} className="flex items-center text-primary text-xs font-semibold hover:underline">
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
            <h2 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
              <Compass className="h-4 w-4 text-primary" />
              Quick Actions
            </h2>
            <Card className="border border-border bg-card rounded-xl shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <Button 
                  onClick={() => setIsCreateOpen(true)}
                  className="w-full justify-start gap-2 bg-primary hover:bg-primary/95 text-primary-foreground text-xs font-semibold rounded-lg"
                >
                  <Plus className="h-4 w-4" />
                  Create Outing Group
                </Button>
                <Button 
                  onClick={() => setIsJoinOpen(true)}
                  variant="outline" 
                  className="w-full justify-start gap-2 border-border text-foreground hover:bg-primary/10 hover:text-primary text-xs font-semibold rounded-lg"
                >
                  <LogIn className="h-4 w-4 text-primary" />
                  Join via Code
                </Button>
                <Link 
                  href="/history" 
                  className={buttonVariants({ variant: 'ghost', className: 'w-full justify-start gap-2 text-muted-foreground hover:bg-accent/10 hover:text-foreground border border-transparent rounded-lg text-xs font-semibold' })}
                >
                  <Clock className="h-4 w-4 text-primary" />
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
