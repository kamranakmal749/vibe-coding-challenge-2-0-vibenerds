# Legacy Express Implementation

Original Express implementation, kept for reference and parity testing, not used by the deployed app.

## Overview
This directory contains the original Express 5 backend, Jest/Node test suites, and vanilla single-page application assets that powered early iterations of MaidanDesk.

The active, production version of MaidanDesk is entirely contained within the [`client/`](../client/) directory, powered by Next.js 15 App Router, TypeScript, and React.

> [!IMPORTANT]
> `scripts/seed.js` and the operational maintenance scripts still import Mongoose models from `legacy/src/models`, so `legacy/` must not be deleted.

