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
  const [outingDate, setOutingDate] = useState('');
  const [outingTime, setOutingTime] = useState('');
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
        outingDate: outingDate || null,
        outingTime: outingTime || null,
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
      <DialogContent className="sm:max-w-md rounded-[4px] border border-[#353534] bg-[#0e0e0e] text-white shadow-[0_0_30px_rgba(0,0,0,0.55)]">
        <DialogHeader>
          <DialogTitle className="text-sm font-mono font-bold text-white uppercase tracking-widest">Create Group Protocol</DialogTitle>
          <DialogDescription className="text-[10px] text-neutral-400 font-mono uppercase tracking-wider">
            Start planning your next meetup. Give your group a name and choose a type.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Group Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Koramangala Crew, Date Night"
              required
              disabled={isLoading}
              className="bg-black/60 border border-[#353534] text-white rounded-[4px] font-mono text-xs focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C]"
            />
            {errorFields.name && (
              <p className="text-xs text-red-500 font-medium">{errorFields.name[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="groupType" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Outing Type</Label>
            <select
              id="groupType"
              value={groupType}
              onChange={(e) => setGroupType(e.target.value)}
              disabled={isLoading}
              className="flex h-10 w-full rounded-[4px] border border-[#353534] bg-black/60 px-3 py-2 text-xs text-white font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#DC143C] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="FRIENDS">Friends</option>
              <option value="DATE">Date Night</option>
              <option value="FAMILY">Family</option>
              <option value="WORK">Work / Colleagues</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="outingDate" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Date (Optional)</Label>
              <Input
                id="outingDate"
                type="date"
                value={outingDate}
                onChange={(e) => setOutingDate(e.target.value)}
                disabled={isLoading}
                className="bg-black/60 border border-[#353534] text-white rounded-[4px] font-mono text-xs focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] [color-scheme:dark]"
              />
              {errorFields.outingDate && (
                <p className="text-[10px] text-red-500 font-mono">{errorFields.outingDate[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="outingTime" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Time (Optional)</Label>
              <Input
                id="outingTime"
                type="time"
                value={outingTime}
                onChange={(e) => setOutingTime(e.target.value)}
                disabled={isLoading}
                className="bg-black/60 border border-[#353534] text-white rounded-[4px] font-mono text-xs focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] [color-scheme:dark]"
              />
              {errorFields.outingTime && (
                <p className="text-[10px] text-red-500 font-mono">{errorFields.outingTime[0]}</p>
              )}
            </div>
          </div>



          <div className="space-y-2">
            <Label htmlFor="description" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Description (Optional)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are we planning?"
              disabled={isLoading}
              className="flex min-h-[80px] w-full rounded-[4px] border border-[#353534] bg-black/60 px-3 py-2 text-xs text-white font-mono ring-offset-black placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#DC143C] disabled:cursor-not-allowed disabled:opacity-50"
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
              className="rounded-[4px] border-[#353534] bg-black/40 text-neutral-300 hover:bg-stone-900 hover:text-white font-mono text-[10px] uppercase tracking-widest"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="bg-[#DC143C] hover:bg-[#B80F2E] text-white shadow-[0_0_15px_rgba(220,20,60,0.28)] rounded-[4px] font-mono text-[10px] uppercase tracking-widest"
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
