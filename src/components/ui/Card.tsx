import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card surface-panel ${className || ''}`.trim()} {...props} />;
}
