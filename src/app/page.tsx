import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';

export default async function HomePage() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tracking-tight text-indigo-600">Hangout</span>
          </div>
          <nav className="flex items-center gap-6">
            {isSignedIn ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="text-sm font-medium text-slate-700 hover:text-indigo-600 transition">
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition"
                >
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
              Outing planning,{' '}
              <span className="text-indigo-600">made effortless.</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Eliminate the friction of organizing group meetups. Coordinate budgets, find a fair midpoint, and let AI generate optimized itineraries that everyone will love.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              {isSignedIn ? (
                <Link
                  href="/dashboard"
                  className="rounded-md bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition"
                >
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/sign-up"
                    className="rounded-md bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition"
                  >
                    Create Your Group
                  </Link>
                  <Link href="/sign-in" className="text-base font-semibold leading-7 text-slate-900 hover:text-indigo-600 transition">
                    Learn more <span aria-hidden="true">→</span>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Problem Statement */}
      <section className="border-t border-slate-200 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl lg:text-center">
            <h2 className="text-base font-semibold leading-7 text-indigo-600">The Problem</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Why is planning outings so hard?
            </p>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              We live in different neighborhoods, have varying budgets, and argue over chat threads. Google Maps helps you find places, WhatsApp lets you talk, and Splitwise tracks splits afterward—but nothing bridges the actual planning. Hangout does.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 sm:py-24 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl lg:text-center">
            <h2 className="text-base font-semibold leading-7 text-indigo-600">How It Works</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Four simple steps to meetup heaven
            </p>
          </div>
          <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-4">
              <div className="flex flex-col">
                <dt className="text-lg font-semibold leading-7 text-slate-900">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">1</div>
                  Create Group
                </dt>
                <dd className="mt-1 flex flex-auto flex-col text-base leading-7 text-slate-600">
                  <p className="flex-auto">Create a group in 30 seconds and set the type (friends, work, date night).</p>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-lg font-semibold leading-7 text-slate-900">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">2</div>
                  Invite Friends
                </dt>
                <dd className="mt-1 flex flex-auto flex-col text-base leading-7 text-slate-600">
                  <p className="flex-auto">Share a unique 8-character invite code or QR code with your friends instantly.</p>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-lg font-semibold leading-7 text-slate-900">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">3</div>
                  Submit Constraints
                </dt>
                <dd className="mt-1 flex flex-auto flex-col text-base leading-7 text-slate-600">
                  <p className="flex-auto">Everyone privately inputs their maximum budget and drops a pin on the map. Individual data remains secret.</p>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-lg font-semibold leading-7 text-slate-900">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">4</div>
                  Vote on AI Itineraries
                </dt>
                <dd className="mt-1 flex flex-auto flex-col text-base leading-7 text-slate-600">
                  <p className="flex-auto">Get 3–4 custom itineraries generated using Groq LLM around the calculated midpoint. Vote on the winner.</p>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-7xl px-6 text-center text-sm text-slate-500">
          <p>© {new Date().getFullYear()} Hangout. Built for modern group coordination.</p>
        </div>
      </footer>
    </div>
  );
}
