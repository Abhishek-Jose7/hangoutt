import React from 'react';

interface PageContainerProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageContainer({
  children,
  title,
  subtitle,
  actions,
}: PageContainerProps) {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8 flex flex-col gap-6 relative z-10">
      {(title || subtitle || actions) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-stone-900/60 pb-5">
          <div className="flex-1 min-w-0">
            {title && (
              <h1 className="text-3xl sm:text-4xl font-normal font-heading tracking-wide text-white italic leading-none">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-2 text-[10px] font-mono tracking-widest text-neutral-400 uppercase">
                // {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-3">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
