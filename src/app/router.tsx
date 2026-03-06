import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'
import { RequireAuth } from '../components/RequireAuth'
import { RequireGroup } from '../components/RequireGroup'
import { RequireGroupAdmin } from '../components/RequireGroupAdmin'
import { AdminPage } from '../pages/AdminPage'
import { DashboardPage } from '../pages/DashboardPage'
import { GroupsPage } from '../pages/GroupsPage'
import { HowToUsePage } from '../pages/HowToUsePage'
import { LandingPage } from '../pages/LandingPage'
import { LeaderboardPage } from '../pages/LeaderboardPage'
import { LoginPage } from '../pages/LoginPage'
import { PicksPage } from '../pages/PicksPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/groups',
    element: (
      <RequireAuth>
        <GroupsPage />
      </RequireAuth>
    ),
  },
  {
    path: '/how-to-use',
    element: <HowToUsePage />,
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <RequireGroup>
          <AppLayout />
        </RequireGroup>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'picks', element: <PicksPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
      {
        path: 'admin',
        element: (
          <RequireGroupAdmin>
            <AdminPage />
          </RequireGroupAdmin>
        ),
      },
    ],
  },
])
