import Link from 'next/link';

export function LegalLayout({ title, children }) {
  return <main className="legal-page"><article className="legal-content">
    <Link className="legal-brand" href="/">人生 · JINSEI</Link>
    <h1>{title}</h1>
    {children}
    <nav className="legal-nav"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refunds">Refunds</Link><Link href="/">Return to JINSEI</Link></nav>
  </article></main>;
}
