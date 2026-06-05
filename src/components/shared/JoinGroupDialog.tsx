'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { joinGroup } from '@/actions/members';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface JoinGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function JoinGroupDialog({ isOpen, onClose }: JoinGroupDialogProps) {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorText('');

    const formattedCode = inviteCode.trim().toUpperCase();
    if (formattedCode.length !== 8) {
      setErrorText('Invite code must be exactly 8 characters.');
      setIsLoading(false);
      return;
    }

    try {
      const res = await joinGroup({ inviteCode: formattedCode });

      if (!res.success) {
        setErrorText(res.error.message || 'Failed to join group. Verify your code and try again.');
        setIsLoading(false);
        return;
      }

      toast.success('Joined planning group successfully!');
      onClose();
      // Redirect to the group page
      router.push(`/groups/${res.data.groupId}`);
    } catch (err) {
      console.error(err);
      toast.error('An unexpected error occurred.');
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">Join Planning Group</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Enter the 8-character alphanumeric invite code shared by your friend to join.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="inviteCode">Invite Code</Label>
            <Input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={(e) => {
                setInviteCode(e.target.value);
                setErrorText('');
              }}
              placeholder="e.g. KORA4390"
              maxLength={8}
              required
              disabled={isLoading}
              className="text-center font-mono tracking-widest uppercase text-lg"
            />
            {errorText && (
              <p className="text-xs text-red-500 font-medium text-center">{errorText}</p>
            )}
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || inviteCode.trim().length !== 8}
              className="bg-indigo-600 hover:bg-indigo-500 text-white shadow"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining...
                </>
              ) : (
                'Join Group'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
