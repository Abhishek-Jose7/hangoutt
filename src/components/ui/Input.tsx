import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input field-input ${className || ''}`.trim()} {...props} />;
}
