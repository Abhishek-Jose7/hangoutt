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
      <div className="space-y-6 max-w-3xl font-sans text-sm">
        
        {/* Account settings */}
        <Card className="border border-border rounded-xl bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Account Settings
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground font-light">
              Manage user registration details and Clerk account synchronizations.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground leading-relaxed text-xs">
            Account security and credentials are synchronized via Clerk. Visit your Clerk profile interface to configure Multi-Factor Auth or update login emails.
          </CardContent>
        </Card>

        {/* Privacy & Permissions */}
        <Card className="border border-border rounded-xl bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Privacy & Location Permissions
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground font-light">
              Configure how your location and budget parameters are shared.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-muted-foreground leading-relaxed text-xs">
            <p className="font-light text-sm">
              Hangout implements a <strong>Privacy-First architecture</strong>. Individual budget capacities and coordinate locations are never exposed to other planning participants.
            </p>
            <div className="flex items-center gap-2 pt-2 text-xs font-semibold text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Location Obfuscation: Enabled (Only calculated midpoint coordinates returned to members)
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Budget Privacy: Enabled (Individual amounts redacted from views)
            </div>
          </CardContent>
        </Card>

        {/* Notification details */}
        <Card className="border border-border rounded-xl bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notification Settings
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground font-light">
              Configure alerts for planning activities and confirmed outings.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground leading-relaxed text-xs">
            Push notifications (Firebase Cloud Messaging) and WhatsApp messaging prompts are in planning stages and will roll out in Phase 2.
          </CardContent>
        </Card>

      </div>
    </PageContainer>
  );
}
