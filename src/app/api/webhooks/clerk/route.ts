import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { getSupabaseServer } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Missing webhook secret' } },
      { status: 500 }
    );
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: { code: 'INVALID_HEADERS', message: 'Missing svix headers' } },
      { status: 400 }
    );
  }

  const body = await req.text();

  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as { type: string; data: Record<string, unknown> };
  } catch (err) {
    console.error('[Webhook] Verification failed:', err);
    return NextResponse.json(
      { error: { code: 'VERIFICATION_FAILED', message: 'Invalid webhook signature' } },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  try {
    if (event.type === 'user.created') {
      const { id, email_addresses, first_name, last_name, image_url } = event.data as {
        id: string;
        email_addresses: { email_address: string }[];
        first_name: string | null;
        last_name: string | null;
        image_url: string | null;
      };

      const email = email_addresses?.[0]?.email_address;
      if (!email) {
        return NextResponse.json(
          { error: { code: 'INVALID_DATA', message: 'No email found' } },
          { status: 400 }
        );
      }

      const name = [first_name, last_name].filter(Boolean).join(' ') || null;

      const { error } = await supabase.from('users').upsert({
        id,
        email,
        name,
        avatar_url: image_url,
      });

      if (error) {
        console.error('[Webhook] User create error:', error);
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: error.message } },
          { status: 500 }
        );
      }
    }

    if (event.type === 'user.deleted') {
      const { id } = event.data as { id: string };
      const { error } = await supabase
        .from('users')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) {
        console.error('[Webhook] User delete error:', error);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Processing error:', err);
    return NextResponse.json(
      { error: { code: 'PROCESSING_ERROR', message: 'Webhook processing failed' } },
      { status: 500 }
    );
  }
}
