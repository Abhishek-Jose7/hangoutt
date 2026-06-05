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
      <div className="space-y-6 max-w-3xl">
        
        {/* Account settings */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <User className="h-4 w-4 text-indigo-600" />
              Account Settings
            </CardTitle>
            <CardDescription>Manage user registration details and Clerk account synchronizations.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-500">
            Account security and credentials are syncronized via Clerk. Visit your Clerk profile interface to configure Multi-Factor Auth or update login emails.
          </CardContent>
        </Card>

        {/* Privacy & Permissions */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-600" />
              Privacy & Location Permissions
            </CardTitle>
            <CardDescription>Configure how your location and budget parameters are shared.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-4 text-slate-600">
            <p>
              Hangout implements a <strong>Privacy-First architecture</strong>. Individual budget capacities and coordinate locations are never exposed to other planning participants.
            </p>
            <div className="flex items-center gap-2 pt-2 text-xs font-semibold text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Location Obfuscation: Enabled (Only calculated midpoint returned to members)
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Budget Privacy: Enabled (Individual amounts redacted from views)
            </div>
          </CardContent>
        </Card>

        {/* Notification details */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Bell className="h-4 w-4 text-indigo-600" />
              Notification Settings
            </CardTitle>
            <CardDescription>Configure alerts for planning activities and confirmed outings.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-500">
            Push notifications (Firebase Cloud Messaging) and WhatsApp messaging prompts are in planning stages and will roll out in Phase 2.
          </CardContent>
        </Card>

      </div>
    </PageContainer>
  );
}
