import { LegalLayout } from '../legal-layout';

export const metadata = { title: 'Terms of Service — JINSEI' };

export default function TermsPage() {
  return <LegalLayout title="Terms of Service">
    <p className="legal-date">Effective date: August 8, 2026</p>
    <p>JINSEI is a language-learning, interactive fiction service. By using it, you agree to these terms.</p>
    <h2>Your account and saved lives</h2><p>You are responsible for the accuracy of information you submit and for keeping your account credentials secure. You may create multiple saved lives. Do not use the service for unlawful, harmful, or abusive activity.</p>
    <h2>Subscriptions and billing</h2><p>The free plan includes a limited number of story turns. Paid plans are monthly subscriptions: Unlimited is US$4.99 per month and Unlimited + Pictures is US$9.99 per month, before any applicable taxes shown at checkout. Subscriptions renew automatically unless cancelled before the next billing date.</p><p>Paddle acts as the merchant of record for paid plans. Its checkout and customer portal handle payment processing, tax collection, invoices, cancellations, and payment-method changes. Your purchase is also subject to Paddle’s applicable buyer terms.</p>
    <h2>Content and availability</h2><p>AI-generated story text, translations, audio, and images can be inaccurate or unsuitable. They are provided for entertainment and language practice, not as professional advice. We may change, suspend, or discontinue features when reasonably necessary.</p>
    <h2>Acceptable use</h2><p>Do not attempt to bypass turn limits or subscription controls, probe or disrupt the service, scrape it at scale, or submit content that infringes others’ rights or violates law.</p>
    <h2>Liability</h2><p>To the extent permitted by law, JINSEI is provided “as is” and “as available.” We are not liable for indirect, incidental, special, consequential, or punitive damages. Nothing in these terms limits rights that cannot legally be limited.</p>
    <h2>Changes and contact</h2><p>We may update these terms and will post the revised effective date here. For questions about these terms, use the support contact associated with your JINSEI purchase or account.</p>
  </LegalLayout>;
}
