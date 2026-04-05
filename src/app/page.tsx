'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Compass,
  MapPin,
  Sparkles,
  Users,
  Vote,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.15 } },
};

const features = [
  {
    icon: MapPin,
    title: 'Fair Meeting Hub',
    description:
      'Your group locations are converted into four smart hub options so everyone gets a practical commute, not just the loudest opinion.',
  },
  {
    icon: Bot,
    title: 'AI Itinerary Engine',
    description:
      'Groq-powered generation builds structured plans from real nearby places, budget limits, and your selected mood.',
  },
  {
    icon: Vote,
    title: 'Live Room Voting',
    description:
      'Supabase Realtime keeps members, votes, and room status in sync so your group can decide quickly and lock one final plan.',
  },
];

const steps = [
  {
    icon: Users,
    title: 'Create and invite',
    description: 'Open a room, share the invite link, and get everyone into the same lobby in seconds.',
  },
  {
    icon: Compass,
    title: 'Set location and budget',
    description: 'Each member adds location and budget so the planner can optimize fairness and practicality.',
  },
  {
    icon: Sparkles,
    title: 'Generate and vote',
    description: 'AI creates options, your group votes live, and the admin confirms one final itinerary.',
  },
];

export default function LandingPage() {
  const { isSignedIn } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg-base)] overflow-hidden">
      <section className="relative section-base pt-[92px] sm:pt-[112px] lg:pt-[124px] hero-gradient mesh-gradient editorial-grid border-b border-[var(--color-border-subtle)]">
        <motion.div
          className="container-base max-w-[980px] text-center z-10 space-y-8 md:space-y-10"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeInUp} className="inline-block">
            <span className="px-3 py-1.5 rounded-full bg-[var(--color-accent-muted)] border border-[var(--color-border-default)] text-[var(--color-accent)] text-xs font-semibold tracking-widest uppercase">
              Black Edition • Smart AI Hangout Planner
            </span>
          </motion.div>

          <motion.h1
            variants={fadeInUp}
            className="display-text landing-hero-title"
          >
            Plan together,
            <span className="text-[var(--color-accent)] block mt-1">without the chaos.</span>
          </motion.h1>

          <motion.p
            variants={fadeInUp}
            className="landing-body-copy text-[var(--color-text-secondary)] max-w-2xl mx-auto"
          >
            Build a room, invite friends, and get fair, budget-aware itinerary options generated around your whole group.
          </motion.p>

          <motion.div
            variants={fadeInUp}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Link href={isSignedIn ? '/rooms/create' : '/sign-up'} className="btn-primary w-[184px] group">
              Create Room
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href={isSignedIn ? '/dashboard' : '/sign-in'} className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
              Already invited? Join from dashboard
            </Link>
          </motion.div>

          <motion.div variants={fadeInUp} className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <Card className="p-6 text-center h-full bg-[rgba(255,255,255,0.02)]">
              <p className="text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-1">Fairness</p>
              <p className="display-text text-[24px] text-[var(--color-accent)]">+32%</p>
              <p className="text-xs text-[var(--color-text-secondary)] leading-6">balanced commute decisions</p>
            </Card>
            <Card className="p-6 text-center h-full bg-[rgba(255,255,255,0.02)]">
              <p className="text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-1">Decision Speed</p>
              <p className="display-text text-[24px] text-[var(--color-accent)]">2x faster</p>
              <p className="text-xs text-[var(--color-text-secondary)] leading-6">than chat-based planning</p>
            </Card>
            <Card className="p-6 text-center h-full bg-[rgba(255,255,255,0.02)]">
              <p className="text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-1">Live Sync</p>
              <p className="display-text text-[24px] text-[var(--color-accent)]">Realtime</p>
              <p className="text-xs text-[var(--color-text-secondary)] leading-6">room members and votes</p>
            </Card>
          </motion.div>
        </motion.div>

        {/* Ambient Glow Orbs */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] h-[320px] bg-[var(--color-accent)] opacity-[0.05] blur-[160px] rounded-full pointer-events-none" />
      </section>

      <section className="section-base section-alt relative z-10">
        <motion.div
          className="container-base max-w-[1100px]"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <div className="text-center mb-16 md:mb-20 space-y-4">
            <motion.h2
              variants={fadeInUp}
              className="display-text landing-section-title"
            >
              How It Works
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-[var(--color-text-secondary)] max-w-xl mx-auto text-[15px] leading-7"
            >
              One centered workflow from invite to confirmed plan.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div key={step.title} variants={fadeInUp}>
                  <Card className="p-6 text-center h-full flex flex-col justify-start">
                    <div className="w-12 h-12 rounded-2xl mx-auto mb-4 bg-[var(--color-accent-muted)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-accent)]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-1">Step {i + 1}</p>
                    <h3 className="font-display text-[18px] font-semibold mb-2">{step.title}</h3>
                    <p className="text-sm text-[var(--color-text-secondary)] landing-card-copy">{step.description}</p>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </section>

      <section className="section-base relative z-10 border-t border-[var(--color-border-subtle)]">
        <motion.div
          className="container-base max-w-[1100px]"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <div className="text-center mb-16 md:mb-20 space-y-4">
            <motion.h2
              variants={fadeInUp}
              className="display-text landing-section-title"
            >
              Why Teams Choose Hangout
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-[var(--color-text-secondary)] max-w-xl mx-auto text-[15px] leading-7"
            >
              Structured planning that keeps everyone included.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={i}
                  variants={fadeInUp}
                  className="h-full"
                >
                  <Card className="p-6 h-full flex flex-col items-start text-left">
                    <div className="w-11 h-11 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] flex items-center justify-center mb-4">
                      <Icon className="h-5 w-5 text-[var(--color-accent)]" />
                    </div>
                    <h3 className="font-display text-[18px] font-semibold mb-2 text-[var(--color-text-primary)]">
                      {feature.title}
                    </h3>
                    <p className="text-[var(--color-text-secondary)] text-[14px] landing-card-copy">
                      {feature.description}
                    </p>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <motion.div variants={fadeInUp} className="mt-16 pt-8 border-t border-[var(--color-border-subtle)]">
            <Card className="p-6 sm:p-8 text-center max-w-[760px] mx-auto">
              <p className="text-sm text-[var(--color-text-secondary)] mb-4 inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[var(--color-accent)]" />
                Ready to stop planning in WhatsApp threads?
              </p>
              <div className="flex justify-center">
                <Link href={isSignedIn ? '/rooms/create' : '/sign-up'} className="btn-primary min-w-[180px]">
                  Start Planning
                </Link>
              </div>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-4">
                Already have a room? Use the Join flow from your dashboard.
              </p>
            </Card>
          </motion.div>
        </motion.div>
      </section>
    </div>
  );
}
