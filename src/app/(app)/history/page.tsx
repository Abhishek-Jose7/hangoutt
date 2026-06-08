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
          <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
            <Loader2 className="h-7 w-7 animate-spin text-[#DC143C] mb-4" />
            <p className="text-[10px] font-mono uppercase tracking-widest font-bold">Loading outing history...</p>
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
                <Card key={entry.id} className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg hover:border-[#DC143C]/30 hover:bg-stone-950/85 transition-all duration-300">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <div>
                        <span className="text-[10px] font-mono text-[#DC143C] font-bold uppercase flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {entry.outingDate}
                        </span>
                        <CardTitle className="text-base font-bold mt-1 text-white font-campus tracking-widest uppercase">{entry.planName}</CardTitle>
                        <CardDescription className="text-xs text-neutral-450 font-sans font-light mt-0.5">{entry.planTagline}</CardDescription>
                      </div>
                      <Badge variant="outline" className="bg-[#00E5A0]/10 text-[#00E5A0] border-[#00E5A0]/20 text-[9px] font-mono font-bold uppercase rounded-full py-0.5 px-2.5">
                        {entry.groupName}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 text-xs text-neutral-450 border-t border-stone-900/40 pt-4 font-mono">
                    
                    {/* Venues checklist */}
                    {venues.length > 0 && (
                      <div>
                        <h4 className="text-[9px] font-bold text-[#DC143C] uppercase tracking-wider mb-2">Venues Visited</h4>
                        <div className="flex flex-wrap gap-2">
                          {venues.map((venue: any, idx: number) => {
                            const name = typeof venue === 'object' && venue !== null ? (venue.name || venue.venueName) : venue;
                            return (
                              <span key={idx} className="inline-flex items-center rounded-full bg-stone-900 px-2.5 py-1 text-[9px] text-neutral-400 border border-stone-850">
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Participants list */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-[10px] pt-3 border-t border-stone-900/30">
                      <div className="flex items-center gap-1.5 text-neutral-400">
                        <Users className="h-3.5 w-3.5 text-[#DC143C]" />
                        <span>
                          {participants.length} Participants: {participants.map((p: any) => typeof p === 'object' && p !== null ? p.name : p).join(', ')}
                        </span>
                      </div>
                      
                      <span className="text-white flex items-center gap-0.5 font-bold">
                        <DollarSign className="h-3.5 w-3.5 text-[#DC143C]" />
                        ₹{entry.totalCostPerHead} spent per head
                      </span>
                    </div>

                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 bg-stone-950/20 rounded-[12px] border border-stone-900/60 max-w-3xl backdrop-blur-md">
            <Clock className="h-8 w-8 text-stone-850 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-campus">No Past Outings</h3>
            <p className="text-[10px] text-neutral-500 max-w-xs mx-auto mt-1 font-mono uppercase tracking-wider">
              Outings will appear here once plans are completed.
            </p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
