import { SignIn } from '@clerk/nextjs';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const resolvedParams = await searchParams;
  const redirectUrl = resolvedParams.redirect_url || '/groups';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <SignIn routing="hash" fallbackRedirectUrl={redirectUrl} forceRedirectUrl={redirectUrl} />
    </div>
  );
}
