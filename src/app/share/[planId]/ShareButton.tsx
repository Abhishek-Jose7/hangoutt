'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';

export default function ShareButton({
  planName,
  groupName,
  outingDate,
  totalCost,
}: {
  planName: string;
  groupName?: string;
  outingDate?: string;
  totalCost?: number;
}) {
  const [copied, setCopied] = useState(false);

  const buildText = () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const lines = [
      `${groupName ? groupName + ' — ' : ''}${planName}`,
      outingDate ? `📅 ${outingDate}` : '',
      totalCost != null ? `💸 ₹${totalCost}/head` : '',
      '',
      `View full itinerary: ${url}`,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const handleShare = async () => {
    const text = buildText();
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try {
        await navigator.share({ title: planName, text, url });
        return;
      } catch {
        // fall through to WhatsApp
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op
    }
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={handleShare}
        className="inline-flex items-center gap-1.5 border border-stone-800 bg-stone-900 hover:bg-stone-800 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-3 py-2 text-white transition-all"
      >
        <Share2 className="h-3.5 w-3.5 text-[#25D366]" />
        Share
      </button>
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 border border-stone-800 bg-stone-950 hover:bg-stone-900 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-3 py-2 text-neutral-300 transition-all"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[#00E5A0]" /> : null}
        {copied ? 'Copied' : 'Copy Link'}
      </button>
    </div>
  );
}
