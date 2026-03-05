# F1 Fantasy App

Vite + React + TypeScript app with Firebase Auth/Firestore/Functions/Hosting.

## Setup

```bash
npm install
npm --prefix functions install
cp .env.example .env
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run functions:build
```

## Routes

- `/login`: Google sign-in
- `/groups`: create group, request to join by invite code, switch active group
- `/`: dashboard (requires auth + approved group membership)
- `/picks`: group-scoped picks
- `/leaderboard`: group-scoped leaderboard
- `/admin`: group admin/owner tools (invite link, approve requests, promote admins)

## Group Access Model

- Group creator becomes `owner` automatically.
- Join requests are created as `pending` and require approval by `owner` or `admin`.
- Only approved (`active`) members can access picks/leaderboard for a group.
- Group owner can promote or demote members to/from group admin.

## Multi-group Storage

- Groups: `groups/{groupId}`
- Memberships: `groups/{groupId}/members/{uid}`
- Active group pointer: `users/{uid}.activeGroupId`
- Picks: `picks/{seasonId}_{raceId}_{groupId}_{uid}`
- Scores: `scores/{seasonId}_{groupId}_{uid}`
- Leaderboards: `leaderboards/{seasonId}_{groupId}`

## Deploy

```bash
firebase deploy --only functions,firestore:rules,hosting
```

## GitHub Actions Deploy

This repo includes `.github/workflows/deploy-main.yml` to auto-deploy on pushes to `main`.

Required repository secret:

- `FIREBASE_SERVICE_ACCOUNT_F1TOTAL_C37F3`: JSON key for a service account that can deploy Firebase Hosting, Functions, and Firestore rules for project `f1total-c37f3`.

Required repository variables:

- `FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

## License

This project is licensed under Apache-2.0. See [LICENSE](./LICENSE).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution flow and ownership/attribution terms.

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability reporting and secret-handling policy.
