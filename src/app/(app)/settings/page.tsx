import React from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Shield, Bell, User } from 'lucide-react';

export default function SettingsPage() {
  return (
    <PageContainer
      title="Settings"
      subtitle="Application configuration and privacy controls."
    >
      <div className="space-y-6 max-w-3xl font-sans text-sm relative z-10">
        
        {/* Account settings */}
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
              <User className="h-4 w-4 text-[#DC143C]" />
              Account Settings
            </CardTitle>
            <CardDescription className="text-xs text-neutral-450 font-sans font-light">
              Manage user registration details and Clerk account synchronizations.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-neutral-400 leading-relaxed text-xs font-sans">
            Account security and credentials are synchronized via Clerk. Visit your Clerk profile interface to configure Multi-Factor Auth or update login emails.
          </CardContent>
        </Card>

        {/* Privacy & Permissions */}
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#DC143C]" />
              Privacy & Location Permissions
            </CardTitle>
            <CardDescription className="text-xs text-neutral-450 font-sans font-light">
              Configure how your location and budget parameters are shared.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-neutral-400 leading-relaxed text-xs">
            <p className="font-light text-sm font-sans">
              Hangout implements a <strong className="text-white">Privacy-First architecture</strong>. Individual budget capacities and coordinate locations are never exposed to other planning participants.
            </p>
            <div className="flex items-center gap-2 pt-2 text-[10px] font-mono font-bold text-[#00E5A0] uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-[#00E5A0] animate-pulse shadow-[0_0_6px_#00E5A0]" />
              Location Obfuscation: Enabled (Only calculated midpoint coordinates returned to members)
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-[#00E5A0] uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-[#00E5A0] animate-pulse shadow-[0_0_6px_#00E5A0]" />
              Budget Redaction: Enabled (Individual amounts redacted from views)
            </div>
          </CardContent>
        </Card>

        {/* Notification details */}
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#DC143C]" />
              Notification Settings
            </CardTitle>
            <CardDescription className="text-xs text-neutral-450 font-sans font-light">
              Configure alerts for planning activities and confirmed outings.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-neutral-400 leading-relaxed text-xs font-sans">
            Push notifications and mobile message prompts are in planning stages and will roll out in Phase 2.
          </CardContent>
        </Card>

      </div>
    </PageContainer>
  );
}
