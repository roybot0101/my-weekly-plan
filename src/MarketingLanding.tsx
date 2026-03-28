import { type FormEvent, useState } from 'react';
import { CalendarClock, CheckCheck, Sparkles } from 'lucide-react';
import { hasSupabaseEnv, supabase } from './lib/supabase';

const WAITLIST_CONTACT_EMAIL = 'tempo@ugcroy.com';
const WAITLIST_SOURCE = 'marketing-landing';
const WAITLIST_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildWaitlistMailto(email: string) {
  const subject = encodeURIComponent('Tempo waitlist request');
  const body = encodeURIComponent(`Please add ${email} to the Tempo waitlist.`);
  return `mailto:${WAITLIST_CONTACT_EMAIL}?subject=${subject}&body=${body}`;
}

async function submitWaitlistViaApi(email: string) {
  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        source: WAITLIST_SOURCE,
      }),
    });

    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) return false;

    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}

async function submitWaitlistViaSupabase(email: string) {
  if (!hasSupabaseEnv || !supabase) return false;
  const { error } = await supabase.from('waitlist_contacts').upsert(
    {
      email,
      opted_in: true,
      source: WAITLIST_SOURCE,
    },
    { onConflict: 'email' },
  );
  return !error;
}

export function MarketingLanding() {
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistError, setWaitlistError] = useState('');
  const [waitlistSuccess, setWaitlistSuccess] = useState('');
  const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);

  async function handleWaitlistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWaitlistError('');
    setWaitlistSuccess('');

    const normalizedEmail = waitlistEmail.trim().toLowerCase();
    if (!WAITLIST_EMAIL_REGEX.test(normalizedEmail)) {
      setWaitlistError('Enter a valid email address to join the waitlist.');
      return;
    }

    setIsSubmittingWaitlist(true);
    try {
      const wasSavedViaApi = await submitWaitlistViaApi(normalizedEmail);
      if (wasSavedViaApi) {
        setWaitlistEmail('');
        setWaitlistSuccess("You're on the waitlist. We'll reach out soon.");
        return;
      }

      const wasSavedViaSupabase = await submitWaitlistViaSupabase(normalizedEmail);
      if (wasSavedViaSupabase) {
        setWaitlistEmail('');
        setWaitlistSuccess("You're on the waitlist. We'll reach out soon.");
        return;
      }

      window.location.assign(buildWaitlistMailto(normalizedEmail));
      setWaitlistSuccess(
        `We couldn't auto-save right now, but we opened your email app for ${WAITLIST_CONTACT_EMAIL}.`,
      );
    } finally {
      setIsSubmittingWaitlist(false);
    }
  }

  return (
    <div className="marcom-shell">
      <div className="marcom-glow marcom-glow-left" aria-hidden="true" />
      <div className="marcom-glow marcom-glow-right" aria-hidden="true" />
      <main className="marcom-card">
        <img className="marcom-owl logo-entrance" src="/img/tempo-icon.png" alt="Plan with Tempo owl" />
        <h1 className="marcom-title">Plan with Tempo</h1>
        <p className="marcom-subhead">Plan your week. Deliver every project calmly.</p>
        <p className="marcom-copy">
          Turn client work into a clear weekly plan — scripts, filming, edits, all scheduled.
        </p>
        <div className="marcom-feature-grid" aria-label="Tempo benefits">
          <article className="marcom-feature-card">
            <Sparkles size={22} aria-hidden="true" />
            <p>Turn messy briefs into a step-by-step execution plan</p>
          </article>
          <article className="marcom-feature-card">
            <CheckCheck size={22} aria-hidden="true" />
            <p>Automatically prioritize deadlines and high-value work</p>
          </article>
          <article className="marcom-feature-card">
            <CalendarClock size={22} aria-hidden="true" />
            <p>See your entire week mapped out in seconds</p>
          </article>
        </div>
        <section className="marcom-waitlist" aria-label="Waitlist signup">
          <form className="marcom-waitlist-form" onSubmit={handleWaitlistSubmit} noValidate>
            <input
              id="marcom-waitlist-email"
              type="email"
              autoComplete="email"
              placeholder="Email address"
              value={waitlistEmail}
              onChange={(event) => setWaitlistEmail(event.target.value)}
              aria-label="Email address"
              required
            />
            <button
              type="submit"
              className="marcom-waitlist-button tempo-primary-button"
              disabled={isSubmittingWaitlist}
            >
              {isSubmittingWaitlist ? 'Joining...' : 'Get early access'}
            </button>
          </form>
          {waitlistError ? <p className="marcom-waitlist-message marcom-waitlist-message-error">{waitlistError}</p> : null}
          {waitlistSuccess ? (
            <p className="marcom-waitlist-message marcom-waitlist-message-success">{waitlistSuccess}</p>
          ) : null}
        </section>
        <p className="marcom-legal">
          <a href="/privacy.html">Privacy Policy</a>
          <span aria-hidden="true">•</span>
          <a href="/terms.html">Terms of Service</a>
          <span aria-hidden="true">•</span>
          <a href="/data-deletion.html">Data Deletion</a>
        </p>
      </main>
    </div>
  );
}
