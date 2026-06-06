import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';

export default async function HomePage() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  return (
    <div className="flex flex-col min-h-screen bg-black font-sans text-foreground selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <header className="w-full bg-black">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-normal tracking-wide font-heading text-foreground">
              Hang<span className="text-primary italic font-serif">out</span>
            </span>
            <span className="hidden sm:inline-block text-[10px] font-sans tracking-wider text-muted-foreground uppercase pl-3 border-l border-border/40">
              Outing Coordination Layer
            </span>
          </div>
          <nav className="flex items-center gap-6">
            {isSignedIn ? (
              <Link
                href="/groups"
                className="text-xs uppercase tracking-wider px-5 py-2.5 bg-primary text-primary-foreground hover:bg-primary/95 transition-all font-semibold rounded-lg"
              >
                Lobbies
              </Link>
            ) : (
              <>
                <Link 
                  href="/sign-in" 
                  className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  className="text-xs uppercase tracking-wider px-5 py-2.5 bg-primary text-primary-foreground hover:bg-primary/95 transition-all font-semibold rounded-lg"
                >
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-black">
        
        {/* Section 1: Hero Block */}
        <section className="bg-black py-16 md:py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              
              {/* Left Column: Typographic Statement */}
              <div className="lg:col-span-8 flex flex-col justify-center">
                <div className="space-y-6">
                  <span className="inline-block text-xs font-bold uppercase tracking-widest text-primary">
                    Outing Planning Protocol
                  </span>
                  <h1 className="text-4xl sm:text-6xl lg:text-7xl font-normal font-heading leading-[1.1] tracking-tight text-foreground">
                    Assemble the group, <br />
                    privately coordinate budgets, <br />
                    and meet at the <span className="italic text-primary font-semibold">fair midpoint.</span>
                  </h1>
                  <p className="max-w-2xl text-base md:text-lg font-light text-muted-foreground leading-relaxed pt-4">
                    Hangout automates coordinate geometry, budget limits, and venue preferences. No endless debate threads. No awkward group finance conversations. Just optimized plans, compiled instantly.
                  </p>
                </div>

                <div className="mt-10 flex flex-wrap gap-4">
                  {isSignedIn ? (
                    <Link
                      href="/groups"
                      className="text-xs uppercase tracking-wider px-8 py-4 bg-primary text-primary-foreground hover:bg-primary/95 transition-all font-bold rounded-lg shadow-sm"
                    >
                      Go to Lobbies
                    </Link>
                  ) : (
                    <>
                      <Link
                        href="/sign-up"
                        className="text-xs uppercase tracking-wider px-8 py-4 bg-primary text-primary-foreground hover:bg-primary/95 transition-all font-bold rounded-lg shadow-sm"
                      >
                        Create Outing Group
                      </Link>
                      <Link 
                        href="/sign-in" 
                        className="text-xs uppercase tracking-wider px-8 py-4 bg-black text-foreground border border-border rounded-lg hover:bg-primary/5 hover:border-primary/50 transition-all font-medium"
                      >
                        Learn More
                      </Link>
                    </>
                  )}
                </div>
              </div>

              {/* Right Column: Clean Scheduled Outing Card */}
              <div className="lg:col-span-4 flex flex-col justify-center">
                <div className="p-6 bg-card rounded-xl space-y-6 shadow-sm border border-border/10">
                  <div className="flex justify-between items-center pb-3 border-b border-border/40">
                    <span className="text-primary text-[10px] font-bold tracking-widest uppercase">Lobby Session</span>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-bold uppercase tracking-wider">Active</span>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2 text-xs">
                      <p className="text-muted-foreground font-semibold uppercase tracking-wider text-[9px]">Participant Status</p>
                      <div className="flex justify-between py-1 border-b border-border/20 text-muted-foreground">
                        <span className="font-semibold text-foreground">Abhishek J.</span>
                        <span className="font-mono text-[10px] text-primary">₹400 max · 7.2km</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/20 text-muted-foreground">
                        <span className="font-semibold text-foreground">Sarah C.</span>
                        <span className="font-mono text-[10px] text-primary">₹800 max · 4.1km</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/20 text-muted-foreground">
                        <span className="font-semibold text-foreground">Marcus M.</span>
                        <span className="font-mono text-[10px] text-primary">₹350 max · 11.0km</span>
                      </div>
                    </div>

                    <div className="pt-2 space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground uppercase text-[9px] tracking-wider">Optimal Midpoint</span>
                        <span className="font-semibold text-foreground">Indiranagar, Block 3</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground uppercase text-[9px] tracking-wider">Aggregate Outing Budget</span>
                        <span className="font-semibold text-primary">₹350 per head</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border/30 space-y-2">
                      <span className="text-muted-foreground uppercase text-[9px] tracking-wider block">Generated Options</span>
                      <div className="border border-border/30 p-3 rounded-lg bg-black/60 flex justify-between items-center text-xs">
                        <span className="font-bold text-foreground">Plan A: Cafe & Bowling</span>
                        <span className="text-[9px] bg-primary text-primary-foreground px-2 py-0.5 rounded font-bold uppercase">3 Votes</span>
                      </div>
                      <div className="border border-border/20 p-3 rounded-lg bg-black/30 flex justify-between items-center text-xs text-muted-foreground">
                        <span>Plan B: Brewery Tour</span>
                        <span className="text-[9px] uppercase">1 Vote</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Section 2: Specification Matrix */}
        <section className="bg-black py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
              
              {/* Feature 01 */}
              <div className="space-y-4">
                <span className="text-xs font-bold uppercase tracking-widest text-primary">01. Geographic Midpoint</span>
                <h3 className="text-xl font-heading text-foreground font-normal tracking-wide uppercase">
                  Fair Travel Metrics
                </h3>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Computes spatial coordinates that minimize cumulative travel times. The participant living farthest away is no longer forced to carry all the travel burdens.
                </p>
              </div>

              {/* Feature 02 */}
              <div className="p-0 space-y-4">
                <span className="text-xs font-bold uppercase tracking-widest text-primary">02. Privacy Envelope</span>
                <h3 className="text-xl font-heading text-foreground font-normal tracking-wide uppercase">
                  Zero-Disclosure Caps
                </h3>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Individual budgets and coordinates remain private. Only derived averages and lowest-common-denominator limits are passed to recommend outing options.
                </p>
              </div>

              {/* Feature 03 */}
              <div className="p-0 space-y-4">
                <span className="text-xs font-bold uppercase tracking-widest text-primary">03. Narrative Outings</span>
                <h3 className="text-xl font-heading text-foreground font-normal tracking-wide uppercase">
                  LLM Itinerary Compiler
                </h3>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Instead of plain listings, nearby venues are passed through Groq to compile 3–4 narrative plans. Group members vote in real-time to lock the meetup.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* Section 3: Value Proposition Editorial */}
        <section className="py-20 md:py-28 bg-black">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-start">
              <div className="md:col-span-5 space-y-4">
                <span className="text-xs font-bold uppercase tracking-widest text-primary">
                  The Problem We Solve
                </span>
                <h2 className="text-3xl sm:text-5xl font-normal font-heading leading-tight tracking-tight text-foreground">
                  Resolving the coordination friction
                </h2>
              </div>
              <div className="md:col-span-7 space-y-6 text-sm text-muted-foreground font-light leading-relaxed">
                <p>
                  Planning outings via standard group chat leads to decision paralysis. Members enter coordinates and budgets privately into Hangout's secure lobby database, and our system calculates the optimized meetup plan.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 text-xs font-semibold uppercase tracking-wider text-foreground">
                  <div className="space-y-1">
                    <span className="text-primary block font-mono">01 / GEOGRAPHY</span>
                    <span className="text-muted-foreground font-normal font-sans">Equal travel times determined by coordinate geometry average.</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-primary block font-mono">02 / BUDGETS</span>
                    <span className="text-muted-foreground font-normal font-sans">Privacy-first filters cap recommendation costs, respecting individual limits.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Process Steps */}
        <section className="bg-black py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12">
              
              {/* Step 1 */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-primary">01. Setup</div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-sm">Create Lobby</h4>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Initialize a group planning workspace in under 30 seconds and define the category profile.
                </p>
              </div>

              {/* Step 2 */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-primary">02. Sync</div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-sm">Distribute Link</h4>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Share a unique 8-character invite code. Members enter coordinate pins and budgets privately.
                </p>
              </div>

              {/* Step 3 */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-primary">03. Compute</div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-sm">Synthesize</h4>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Ola Maps aggregates nearby venues. Groq LLM compiles three tailored, narrative itinerary plans.
                </p>
              </div>

              {/* Step 4 */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-primary">04. Lock</div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-sm">Consensus</h4>
                <p className="font-sans font-light text-muted-foreground leading-relaxed text-sm">
                  Cast votes in the shared planner lobby. The winning plan is confirmed and locked automatically.
                </p>
              </div>

            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-black py-12 text-xs text-muted-foreground">
        <div className="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="text-xl font-normal font-heading tracking-wide text-foreground">
            Hang<span className="text-primary italic font-serif">out</span>
          </div>
          <div className="flex gap-6 tracking-wide text-[10px] uppercase font-mono">
            <span className="text-muted-foreground/60 font-medium">
              © {new Date().getFullYear()} Hangout Outing Coordination Layer.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
