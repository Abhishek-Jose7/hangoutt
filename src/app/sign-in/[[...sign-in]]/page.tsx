import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen hero-gradient">
      <div className="container-base section-base max-w-[760px]">
        <div className="card p-8 sm:p-10 max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="display-text text-3xl mb-2">Welcome back</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Sign in to continue planning
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: 'w-full',
              cardBox: 'w-full',
            },
          }}
        />
        </div>
      </div>
    </div>
  );
}
