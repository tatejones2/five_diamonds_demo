import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { SiteLayout } from './components/Layout';
import { Spinner } from './components/ui';
import { Login, RequireAuth, ResetPassword, SignUp, VerifyEmail } from './pages/auth/AuthPages';
import Home from './pages/public/Home';
import { Contact, ContentPage, Facilities, FacilityDetail, Faq, GameDay, NewsList, NewsPost, NotFound, Partners, Staff } from './pages/public/InfoPages';
import { TournamentBrackets, TournamentLayout, TournamentOverview, TournamentSchedule, TournamentScores, TournamentStandings, TournamentTeams, TournamentUpdates } from './pages/public/TournamentPages';
import Tournaments from './pages/public/Tournaments';

// Code-split private areas so public visitors download less on game day.
const Dash = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.DashboardLayout })));
const DashHome = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.DashboardHome })));
const TeamsPage = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.TeamsPage })));
const TeamNew = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.TeamNew })));
const TeamDetail = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.TeamDetail })));
const RosterPage = lazy(() => import('./pages/dashboard/Roster'));
const RegistrationsPage = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.RegistrationsPage })));
const RegistrationDetail = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.RegistrationDetail })));
const NotificationsPage = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.ProfilePage })));
const RegisterForTournament = lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.RegisterForTournament })));

const admin = () => import('./pages/admin/AdminCore');
const AdminLayout = lazy(() => admin().then((m) => ({ default: m.AdminLayout })));
const AdminOverview = lazy(() => admin().then((m) => ({ default: m.AdminOverview })));
const AdminTournamentList = lazy(() => admin().then((m) => ({ default: m.AdminTournamentList })));
const AdminTournamentNew = lazy(() => admin().then((m) => ({ default: m.AdminTournamentNew })));
const AdminTournamentLayout = lazy(() => admin().then((m) => ({ default: m.AdminTournamentLayout })));
const AdminTournamentSetup = lazy(() => admin().then((m) => ({ default: m.AdminTournamentSetup })));
const AdminDivisions = lazy(() => admin().then((m) => ({ default: m.AdminDivisions })));
const AdminRegistrations = lazy(() => import('./pages/admin/AdminRegistrations').then((m) => ({ default: m.AdminRegistrations })));
const ScheduleEditor = lazy(() => import('./pages/admin/ScheduleEditor').then((m) => ({ default: m.ScheduleEditor })));
const ops = () => import('./pages/admin/GameOps');
const GameOps = lazy(() => ops().then((m) => ({ default: m.GameOps })));
const MyGames = lazy(() => ops().then((m) => ({ default: m.MyGames })));
const BracketAdmin = lazy(() => ops().then((m) => ({ default: m.BracketAdmin })));
const NoticesAdmin = lazy(() => ops().then((m) => ({ default: m.NoticesAdmin })));
const org = () => import('./pages/admin/OrgAdmin');
const VenuesAdmin = lazy(() => org().then((m) => ({ default: m.VenuesAdmin })));
const StaffAdmin = lazy(() => org().then((m) => ({ default: m.StaffAdmin })));
const ContentAdmin = lazy(() => org().then((m) => ({ default: m.ContentAdmin })));
const NewsAdmin = lazy(() => org().then((m) => ({ default: m.NewsAdmin })));
const PartnersAdmin = lazy(() => org().then((m) => ({ default: m.PartnersAdmin })));
const FaqAdmin = lazy(() => org().then((m) => ({ default: m.FaqAdmin })));
const InquiriesAdmin = lazy(() => org().then((m) => ({ default: m.InquiriesAdmin })));
const AuditLog = lazy(() => org().then((m) => ({ default: () => <m.AuditLog /> })));
const TournamentAudit = lazy(() => org().then((m) => ({ default: m.TournamentAudit })));
const SimulatedCheckout = lazy(() => import('./pages/dev/SimulatedCheckout'));

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<Spinner />}>{children}</Suspense>;
const authed = (el: ReactNode, staff = false) => (
  <RequireAuth staff={staff}>
    <S>{el}</S>
  </RequireAuth>
);

