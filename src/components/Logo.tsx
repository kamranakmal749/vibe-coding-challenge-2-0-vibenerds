import React from 'react';

export function Logo({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" className={className}>
      <defs>
        {/* Bright Emerald Gradient kept for both modes */}
        <linearGradient id="mGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      
      {/* The Monolith 'M' - Scaled to fill the entire 200x200 canvas */}
      <path 
        d="M 0 200 L 0 0 L 100 100 L 200 0 L 200 200 L 150 200 L 150 80 L 100 140 L 50 80 L 50 200 Z" 
        fill="url(#mGrad)" 
      />
      
      {/* The Data Horizon Line - Slate in light mode, White in dark mode */}
      <rect 
        x="0" 
        y="96" 
        width="200" 
        height="8" 
        className="fill-slate-900 dark:fill-white" 
      />
    </svg>
  );
}
export default Logo;
