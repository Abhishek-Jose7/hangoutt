'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
}: SearchBarProps) {
  return (
    <div className="relative w-full">
      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-neutral-500">
        <Search className="h-3.5 w-3.5" />
      </div>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-8 w-full bg-stone-950/80 border border-stone-850 focus-visible:ring-1 focus-visible:ring-[#EB690B] focus-visible:border-[#EB690B] rounded-[8px] text-xs font-mono uppercase tracking-wider text-white placeholder-neutral-600 h-9"
        placeholder={placeholder}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-500 hover:text-white focus:outline-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
