import type { Metadata } from 'next';
import '../styles.css';

export const metadata: Metadata = {
  title: 'Telecom Incident Explorer — Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
