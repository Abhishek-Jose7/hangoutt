import { SignIn } from '@clerk/nextjs';
import { WebsiteHero, WebsitePage } from '@/components/site/WebsiteLayout';

export default function SignInPage() {
  return (
    <WebsitePage>
      <WebsiteHero>
          <div className="saas-grid-2 relative z-[1] items-start">
            <div className="space-y-4">
              <span className="section-kicker">Account Access</span>
              <h1 className="saas-title">Sign In To Your Workspace</h1>
              <p className="saas-lead">
                Return to your active rooms, continue planning sessions, and keep all group decisions in sync.
              </p>

              <div className="saas-list">
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Live room status and member readiness.</div>
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">AI itinerary generation with fairness constraints.</div>
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Voting and confirmation workflow for final decisions.</div>
              </div>
            </div>

            <div className="panel p-5 sm:p-7">
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
      </WebsiteHero>
    </WebsitePage>
  );
}
