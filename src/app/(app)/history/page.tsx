import React from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
      <div className="space-y-6 font-sans text-sm">
        {historyEntries.length > 0 ? (
          <div className="space-y-4 max-w-3xl">
            {historyEntries.map((entry) => (
              <Card key={entry.id} className="border border-border rounded-xl bg-card shadow-sm">
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
                <CardContent className="space-y-4 text-xs text-muted-foreground border-t border-border pt-4">
                  
                  {/* Venues checklist */}
                  <div>
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2">Venues Visited</h4>
                    <div className="flex flex-wrap gap-2">
                      {entry.venues.map((venue, idx) => (
                        <span key={idx} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground border border-border">
                          {venue}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Participants list */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs font-semibold pt-2 border-t border-border/40">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-4 w-4 text-primary" />
                      <span>{entry.participants.length} Participants: {entry.participants.join(', ')}</span>
                    </div>
                    
                    <span className="text-foreground flex items-center gap-0.5 font-bold">
                      <DollarSign className="h-4 w-4 text-primary" />
                      ₹{entry.totalCostPerHead} spent per head
                    </span>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-card rounded-xl border border-border">
            <Clock className="h-8 w-8 text-primary mx-auto mb-3" />
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
