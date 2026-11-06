import React from 'react';

export const metadata = {
  title: 'Maidan Desk | Sports OS',
  description: 'Sports Academy Management Platform',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased font-sans min-h-screen m-0 p-0 overflow-auto">
        {children}
      </body>
    </html>
  );
}
