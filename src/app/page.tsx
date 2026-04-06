'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  Bot,
  Compass,
  Gauge,
  Map,
  MapPin,
  Users,
  Vote,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

const features = [
  {
    icon: MapPin,
    title: 'Fair Midpoint Engine',
    description: 'Balances commute friction so no one gets stuck with a painful route.',
  },
  {
    icon: Bot,
    title: 'AI Route Composer',
    description: 'Builds diverse plans tuned to your budget, vibe, and timing constraints.',
  },
  {
    icon: Vote,
    title: 'Live Team Voting',
    description: 'Everyone votes in real time and the top option can be confirmed instantly.',
  },
];

const stats = [
  { value: '4', label: 'Diverse Options', icon: Compass },
  { value: '< 30s', label: 'Plan Generation', icon: Gauge },
  { value: 'Live', label: 'Sync + Votes', icon: Users },
];

const flow = [
  {
    title: 'Create a Room',
    description: 'Set mood and invite your group in one shareable link.',
  },
  {
    title: 'Collect Context',
    description: 'Members add location and budget so constraints are real, not guessed.',
  },
  {
    title: 'Generate Options',
    description: 'AI composes balanced itineraries with fair travel and clear cost.',
  },
  {
    title: 'Vote and Confirm',
    description: 'Compare options side-by-side and lock the best one in seconds.',
  },
];

export default function LandingPage() {
  const { isSignedIn } = useAuth();

  return (
    <div className="flex-1 hero-gradient mesh-gradient relative overflow-hidden">
      <div className="container-base section-base py-10 sm:py-12 relative z-[1] space-y-7">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38 }}
        >
          <Card className="p-6 sm:p-8 lg:p-10 border-[var(--color-border-strong)]">
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div className="space-y-5">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent-strong)] text-[11px] font-bold tracking-[0.12em] uppercase border border-[rgba(255,143,102,0.55)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  Smart AI Hangout Planner
                </span>

                <h1 className="display-text text-4xl sm:text-5xl lg:text-[3.5rem] text-[var(--color-text-primary)] leading-[1.03]">
                  Plan with your group,
                  <br />
                  <span className="text-[var(--color-text-secondary)]">not against each other.</span>
                </h1>

                <p className="max-w-[640px] text-[15px] sm:text-base text-[var(--color-text-secondary)] leading-relaxed">
                  A clean SaaS workflow for group hangouts: collect member context, generate balanced itineraries, compare options, and lock a final plan everyone can live with.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <Link href={isSignedIn ? '/rooms/create' : '/sign-up'} className="btn-primary w-full sm:w-auto min-w-[210px]">
                    Create Room
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                  <Link href={isSignedIn ? '/dashboard' : '/sign-in'} className="btn-secondary w-full sm:w-auto min-w-[210px]">
                    Open Dashboard
                  </Link>
                </div>
              </div>

              <div className="grid gap-3 sm:gap-4">
                <Card className="p-4 sm:p-5 bg-[rgba(11,18,28,0.75)]">
                  <div className="grid grid-cols-3 gap-2">
                    {stats.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div key={item.label} className="rounded-xl border border-[var(--color-border-subtle)] p-3 text-center bg-[rgba(18,29,44,0.6)]">
                          <Icon className="h-4 w-4 mx-auto mb-1 text-[var(--color-accent)]" />
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.value}</p>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mt-0.5">{item.label}</p>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card className="p-4 sm:p-5 bg-[rgba(11,18,28,0.75)]">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-3">Built For Real Groups</p>
                  <div className="space-y-2.5">
                    {[
                      'Fair commute-aware midpoint selection',
                      'Budget-safe options with transparent costs',
                      'Live voting with admin confirmation controls',
                    ].map((line) => (
                      <div key={line} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] mt-0.5" />
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </Card>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.05 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="p-5 bg-[rgba(12,20,30,0.82)]">
                <div className="w-10 h-10 rounded-xl bg-[rgba(255,106,61,0.14)] border border-[rgba(255,143,102,0.35)] flex items-center justify-center mb-3">
                  <Icon className="h-5 w-5 text-[var(--color-accent)]" />
                </div>
                <h3 className="font-semibold text-[16px] text-[var(--color-text-primary)] mb-1">{feature.title}</h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{feature.description}</p>
              </Card>
            );
          })}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <Card className="p-6 sm:p-7 bg-[rgba(12,20,30,0.84)]">
            <div className="flex items-center gap-2 mb-5">
              <Map className="h-4 w-4 text-[var(--color-info)]" />
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">How It Works</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {flow.map((step, index) => (
                <div key={step.title} className="rounded-xl border border-[var(--color-border-subtle)] bg-[rgba(18,29,44,0.56)] p-4">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-1">Step {index + 1}</p>
                  <h4 className="font-semibold text-[15px] text-[var(--color-text-primary)] mb-1">{step.title}</h4>
                  <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">{step.description}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.section>
      </div>
    </div>
  );
}
