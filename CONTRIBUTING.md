# Contributing to Maidan Desk

Thank you for your interest in contributing to **Maidan Desk**! We welcome bug reports, feature discussions, documentation improvements, and pull requests.

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for all contributors. Please treat everyone with respect and kindness.

## Development Workflow

### 1. Repository Structure
- `client/`: Active Next.js 15 App Router application, React 19 components, and API route handlers.
- `docs/`: Technical specifications, architecture records, and screenshots.
- `scripts/`: Operational utilities (guarded database seeds, verification).
- `legacy/`: Preserved Express codebase and Mongoose schemas (required by maintenance scripts; do not delete).

### 2. Setting Up Locally
```bash
cd client
npm ci
cp .env.example .env.local
npm run dev
```

### 3. Testing Requirements
Before submitting any changes, ensure all automated tests and typechecks pass:
```bash
cd client
npm test
npm run typecheck
npm run build
```

## Pull Request Guidelines

1. **Focused Changes**: Keep pull requests focused on a single issue or feature.
2. **Preserve Database Safety**: Never bypass the database guards or commit database credentials.
3. **Keep Commits Clean**: Write clear, descriptive commit messages following the Conventional Commits specification (e.g. `fix: ...`, `feat: ...`, `chore: ...`, `docs: ...`).
4. **Update Documentation**: If your change modifies API routes, role permissions, or environment variables, update the corresponding documentation in `docs/` and `README.md`.

