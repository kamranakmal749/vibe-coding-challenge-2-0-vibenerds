import React from 'react';
import type { Metadata } from 'next';
import { BackgroundBlobs } from "@/components/BackgroundBlobs";

export const metadata: Metadata = {
  title: "Maidan Desk | Ultimate Platform",
  description: "The operating system for your sports academy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="relative min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <BackgroundBlobs />
        {children}
      </body>
    </html>
  );
}
