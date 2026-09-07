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
    <div className="w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 sm:pb-10 flex flex-col gap-7 relative z-10">
      {(title || subtitle || actions) && (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-white/10 pb-6">
          <div className="flex-1 min-w-0">
            {title && (
              <h1 className="text-3xl sm:text-5xl font-normal font-heading tracking-[-0.04em] text-white leading-none">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-3 text-[11px] tracking-[0.14em] text-neutral-500 uppercase">
                {subtitle}
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
