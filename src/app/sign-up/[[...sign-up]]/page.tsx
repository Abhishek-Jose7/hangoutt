import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="saas-page">
      <div className="saas-shell saas-section">
        <section className="saas-hero">
          <div className="saas-grid-2 relative z-[1] items-start">
            <div className="space-y-4">
              <span className="section-kicker">Start Free</span>
              <h1 className="saas-title">Create Your Planning Account</h1>
              <p className="saas-lead">
                Launch your first room in minutes and run every group plan through one consistent, trackable flow.
              </p>

              <div className="saas-list">
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Invite links for instant onboarding.</div>
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Balanced midpoint and budget-aware generation.</div>
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Transparent voting before final confirmation.</div>
              </div>
            </div>

            <div className="panel p-5 sm:p-7">
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
        </section>
      </div>
    </div>
  );
}
