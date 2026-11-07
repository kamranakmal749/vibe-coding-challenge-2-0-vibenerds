import React from 'react';
import type { Metadata } from 'next';
import './scout.css';

export const metadata: Metadata = {
  title: 'Scout Radar | Maidan Desk',
  description: 'Trial-ready academy athletes evaluated for professional selection',
};

export default function ScoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
