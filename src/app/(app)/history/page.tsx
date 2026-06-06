'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Users, DollarSign, Clock, Loader2 } from 'lucide-react';
import { getUserHistoryAction } from '@/actions/groups';
import { toast } from 'sonner';

export default function HistoryPage() {
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await getUserHistoryAction();
        if (res.success) {
          setHistoryEntries(res.data);
        } else {
          toast.error(res.error.message || 'Failed to load history');
        }
      } catch (err) {
        console.error(err);
        toast.error('An error occurred loading outing history.');
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, []);

  return (
    <PageContainer
      title="Outing History"
      subtitle="Memories and summaries of your completed group outings."
    >
      <div className="space-y-6 font-sans text-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-xs uppercase tracking-widest font-semibold">Loading outing history...</p>
          </div>
        ) : historyEntries.length > 0 ? (
          <div className="space-y-4 max-w-3xl">
            {historyEntries.map((entry) => {
              let venues: string[] = [];
              let participants: string[] = [];
              try {
                venues = typeof entry.venuesJson === 'string' ? JSON.parse(entry.venuesJson) : (entry.venuesJson || []);
                participants = typeof entry.participantsJson === 'string' ? JSON.parse(entry.participantsJson) : (entry.participantsJson || []);
              } catch (e) {
                console.error('Failed to parse history JSON data', e);
              }
              
              return (
                <Card key={entry.id} className="border border-neutral-900 rounded-xl bg-neutral-950/20 shadow-sm hover:border-primary/20 transition-all">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <div>
                        <span className="text-xs text-primary font-semibold uppercase flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {entry.outingDate}
                        </span>
                        <CardTitle className="text-base font-bold mt-1 text-foreground font-heading tracking-wide uppercase">{entry.planName}</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground font-light mt-0.5">{entry.planTagline}</CardDescription>
                      </div>
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] font-semibold uppercase rounded-full py-1 px-2.5">
                        {entry.groupName}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 text-xs text-muted-foreground border-t border-neutral-900/60 pt-4">
                    
                    {/* Venues checklist */}
                    {venues.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2">Venues Visited</h4>
                        <div className="flex flex-wrap gap-2">
                          {venues.map((venue: any, idx: number) => {
                            const name = typeof venue === 'object' && venue !== null ? (venue.name || venue.venueName) : venue;
                            return (
                              <span key={idx} className="inline-flex items-center rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground border border-neutral-800">
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Participants list */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs font-semibold pt-2 border-t border-neutral-900/40">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Users className="h-4 w-4 text-primary" />
                        <span>
                          {participants.length} Participants: {participants.map((p: any) => typeof p === 'object' && p !== null ? p.name : p).join(', ')}
                        </span>
                      </div>
                      
                      <span className="text-foreground flex items-center gap-0.5 font-bold">
                        <DollarSign className="h-4 w-4 text-primary" />
                        ₹{entry.totalCostPerHead} spent per head
                      </span>
                    </div>

                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 bg-neutral-950/20 rounded-xl border border-neutral-900 max-w-3xl">
            <Clock className="h-8 w-8 text-neutral-800 mx-auto mb-3" />
            <h3 className="text-base font-bold text-foreground">No Past Outings</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 font-light">
              Outings are stored in history once a generated plan is confirmed and completed.
            </p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
