import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  fullPage?: boolean;
}

export default function LoadingState({
  message = 'Loading details, please wait...',
  fullPage = false,
}: LoadingStateProps) {
  const content = (
    <div className="flex flex-col items-center justify-center p-8 gap-3 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        {content}
      </div>
    );
  }

  return content;
}
