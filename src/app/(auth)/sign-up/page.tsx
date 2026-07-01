import { SignUp } from '@clerk/nextjs';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const resolvedParams = await searchParams;
  const redirectUrl = resolvedParams.redirect_url || '/groups';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <SignUp routing="hash" fallbackRedirectUrl={redirectUrl} forceRedirectUrl={redirectUrl} />
    </div>
  );
}
