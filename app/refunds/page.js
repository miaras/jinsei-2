import { LegalLayout } from '../legal-layout';

export const metadata = { title: 'Refund Policy — JINSEI' };

export default function RefundsPage() {
  return <LegalLayout title="Refund Policy">
    <p className="legal-date">Effective date: August 8, 2026</p>
    <p>Paid JINSEI plans are monthly digital subscriptions sold by Paddle as merchant of record.</p>
    <h2>Cancellation</h2><p>You can cancel at any time through Paddle’s customer portal. Cancellation stops future renewal charges; you retain paid access until the end of the current billing period unless otherwise required by law.</p>
    <h2>Refund requests</h2><p>If you were charged in error, experienced a material technical issue that we cannot resolve, or believe a charge was unauthorized, contact support promptly with your Paddle order or transaction details. Refund requests are assessed case by case and do not affect rights you may have under applicable consumer-protection law.</p>
    <h2>Non-refundable use</h2><p>Except where required by law, we generally cannot refund a billing period after substantial use of the subscription or generated-picture benefit. Cancelling a subscription does not automatically create a refund for the current or past billing period.</p>
    <h2>How refunds are issued</h2><p>Approved refunds are processed by Paddle to the original payment method when possible. Processing times depend on the payment provider. If you bought through Paddle, Paddle may also provide buyer support and handling options in its customer portal.</p>
  </LegalLayout>;
}
