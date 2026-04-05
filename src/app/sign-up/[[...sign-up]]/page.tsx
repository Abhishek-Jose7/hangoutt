import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen hero-gradient">
      <div className="container-base section-base max-w-[760px]">
        <div className="card p-8 sm:p-10 max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="display-text text-3xl mb-2">Create your account</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Start planning hangouts with your friends
          </p>
        </div>
        <SignUp
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