export const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/tournaments', element: <Tournaments /> },
      { path: '/tournaments/:slug/register', element: authed(<RegisterForTournament />) },
      {
        path: '/tournaments/:slug',
        element: <TournamentLayout />,
        children: [
          { index: true, element: <TournamentOverview /> },
          { path: 'schedule', element: <TournamentSchedule /> },
          { path: 'scores', element: <TournamentScores /> },
          { path: 'brackets', element: <TournamentBrackets /> },
          { path: 'standings', element: <TournamentStandings /> },
          { path: 'teams', element: <TournamentTeams /> },
          { path: 'updates', element: <TournamentUpdates /> },
        ],
      },
      { path: '/game-day', element: <GameDay /> },
      { path: '/facilities', element: <Facilities /> },
      { path: '/facilities/:slug', element: <FacilityDetail /> },
      { path: '/news', element: <NewsList /> },
      { path: '/news/:slug', element: <NewsPost /> },
      { path: '/staff', element: <Staff /> },
      { path: '/partners', element: <Partners /> },
      { path: '/faq', element: <Faq /> },
      { path: '/contact', element: <Contact /> },
      { path: '/about', element: <ContentPage pageKey="about" fallbackTitle="About" /> },
      { path: '/rules', element: <ContentPage pageKey="rules" fallbackTitle="Rules" /> },
      { path: '/get-involved', element: <ContentPage pageKey="get_involved" fallbackTitle="Get Involved" /> },
      { path: '/sponsorship', element: <ContentPage pageKey="sponsorship" fallbackTitle="Sponsorship" /> },
      { path: '/media', element: <ContentPage pageKey="media" fallbackTitle="Photos & Video" /> },
      { path: '/privacy', element: <ContentPage pageKey="privacy" fallbackTitle="Privacy Policy" legal /> },
      { path: '/terms', element: <ContentPage pageKey="terms" fallbackTitle="Terms of Use" legal /> },
      { path: '/accessibility', element: <ContentPage pageKey="accessibility" fallbackTitle="Accessibility" legal /> },

      { path: '/auth/login', element: <Login /> },
      { path: '/auth/sign-up', element: <SignUp /> },
      { path: '/auth/verify-email', element: <VerifyEmail /> },
      { path: '/auth/reset-password', element: <ResetPassword /> },

      {
        path: '/dashboard',
        element: authed(<Dash />),
        children: [
          { index: true, element: <S><DashHome /></S> },
          { path: 'teams', element: <S><TeamsPage /></S> },
          { path: 'teams/new', element: <S><TeamNew /></S> },
          { path: 'teams/:teamId', element: <S><TeamDetail /></S> },
          { path: 'teams/:teamId/roster', element: <S><RosterPage /></S> },
          { path: 'registrations', element: <S><RegistrationsPage /></S> },
          { path: 'registrations/:registrationId', element: <S><RegistrationDetail /></S> },
          { path: 'notifications', element: <S><NotificationsPage /></S> },
          { path: 'profile', element: <S><ProfilePage /></S> },
        ],
      },
      {
        path: '/admin',
        element: authed(<AdminLayout />, true),
        children: [
          { index: true, element: <S><AdminOverview /></S> },
          { path: 'tournaments', element: <S><AdminTournamentList /></S> },
          { path: 'tournaments/new', element: <S><AdminTournamentNew /></S> },
          {
            path: 'tournaments/:id',
            element: <S><AdminTournamentLayout /></S>,
            children: [
              { index: true, element: <S><AdminTournamentSetup /></S> },
              { path: 'divisions', element: <S><AdminDivisions /></S> },
              { path: 'registrations', element: <S><AdminRegistrations /></S> },
              { path: 'schedule', element: <S><ScheduleEditor /></S> },
              { path: 'brackets', element: <S><BracketAdmin /></S> },
              { path: 'updates', element: <S><NoticesAdmin /></S> },
              { path: 'audit', element: <S><TournamentAudit /></S> },
            ],
          },
          { path: 'games/:id', element: <S><GameOps /></S> },
          { path: 'my-games', element: <S><MyGames /></S> },
          { path: 'venues', element: <S><VenuesAdmin /></S> },
          { path: 'staff', element: <S><StaffAdmin /></S> },
          { path: 'content', element: <S><ContentAdmin /></S> },
          { path: 'news', element: <S><NewsAdmin /></S> },
          { path: 'partners', element: <S><PartnersAdmin /></S> },
          { path: 'faqs', element: <S><FaqAdmin /></S> },
          { path: 'inquiries', element: <S><InquiriesAdmin /></S> },
          { path: 'audit-log', element: <S><AuditLog /></S> },
        ],
      },
      ...(import.meta.env.DEV ? [{ path: '/dev/simulated-checkout', element: <S><SimulatedCheckout /></S> }] : []),
      // Legacy URL fallbacks handled client-side; permanent 301s live in the reverse proxy (see CONTENT_INVENTORY.md).
      { path: '/home', element: <Navigate to="/" replace /> },
      { path: '/events', element: <Navigate to="/tournaments" replace /> },
      { path: '/calendar', element: <Navigate to="/tournaments?view=calendar" replace /> },
      { path: '/history', element: <Navigate to="/about" replace /> },
      { path: '/expansion', element: <Navigate to="/get-involved" replace /> },
      { path: '/photos', element: <Navigate to="/media" replace /> },
      { path: '/videos', element: <Navigate to="/media" replace /> },
      { path: '/register', element: <Navigate to="/tournaments" replace /> },
      { path: '/stats', element: <Navigate to="/game-day" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
