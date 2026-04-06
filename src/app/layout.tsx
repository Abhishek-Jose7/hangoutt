import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hangout // Noir Planner',
  description:
    'Build fair, budget-aware group plans in a sharp black-and-scarlet workspace.',
  keywords: ['hangout', 'planner', 'mumbai', 'AI', 'group', 'itinerary', 'noir'],
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
          colorBackground: '#0A0A0D',
          colorInputBackground: '#16161D',
          colorText: '#F4F4F6',
          borderRadius: '12px',
        },
      }}
    >
      <html lang="en" data-theme="dark" className="h-full antialiased">
        <body className="min-h-full flex flex-col">
          <QueryProvider>
            <Navbar />
            <main className="flex-1 flex flex-col basis-full noir-page">
              {children}
            </main>
            <Footer />
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
