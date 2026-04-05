'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { motion } from 'framer-motion';
import { AlertCircle, Copy, Crown, Link2, Users } from 'lucide-react';
import { useRemoveMember, useRoom, useRoomMembers, useStartPlanning } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { RoomMemberWithUser } from '@/types';

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  const { data: room } = useRoom(roomId);
  const { data: members } = useRoomMembers(roomId);
  const startPlanning = useStartPlanning(roomId);
  const removeMember = useRemoveMember(roomId);
  const status = useRoomStore((s) => s.status);
  const setRoom = useRoomStore((s) => s.setRoom);
  const setIsAdmin = useRoomStore((s) => s.setIsAdmin);
  const [copied, setCopied] = useState(false);

  useRoomRealtime(roomId);

  useEffect(() => {
    if (room) {
      setRoom(room);
      setIsAdmin(room.is_admin);
    }
  }, [room, setRoom, setIsAdmin]);

  // Redirect on status change
  useEffect(() => {
    if (status === 'planning') router.push(`/rooms/${roomId}/planning`);
    if (status === 'voting') router.push(`/rooms/${roomId}/voting`);
    if (status === 'confirmed') router.push(`/rooms/${roomId}/confirmed`);
  }, [status, roomId, router]);

  const inviteLink = room
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/rooms/join/${room.invite_code}`
    : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartPlanning = async () => {
    try {
      await startPlanning.mutateAsync();
    } catch {
      // error is shown from mutation
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    try {
      await removeMember.mutateAsync(memberUserId);
    } catch {
      // error shown by mutation state on button title fallback
    }
  };

  const isAdmin = room?.is_admin;
  const memberCount = (members as RoomMemberWithUser[])?.length || 0;
  const readyCount =
    (members as RoomMemberWithUser[])?.filter(
      (member) => member.lat !== null && member.lng !== null && member.budget !== null
    ).length || 0;
  const canStart = memberCount >= 2;
  const typedMembers = (members as RoomMemberWithUser[]) || [];
  const isLoadingMembers = !members;

  return (
    <div className="min-h-screen">
      <Navbar badge={{ text: 'Lobby', type: 'info' }} />

      <main className="container-base max-w-[1100px] section-base">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          className="space-y-6"
        >
          <motion.div variants={fadeInUp}>
            <Card className="p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h1 className="display-text text-[28px] sm:text-[34px] mb-1">
                    {room?.name || 'Loading Room...'}
                  </h1>
                  <p className="text-[14px] text-[var(--color-text-secondary)]">
                    Room status and members update in real-time.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${readyCount === memberCount && memberCount > 1 ? 'badge-success' : 'badge-warning'}`}>
                    {readyCount === memberCount && memberCount > 1 ? 'Live' : 'Waiting'}
                  </span>
                  <span className="badge badge-info inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> {memberCount} members
                  </span>
                </div>
              </div>
            </Card>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.25fr] gap-6 items-start">
            <motion.div variants={fadeInUp} className="space-y-6">
              <Card className="p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Link2 className="h-4 w-4 text-[var(--color-accent)]" />
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Invite Link</p>
                </div>
                <div className="relative">
                  <code className="block w-full h-[46px] leading-[46px] pr-[116px] pl-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] text-sm font-mono text-[var(--color-accent)] truncate">
                    {inviteLink || 'Generating invite link...'}
                  </code>
                  <Button
                    variant="secondary"
                    onClick={handleCopy}
                    className="absolute right-1 top-1 h-[38px]"
                    id="copy-invite-btn"
                    icon={<Copy className="h-3.5 w-3.5" />}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </Card>

              <Card className="p-5 sm:p-6 border-[var(--color-warning)]/35 bg-[rgba(245,158,11,0.08)]">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-[var(--color-warning)] mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Planning Status</p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {isAdmin
                        ? `Waiting for all members to share location and budget (${readyCount}/${memberCount} ready).`
                        : 'Waiting for admin to start planning once everyone is ready.'}
                    </p>
                  </div>
                </div>
              </Card>

              {isAdmin ? (
                <Button
                  onClick={handleStartPlanning}
                  disabled={!canStart || startPlanning.isPending}
                  loading={startPlanning.isPending}
                  className="w-full"
                  id="start-planning-btn"
                >
                  {!canStart
                    ? `Need at least 2 members (${memberCount}/2)`
                    : `Everyone's here — Start Planning`}
                </Button>
              ) : (
                <Card className="p-6 text-center">
                  <div className="text-2xl mb-2">⏳</div>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Waiting for the admin to start planning...
                  </p>
                </Card>
              )}

              {isAdmin && startPlanning.isError ? (
                <p className="text-sm text-[var(--color-danger)] text-center">
                  {startPlanning.error.message}
                </p>
              ) : null}
            </motion.div>

            <motion.div variants={fadeInUp}>
              <Card className="p-5 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Members</p>
                  <span className="text-xs text-[var(--color-text-secondary)]">{readyCount} ready</span>
                </div>

                {isLoadingMembers ? (
                  <div className="space-y-3">
                    <div className="h-[54px] rounded-xl skeleton" />
                    <div className="h-[54px] rounded-xl skeleton" />
                    <div className="h-[54px] rounded-xl skeleton" />
                  </div>
                ) : typedMembers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--color-border-default)] p-8 text-center">
                    <p className="text-sm text-[var(--color-text-secondary)]">No members yet. Share the invite link to get started.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                    {typedMembers.map((member, i) => (
                      <motion.div
                        key={member.user_id}
                        variants={fadeInUp}
                        custom={i}
                        className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                      >
                        <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-muted)] flex items-center justify-center text-sm font-semibold text-[var(--color-accent)]">
                          {(member.users?.name || member.users?.email || '?')[0].toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {member.users?.name || member.users?.email || 'Anonymous'}
                          </p>
                          <p className="text-xs text-[var(--color-text-tertiary)]">
                            Joined {new Date(member.joined_at).toLocaleTimeString()}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`badge ${member.lat !== null && member.lng !== null && member.budget !== null ? 'badge-success' : 'badge-warning'}`}>
                            {member.lat !== null && member.lng !== null && member.budget !== null ? 'Ready' : 'Pending'}
                          </span>

                          {member.user_id === room?.admin_id ? (
                            <span className="badge badge-accent inline-flex items-center gap-1">
                              <Crown className="h-3 w-3" /> Admin
                            </span>
                          ) : null}

                          {isAdmin && member.user_id !== room?.admin_id ? (
                            <Button
                              variant="secondary"
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="h-[34px] px-3 text-xs"
                              disabled={removeMember.isPending}
                              title="Remove member"
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
