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
import { createGroup } from '@/actions/groups';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface CreateGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateGroupDialog({ isOpen, onClose }: CreateGroupDialogProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState('FRIENDS');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorFields, setErrorFields] = useState<Record<string, string[]>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorFields({});

    try {
      const res = await createGroup({
        name,
        groupType,
        description: description || null,
      });

      if (!res.success) {
        if (res.error.code === 'VALIDATION_ERROR' && res.error.fields) {
          setErrorFields(res.error.fields.fieldErrors || {});
        } else {
          toast.error(res.error.message || 'Failed to create group');
        }
        setIsLoading(false);
        return;
      }

      toast.success('Planning group created successfully!');
      onClose();
      // Redirect to newly created group details page
      router.push(`/groups/${res.data.id}`);
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
          <DialogTitle className="text-xl font-bold text-slate-900">Create Outing Group</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Start planning your next meetup. Give your group a name and choose a type.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Group Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Koramangala Crew, Date Night"
              required
              disabled={isLoading}
            />
            {errorFields.name && (
              <p className="text-xs text-red-500 font-medium">{errorFields.name[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="groupType">Outing Type</Label>
            <select
              id="groupType"
              value={groupType}
              onChange={(e) => setGroupType(e.target.value)}
              disabled={isLoading}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300"
            >
              <option value="FRIENDS">Friends</option>
              <option value="DATE">Date Night</option>
              <option value="FAMILY">Family</option>
              <option value="WORK">Work / Colleagues</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are we planning?"
              disabled={isLoading}
              className="flex min-h-[80px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300"
              maxLength={300}
            />
            {errorFields.description && (
              <p className="text-xs text-red-500 font-medium">{errorFields.description[0]}</p>
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
              disabled={isLoading || !name.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white shadow"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Group'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
