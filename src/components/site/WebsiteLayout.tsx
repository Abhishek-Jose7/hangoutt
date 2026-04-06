import type { ReactNode } from 'react';

interface WebsitePageProps {
  children: ReactNode;
  className?: string;
}

interface WebsiteSectionProps {
  children: ReactNode;
  className?: string;
}

interface WebsiteHeroProps {
  children: ReactNode;
  className?: string;
}

export function WebsitePage({ children, className }: WebsitePageProps) {
  return <div className={`site-page ${className || ''}`.trim()}>{children}</div>;
}

export function WebsiteSection({ children, className }: WebsiteSectionProps) {
  return <section className={`site-section ${className || ''}`.trim()}>{children}</section>;
}

export function WebsiteHero({ children, className }: WebsiteHeroProps) {
  return <section className={`site-hero ${className || ''}`.trim()}>{children}</section>;
}
