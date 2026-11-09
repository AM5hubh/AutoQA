import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AutoQA — Evidence, not guesswork',
  description:
    'Turn plain-English requirements into reviewed browser tests and evidence-backed reports.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
