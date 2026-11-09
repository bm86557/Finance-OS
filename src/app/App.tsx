import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import React, { Suspense, Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useAuth, AuthProvider } from '@/contexts/AuthContext';
import { logErrorBoundary, logSilentUiFailure } from '../lib/diagnostics';
import { ThemeProvider } from '../contexts/ThemeContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { LandingPage } from './components/LandingPage';
import { AdminLoginPage } from './components/AdminLoginPage';
import { PlatformLoginPage } from './components/PlatformLoginPage';
import { EmployeeLoginPage } from './components/EmployeeLoginPage';
import { BingLoginPage } from './components/BingLoginPage';
import { LoginPage } from './components/LoginPage';
import { AdminSignupPage } from './components/AdminSignupPage';
import { PlatformSignupPage } from './components/PlatformSignupPage';
import { BingSignupPage } from './components/BingSignupPage';
import { AcceptInvitePage } from './components/AcceptInvitePage';
import { AcceptOrgInvitePage } from './components/AcceptOrgInvitePage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { AuthErrorHandler } from './components/AuthErrorHandler';

// Lazy load heavy workspace components
const PlatformDashboard = React.lazy(() =>
  import('./components/platform/PlatformDashboard').then(m => ({ default: m.PlatformDashboard }))
);
const OrganizationDashboard = React.lazy(() =>
  import('./components/OrganizationDashboardModern').then(m => ({ default: m.OrganizationDashboard }))
);
const OrganizationWorkspace = React.lazy(() =>
  import('./components/organization/OrganizationWorkspace').then(m => ({ default: m.OrganizationWorkspace }))
);
const EmployeeWorkspace = React.lazy(() =>
  import('./components/employee/EmployeeWorkspace').then(m => ({ default: m.EmployeeWorkspace }))
);
const ProfitIntelligence = React.lazy(() =>
  import('./components/ProfitIntelligence').then(m => ({ default: m.ProfitIntelligence }))
);
const FinancialReports = React.lazy(() =>
  import('./components/FinancialReports').then(m => ({ default: m.FinancialReports }))
);
const AIClassificationEngine = React.lazy(() =>
  import('./components/AIClassificationEngine').then(m => ({ default: m.AIClassificationEngine }))
);

// Lazy load overlay components
const MagneticCursor = React.lazy(() =>
  import('./components/ui/MagneticCursor').then(m => ({ default: m.MagneticCursor }))
);
const OnboardingWizard = React.lazy(() =>
  import('./components/onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard }))
);
const CommandPalette = React.lazy(() =>
  import('./components/command-palette/CommandPalette').then(m => ({ default: m.CommandPalette }))
);
const KeyboardShortcuts = React.lazy(() =>
  import('./components/keyboard-shortcuts/KeyboardShortcuts').then(m => ({ default: m.KeyboardShortcuts }))
);
const AIAssistantChat = React.lazy(() =>
  import('./components/ai-assistant/AIAssistantChat').then(m => ({ default: m.AIAssistantChat }))
);

// Error Boundary
class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logErrorBoundary('AppRoutes', error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-8">
          <div className="max-w-lg w-full bg-slate-800 rounded-xl p-6 border border-red-500/30">
            <h2 className="text-red-400 text-xl mb-2">Something went wrong</h2>
            <p className="text-slate-300 text-sm mb-4">{this.state.error?.message}</p>
            <pre className="text-xs text-slate-400 bg-slate-900 p-3 rounded overflow-auto max-h-48">
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Silent error boundary for non-critical UI (overlays, cursors, etc.)
class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logSilentUiFailure('overlay', error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// Loading Screen
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-white">Loading...</div>
      </div>
    </div>
  );
}

// Protected Route
function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, userRole, isLoading, getRedirectPath } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && userRole && !allowedRoles.includes(userRole)) {
    return <Navigate to={getRedirectPath()} replace />;
  }

  return <>{children}</>;
}

// Platform-only route
function PlatformRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, getRedirectPath } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'platform_admin' && user.role !== 'platform_manager') {
    return <Navigate to={getRedirectPath()} replace />;
  }
  return <>{children}</>;
}

// Employee-only route
function EmployeeRoute({ children }: { children: React.ReactNode }) {
  const { user, userRole, isLoading, getRedirectPath } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  // Allow employees + platform admins/managers
  if (userRole !== 'employee' && user.role !== 'platform_admin' && user.role !== 'platform_manager') {
    return <Navigate to={getRedirectPath()} replace />;
  }
  return <>{children}</>;
}

// Smart redirect after login
function SmartRedirect() {
  const { user, isLoading, getRedirectPath } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  return <Navigate to={getRedirectPath()} replace />;
}

