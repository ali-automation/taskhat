import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import Spinner from '@atlaskit/spinner'
import { useAuth } from './auth/AuthContext'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import ForYouPage from './pages/ForYouPage'
import YourWorkPage from './pages/YourWorkPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectIssuesPage from './pages/ProjectIssuesPage'
import BoardPage from './pages/BoardPage'
import TimelinePage from './pages/TimelinePage'
import ReportsPage from './pages/ReportsPage'
import BoardSettingsPage from './pages/BoardSettingsPage'
import ReleasesPage from './pages/ReleasesPage'
import BacklogPage from './pages/BacklogPage'
import IssuePage from './pages/IssuePage'
import SearchPage from './pages/SearchPage'
import DashboardsPage from './pages/DashboardsPage'
import WikiHomePage, { WikiLabelPage, WikiSpaceRedirect } from './pages/WikiHomePage'
import WikiPageView from './pages/WikiPageView'
import WikiEditorPage from './pages/WikiEditorPage'
import WikiSpaceSettings from './pages/WikiSpaceSettings'
import WikiBlogPage from './pages/WikiBlogPage'
import WikiCalendarPage from './pages/WikiCalendarPage'
import WikiForYouPage from './pages/WikiForYouPage'
import WikiHistoryPage from './pages/WikiHistoryPage'
import DashboardPage from './pages/DashboardPage'
import SummaryPage from './pages/SummaryPage'
import WorkflowEditorPage from './pages/WorkflowEditorPage'
import ImportPage from './pages/ImportPage'
import AccountPage from './pages/AccountPage'
import PeoplePage from './pages/PeoplePage'
import AdminPage from './pages/AdminPage'
import InvitePage from './pages/InvitePage'
import SpaceSettingsPage from './pages/SpaceSettingsPage'
import ApiTokensPage from './pages/ApiTokensPage'
import { FlowEditorPage } from './pages/AutomationAdmin'
import GeneralSettingsPage from './pages/GeneralSettingsPage'
import NotificationSettingsPage from './pages/NotificationSettingsPage'
import { useAccount } from './api/hooks'

function FullPageSpinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size="large" label="Loading TaskHat" />
    </div>
  )
}

// Honors the "default landing page" personal preference (Stage 10).
function Landing() {
  const { data: profile } = useAccount()
  if (profile?.landingPage === 'projects') return <Navigate to="/projects" replace />
  if (profile?.landingPage === 'issues') return <Navigate to="/issues" replace />
  return <ForYouPage />
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/settings/general" element={<GeneralSettingsPage />} />
                <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
                <Route path="/settings/api-tokens" element={<ApiTokensPage />} />
                <Route path="/issues" element={<SearchPage />} />
                <Route path="/dashboards" element={<DashboardsPage />} />
                <Route path="/yourwork" element={<YourWorkPage />} />
                <Route path="/wiki" element={<WikiForYouPage />} />
                <Route path="/wiki/directory" element={<WikiHomePage />} />
                <Route path="/wiki/spaces/:key" element={<WikiSpaceRedirect />} />
                <Route path="/wiki/spaces/:key/new" element={<WikiEditorPage />} />
                <Route path="/wiki/spaces/:key/settings" element={<WikiSpaceSettings />} />
                <Route path="/wiki/spaces/:key/settings/:section" element={<WikiSpaceSettings />} />
                <Route path="/wiki/spaces/:key/blog" element={<WikiBlogPage />} />
                <Route path="/wiki/spaces/:key/calendar" element={<WikiCalendarPage />} />
                <Route path="/wiki/spaces/:key/labels/:label" element={<WikiLabelPage />} />
                <Route path="/wiki/spaces/:key/pages/:pageId" element={<WikiPageView />} />
                <Route path="/wiki/spaces/:key/pages/:pageId/edit" element={<WikiEditorPage />} />
                <Route path="/wiki/spaces/:key/pages/:pageId/history" element={<WikiHistoryPage />} />
                <Route path="/wiki/spaces/:key/pages/:pageId/history/:n" element={<WikiHistoryPage />} />
                <Route path="/dashboards/:id" element={<DashboardPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/users" element={<AdminPage />} />
                <Route path="/admin/spaces" element={<AdminPage />} />
                <Route path="/admin/spaces/:section" element={<AdminPage />} />
                <Route path="/admin/system/:section" element={<AdminPage />} />
                <Route path="/admin/work-items/:section" element={<AdminPage />} />
                <Route path="/admin/workflows/:id/edit" element={<WorkflowEditorPage />} />
                <Route path="/admin/work-items/permissions/:id" element={<AdminPage />} />
                <Route path="/admin/integrations/:section" element={<AdminPage />} />
                <Route path="/admin/automation" element={<AdminPage />} />
                <Route path="/admin/automation/:id" element={<AdminPage />} />
                <Route path="/people/:id" element={<PeoplePage />} />
                <Route path="/projects/:key" element={<BoardPage />} />
                <Route path="/projects/:key/board" element={<BoardPage />} />
                <Route path="/projects/:key/backlog" element={<BacklogPage />} />
                <Route path="/projects/:key/backlog/:boardId" element={<BacklogPage />} />
                <Route path="/projects/:key/timeline" element={<TimelinePage />} />
                <Route path="/projects/:key/board/:boardId" element={<BoardPage />} />
                <Route path="/boards/:id/settings" element={<BoardSettingsPage />} />
                <Route path="/boards/:id/settings/:section" element={<BoardSettingsPage />} />
                <Route path="/projects/:key/reports" element={<ReportsPage />} />
                <Route path="/projects/:key/reports/:report" element={<ReportsPage />} />
                <Route path="/projects/:key/releases" element={<ReleasesPage />} />
                <Route path="/projects/:key/releases/:versionId" element={<ReleasesPage />} />
                <Route path="/projects/:key/summary" element={<SummaryPage />} />
                <Route path="/projects/:key/issues" element={<ProjectIssuesPage />} />
                <Route path="/projects/:key/workflow" element={<WorkflowEditorPage />} />
                <Route path="/projects/:key/settings" element={<SpaceSettingsPage />} />
                <Route path="/projects/:key/settings/:section" element={<SpaceSettingsPage />} />
                <Route path="/projects/:key/settings/automation/:flowId" element={<FlowEditorPage />} />
                <Route path="/browse/:issueKey" element={<IssuePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
