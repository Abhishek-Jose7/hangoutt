import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const [{ db }, { users }] = await Promise.all([
      import('@/lib/db/client'),
      import('@/lib/db/schema'),
    ]);

    await db.select({ id: users.id }).from(users).limit(1);

    return NextResponse.json({
      ok: true,
      database: {
        reachable: true,
        driver: process.env.DB ? 'd1-binding' : 'sqlite',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown database error';

    return NextResponse.json(
      {
        ok: false,
        database: {
          reachable: false,
          error: message,
          driver: process.env.DB ? 'd1-binding' : 'sqlite',
        },
      },
      { status: 500 }
    );
  }
}
