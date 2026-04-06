'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, Copy, Crown, Link2, Users } from 'lucide-react';
import { useRemoveMember, useRoom, useRoomMembers, useStartPlanning } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Button } from '@/components/ui/Button';
import type { RoomMemberWithUser } from '@/types';

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
    setTimeout(() => setCopied(false), 1800);
  };

  const handleStartPlanning = async () => {
    try {
      await startPlanning.mutateAsync();
    } catch {
      // handled by mutation state
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    try {
      await removeMember.mutateAsync(memberUserId);
    } catch {
      // handled by mutation state
    }
  };

  const isAdmin = room?.is_admin;
  const typedMembers = (members as RoomMemberWithUser[]) || [];
  const memberCount = typedMembers.length;
  const readyCount = typedMembers.filter((m) => m.lat !== null && m.lng !== null && m.budget !== null).length;
  const readinessPercent = memberCount > 0 ? Math.round((readyCount / memberCount) * 100) : 0;
  const canStart = memberCount >= 2;

  return (
    <div className="saas-page">
      <div className="saas-shell saas-section space-y-6">
        <section className="saas-hero">
          <div className="relative z-[1] space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div>
                <span className="section-kicker">Lobby Stage</span>
                <h1 className="saas-title mt-3">{room?.name || 'Room Lobby'}</h1>
                <p className="saas-lead mt-3">Invite everyone, confirm readiness, and launch planning once enough members are in.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`badge ${readyCount === memberCount && memberCount > 1 ? 'badge-success' : 'badge-warning'}`}>
                  {readyCount}/{memberCount} Ready
                </span>
                <span className="badge badge-info inline-flex items-center gap-1"><Users className="h-3 w-3" /> Members: {memberCount}</span>
              </div>
            </div>

            <div className="saas-grid-4">
              <div className="saas-kpi"><p className="saas-kpi-label">Ready Members</p><p className="saas-kpi-value">{readyCount}</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Pending Members</p><p className="saas-kpi-value">{Math.max(memberCount - readyCount, 0)}</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Readiness</p><p className="saas-kpi-value">{readinessPercent}%</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Admin</p><p className="saas-kpi-value">{isAdmin ? 'You' : 'Host'}</p></div>
            </div>
          </div>
        </section>

        <section className="saas-grid-2 items-start">
          <aside className="space-y-4">
            <div className="panel p-5 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Invite Link</p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">Share this with your group to join the room.</p>
              </div>

              <div className="saas-band">
                <code className="text-xs sm:text-sm text-[var(--color-accent-strong)] break-all">{inviteLink || 'Generating link...'}</code>
              </div>

              <Button variant="secondary" onClick={handleCopy} id="copy-invite-btn">
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy Invite'}
              </Button>
            </div>

            <div className="panel p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)] inline-flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-[var(--color-warning)] mt-0.5" />
                {isAdmin
                  ? `Waiting for complete member inputs (${readyCount}/${memberCount} ready).`
                  : 'Waiting for host to start planning once everyone is ready.'}
              </p>

              {isAdmin ? (
                <Button
                  onClick={handleStartPlanning}
                  disabled={!canStart || startPlanning.isPending}
                  loading={startPlanning.isPending}
                  className="w-full"
                  id="start-planning-btn"
                >
                  {!canStart ? `Need at least 2 members (${memberCount}/2)` : 'Start Planning'}
                </Button>
              ) : null}

              {isAdmin && startPlanning.isError ? (
                <p className="text-sm text-[var(--color-danger)]">{startPlanning.error.message}</p>
              ) : null}
            </div>
          </aside>

          <div className="panel p-5">
            <div className="flex items-end justify-between gap-3 mb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Member Directory</p>
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mt-1">Roster And Readiness</h2>
              </div>
              <span className="text-xs text-[var(--color-text-tertiary)]">{readyCount}/{memberCount} Ready</span>
            </div>

            {!members ? (
              <div className="space-y-2">
                <div className="h-12 rounded-xl skeleton" />
                <div className="h-12 rounded-xl skeleton" />
                <div className="h-12 rounded-xl skeleton" />
              </div>
            ) : typedMembers.length === 0 ? (
              <div className="saas-band text-sm text-[var(--color-text-secondary)]">No members yet. Share the invite link to get started.</div>
            ) : (
              <div className="saas-table">
                {typedMembers.map((member) => (
                  <div key={member.user_id} className="saas-row">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                        {member.users?.name || member.users?.email || 'Anonymous'}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)] mt-1">Joined {new Date(member.joined_at).toLocaleTimeString()}</p>
                    </div>

                    <div>
                      <span className={`badge ${member.lat !== null && member.lng !== null && member.budget !== null ? 'badge-success' : 'badge-warning'}`}>
                        {member.lat !== null && member.lng !== null && member.budget !== null ? 'Ready' : 'Pending'}
                      </span>
                    </div>

                    <div>
                      {member.user_id === room?.admin_id ? (
                        <span className="badge badge-accent inline-flex items-center gap-1"><Crown className="h-3 w-3" /> Admin</span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-tertiary)]">Member</span>
                      )}
                    </div>

                    <div>
                      {isAdmin && member.user_id !== room?.admin_id ? (
                        <Button
                          variant="secondary"
                          onClick={() => handleRemoveMember(member.user_id)}
                          className="h-[34px] px-3 text-xs"
                          disabled={removeMember.isPending}
                        >
                          Remove
                        </Button>
                      ) : (
                        <span className="text-xs text-[var(--color-text-tertiary)] inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> Active</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
