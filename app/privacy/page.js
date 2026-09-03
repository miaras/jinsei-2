import { LegalLayout } from '../legal-layout';

export const metadata = { title: 'Privacy Notice — JINSEI' };

export default function PrivacyPage() {
  return <LegalLayout title="Privacy Notice">
    <p className="legal-date">Effective date: August 8, 2026</p>
    <p>This notice explains how JINSEI processes personal data when you use the service.</p>
    <h2>Information we process</h2><p>We process account details you provide, saved-game information, game messages and actions, learned words, subscription status, and technical information needed to operate and protect the service. Paddle processes payment details; JINSEI does not receive or store full payment-card numbers.</p>
    <h2>How we use it</h2><p>We use this information to provide the game, save and resume your lives, enforce plan limits, provide support, prevent abuse, and maintain the service. With paid picture generation, we process prompts and game context to generate the requested imagePromptForModel.</p>
    <h2>Service providers</h2><p>We use Supabase for authentication, database, and storage; Paddle for merchant-of-record billing; OpenRouter for story-model access; Replicate for paid image generation; and Google Cloud Text-to-Speech for speech synthesis where enabled. These providers process information only to deliver their services under their own terms and privacy practices.</p>
    <h2>Retention and deletion</h2><p>We retain account and saved-life data while your account is active or as needed to provide the service, resolve disputes, meet legal obligations, and prevent fraud. You may request deletion of your account data through the support contact associated with your account. Billing records may be retained where required by law or Paddle’s obligations as merchant of record.</p>
    <h2>Your choices</h2><p>You can stop using the service at any time, cancel a subscription through Paddle’s customer portal, and request access, correction, or deletion where applicable law provides those rights. We do not sell personal information or use game content for targeted advertising.</p>
    <h2>Changes and contact</h2><p>We may update this notice and will post the revised effective date here. For privacy questions or requests, use the support contact associated with your JINSEI purchase or account.</p>
  </LegalLayout>;
}
