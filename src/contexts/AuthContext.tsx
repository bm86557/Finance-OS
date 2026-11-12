import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { toast } from 'sonner';
import { User, Organization, UserRole, OrganizationMember, MemberAccessRole } from '@/services/types';
import { authService, organizationService } from '@/services';
import type { AuthSession } from '@/services';
import type { PortalType } from '@/services/authSessionTypes';
import { logUnexpectedError } from '@/lib/diagnostics';
import { isSupabaseConfigured } from '@/lib/supabaseClient';
import { isHttpBackendConfigured } from '@/lib/apiClient';
import { hydrateDataStoreFromSupabase } from '@/services/dataStore';
import { setupSupabaseRealtimeSync, teardownSupabaseRealtimeSync } from '@/services/realtimeSync';

// Mock-mode-only token storage key. When talking to the real HTTP backend, the session lives in
// an httpOnly cookie the server sets on login — it's never readable from JS, so nothing is
// stored here in that mode (see restoreSession/login/logout below).
const TOKEN_KEY = 'finance_os_token';

interface AuthContextType {
  user: User | null;
  currentOrganization: Organization | null;
  userRole: UserRole | null;
  accessRole: MemberAccessRole | null;
  membership: OrganizationMember | null;
  organizations: Organization[];
  isAuthenticated: boolean;
  isLoading: boolean;
  activePortal: PortalType | null;
  setActivePortal: (portal: PortalType | null) => void;
  /** Optional `orgSlug` matches tenant from URL (e.g. `/login/employee/creative-agency`). 
   *  Optional `portalType` ensures users can only login through their designated portal.
   *  Optional `requiredAccessRole` enforces that user has the selected role within the organization. */
  login: (email: string, password: string, orgSlug?: string, portalType?: PortalType, requiredAccessRole?: MemberAccessRole) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => void;
  acceptInvite: (organizationId?: string, userId?: string) => Promise<{ success: boolean; data?: any; error?: string; message?: string }>;
  declineInvite: (organizationId?: string, userId?: string) => Promise<{ success: boolean; data?: any; error?: string; message?: string }>;
  /** After PATCH organization (e.g. settings save), keep session and org list in sync. */
  applyOrganizationUpdate: (org: Organization) => void;
  refreshUserProfile: (updates: Partial<Pick<User, 'name' | 'email' | 'phone' | 'avatar'>>) => void;
  setSessionTimeoutPreference: (timeout: string, userId?: string) => void;
  hasPermission: (permission: 'read' | 'write' | 'admin') => boolean;
  getRedirectPath: (targetPortal?: PortalType) => string;
}

