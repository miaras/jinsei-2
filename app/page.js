import fs from 'node:fs';
import path from 'node:path';
import Script from 'next/script';

function legacyPageParts() {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  return {
    css: [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map((match) => match[1])
      .join('\n'),
    body: html.match(/<body>([\s\S]*?)<script>/)?.[1] || '',
    script: html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || ''
  };
}

export default function HomePage() {
  const { css, body, script } = legacyPageParts();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <Script id="jinsei-game" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
