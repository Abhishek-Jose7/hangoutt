import type { Metadata } from 'next';
import { Cormorant_Garamond, Plus_Jakarta_Sans } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

const cormorant = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Hangout — Outing Planning Platform',
  description: 'Coordinate locations, budgets, and activities, and let AI generate your group outing itineraries.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${cormorant.variable} ${plusJakartaSans.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