// Ensure a single Context instance even across alias vs relative imports and Vite HMR
const AUTH_CONTEXT_KEY = Symbol.for('finance_os.auth_context');
export const AuthContext = ((globalThis as any)[AUTH_CONTEXT_KEY] ||
  ((globalThis as any)[AUTH_CONTEXT_KEY] = createContext<AuthContextType | undefined>(undefined))) as React.Context<AuthContextType | undefined>;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [membership, setMembership] = useState<OrganizationMember | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true); // true for session restore check
  const [activePortal, setActivePortal] = useState<PortalType | null>(() => {
    try {
      return (localStorage.getItem('finance_os_portal') as PortalType) || null;
    } catch {
      return null;
    }
  });

  /**
   * Derive a UserRole from an AuthSession.
   * Platform-level users without org memberships get mapped to org-level equivalents.
   */
  const deriveUserRole = (session: AuthSession): UserRole => {
    if (session.membership) {
      return session.membership.role;
    }
    if (session.user.role === 'platform_admin') return 'owner';
    if (session.user.role === 'platform_manager') return 'admin';
    return 'employee';
  };

  /**
   * Load the organizations list for a user.
   * Platform admins/managers see ALL orgs; regular users see only their memberships.
   */
  const loadOrganizations = async (sessionUser: User): Promise<Organization[]> => {
    if (sessionUser.role === 'platform_admin' || sessionUser.role === 'platform_manager') {
      const res = await authService.getUserOrganizations(sessionUser.id);
      return res.success ? res.data : [];
    }
    const res = await authService.getUserOrganizations(sessionUser.id);
    return res.success ? res.data : [];
  };

  /**
   * Apply a full AuthSession to component state.
   */
  const applySession = async (session: AuthSession) => {
    setUser(session.user);
    setCurrentOrganization(session.organization);
    const resolvedRole = deriveUserRole(session);
    setUserRole(resolvedRole);
    setMembership(session.membership ?? null);

    setActivePortal((prev) => {
      if (prev) return prev;
      if (session.membership?.portalType) return session.membership.portalType;
      if (resolvedRole === 'employee' || session.membership?.role === 'employee') return 'employee';
      if ((session.user.role === 'platform_admin' || session.user.role === 'platform_manager') && !session.membership) {
        return 'platform_admin';
      }
      return 'organization_admin';
    });

    const orgs = await loadOrganizations(session.user);
    setOrganizations(orgs);

    if (session.organization?.id) {
      setupSupabaseRealtimeSync(session.organization.id);
    }
  };

  // ── Session restore on mount ───────────────────────────────────
  useEffect(() => {
    const restoreSession = async () => {
      // Real backend (Supabase or the local HTTP API): the session lives server-side (Supabase
      // session / httpOnly cookie), so restore is just "ask the server who I am" — no token to
      // manage client-side at all.
      if (isSupabaseConfigured() || isHttpBackendConfigured()) {
        try {
          const response = await authService.getSession('');
          if (response.success && response.data) {
            await applySession(response.data);
            // Fresh login hydrates dataStore from the Supabase bundle (see `login` below) — a
            // page refresh restores the session the same way but skipped this until now, so every
            // Supabase-backed service (dataStore branch) saw only the unsynced local seed data.
            if (import.meta.env.VITE_USE_SUPABASE_DATA === 'true') {
              if (import.meta.env.VITE_USE_SUPABASE_DATA === 'true') {
        await hydrateDataStoreFromSupabase();
      }
            }
          }
        } catch (e) {
          logUnexpectedError('AuthContext.restoreSession', e);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // Mock mode only: no server to hold a session, so a token is kept in localStorage purely
      // to remember "who was logged in" across a page refresh in the browser-only demo.
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const response = await authService.getSession(token);
        if (response.success && response.data) {
          await applySession(response.data);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      } catch (e) {
        logUnexpectedError('AuthContext.restoreSession', e);
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public API ─────────────────────────────────────────────────

  const login = async (
    email: string,
    password: string,
    orgSlug?: string,
    portalType?: PortalType,
    requiredAccessRole?: MemberAccessRole
  ) => {
    setIsLoading(true);
    if (portalType) {
      setActivePortal(portalType);
      try {
        localStorage.setItem('finance_os_portal', portalType);
      } catch {}
    }
    try {
      const response = await authService.login({ email, password, orgSlug, portalType, requiredAccessRole });
      if (!response.success) {
        throw new Error(response.error || 'Login failed');
      }
      // Mock mode only — real backends never expose the session token to client JS (Supabase
      // manages its own storage; the local API sets an httpOnly cookie the browser can't read).
      if (!isSupabaseConfigured() && !isHttpBackendConfigured()) {
        localStorage.setItem(TOKEN_KEY, response.data.token);
      }
      await applySession(response.data);
      await hydrateDataStoreFromSupabase();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    // Wait for the service call to complete to ensure Supabase session is properly cleared
    await authService.logout();
    localStorage.removeItem(TOKEN_KEY);
    try {
      localStorage.removeItem('finance_os_portal');
    } catch {}
    setActivePortal(null);
    setUser(null);
    setCurrentOrganization(null);
    setUserRole(null);
    setMembership(null);
    setOrganizations([]);
    
    // Small delay to ensure Supabase has fully processed the logout
    await new Promise(resolve => setTimeout(resolve, 100));
    teardownSupabaseRealtimeSync();
  };

  const acceptInvite = async (organizationId?: string, userId?: string) => {
    const oId = organizationId || membership?.organizationId || currentOrganization?.id;
    const uId = userId || user?.id;
    if (!oId || !uId) return { success: false, error: 'Missing organization or user' };
    try {
      const res = await authService.acceptInvite(oId, uId);
      if (res.success) {
        if (membership) setMembership({ ...membership, status: 'active' });
      }
      return res;
    } catch (err: any) {
      console.error('acceptInvite failed', err);
      return { success: false, error: err?.message || 'Failed to accept invitation' };
    }
  };

  const declineInvite = async (organizationId?: string, userId?: string) => {
    const oId = organizationId || membership?.organizationId || currentOrganization?.id;
    const uId = userId || user?.id;
    if (!oId || !uId) return { success: false, error: 'Missing organization or user' };
    try {
      const res = await authService.declineInvite(oId, uId);
      await logout();
      return res;
    } catch (err: any) {
      console.error('declineInvite failed', err);
      await logout();
      return { success: false, error: err?.message || 'Failed to decline invitation' };
    }
  };


  const switchOrganization = (organizationId: string) => {
    const org = organizations.find((o) => o.id === organizationId);
    if (org && user) {
      setCurrentOrganization(org);
      setupSupabaseRealtimeSync(org.id);
      // Async role lookup — org switches instantly, role resolves ~50ms later
      authService.getUserRole(user.id, organizationId).then((response) => {
        if (response.success && response.data) {
          setUserRole(response.data.role);
        } else {
          setUserRole('employee');
        }
      });
    }
  };

  const applyOrganizationUpdate = useCallback((org: Organization) => {
    setCurrentOrganization(org);
    setOrganizations((prev) => {
      const i = prev.findIndex((o) => o.id === org.id);
      if (i === -1) return [...prev, org];
      const next = [...prev];
      next[i] = org;
      return next;
    });
  }, []);

  const hasPermission = (permission: 'read' | 'write' | 'admin'): boolean => {
    return authService.hasPermission(userRole, permission);
  };

  const accessRole: MemberAccessRole | null =
    membership?.accessRole ??
    (userRole === 'owner' || userRole === 'admin'
      ? 'org_admin'
      : userRole === 'employee'
        ? 'team_member'
        : null);

  const getRedirectPath = (targetPortal?: PortalType): string => {
    if (!user) return '/';

    const portal = targetPortal || activePortal;

    // 1. Organization admin portal priority (includes admins & employees accessing org dashboard)
    if (portal === 'organization_admin') {
      return '/dashboard';
    }

    // 2. Employee portal priority: If user specifically logged into employee portal
    if (
      portal === 'employee' ||
      userRole === 'employee' ||
      membership?.portalType === 'employee' ||
      membership?.role === 'employee'
    ) {
      return '/employee';
    }

    // 3. Platform admin & Bing AI portal priority
    if (
      (portal === 'platform_admin' || portal === 'ai_assistant') &&
      (user.role === 'platform_admin' || user.role === 'platform_manager')
    ) {
      if (portal === 'ai_assistant') {
        return '/ai-portal';
      }
      return '/platform';
    }

    // 4. Platform admin portal priority
    if (portal === 'platform_admin' && (user.role === 'platform_admin' || user.role === 'platform_manager')) {
      return '/platform';
    }

    // 5. Platform role fallback: users without organization membership go to /platform
    if ((user.role === 'platform_admin' || user.role === 'platform_manager') && !membership) {
      return '/platform';
    }

    // 6. Default platform role fallback
    if (user.role === 'platform_admin' || user.role === 'platform_manager') {
      return '/platform';
    }

    return '/dashboard';
  };

  const refreshUserProfile = useCallback(
    (updates: Partial<Pick<User, 'name' | 'email' | 'phone' | 'avatar'>>) => {
      setUser((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.email !== undefined ? { email: updates.email } : {}),
          ...(updates.phone !== undefined ? { phone: updates.phone } : {}),
          ...(updates.avatar !== undefined ? { avatar: updates.avatar } : {}),
        };
      });
    },
    [],
  );

  const parseTimeoutLabelToMs = (timeoutLabel: string): number => {
    if (timeoutLabel === '15 minutes') return 15 * 60 * 1000;
    if (timeoutLabel === '1 hour') return 60 * 60 * 1000;
    if (timeoutLabel === '4 hours') return 4 * 60 * 60 * 1000;
    if (timeoutLabel === '8 hours') return 8 * 60 * 60 * 1000;
    return 30 * 60 * 1000;
  };

  const getScopedTimeoutKey = (userId: string) => `finance_os_employee_session_timeout_${userId}`;

  // Session timeout state strictly scoped to the active employee in the employee portal (0 = disabled)
  const [sessionTimeoutMs, setSessionTimeoutMs] = useState<number>(0);

  // Sync / update session timeout preference strictly for a given employee
  const setSessionTimeoutPreference = useCallback((timeoutLabel: string, targetUserId?: string) => {
    const uid = targetUserId || user?.id;
    if (uid) {
      try {
        localStorage.setItem(getScopedTimeoutKey(uid), timeoutLabel);
        // Clean up legacy un-scoped key so it doesn't leak to other accounts
        localStorage.removeItem('finance_os_employee_session_timeout');
      } catch {
        /* ignore */
      }
    }

    // STRICT ISOLATION: Inactivity timeout only runs for this specific employee in the employee portal.
    // Platform Admins, Org Admins, and other portals must NEVER be affected by an employee's setting.
    const isEmployeePortal = activePortal === 'employee' || (typeof window !== 'undefined' && window.location.pathname.startsWith('/employee'));
    const isEmployeeRole = userRole === 'employee' || membership?.role === 'employee' || activePortal === 'employee';

    if (isEmployeePortal && isEmployeeRole) {
      setSessionTimeoutMs(parseTimeoutLabelToMs(timeoutLabel));
    } else {
      setSessionTimeoutMs(0);
    }
  }, [user?.id, activePortal, userRole, membership?.role]);

  // Recalculate and enforce employee session timeout when user, portal, or route changes
  useEffect(() => {
    if (!user) {
      setSessionTimeoutMs(0);
      return;
    }

    const checkAndApplyTimeout = () => {
      const isEmployeePortal = activePortal === 'employee' || (typeof window !== 'undefined' && window.location.pathname.startsWith('/employee'));
      const isEmployeeRole = userRole === 'employee' || membership?.role === 'employee' || activePortal === 'employee';

      // STRICT ISOLATION: Inactivity timeout only runs for this specific employee in the employee portal.
      // Platform Admins, Org Admins, and other portals must NEVER be affected by this employee's setting.
      if (!isEmployeePortal || !isEmployeeRole) {
        setSessionTimeoutMs(0);
        return;
      }

      // Resolve this specific employee's saved timeout
      let savedTimeout: string | null = null;
      try {
        savedTimeout = localStorage.getItem(getScopedTimeoutKey(user.id));
      } catch {
        /* ignore */
      }

      // Check user / membership employee_settings if available
      const settingsFromUser = (user as any).employee_settings?.security?.sessionTimeout ||
                               (membership as any)?.employee_settings?.security?.sessionTimeout;
      const finalTimeout = settingsFromUser || savedTimeout || '30 minutes';

      setSessionTimeoutMs(parseTimeoutLabelToMs(finalTimeout));
    };

    checkAndApplyTimeout();

    // Listen for client-side navigation / URL changes between portals
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', checkAndApplyTimeout);
      return () => {
        window.removeEventListener('popstate', checkAndApplyTimeout);
      };
    }
  }, [user, activePortal, userRole, membership]);

  useEffect(() => {
    // Only arm timer if user exists, sessionTimeoutMs > 0, and user is actively in employee portal
    const isEmployeePortal = activePortal === 'employee' || (typeof window !== 'undefined' && window.location.pathname.startsWith('/employee'));
    if (!user || !sessionTimeoutMs || !isEmployeePortal) return;

    let timerId: ReturnType<typeof setTimeout> | null = null;

    const resetTimer = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        // Double-check still in employee portal before expiring
        const stillInEmployeePortal = typeof window !== 'undefined' && window.location.pathname.startsWith('/employee');
        if (stillInEmployeePortal) {
          toast.error('Session expired due to inactivity. Please log in again.');
          logout();
        }
      }, sessionTimeoutMs);
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timerId) clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [user, sessionTimeoutMs, activePortal, logout]);

  const value: AuthContextType = {
    user,
    currentOrganization,
    userRole,
    accessRole,
    membership,
    organizations,
    isAuthenticated: !!user,
    isLoading,
    activePortal,
    setActivePortal,
    login,
    logout,
    acceptInvite,
    declineInvite,
    switchOrganization,
    applyOrganizationUpdate,
    refreshUserProfile,
    setSessionTimeoutPreference,
    hasPermission,
    getRedirectPath,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};