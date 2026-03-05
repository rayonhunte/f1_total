# F1 Fantasy App - Executable Delivery Plan

## 1) Product Scope (MVP)
Build an F1 fantasy web app where users submit picks and earn points through configurable scoring rules.

### Core MVP features
- User auth (Email/Password + Google)
- League leaderboard with rank movement indicators
- Pick submission with admin-controlled lock time
- Admin-configurable scoring engine
- Race result ingestion and automatic score calculation

### Confirmed rule updates from feedback
- DNF penalties are optional (`enabled/disabled`, configurable value)
- Podium picks must be unique (no duplicate driver in P1/P2/P3)
- Lock window is admin-controlled (`FP3_END`, `QUALIFYING_END`, `RACE_START`, `CUSTOM_DATETIME`)
- Leaderboard must show rank movement (`previousRank`, `rankDelta`)

## 2) Technical Stack
- Frontend: Vite + React + TypeScript
- Data/Auth/Hosting: Firebase (Auth, Firestore, Hosting, Functions, Scheduler)
- State/data fetching: React Query
- Validation: Zod + Firebase server-side validation
- Styling/UI: Tailwind or CSS Modules (choose during Phase 0)

## 3) Firestore Data Model (MVP)
- `users/{uid}`
  - `displayName`, `email`, `role` (`user|admin`), `createdAt`
- `seasons/{seasonId}`
  - `name`, `year`, `isActive`, `scoringRules`, `lockPolicy`
- `races/{raceId}`
  - `seasonId`, `name`, `fp3EndAt`, `qualifyingEndAt`, `raceStartAt`, `status`
- `drivers/{driverId}`
  - `name`, `teamId`, `code`
- `constructors/{constructorId}`
  - `name`, `code`
- `picks/{pickId}`
  - `uid`, `seasonId`, `raceId`, `podium: {p1,p2,p3}`, `constructors[]`, `submittedAt`, `locked`
- `results/{raceId}`
  - normalized race + standings data for scoring
- `scores/{seasonId_uid}`
  - `totalPoints`, `byRace`, `lastUpdatedAt`
- `leaderboards/{seasonId}`
  - `entries[]` with `uid`, `rank`, `previousRank`, `rankDelta`, `points`, `pointsDelta`

## 4) Scoring Engine Contract
Store scoring rules under `seasons/{seasonId}.scoringRules`:
- `podiumPoints`: `{ p1: number, p2: number, p3: number }`
- `constructorPointsMode`: `official | custom`
- `constructorPointsCustom` (optional map)
- `standingsMovement`: `{ constructorGain: number, driverGain: number }`
- `dnfPenalty`: `{ enabled: boolean, value: number }`

Server (Functions) computes all official scores. Client only displays.

## 5) Security and Validation Rules
- Users can create/update only their own picks before lock
- Picks immutable after lock cutoff
- Only admins/functions can write `results`, `scores`, `leaderboards`, `seasons.scoringRules`, `seasons.lockPolicy`
- Podium uniqueness validated in:
  - React form validation
  - Zod schema
  - Cloud Function write guard

## 6) Execution Phases

## Phase 0 - Project Bootstrap (Day 1)
### Tasks
- Initialize Vite React TS app
- Initialize Firebase project config
- Install dependencies
- Setup env and emulator scripts

### Exit criteria
- App runs locally
- Firebase emulator starts
- CI baseline (lint + typecheck) passes

## Phase 1 - Auth + Base Data (Days 2-3)
### Tasks
- Implement auth flows
- Create season/race/driver/constructor seed scripts
- Build user profile bootstrap on first login

### Exit criteria
- User can sign in/out
- Seeded season and race calendar visible in UI

## Phase 2 - Picks Flow (Days 4-6)
### Tasks
- Build pick form (podium + constructors)
- Enforce no duplicate podium driver
- Show lock countdown and lock status
- Save picks to Firestore

### Exit criteria
- User can submit picks before lock
- Duplicate podium is blocked at UI and backend
- Pick updates denied after lock

## Phase 3 - Admin Rules + Lock Controls (Days 7-9)
### Tasks
- Admin panel for scoring rules
- Admin panel for lock policy mode
- Manual lock override control
- Audit log entries for rule/lock changes

### Exit criteria
- Admin can adjust scoring without redeploy
- Admin can change submission close strategy per race/season

## Phase 4 - Results Ingestion + Scoring (Days 10-12)
### Tasks
- Scheduled function to fetch race/standings data
- Score calculator with configurable rules
- Recompute season leaderboard after each race

### Exit criteria
- Scores are produced automatically after race data ingestion
- DNF penalty only applies when enabled

## Phase 5 - Leaderboard UX (Days 13-14)
### Tasks
- Build leaderboard screen
- Add movement indicators (up/down/same)
- Add race-by-race points breakdown

### Exit criteria
- Users can see live rank, previous rank, and movement

## Phase 6 - Hardening + Launch (Days 15-17)
### Tasks
- Firestore security rules tests
- Function integration tests for scoring and locks
- Production build + Firebase Hosting deploy

### Exit criteria
- Security rules pass tests
- Scoring regression tests pass
- Production URL live

## 7) Backlog (Ticket-Ready)
1. FE-001: Initialize Vite React TS + routing + query client
2. FE-002: Firebase auth and protected routes
3. FE-003: Pick submission UI with no-duplicate podium validation
4. FE-004: Leaderboard page with movement indicators
5. FE-005: Admin rules editor (scoring + DNF toggle)
6. FE-006: Admin lock policy editor and manual override
7. BE-001: Firestore schema + indexes + seed scripts
8. BE-002: Cloud Function for pick lock evaluation
9. BE-003: Cloud Function for results ingestion
10. BE-004: Cloud Function for score calculation and leaderboard refresh
11. QA-001: Unit tests for scoring engine
12. QA-002: Integration tests for lock modes and pick immutability

## 8) Initial Command Plan (Phase 0)
Run in `/Users/rayonhunte/GitHub/f1_total`:

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install firebase @tanstack/react-query react-router-dom zod date-fns
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
firebase init
npm run dev
```

## 9) Risk Controls
- Data source API instability: cache last successful result payload and add retry/backoff.
- Scoring rule changes mid-season: version rules and snapshot applied rule-set per race.
- Unauthorized admin changes: enforce custom claims + server-side checks.

## 10) Definition of Done (MVP)
- Users can submit valid picks before lock
- Admin can configure scoring and lock timing
- Optional DNF penalty works as configured
- Leaderboard shows accurate rank movement after scoring runs
- App is deployed on Firebase Hosting with tested security rules
