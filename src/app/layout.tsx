import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hangout — Smart AI Hangout Planner',
  description:
    'Plan group hangouts in Mumbai with AI-powered itineraries, fair travel times, and real-time voting.',
  keywords: ['hangout', 'planner', 'mumbai', 'AI', 'group', 'itinerary'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: '#DC143C',
          colorBackground: '#0F0F12',
          colorInputBackground: '#15151A',
          colorText: '#F6F6F7',
          borderRadius: '12px',
        },
      }}
    >
      <html lang="en" data-theme="dark" className="h-full antialiased">
        <body className="min-h-full flex flex-col">
          <QueryProvider>
            <Navbar />
            <main className="flex-1 flex flex-col basis-full">
              {children}
            </main>
            <Footer />
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
