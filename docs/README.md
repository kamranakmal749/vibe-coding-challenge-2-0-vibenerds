# Documentation Index — Maidan Desk

Welcome to the Maidan Desk documentation hub. This index centralizes all architectural, technical, operational, and historical reference documents for the platform.

---

## 📚 Core Documentation

| Document | Purpose & Content | Target Audience |
|:---|:---|:---|
| [**Main Project README**](../README.md) | Primary project showcase, feature matrix, live demo credentials, and quickstart guide. | Developers, Evaluators, Maintainers |
| [**System Architecture & Context**](PROJECT_CONTEXT.md) | Historical architectural notes, domain entities, design rationale, and schema specifications. | System Architects, Engineers |
| [**Known Issues & Technical Debt**](../KNOWN_ISSUES.md) | Catalog of resolved bugs, parity considerations, test fixtures notes, and architectural trade-offs. | QA, Security Engineers, Maintainers |
| [**Changelog & Release Notes**](../CHANGELOG.md) | Complete chronological release history across v1, v2 (ERP), and v2.1 (Hardening). | All Stakeholders |

---

## 🖼️ Media & Visual Assets

| Asset / Gallery | Description | Path |
|:---|:---|:---|
| **Project Banner** | High-resolution scalable vector banner (Deep Navy, Emerald Accent, Sports Geometry). | [`docs/assets/maidan-desk-banner.svg`](assets/maidan-desk-banner.svg) |
| [**Full Screenshot Gallery**](SCREENSHOTS.md) | High-fidelity production captures across all 4 portals (Admin, Coach, Scout, Player). | [`docs/SCREENSHOTS.md`](SCREENSHOTS.md) |

---

## 🛠️ Configuration & Deployment

| Reference | Scope & Details |
|:---|:---|
| [**Client Environment Template**](../client/.env.example) | Production & local environment variables for the active Next.js 15 application. |
| [**Root Tooling Environment**](../.env.example) | Dedicated environment template for offline maintenance scripts and parity testing. |
| [**CI/CD Pipeline**](../.github/workflows/ci.yml) | GitHub Actions workflow covering `npm ci`, unit testing, TypeScript typechecking, and production builds. |

---

## 🔐 Security & Governance

- **Database Protection**: `scripts/seed.js` enforces a multi-tier safety guard requiring both `ALLOW_PRODUCTION_DB="true"` and `CONFIRM_DESTRUCTIVE_SEED="I_ACKNOWLEDGE_THIS_DESTROYS_DATA"`.
- **Clock Mocking**: `ALLOW_MOCK_NOW` is strictly barred in production environments (`NODE_ENV === 'production'`).
- **Audit Logging**: All administrative operations (staff provisioning, athlete lifecycle, password resets, coach reassignments) are recorded to the immutable `auditlogs` collection.

