'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { joinGroup } from '@/actions/members';
import { Loader2, ShieldAlert, ArrowRight, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { GroupCardSkeleton } from '@/components/shared/BasicSkeleton';

export default function JoinGroupPage() {
  const params = useParams();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const inviteCode = params.code as string;

  const [status, setStatus] = useState<'LOADING' | 'SUCCESS' | 'ERROR'>('LOADING');
  const [errorMsg, setErrorMsg] = useState('');
  const [targetGroupId, setTargetGroupId] = useState('');

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!inviteCode) {
      setStatus('ERROR');
      setErrorMsg('No invite code provided.');
      return;
    }

    if (!isSignedIn) {
      const returnTo = `/join/${encodeURIComponent(inviteCode)}`;
      router.replace(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
      return;
    }

    const processJoin = async () => {
      try {
        const formattedCode = inviteCode.trim().toUpperCase();
        const res = await joinGroup({ inviteCode: formattedCode });

        if (!res.success) {
          setStatus('ERROR');
          setErrorMsg(res.error.message || 'Failed to join group. Verify your code and try again.');
          return;
        }

        // Successfully joined group
        setStatus('SUCCESS');
        const groupId = res.data.groupId;
        setTargetGroupId(groupId);
        toast.success('Joined planning group successfully!');
        
        // Wait 1.5s to show a success state to the user before redirecting
        setTimeout(() => {
          router.push(`/groups/${groupId}`);
        }, 1500);
      } catch (err) {
        console.error(err);
        setStatus('ERROR');
        setErrorMsg('An unexpected error occurred while processing the join code.');
      }
    };

    processJoin();
  }, [inviteCode, isLoaded, isSignedIn, router]);

  return (
    <PageContainer title="Outing Join Portal">
      <div className="max-w-md mx-auto relative z-10 pt-10">
        {status === 'LOADING' && (
          <GroupCardSkeleton />
        )}

        {status === 'SUCCESS' && (
          <Card className="border border-[#00E1AB]/20 bg-stone-950/45 p-8 text-center rounded-[12px] backdrop-blur-md space-y-4">
            <div className="h-10 w-10 rounded-full bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 flex items-center justify-center mx-auto animate-bounce">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xs font-mono font-bold uppercase tracking-widest text-[#00E1AB]">
                Protocol Authorized
              </CardTitle>
              <p className="text-[10px] font-mono text-neutral-500 uppercase">
                Redirecting to outing workspace...
              </p>
            </div>
            {targetGroupId && (
              <Button
                onClick={() => router.push(`/groups/${targetGroupId}`)}
                className="bg-[#00E1AB]/10 border border-[#00E1AB]/20 hover:bg-[#00E1AB]/20 text-[#00E1AB] text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] px-6 py-2 mx-auto flex items-center gap-1.5 cursor-pointer mt-2"
              >
                Enter Lobby <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </Card>
        )}

        {status === 'ERROR' && (
          <Card className="border border-stone-900 bg-stone-950/45 p-6 rounded-[12px] backdrop-blur-md text-center space-y-4">
            <div className="h-10 w-10 rounded-full bg-red-950/45 text-red-500 border border-red-900/50 flex items-center justify-center mx-auto">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xs font-mono font-bold uppercase tracking-widest text-red-500">
                Authentication Failed
              </CardTitle>
              <p className="text-[10px] font-mono text-neutral-400 uppercase leading-relaxed max-w-[280px] mx-auto mt-1">
                {errorMsg}
              </p>
            </div>
            <div className="pt-2">
              <Link href="/groups" passHref>
                <Button className="w-full bg-stone-900 hover:bg-stone-850 text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] py-2.5 cursor-pointer">
                  Return to Groups
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