// App Routes Component
function AppRoutes() {
  const { user, login } = useAuth();
  const location = useLocation();

  // Handle Supabase auth errors from URL hash
  useEffect(() => {
    const handleAuthError = () => {
      const hash = window.location.hash;
      if (hash.includes('error=access_denied') || hash.includes('error_code=otp_expired')) {
        // Clear the error from URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Show user-friendly message
        console.warn('Email verification failed or expired. You can sign up again or try logging in.');
      }
    };

    handleAuthError();
  }, [location]);

  return (
    <Routes>
      {/* Auth Error Handler */}
      <Route path="*" element={<AuthErrorHandler />} />
      
      {/* Landing Page - Entry Point */}
      <Route path="/" element={!user ? <LandingPage /> : <SmartRedirect />} />
      
      {/* Login & Setup Routes */}
      {/* Public signup removed — employee access is invite-only.
          /signup now redirects to the portal chooser instead of creating an open account. */}
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      <Route path="/signup/admin" element={!user ? <AdminSignupPage onLogin={login} /> : <Navigate to="/dashboard" replace />} />
      <Route path="/signup/platform" element={!user ? <PlatformSignupPage onLogin={login} /> : <Navigate to="/platform" replace />} />
      <Route path="/signup/employee" element={<Navigate to="/login/employee?notice=invite_only" replace />} />
      <Route path="/signup/employee/:orgSlug" element={<Navigate to="/login/employee?notice=invite_only" replace />} />
      <Route path="/signup/bing" element={!user ? <BingSignupPage onLogin={login} /> : <SmartRedirect />} />
      
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/accept-org-invite/:token" element={<AcceptOrgInvitePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      
      <Route path="/login/admin" element={!user ? <AdminLoginPage onLogin={login} /> : <Navigate to="/dashboard" replace />} />
      <Route path="/login/platform" element={!user ? <PlatformLoginPage onLogin={login} /> : <Navigate to="/platform" replace />} />
      <Route path="/login/employee/:orgSlug" element={!user ? <EmployeeLoginPage onLogin={login} /> : <Navigate to="/employee" replace />} />
      <Route path="/login/employee" element={!user ? <EmployeeLoginPage onLogin={login} /> : <Navigate to="/employee" replace />} />
      <Route path="/login/bing" element={!user ? <BingLoginPage onLogin={login} /> : <SmartRedirect />} />
      <Route path="/login" element={!user ? <LoginPage onLogin={login} /> : <SmartRedirect />} />
      
      {/* ============================== */}
      {/* ORGANIZATION ADMIN ROUTES      */}
      {/* ============================== */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedRoles={['owner', 'admin', 'viewer', 'employee']}>
            <OrganizationWorkspace />
          </ProtectedRoute>
        }
      />

      <Route
        path="/organization"
        element={
          <ProtectedRoute allowedRoles={['owner', 'admin', 'viewer', 'employee']}>
            <OrganizationDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/organization/workspace"
        element={
          <ProtectedRoute allowedRoles={['owner', 'admin', 'viewer', 'employee']}>
            <OrganizationWorkspace />
          </ProtectedRoute>
        }
      />

      <Route
        path="/profit-intelligence"
        element={
          <ProtectedRoute allowedRoles={['owner', 'admin', 'viewer', 'employee']}>
            <ProfitIntelligence />
          </ProtectedRoute>
        }
      />

      <Route
        path="/financial-reports"
        element={
          <ProtectedRoute allowedRoles={['owner', 'admin', 'viewer', 'employee']}>
            <FinancialReports />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ai-classification"
        element={
          <ProtectedRoute allowedRoles={['owner', 'admin', 'viewer', 'employee']}>
            <AIClassificationEngine />
          </ProtectedRoute>
        }
      />

      {/* ============================== */}
      {/* PLATFORM ADMIN ROUTES          */}
      {/* ============================== */}
      <Route
        path="/platform"
        element={
          <PlatformRoute>
            <PlatformDashboard />
          </PlatformRoute>
        }
      />

      {/* ============================== */}
      {/* EMPLOYEE ROUTES                */}
      {/* ============================== */}
      <Route
        path="/employee"
        element={
          <EmployeeRoute>
            <EmployeeWorkspace />
          </EmployeeRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Main App Component
export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <ThemeProvider>
            <NotificationProvider>
              <OnboardingProvider>
                <Suspense fallback={<LoadingScreen />}>
                  <SilentErrorBoundary>
                    <MagneticCursor />
                  </SilentErrorBoundary>
                  <SilentErrorBoundary>
                    <OnboardingWizard />
                  </SilentErrorBoundary>
                  <SilentErrorBoundary>
                    <CommandPalette />
                  </SilentErrorBoundary>
                  <SilentErrorBoundary>
                    <KeyboardShortcuts />
                  </SilentErrorBoundary>
                  <SilentErrorBoundary>
                    <AIAssistantChat />
                  </SilentErrorBoundary>
                  <ErrorBoundary>
                    <AppRoutes />
                  </ErrorBoundary>
                </Suspense>
              </OnboardingProvider>
            </NotificationProvider>
          </ThemeProvider>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}