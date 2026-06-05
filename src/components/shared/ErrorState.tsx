import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryText?: string;
}

export default function ErrorState({
  title = 'An error occurred',
  message = 'We could not fetch the details. Please try again.',
  onRetry,
  retryText = 'Try Again',
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 gap-4 text-center border border-dashed border-red-200 bg-red-50/50 rounded-xl max-w-lg mx-auto my-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} variant="destructive">
          {retryText}
        </Button>
      )}
    </div>
  );
}
