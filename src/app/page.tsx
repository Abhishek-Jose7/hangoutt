'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  MapPin,
  Vote,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

const features = [
  {
    icon: MapPin,
    title: 'Fair Hub',
    description: 'Find optimal meeting spots based on the group location.',
  },
  {
    icon: Bot,
    title: 'AI Planned',
    description: 'Groq-powered itineraries built for your budget and mood.',
  },
  {
    icon: Vote,
    title: 'Live Voting',
    description: 'Realtime polling to quickly lock in the best group plan.',
  },
];

export default function LandingPage() {
  const { isSignedIn } = useAuth();

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-6 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-[var(--color-accent)] opacity-[0.1] blur-[100px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-[800px] z-10"
      >
        <Card className="p-8 sm:p-12 border border-[var(--color-border-strong)] bg-gradient-to-b from-[var(--color-bg-surface)] to-[var(--color-bg-base)]">
          
          <div className="text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)] text-xs font-bold tracking-wider uppercase border border-[var(--color-accent)]">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
              Smart AI Hangout Planner
            </div>

            <h1 className="display-text text-4xl sm:text-5xl font-bold text-[var(--color-text-primary)]">
              Plan together,<br />
              <span className="text-[var(--color-text-secondary)]">without the chaos.</span>
            </h1>

            <p className="max-w-[480px] mx-auto text-[var(--color-text-tertiary)] leading-relaxed">
              Build a room, invite friends, and let AI generate budget-aware, fair itineraries around your entire group.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-4">
              <Link href={isSignedIn ? '/rooms/create' : '/sign-up'} className="btn-primary w-full sm:w-auto min-w-[200px]">
                Create Room
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
              <Link href={isSignedIn ? '/dashboard' : '/sign-in'} className="btn-secondary w-full sm:w-auto min-w-[200px]">
                Join Dashboard
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12 pt-8 border-t border-[var(--color-border-default)]">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div key={i} className="flex flex-col items-center text-center p-4 rounded-xl bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]">
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-elevated)] flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-[var(--color-accent)]" />
                  </div>
                  <h3 className="font-semibold text-[14px] text-[var(--color-text-primary)] mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>

        </Card>
      </motion.div>
    </div>
  );
}
