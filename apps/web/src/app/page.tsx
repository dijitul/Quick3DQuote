import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Cuboid,
  Gauge,
  Plug,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const benefits = [
  {
    icon: Gauge,
    title: 'Instant quoting',
    copy: 'Customers see a priced, 3D-previewed, payable quote within two seconds of uploading their part. No more email back-and-forth.',
  },
  {
    icon: Plug,
    title: 'One-line install',
    copy: 'Paste a single <script> tag into WordPress, Shopify, Webflow or raw HTML. No plugins, no tech team required.',
  },
  {
    icon: ShieldCheck,
    title: 'You keep the payment',
    copy: 'Customers pay your Stripe account directly. We bill you a flat monthly fee — your margins stay yours.',
  },
] as const;

const plans = [
  {
    id: 'starter',
    name: 'Starter',
    price: '£50',
    cadence: 'per month',
    tagline: 'Everything a one-printer shop needs to start quoting online today.',
    features: [
      'Unlimited quotes and orders',
      'Unlimited materials and processes',
      'Stripe Checkout for your customers',
      'Email notifications',
      'Standard support',
    ],
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '£99',
    cadence: 'per month',
    tagline: 'For shops juggling dozens of materials and more than one printer.',
    features: [
      'Everything in Starter',
      'Bulk material imports',
      'Priority quote-engine capacity',
      'Remove "Powered by Quick3DQuote"',
      'Priority email support',
    ],
    highlight: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    price: '£199',
    cadence: 'per month',
    tagline: 'For busy bureaus doing hundreds of quotes a month across sites.',
    features: [
      'Everything in Pro',
      'Multiple widgets per shop',
      'SLA on quote-engine uptime',
      'Custom accent + logo kit',
      'Dedicated onboarding call',
    ],
    highlight: false,
  },
] as const;

const faqs = [
  {
    q: 'How is the price calculated?',
    a: 'We measure the mesh volume with trimesh, then apply your per-material £/cm³, machine hourly rate, setup fee, min order and markup. You control every number.',
  },
  {
    q: 'Which file types are supported?',
    a: 'STL, OBJ and 3MF on launch, up to 100MB. STEP is on the roadmap.',
  },
  {
    q: 'Who receives the customer\u2019s payment?',
    a: 'You do. Customers pay your own Stripe account directly through Stripe Checkout. We bill you a flat monthly subscription only.',
  },
  {
    q: 'Can I try it before subscribing?',
    a: 'Sign up with your email, configure a material, and view a live preview widget at quick3dquote.com/preview. Subscribing unlocks the embed snippet for your real site.',
  },
  {
    q: 'What if my customer uploads a broken mesh?',
    a: 'Our engine reports watertight / repairable state. Broken-but-repairable meshes still get priced; unrepairable ones tell the customer to re-export.',
  },
];

export default function MarketingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-5 w-5 text-accent-500" aria-hidden />
            Quick3DQuote
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <Link href="#benefits" className="hover:text-foreground">
              Why Quick3DQuote
            </Link>
            <Link href="#pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="#faq" className="hover:text-foreground">
              FAQ
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-accent-50 to-background dark:from-neutral-900 dark:to-background" />
          <div className="container grid gap-12 py-24 md:grid-cols-12 md:items-center">
            <div className="md:col-span-7">
              <Badge tone="accent" className="mb-5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                New: direct-to-shop Stripe payouts
              </Badge>
              <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
                Instant 3D-printing quotes, embedded on your site.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                A drop-in widget that turns an uploaded STL into a priced, payable order in under
                two minutes. Half the price of RapidQuote3D, twice as considered.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/signup">
                    Start free <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="#pricing">See pricing</Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                From £50/mo. Cancel anytime. No setup fees.
              </p>
            </div>
            <div className="md:col-span-5">
              <div className="relative rounded-lg border border-border bg-card p-6 shadow-2">
                <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-wider text-neutral-500">
                  <span>Preview</span>
                  <Cuboid className="h-4 w-4" aria-hidden />
                </div>
                <div className="grid aspect-[4/3] place-items-center rounded-md bg-gradient-to-br from-accent-50 to-accent-100 dark:from-neutral-800 dark:to-neutral-900">
                  <Cuboid className="h-20 w-20 text-accent-500" aria-hidden />
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-neutral-500">Total</p>
                    <p className="text-3xl font-bold tabular-nums">£14.20</p>
                  </div>
                  <Button size="sm">Order now</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  48 × 32 × 15 mm · 12.4 cm³ · PLA Black (FDM)
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section id="benefits" className="border-b border-border py-24">
          <div className="container grid gap-12 md:grid-cols-3">
            {benefits.map(({ icon: Icon, title, copy }) => (
              <Card key={title} className="p-6">
                <CardContent className="flex flex-col gap-4 p-0">
                  <div
                    aria-hidden
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-50 text-accent-700"
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-semibold">{title}</h2>
                  <p className="text-sm text-muted-foreground">{copy}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-b border-border py-24">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">Simple, honest pricing</h2>
              <p className="mt-3 text-muted-foreground">
                Pick a plan, paste the snippet, start taking paid orders. No per-quote fees, no
                per-customer fees.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className={
                    plan.highlight
                      ? 'relative border-accent-500 ring-1 ring-accent-500'
                      : undefined
                  }
                >
                  {plan.highlight ? (
                    <span className="absolute -top-3 left-6 rounded-full bg-accent-500 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
                      Most popular
                    </span>
                  ) : null}
                  <CardContent className="flex h-full flex-col gap-6 p-6">
                    <div>
                      <h3 className="text-lg font-semibold">{plan.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                    </div>
                    <div>
                      <span className="text-3xl font-bold tabular-nums">{plan.price}</span>
                      <span className="ml-1 text-sm text-muted-foreground">{plan.cadence}</span>
                    </div>
                    <ul className="flex flex-1 flex-col gap-2 text-sm">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 text-success" aria-hidden />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button asChild variant={plan.highlight ? 'primary' : 'secondary'}>
                      <Link href="/signup">
                        Start {plan.name}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Customer payments settle directly in your Stripe account.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-b border-border py-24">
          <div className="container grid gap-12 md:grid-cols-3">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Frequently asked</h2>
              <p className="mt-3 text-muted-foreground">
                Can\u2019t find an answer? Email{' '}
                <a className="underline" href="mailto:hello@quick3dquote.com">
                  hello@quick3dquote.com
                </a>
                .
              </p>
            </div>
            <dl className="md:col-span-2 space-y-6">
              {faqs.map((item) => (
                <div key={item.q} className="border-b border-border pb-6">
                  <dt className="text-base font-semibold">{item.q}</dt>
                  <dd className="mt-2 text-sm text-muted-foreground">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24">
          <div className="container">
            <Card className="border-accent-500/30 bg-accent-50/60 dark:bg-neutral-900/40">
              <CardContent className="flex flex-col items-center justify-between gap-6 p-10 md:flex-row">
                <div className="max-w-xl text-center md:text-left">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    Give your customers a price before they close the tab.
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sign up, configure one material, and have the widget live on your site in under
                    ten minutes.
                  </p>
                </div>
                <Button asChild size="lg">
                  <Link href="/signup">
                    Start free <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-10">
        <div className="container flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-500" aria-hidden />
            <span>&copy; {new Date().getFullYear()} Quick3DQuote. UK spelling included.</span>
          </div>
          <nav className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Start free
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
