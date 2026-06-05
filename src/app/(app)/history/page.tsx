import React from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Calendar, Users, DollarSign, Clock } from 'lucide-react';

export default function HistoryPage() {
  const historyEntries = [
    {
      id: 'h_1',
      groupName: 'Koramangala Crew',
      outingDate: 'May 16, 2026',
      planName: 'Chill & Bowl Outing',
      planTagline: 'A relaxed afternoon with coffee, conversation, and some friendly competition',
      venues: ['Third Wave Coffee', 'BluO Bowling Alley', 'Corner House Ice Creams'],
      participants: ['Abhishek Jose', 'Sarah Chen', 'Marcus Miller', 'Pooja Rao'],
      totalCostPerHead: 750,
    },
    {
      id: 'h_2',
      groupName: 'Friday Anniversary Date',
      outingDate: 'April 20, 2026',
      planName: 'Romantic escape',
      planTagline: 'A romantic walk in Cubbon Park followed by elegant Italian dinner',
      venues: ['Cubbon Park', 'Toscano Restaurant'],
      participants: ['Abhishek Jose', 'Sarah Chen'],
      totalCostPerHead: 950,
    }
  ];

  return (
    <PageContainer
      title="Outing History"
      subtitle="Memories and summaries of your completed group outings."
    >
      <div className="space-y-6">
        {historyEntries.length > 0 ? (
          <div className="space-y-4 max-w-3xl">
            {historyEntries.map((entry) => (
              <Card key={entry.id} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                      <span className="text-xs text-indigo-600 font-bold uppercase flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {entry.outingDate}
                      </span>
                      <CardTitle className="text-lg font-bold mt-1">{entry.planName}</CardTitle>
                      <CardDescription className="text-xs text-slate-500 mt-0.5">{entry.planTagline}</CardDescription>
                    </div>
                    <Badge variant="outline" className="bg-slate-50 text-slate-700 text-xs font-semibold py-1">
                      {entry.groupName}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-600 border-t border-slate-50 pt-4">
                  
                  {/* Venues checklist */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Venues Visited</h4>
                    <div className="flex flex-wrap gap-2">
                      {entry.venues.map((venue, idx) => (
                        <span key={idx} className="inline-flex items-center rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {venue}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Participants list */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Users className="h-4 w-4 text-slate-400" />
                      <span>{entry.participants.length} Participants: {entry.participants.join(', ')}</span>
                    </div>
                    
                    <span className="font-bold text-slate-800 flex items-center gap-0.5">
                      <DollarSign className="h-4 w-4 text-slate-400" />
                      ₹{entry.totalCostPerHead} spent per head
                    </span>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No Past Outings</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1">
              Outings are stored in history once a generated plan is confirmed and completed.
            </p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

import { Badge } from '@/components/ui/badge';
