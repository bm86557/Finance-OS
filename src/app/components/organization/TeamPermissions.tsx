import * as React from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle,
  Crown,
  Database,
  DollarSign,
  Edit,
  Eye,
  FileText,
  Filter,
  GitBranch,
  Lock,
  Mail,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  Unlock,
  UserCheck,
  Clock,
  Users,
  XCircle,
  RotateCcw,
  Check,
  Brain,
  Megaphone,
  Pin,
  PinOff,
  Tag,
  Calendar,
} from 'lucide-react';
import { AXIOM } from '../../../styles/axiom-tokens';
// Wired to organizationService for member management
import { organizationService, type AgencyTeam } from '@/services/organizationService';
import { authService } from '@/services/authService';
import { dataStore } from '@/services/dataStore';
import { departmentService } from '@/services/departmentService';
import { projectService } from '@/services/projectService';
import { employeeService } from '@/services/employeeService';
import { useService, useServiceArray, useMutation } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';

import { formatDate } from '@/lib/formatters';
import type { OrganizationMember, User, UserRole, Project, CompanyAnnouncement } from '@/services/types';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import { isPermissionAllowedByPlanFeatures, getRequiredPlanFeatureForPermission } from '@/config/planFeatures';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Loader2 } from 'lucide-react';

type TeamView = 'members' | 'teams' | 'announcements' | 'roles' | 'activity' | 'invitations';
type MemberRole = 'org_admin' | 'team_member' | 'accountant' | 'viewer';
type MemberStatus = 'active' | 'inactive' | 'pending';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  customRole?: string;
  department?: string;
  status: MemberStatus;
  permissions: string[];
  organizationId?: string;
  lastActive?: string;
  joinedDate?: string;
  avatar?: string;
  /** Source org role from `organizationService` — used when saving role changes. */
  orgRole: UserRole;
  fixedSalary?: number;
  assignedProjects?: string[];
}

interface Permission {
  id: string;
  name: string;
  description: string;
  icon: any;
  category: 'financial' | 'team' | 'settings' | 'data';
}

const allPermissions: Permission[] = [
  { id: 'view_dashboard', name: 'View Dashboard', description: 'Access organization dashboard', icon: BarChart3, category: 'financial' },
  { id: 'view_reports', name: 'View Reports', description: 'Access financial reports', icon: FileText, category: 'financial' },
  { id: 'add_transaction', name: 'Add Transactions', description: 'Create new transactions', icon: Plus, category: 'financial' },
  { id: 'edit_transaction', name: 'Edit Transactions', description: 'Modify existing transactions', icon: Edit, category: 'financial' },
  { id: 'delete_transaction', name: 'Delete Transactions', description: 'Remove transactions', icon: Trash2, category: 'financial' },
  { id: 'categorize', name: 'Categorize', description: 'Assign categories to transactions', icon: GitBranch, category: 'financial' },
  { id: 'manage_accounts', name: 'Manage Accounts', description: 'Add/edit bank accounts and wallets', icon: DollarSign, category: 'financial' },
  { id: 'export_data', name: 'Export Data', description: 'Export financial data and reports', icon: Database, category: 'data' },
  { id: 'import_statements', name: 'Import Statements', description: 'Upload bank statements', icon: FileText, category: 'data' },
  { id: 'ai_assistant', name: 'AI Assistant', description: 'Access AI financial assistant and insights', icon: Brain, category: 'data' },
  { id: 'manage_team', name: 'Manage Team', description: 'Invite and manage team members', icon: Users, category: 'team' },
  { id: 'manage_permissions', name: 'Manage Permissions', description: 'Assign roles and permissions', icon: Shield, category: 'team' },
  { id: 'organization_settings', name: 'Organization Settings', description: 'Modify organization settings', icon: Settings, category: 'settings' },
];

const DEFAULT_ROLE_DEFINITIONS = [
  {
    id: 'org_admin' as MemberRole,
    name: 'Organization Admin',
    description: 'Full access to all features and settings',
    color: 'purple',
    permissions: ['all'],
  },
  {
    id: 'accountant' as MemberRole,
    name: 'Accountant',
    description: 'Full financial access, limited team management',
    color: 'cyan',
    permissions: ['view_dashboard', 'view_reports', 'add_transaction', 'edit_transaction', 'categorize', 'export_data', 'manage_accounts', 'import_statements', 'ai_assistant'],
  },
  {
    id: 'team_member' as MemberRole,
    name: 'Team Member',
    description: 'Add transactions and view reports',
    color: 'blue',
    permissions: ['view_dashboard', 'add_transaction', 'view_reports'],
  },
  {
    id: 'viewer' as MemberRole,
    name: 'Viewer',
    description: 'View-only access to reports and dashboard',
    color: 'green',
    permissions: ['view_dashboard', 'view_reports'],
  },
];

/** Editable roles only — matches `UserRole` round-trip via `memberRoleToUserRole`. */
const MEMBER_ROLE_SELECT: { value: MemberRole; label: string }[] = [
  { value: 'accountant', label: 'Accountant' },
  { value: 'team_member', label: 'Team member' },
  { value: 'viewer', label: 'Viewer' },
];

// Activity log will be fetched from backend when implemented
const activityLog: Array<{
  id: string;
  user: string;
  action: string;
  details: string;
  timestamp: string;
  type: string;
}> = [];

function mapOrgRoleToMemberRole(role: UserRole, accessRole?: string, customRole?: string): MemberRole {
  if (accessRole === 'org_admin' || accessRole === 'accountant' || accessRole === 'team_member' || accessRole === 'viewer') {
    return accessRole as MemberRole;
  }
  const cr = (customRole || '').toLowerCase();
  if (cr.includes('accountant') || cr.includes('finance') || cr.includes('cfo')) {
    return 'accountant';
  }
  if (cr.includes('viewer') || cr.includes('auditor') || cr.includes('analyst')) {
    return 'viewer';
  }
  switch (role as string) {
    case 'owner':
    case 'admin':
      return 'org_admin';
    case 'viewer':
      return 'viewer';
    case 'employee':
    default:
      return 'team_member';
  }
}

function permissionsForDisplayRole(role: MemberRole): string[] {
  if (role === 'org_admin') return ['all'];
  if (role === 'accountant') return ['view_dashboard', 'view_reports', 'add_transaction', 'edit_transaction', 'categorize', 'export_data', 'manage_accounts', 'import_statements', 'ai_assistant'];
  if (role === 'team_member') return ['view_dashboard', 'add_transaction', 'view_reports'];
  return ['view_dashboard', 'view_reports'];
}

function mapOrgMemberRowToTeamMember(
  row: OrganizationMember & { user?: User | null; customRole?: string; accessRole?: string },
): TeamMember | null {
  const u = row.user || dataStore.users.find(usr => usr.id === row.userId);
  const displayRole = mapOrgRoleToMemberRole(row.role, row.accessRole, row.customRole);
  return {
    id: u?.id || row.userId,
    name: u?.name || u?.email?.split('@')[0] || 'Invited Member',
    email: u?.email || '',
    role: displayRole,
    customRole: row.customRole,
    department: row.department,
    status: (row.status as MemberStatus) || 'pending',
    permissions: permissionsForDisplayRole(displayRole),
    organizationId: row.organizationId,
    joinedDate: row.joinedAt,
    avatar: u?.avatar,
    orgRole: row.role,
    fixedSalary: row.fixedSalary ?? (row as any).salary,
    assignedProjects: row.assignedProjects ?? (row as any).assignedProjectIds ?? [],
  };
}

/** Maps UI role to persisted `UserRole`, ensuring employees stay 'employee' and admins stay 'admin' / 'owner'. */
function memberRoleToUserRole(memberRole: MemberRole, previousOrgRole: UserRole): UserRole {
  if (memberRole === 'org_admin') {
    return previousOrgRole === 'owner' ? 'owner' : 'admin';
  }
  return 'employee';
}

export const ROLE_SUGGESTIONS = [
  'Team Member',
  'Senior Developer',
  'Frontend Engineer',
  'Backend Engineer',
  'Full Stack Developer',
  'UI/UX Designer',
  'Product Designer',
  'Accountant',
  'Financial Analyst',
  'Finance Manager',
  'Operations Lead',
  'Marketing Specialist',
  'Project Manager',
  'Organization Admin',
  'Viewer',
];

export const DEPT_SUGGESTIONS = [
  'Development',
  'Design',
  'Marketing',
  'Finance',
  'Operations',
  'Management',
  'Sales',
  'Human Resources',
  'Customer Support',
  'Product',
  'Legal & Compliance',
  'Security',
];

export function TeamPermissions() {
  const { user, currentOrganization, switchOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';
  /** The Supabase auth user id of the currently-logged-in user. */
  const currentUserId = user?.id;
  const goToOrgView = useOrgWorkspaceNav();
  const { currentPlan, allowedFeatures } = usePlanEntitlements();
  const maxSeatsAllowed = currentPlan?.limits?.users ?? 5;

  const {
    data: orgMemberRows,
    loading: membersLoading,
    error: membersError,
    refetch: refetchMembers,
  } = useServiceArray(
    () => (orgId ? organizationService.getMembers(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId],
    ['organizationMembers'],
  );

  const roleMutation = useMutation(
    (input: { userId: string; newRole: UserRole | string }) =>
      organizationService.updateMemberRole(orgId, input.userId, input.newRole),
  );

  const updateDeptMutation = useMutation(
    (input: { userId: string; department: string }) =>
      organizationService.updateMemberDepartment(orgId, input.userId, input.department),
  );

  const updateSalaryMutation = useMutation(
    (input: { userId: string; fixedSalary: number }) =>
      organizationService.updateMemberSalary(orgId, input.userId, input.fixedSalary),
  );

  const updateProjectsMutation = useMutation(
    (input: { userId: string; assignedProjects: string[] }) =>
      organizationService.updateMemberProjects(orgId, input.userId, input.assignedProjects),
  );

  const inviteMutation = useMutation(
    (input: { email: string; name: string; role: UserRole | string; department?: string; position?: string }) =>
      organizationService.inviteMember(orgId, input.email, input.role as UserRole, input.name, input.department, input.position),
  );

  // ── Real Organization Projects ──────────────────────────────────
  const {
    data: orgProjects = [],
  } = useServiceArray(
    () => projectService.getAll(orgId),
    [orgId],
    ['projects'],
  );

  // ── Real Organization Timesheets (to compute monthly logged hours) ──
  const {
    data: orgTimesheets = [],
  } = useServiceArray(
    () => employeeService.getTimesheetsByOrg(orgId),
    [orgId],
    ['timesheets', orgId],
  );

  const monthlyHoursByMember = React.useMemo(() => {
    const curMonth = new Date().toISOString().slice(0, 7);
    const map = new Map<string, number>();
    for (const ts of (orgTimesheets || [])) {
      if (ts.date && ts.date.startsWith(curMonth)) {
        const uId = ts.userId;
        const prev = map.get(uId) || 0;
        map.set(uId, prev + Number(ts.hours || 0));
      }
    }
    return map;
  }, [orgTimesheets]);

  // ── Real Organization Departments ────────────────────────────────
  const {
    data: orgDepartments = [],
  } = useServiceArray(
    () => departmentService.getAll(orgId),
    [orgId],
    ['departments'],
  );

  const availableDepartments = React.useMemo(() => {
    const list: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();

    for (const d of orgDepartments) {
      if (d.name && !seen.has(d.name.toLowerCase().trim())) {
        seen.add(d.name.toLowerCase().trim());
        list.push({ id: d.id, name: d.name.trim() });
      }
    }

    if (list.length === 0) {
      for (const def of DEPT_SUGGESTIONS) {
        list.push({ id: def.toLowerCase(), name: def });
      }
    }
    return list;
  }, [orgDepartments]);

  const [activeView, setActiveView] = React.useState<TeamView>('members');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [filterRole, setFilterRole] = React.useState<string>('all');
  const [updatingMemberId, setUpdatingMemberId] = React.useState<string | null>(null);
  const [salaryDrafts, setSalaryDrafts] = React.useState<Record<string, string>>({});

  // ── Cross-Departmental Agency Teams / Squads ───────────────────────
  const {
    data: agencyTeams = [],
    loading: teamsLoading,
    refetch: refetchTeams,
  } = useServiceArray(
    () => organizationService.getTeams(orgId),
    [orgId],
    ['agency_teams', orgId],
  );

  const [teamDialogOpen, setTeamDialogOpen] = React.useState(false);
  const [editingTeam, setEditingTeam] = React.useState<AgencyTeam | null>(null);
  const [teamName, setTeamName] = React.useState('');
  const [teamDescription, setTeamDescription] = React.useState('');
  const [teamProjectId, setTeamProjectId] = React.useState('');
  const [teamLeadUserId, setTeamLeadUserId] = React.useState('');
  const [teamMemberIds, setTeamMemberIds] = React.useState<string[]>([]);
  const [teamDeptFilter, setTeamDeptFilter] = React.useState<string>('ALL');
  const [savingTeam, setSavingTeam] = React.useState(false);
  const [deletingTeamId, setDeletingTeamId] = React.useState<string | null>(null);

  const openCreateTeamModal = (preselectedMemberIds: string[] = []) => {
    setEditingTeam(null);
    setTeamName('');
    setTeamDescription('');
    setTeamProjectId(orgProjects[0]?.id || '');
    setTeamMemberIds(preselectedMemberIds);
    setTeamLeadUserId(preselectedMemberIds[0] || '');
    setTeamDeptFilter('ALL');
    setTeamDialogOpen(true);
  };

  const openEditTeamModal = (team: AgencyTeam) => {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamDescription(team.description || '');
    setTeamProjectId(team.projectId || '');
    setTeamMemberIds(team.memberIds || []);
    setTeamLeadUserId(team.leadUserId || team.memberIds?.[0] || '');
    setTeamDeptFilter('ALL');
    setTeamDialogOpen(true);
  };

  const toggleTeamMemberSelection = (userId: string) => {
    setTeamMemberIds((prev) => {
      const exists = prev.includes(userId);
      const next = exists ? prev.filter((id) => id !== userId) : [...prev, userId];
      if (!exists && !teamLeadUserId) {
        setTeamLeadUserId(userId);
      } else if (exists && teamLeadUserId === userId) {
        setTeamLeadUserId(next[0] || '');
      }
      return next;
    });
  };

  const handleSaveTeam = async () => {
    if (!teamName.trim()) {
      toast.error('Please enter a Team / Squad name');
      return;
    }
    if (teamMemberIds.length === 0) {
      toast.error('Please select at least one employee for this team');
      return;
    }

    setSavingTeam(true);
    try {
      const payload = {
        name: teamName.trim(),
        description: teamDescription.trim(),
        projectId: teamProjectId || undefined,
        leadUserId: teamLeadUserId || teamMemberIds[0],
        memberIds: teamMemberIds,
      };

      const res = editingTeam
        ? await organizationService.updateTeam(orgId, editingTeam.id, payload)
        : await organizationService.createTeam(orgId, payload);

      if (res.success) {
        toast.success(
          editingTeam
            ? `Updated team "${teamName.trim()}"`
            : `Created cross-departmental team "${teamName.trim()}"!`,
        );
        setTeamDialogOpen(false);
        await Promise.all([refetchTeams(), refetchMembers()]);
        setActiveView('teams');
      } else {
        toast.error(res.error || 'Failed to save team');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save team');
    } finally {
      setSavingTeam(false);
    }
  };

  const handleDeleteTeam = async (team: AgencyTeam) => {
    if (!window.confirm(`Delete team "${team.name}"?`)) return;
    setDeletingTeamId(team.id);
    try {
      const res = await organizationService.deleteTeam(orgId, team.id);
      if (res.success) {
        toast.success(`Deleted team "${team.name}"`);
        await refetchTeams();
      } else {
        toast.error(res.error || 'Failed to delete team');
      }
    } catch {
      toast.error('Failed to delete team');
    } finally {
      setDeletingTeamId(null);
    }
  };

  // ── Company Announcements Management State & Actions ──────────────
  const {
    data: announcements = [],
    loading: announcementsLoading,
    refetch: refetchAnnouncements,
  } = useServiceArray(
    () => organizationService.getAnnouncements(orgId),
    [orgId],
    ['announcements', orgId],
  );

  const [announcementModalOpen, setAnnouncementModalOpen] = React.useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = React.useState<CompanyAnnouncement | null>(null);
  const [announcementTitle, setAnnouncementTitle] = React.useState('');
  const [announcementContent, setAnnouncementContent] = React.useState('');
  const [announcementCategory, setAnnouncementCategory] = React.useState<'general' | 'hr' | 'finance' | 'project' | 'celebration'>('general');
  const [announcementIsPinned, setAnnouncementIsPinned] = React.useState(false);
  const [announcementAuthor, setAnnouncementAuthor] = React.useState('');
  const [savingAnnouncement, setSavingAnnouncement] = React.useState(false);
  const [announcementSearch, setAnnouncementSearch] = React.useState('');
  const [announcementCategoryFilter, setAnnouncementCategoryFilter] = React.useState('all');

  const openCreateAnnouncementModal = () => {
    setEditingAnnouncement(null);
    setAnnouncementTitle('');
    setAnnouncementContent('');
    setAnnouncementCategory('general');
    setAnnouncementIsPinned(false);
    setAnnouncementAuthor(user?.name || user?.email || 'Leadership');
    setAnnouncementModalOpen(true);
  };

  const openEditAnnouncementModal = (ann: CompanyAnnouncement) => {
    setEditingAnnouncement(ann);
    setAnnouncementTitle(ann.title);
    setAnnouncementContent(ann.content);
    setAnnouncementCategory(ann.category);
    setAnnouncementIsPinned(ann.isPinned);
    setAnnouncementAuthor(ann.author);
    setAnnouncementModalOpen(true);
  };

  const handleSaveAnnouncement = async () => {
    if (!announcementTitle.trim()) {
      toast.error('Announcement title is required');
      return;
    }
    if (!announcementContent.trim()) {
      toast.error('Announcement content is required');
      return;
    }

    setSavingAnnouncement(true);
    try {
      if (editingAnnouncement) {
        const res = await organizationService.updateAnnouncement(orgId, editingAnnouncement.id, {
          title: announcementTitle.trim(),
          content: announcementContent.trim(),
          category: announcementCategory,
          isPinned: announcementIsPinned,
          author: announcementAuthor.trim(),
        });
        if (res.success) {
          toast.success('Announcement updated');
          setAnnouncementModalOpen(false);
          await refetchAnnouncements();
        } else {
          toast.error(res.error || 'Failed to update announcement');
        }
      } else {
        const res = await organizationService.createAnnouncement(orgId, {
          title: announcementTitle.trim(),
          content: announcementContent.trim(),
          category: announcementCategory,
          isPinned: announcementIsPinned,
          author: announcementAuthor.trim(),
        });
        if (res.success) {
          toast.success('Announcement published');
          setAnnouncementModalOpen(false);
          await refetchAnnouncements();
        } else {
          toast.error(res.error || 'Failed to create announcement');
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save announcement');
    } finally {
      setSavingAnnouncement(false);
    }
  };

  const handleTogglePinAnnouncement = async (ann: CompanyAnnouncement) => {
    try {
      const res = await organizationService.updateAnnouncement(orgId, ann.id, {
        isPinned: !ann.isPinned,
      });
      if (res.success) {
        toast.success(ann.isPinned ? 'Announcement unpinned' : 'Announcement pinned to top');
        await refetchAnnouncements();
      } else {
        toast.error(res.error || 'Failed to update pin status');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update pin');
    }
  };

  const handleDeleteAnnouncement = async (annId: string) => {
    if (!window.confirm('Are you sure you want to delete this company announcement?')) return;
    try {
      const res = await organizationService.deleteAnnouncement(orgId, annId);
      if (res.success) {
        toast.success('Announcement deleted');
        await refetchAnnouncements();
      } else {
        toast.error(res.error || 'Failed to delete announcement');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete announcement');
    }
  };

  // ── Dynamic Role Permissions (Supabase org settings) ─────────────
  const {
    data: customRolePermissions,
    refetch: refetchRolePermissions,
  } = useService(
    () => organizationService.getRolePermissions(orgId),
    [orgId],
    ['role_permissions', orgId],
  );

  const roleDefinitions = React.useMemo(() => {
    return DEFAULT_ROLE_DEFINITIONS.map(def => {
      if (customRolePermissions && customRolePermissions[def.id]) {
        return {
          ...def,
          permissions: customRolePermissions[def.id],
        };
      }
      return def;
    });
  }, [customRolePermissions]);

  const getPermissionsForRole = React.useCallback((role: MemberRole): string[] => {
    if (role === 'org_admin') return ['all'];
    if (customRolePermissions && customRolePermissions[role]) {
      return customRolePermissions[role];
    }
    return permissionsForDisplayRole(role);
  }, [customRolePermissions]);

  // ── Edit Role Permissions Dialog State ─────────────────────────────
  const [editRoleDialogOpen, setEditRoleDialogOpen] = React.useState(false);
  const [selectedRoleForEdit, setSelectedRoleForEdit] = React.useState<MemberRole | null>(null);
  const [editingPermissions, setEditingPermissions] = React.useState<string[]>([]);
  const [savingRolePermissions, setSavingRolePermissions] = React.useState(false);

  const openEditRoleModal = (roleId: MemberRole) => {
    setSelectedRoleForEdit(roleId);
    const existingRole = roleDefinitions.find(r => r.id === roleId);
    if (roleId === 'org_admin') {
      setEditingPermissions(allPermissions.map(p => p.id));
    } else {
      setEditingPermissions(existingRole ? [...existingRole.permissions] : []);
    }
    setEditRoleDialogOpen(true);
  };

  const togglePermission = (permId: string) => {
    if (selectedRoleForEdit === 'org_admin') {
      toast.info('Organization Admin always retains full access');
      return;
    }
    setEditingPermissions(prev =>
      prev.includes(permId) ? prev.filter(p => p !== permId) : [...prev, permId]
    );
  };

  const handleSelectAllPermissions = () => {
    if (selectedRoleForEdit === 'org_admin') return;
    setEditingPermissions(allPermissions.map(p => p.id));
  };

  const handleResetPermissionsToDefault = () => {
    if (!selectedRoleForEdit) return;
    const defaultDef = DEFAULT_ROLE_DEFINITIONS.find(r => r.id === selectedRoleForEdit);
    if (defaultDef) {
      setEditingPermissions(defaultDef.permissions.includes('all') ? allPermissions.map(p => p.id) : [...defaultDef.permissions]);
    }
  };

  const handleSaveRolePermissions = async () => {
    if (!selectedRoleForEdit) return;
    setSavingRolePermissions(true);
    try {
      const permsToSave = selectedRoleForEdit === 'org_admin' ? ['all'] : editingPermissions.filter(p => isPermissionAllowedByPlanFeatures(p, allowedFeatures));
      const res = await organizationService.updateRolePermissions(orgId, selectedRoleForEdit, permsToSave);
      if (res.success) {
        toast.success(`Updated permissions for ${selectedRoleForEdit.replace('_', ' ')}`);
        await refetchRolePermissions();
        setEditRoleDialogOpen(false);
      } else {
        toast.error(res.error || 'Failed to update role permissions');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error saving role permissions');
    } finally {
      setSavingRolePermissions(false);
    }
  };

  // ── Invite Dialog State ──────────────────────────────────────────
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false);
  const [inviteMode, setInviteMode] = React.useState<'single' | 'bulk'>('single');

  // Single Invite State
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteName, setInviteName] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<string>('employee'); // Access role
  const [invitePosition, setInvitePosition] = React.useState<string>(''); // Job title/position
  const [inviteDepartment, setInviteDepartment] = React.useState<string>('Development');
  const [inviteModalError, setInviteModalError] = React.useState<string | null>(null);
  const [inviteModalSuccess, setInviteModalSuccess] = React.useState<string | null>(null);

  // Bulk Invite State
  const [bulkRows, setBulkRows] = React.useState<Array<{ id: string; email: string; name: string; role: string; department: string }>>([
    { id: '1', email: '', name: '', role: 'Team Member', department: 'Development' },
    { id: '2', email: '', name: '', role: 'Team Member', department: 'Development' },
    { id: '3', email: '', name: '', role: 'Team Member', department: 'Development' },
  ]);
  const [bulkPasteText, setBulkPasteText] = React.useState('');
  const [bulkDefaultRole, setBulkDefaultRole] = React.useState('Team Member');
  const [bulkDefaultDept, setBulkDefaultDept] = React.useState('Development');
  const [bulkIsSubmitting, setBulkIsSubmitting] = React.useState(false);

  // Sync default invite department with real org departments when available
  React.useEffect(() => {
    if (orgDepartments.length > 0) {
      const firstDept = orgDepartments[0].name;
      const exists = orgDepartments.some(d => d.name.toLowerCase() === inviteDepartment.toLowerCase());
      if (!exists || inviteDepartment === 'Development') {
        setInviteDepartment(firstDept);
      }
      const bulkExists = orgDepartments.some(d => d.name.toLowerCase() === bulkDefaultDept.toLowerCase());
      if (!bulkExists || bulkDefaultDept === 'Development') {
        setBulkDefaultDept(firstDept);
        setBulkRows(prev =>
          prev.map(r => (r.department === 'Development' ? { ...r, department: firstDept } : r))
        );
      }
    }
  }, [orgDepartments]);
  const [bulkResults, setBulkResults] = React.useState<{
    total: number;
    successful: number;
    failed: number;
    results: Array<{ email: string; success: boolean; previewUrl?: string; error?: string }>;
  } | null>(null);

  const addBulkRow = () => {
    setBulkRows(prev => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        email: '',
        name: '',
        role: bulkDefaultRole || 'Team Member',
        department: bulkDefaultDept || 'Development',
      },
    ]);
  };

  const removeBulkRow = (id: string) => {
    setBulkRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== id) : prev));
  };

  const updateBulkRow = (id: string, field: 'email' | 'name' | 'role' | 'department', value: string) => {
    setBulkRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const applyDefaultsToAllRows = () => {
    setBulkRows(prev =>
      prev.map(r => ({
        ...r,
        role: bulkDefaultRole || r.role,
        department: bulkDefaultDept || r.department,
      }))
    );
    toast.success('Applied default role & department to all rows');
  };

  const parsePastedEmails = (text: string) => {
    const rawEmails = text
      .split(/[\n,;]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.includes('@'));

    if (rawEmails.length === 0) {
      toast.error('No valid emails detected in paste text');
      return;
    }

    const newRows = rawEmails.map((email, idx) => ({
      id: `p-${Date.now()}-${idx}`,
      email,
      name: email.split('@')[0],
      role: bulkDefaultRole || 'Team Member',
      department: bulkDefaultDept || 'Development',
    }));

    setBulkRows(newRows);
    setBulkPasteText('');
    toast.success(`Loaded ${newRows.length} email(s) into bulk list!`);
  };

  const handleBulkInvite = async () => {
    setInviteModalError(null);
    setInviteModalSuccess(null);
    const validRows = bulkRows.filter(r => r.email.trim().length > 0);
    if (validRows.length === 0) {
      setInviteModalError('Please enter at least one valid email address.');
      toast.error('Please enter at least one email address.');
      return;
    }

    setBulkIsSubmitting(true);
    try {
      const res = await organizationService.bulkInviteMembers(orgId, validRows);
      if (res.success && res.data) {
        setBulkResults(res.data);
        const msg = `${res.data.successful} of ${res.data.total} invitations sent successfully!`;
        setInviteModalSuccess(msg);
        toast.success(msg);
        await refetchMembers();
      } else {
        const errMsg = res.error || 'Failed to process bulk invitations';
        setInviteModalError(errMsg);
        toast.error(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Unexpected error during bulk invitations';
      setInviteModalError(errMsg);
      toast.error(errMsg);
    } finally {
      setBulkIsSubmitting(false);
    }
  };

  const handleInvite = async () => {
    setInviteModalError(null);
    setInviteModalSuccess(null);
    const email = inviteEmail.trim();
    if (!email) {
      setInviteModalError('Please enter an email address.');
      toast.error('Enter an email address.');
      return;
    }
    const res = await inviteMutation.execute({
      email,
      name: inviteName.trim(),
      role: inviteRole as any, // Access role (admin, employee, accountant, viewer)
      department: inviteDepartment,
      position: invitePosition.trim() || undefined // Job title
    });
    if (res.success) {
      const msg = res.message ?? `Invitation sent successfully to ${email}!`;
      setInviteModalSuccess(msg);
      toast.success(msg);
      await refetchMembers();
      setTimeout(() => {
        setInviteDialogOpen(false);
        setInviteEmail('');
        setInviteName('');
        setInviteRole('employee');
        setInvitePosition('');
        setInviteDepartment('Development');
        setInviteModalSuccess(null);
        setInviteModalError(null);
      }, 1500);
    } else {
      const errMsg = res.error ?? 'Could not invite member. Please verify email and try again.';
      setInviteModalError(errMsg);
      toast.error(errMsg);
    }
  };

  // ── Derived team members list from Supabase org member rows ─────────────
  const teamMembers: TeamMember[] = React.useMemo(() => {
    if (!orgMemberRows) return [];
    return orgMemberRows
      .map((row) => {
        const tm = mapOrgMemberRowToTeamMember(row as OrganizationMember & { user?: User | null });
        if (!tm) return null;
        return {
          ...tm,
          permissions: getPermissionsForRole(tm.role as MemberRole),
        };
      })
      .filter((m): m is TeamMember => m !== null);
  }, [orgMemberRows, getPermissionsForRole]);

  // ── Role counts for Roles & Permissions view ─────────────────────────────
  const roleMemberCounts: Record<string, number> = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of teamMembers) {
      counts[m.role] = (counts[m.role] ?? 0) + 1;
    }
    return counts;
  }, [teamMembers]);

  // ── Save role change for a specific member ────────────────────────────────
  const saveMemberRole = async (member: TeamMember, newDisplayRole: MemberRole) => {
    setUpdatingMemberId(member.id);
    try {
      const res = await roleMutation.execute({ userId: member.id, newRole: newDisplayRole });
      if (res.success) {
        toast.success(`Role updated to ${newDisplayRole.replace('_', ' ')}`);
        await refetchMembers();
      } else {
        toast.error(res.error || 'Failed to update role');
      }
    } catch {
      toast.error('Failed to update role');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const activeMembers = teamMembers.filter(m => m.status === 'active').length;
  const pendingMembers = teamMembers.filter(m => m.status === 'pending').length;
  const totalPermissions = allPermissions.length;

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  };

  const getRoleBadge = (role: string) => {
    const styles: Record<string, any> = {
      org_admin: AXIOM.badges.purple,
      accountant: AXIOM.badges.cyan,
      team_member: AXIOM.badges.info,
      viewer: AXIOM.badges.success,
    };
    return styles[role] || AXIOM.badges.info;
  };

  const getStatusBadge = (status: MemberStatus) => {
    const styles: Record<string, any> = {
      active: AXIOM.badges.success,
      inactive: AXIOM.badges.danger,
      pending: AXIOM.badges.warning,
    };
    return styles[status] || AXIOM.badges.info;
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'org_admin':
        return <Crown className="size-4" />;
      case 'accountant':
        return <DollarSign className="size-4" />;
      case 'team_member':
        return <Users className="size-4" />;
      case 'viewer':
        return <Eye className="size-4" />;
      default:
        return <UserCheck className="size-4" />;
    }
  };

  const q = searchQuery.toLowerCase();
  const filteredMembers = teamMembers.filter(member => {
    const matchesSearch =
      (member.name ?? '').toLowerCase().includes(q) ||
      (member.email ?? '').toLowerCase().includes(q) ||
      (member.customRole ?? '').toLowerCase().includes(q) ||
      (member.department ?? '').toLowerCase().includes(q);
    const matchesRole = filterRole === 'all' || member.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const viewButtons = [
    { id: 'members' as const, label: 'Team Members', icon: Users },
    { id: 'teams' as const, label: `Agency Teams (${agencyTeams.length})`, icon: GitBranch },
    { id: 'announcements' as const, label: `Company News (${announcements.length})`, icon: Megaphone },
    { id: 'roles' as const, label: 'Roles & Permissions', icon: Shield },
    { id: 'activity' as const, label: 'Activity Log', icon: Activity },
    { id: 'invitations' as const, label: 'Pending Invites', icon: Mail },
  ];

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Users className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Team & Permissions
              </h1>
              <p className="text-slate-400 text-sm">Manage team members and access control</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => openCreateTeamModal()}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(6, 182, 212, 0.35))',
                border: '1px solid rgba(16, 185, 129, 0.55)',
                boxShadow: '0 10px 30px -10px rgba(16, 185, 129, 0.5)',
                color: '#ffffff',
              }}
            >
              <GitBranch className="size-4 text-emerald-300" />
              + Create Team
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => goToOrgView?.('dashboard')}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                display: 'none',
                border: '1px solid rgba(168, 85, 247, 0.5)',
                color: '#ffffff',
              }}
            >


            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => goToOrgView?.('settings')}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <Settings className="size-4" />
              Settings
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setInviteDialogOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Plus className="size-4" />
              Invite Member
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartGreen}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Active Members</p>
              <p className="text-3xl font-bold text-white">{activeMembers}</p>
              <p className="text-xs text-green-400 mt-1">Currently online</p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <UserCheck className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartAmber}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Pending Invites</p>
              <p className="text-3xl font-bold text-white">{pendingMembers}</p>
              <p className="text-xs text-amber-400 mt-1">Awaiting acceptance</p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.amber,
                boxShadow: AXIOM.shadows.iconAmber,
              }}
            >
              <Mail className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartPurple}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Roles</p>
              <p className="text-3xl font-bold text-white">{roleDefinitions.length}</p>
              <p className="text-xs text-purple-400 mt-1">Permission groups</p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Shield className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.chartCyan}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Permissions</p>
              <p className="text-3xl font-bold text-white">{totalPermissions}</p>
              <p className="text-xs text-cyan-400 mt-1">Available controls</p>
            </div>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Lock className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* View Selector */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex gap-2 p-2 rounded-2xl"
        style={AXIOM.containers.list}
      >
        {viewButtons.map((btn) => (
          <motion.button
            key={btn.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveView(btn.id)}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={activeView === btn.id ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
          >
            <btn.icon className="size-4" />
            {btn.label}
          </motion.button>
        ))}
      </motion.div>

      {/* Search and Filter */}
      {activeView === 'members' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="flex flex-col gap-3"
        >
          {membersError && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fecaca',
              }}
            >
              <span className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                {membersError}
              </span>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => void refetchMembers()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={AXIOM.buttons.secondary}
              >
                Try again
              </motion.button>
            </div>
          )}
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                  color: AXIOM.inputs.color,
                }}
              />
            </div>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-4 py-3 rounded-xl text-sm font-medium"
              style={AXIOM.buttons.secondary}
            >
              <option value="all">All Roles</option>
              <option value="org_admin">Organization Admin</option>
              <option value="team_member">Team Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </motion.div>
      )}

      {/* Content Views */}
      {activeView === 'members' && membersLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-6 rounded-2xl animate-pulse"
              style={{ ...AXIOM.containers.list, minHeight: 220 }}
            >
              <div className="flex gap-3 mb-4">
                <div className="size-12 rounded-xl bg-slate-700/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-700/80 rounded w-2/3" />
                  <div className="h-3 bg-slate-700/60 rounded w-full" />
                </div>
              </div>
              <div className="h-9 bg-slate-700/50 rounded-lg w-full mb-3" />
              <div className="h-20 bg-slate-700/40 rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {activeView === 'members' && !membersLoading && filteredMembers.length === 0 && (
        <div
          className="p-10 rounded-2xl text-center text-slate-400 text-sm"
          style={AXIOM.containers.list}
        >
          {membersError ? 'Could not load team members.' : 'No team members match your filters.'}
        </div>
      )}

      {activeView === 'members' && !membersLoading && filteredMembers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMembers.map((member, index) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + index * 0.05 }}
              className="p-6 rounded-2xl group"
              style={AXIOM.containers.list}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="size-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: member.role === 'org_admin' ? AXIOM.iconBoxes.purple :
                        member.role === 'accountant' ? AXIOM.iconBoxes.cyan :
                          member.role === 'viewer' ? AXIOM.iconBoxes.green :
                            AXIOM.iconBoxes.blue,
                      boxShadow: member.role === 'org_admin' ? AXIOM.shadows.iconPurple :
                        member.role === 'accountant' ? AXIOM.shadows.iconCyan :
                          member.role === 'viewer' ? AXIOM.shadows.iconGreen :
                            AXIOM.shadows.iconBlue,
                    }}
                  >
                    <span className="text-white font-bold text-lg">{(member.name || '?')[0]}</span>
                  </div>
                  <div>
                    <p className="text-white font-medium">{member.name}</p>
                    <p className="text-xs text-slate-400">{member.email}</p>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={AXIOM.buttons.secondary}
                  onClick={() => toast.success('Member options')}
                >
                  <MoreVertical className="size-4" />
                </motion.button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span
                  className="px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                  style={getStatusBadge(member.status)}
                >
                  {member.status === 'active' ? <CheckCircle className="size-3" /> :
                    member.status === 'pending' ? <AlertCircle className="size-3" /> :
                      <XCircle className="size-3" />}
                  {member.status}
                </span>
                {member.customRole && (
                  <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    {member.customRole}
                  </span>
                )}
                {member.department && (
                  <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono text-slate-300 bg-slate-800/80 border border-slate-700/60">
                    {member.department}
                  </span>
                )}
              </div>

              {/* Monthly Logged Hours for this member (not shown for Organization Owner) */}
              {member.orgRole !== 'owner' && (
  <div
                className="flex items-center justify-between p-2.5 rounded-xl mb-4"
                style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                }}
              >
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-blue-400" />
                  <span className="text-xs text-slate-300 font-medium">Logged this month</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-bold text-white bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/30">
                    {(monthlyHoursByMember.get(member.id) || 0).toFixed(1)}h
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">/ 160h</span>
                </div>
              </div>
              )}

              <div className="mb-4">
                <label htmlFor={`member-role-${member.id}`} className="text-xs text-slate-400 mb-1 flex items-center justify-between">
                  <span>Access Role</span>
                  {member.customRole && <span className="text-[11px] text-cyan-400/80 font-mono font-normal">Position: {member.customRole}</span>}
                </label>
                {/* Lock role editing for: the org owner's own card, org admins, or if the logged-in user is viewing their own card */}
                {member.orgRole === 'owner' || member.orgRole === 'admin' || member.role === 'org_admin' || member.id === currentUserId ? (
                  <div
                    className="w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                    style={{
                      background: 'rgba(168, 85, 247, 0.08)',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      color: '#c4b5fd',
                    }}
                  >
                    <Lock className="size-3.5 text-purple-400 shrink-0" />
                    <span className="font-medium">
                      {member.orgRole === 'owner'
                        ? 'Organization Owner'
                        : member.orgRole === 'admin' || member.role === 'org_admin'
                          ? 'Organization Admin'
                          : member.role.replace('_', ' ')}
                    </span>
                    <span className="ml-auto text-[11px] text-purple-400/60 font-mono">
                      {member.orgRole === 'owner' || member.orgRole === 'admin' || member.role === 'org_admin'
                        ? 'Protected'
                        : 'Your account'}
                    </span>
                  </div>
                ) : (
                  <>
                    <select
                      id={`member-role-${member.id}`}
                      value={member.role as MemberRole}
                      disabled={updatingMemberId === member.id}
                      onChange={(e) => void saveMemberRole(member, e.target.value as MemberRole)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    >
                      {MEMBER_ROLE_SELECT.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {updatingMemberId === member.id && (
                      <p className="text-xs text-slate-500 mt-1">Saving…</p>
                    )}
                  </>
                )}
              </div>

              {/* Department Assignment for Overhead & Headcount — REMOVED for organization owner */}
              {member.orgRole !== 'owner' && (
                <div className="mb-4">
                  <label htmlFor={`member-dept-${member.id}`} className="text-xs text-slate-400 mb-1 flex items-center justify-between">
                    <span>Department</span>
                    <span className="text-[11px] text-cyan-400/90 font-mono">Overhead Headcount</span>
                  </label>
                  <select
                    id={`member-dept-${member.id}`}
                    value={member.department || ''}
                    disabled={updatingMemberId === member.id}
                    onChange={async (e) => {
                      const newDept = e.target.value;
                      setUpdatingMemberId(member.id);
                      try {
                        const res = await updateDeptMutation.execute({ userId: member.id, department: newDept });
                        if (res.success) {
                          toast.success(`Department updated to ${newDept}`);
                          await refetchMembers();
                        } else {
                          toast.error(res.error || 'Failed to update department');
                        }
                      } catch {
                        toast.error('Failed to update department');
                      } finally {
                        setUpdatingMemberId(null);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    <option value="" disabled>Select department...</option>
                    {availableDepartments.map((d) => (
                      <option key={d.id} value={d.name} className="bg-slate-900 text-white">
                        {d.name}
                      </option>
                    ))}
                    {!availableDepartments.some(d => d.name.toLowerCase() === (member.department || '').toLowerCase()) && member.department && (
                      <option value={member.department} className="bg-slate-900 text-white">
                        {member.department} (Custom)
                      </option>
                    )}
                  </select>
                </div>
              )}

              {/* Fixed Monthly Salary / Compensation */}
              {member.orgRole !== 'owner' && (
                <div className="mb-4">
                  <label htmlFor={`member-salary-${member.id}`} className="text-xs text-slate-400 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <DollarSign className="size-3.5 text-emerald-400" />
                      Fixed Monthly Salary
                    </span>
                    <span className="text-[11px] text-emerald-400/90 font-mono">
                      {member.fixedSalary && Number(member.fixedSalary) > 0
                        ? `@ $${(Number(member.fixedSalary) / 160).toFixed(2)}/hr`
                        : 'Unconfigured'}
                    </span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">
                      {currentOrganization?.currency === 'PKR' ? '₨' : '$'}
                    </span>
                    <input
                      id={`member-salary-${member.id}`}
                      type="number"
                      min="0"
                      step="100"
                      placeholder="e.g. 5000"
                      defaultValue={member.fixedSalary ? Number(member.fixedSalary) : ''}
                      key={`sal-${member.id}-${member.fixedSalary ?? 0}`}
                      disabled={updatingMemberId === member.id}
                      onBlur={async (e) => {
                        const val = parseFloat(e.target.value);
                        const newSal = isNaN(val) ? 0 : Math.max(0, val);
                        if (newSal === Number(member.fixedSalary || 0)) return;
                        setUpdatingMemberId(member.id);
                        try {
                          const res = await updateSalaryMutation.execute({ userId: member.id, fixedSalary: newSal });
                          if (res.success) {
                            toast.success(`Fixed salary updated for ${member.name}`);
                            await refetchMembers();
                          } else {
                            toast.error(res.error || 'Failed to update salary');
                          }
                        } catch {
                          toast.error('Failed to update salary');
                        } finally {
                          setUpdatingMemberId(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-full pl-8 pr-3 py-2 rounded-lg text-sm text-white font-mono"
                      style={{
                        background: AXIOM.inputs.background,
                        border: AXIOM.inputs.border,
                        color: AXIOM.inputs.color,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono mt-1">
                    Used for real-time project labor costing ($/hr = salary ÷ 160h)
                  </p>
                </div>
              )}

              {/* Project Assignments — for employees */}
              {member.orgRole !== 'owner' && (
                <div className="mb-4">
                  <label className="text-xs text-slate-400 mb-1.5 flex items-center justify-between">
                    <span>Assigned Projects</span>
                    <span className="text-[11px] text-purple-400/90 font-mono">
                      {(member.assignedProjects || []).length} assigned
                    </span>
                  </label>

                  {/* Badges of currently assigned projects */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(member.assignedProjects || []).map((pId) => {
                      const proj = orgProjects.find((p) => p.id === pId);
                      const projName = proj?.name || pId;
                      return (
                        <span
                          key={pId}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium"
                          style={{
                            background: 'rgba(168, 85, 247, 0.15)',
                            border: '1px solid rgba(168, 85, 247, 0.35)',
                            color: '#e9d5ff',
                          }}
                        >
                          <span className="truncate max-w-[120px]">{projName}</span>
                          <button
                            type="button"
                            title="Remove assignment"
                            disabled={updatingMemberId === member.id}
                            onClick={async () => {
                              const updated = (member.assignedProjects || []).filter((id) => id !== pId);
                              setUpdatingMemberId(member.id);
                              try {
                                const res = await updateProjectsMutation.execute({ userId: member.id, assignedProjects: updated });
                                if (res.success) {
                                  toast.success(`Removed from ${projName}`);
                                  await refetchMembers();
                                } else {
                                  toast.error(res.error || 'Failed to update projects');
                                }
                              } catch {
                                toast.error('Failed to update projects');
                              } finally {
                                setUpdatingMemberId(null);
                              }
                            }}
                            className="hover:text-red-400 transition-colors ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {(!member.assignedProjects || member.assignedProjects.length === 0) && (
                      <span className="text-xs text-slate-500 italic py-0.5">No specific projects assigned</span>
                    )}
                  </div>

                  {/* Add project dropdown */}
                  <select
                    value=""
                    disabled={updatingMemberId === member.id}
                    onChange={async (e) => {
                      const selectedProjId = e.target.value;
                      if (!selectedProjId) return;
                      const currentAssigned = member.assignedProjects || [];
                      if (currentAssigned.includes(selectedProjId)) return;
                      const updated = [...currentAssigned, selectedProjId];
                      const projObj = orgProjects.find((p) => p.id === selectedProjId);
                      setUpdatingMemberId(member.id);
                      try {
                        const res = await updateProjectsMutation.execute({ userId: member.id, assignedProjects: updated });
                        if (res.success) {
                          toast.success(`Assigned to ${projObj?.name || 'project'}`);
                          await refetchMembers();
                        } else {
                          toast.error(res.error || 'Failed to assign project');
                        }
                      } catch {
                        toast.error('Failed to assign project');
                      } finally {
                        setUpdatingMemberId(null);
                      }
                    }}
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-slate-300 font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                      color: AXIOM.inputs.color,
                    }}
                  >
                    <option value="">+ Assign project...</option>
                    {orgProjects
                      .filter((p) => !(member.assignedProjects || []).includes(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                          {p.name} {p.clientName ? `(${p.clientName})` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Cross-Departmental Agency Teams / Squads for this employee */}
              {member.orgRole !== 'owner' && (
                <div className="mb-4">
                  <div className="text-xs text-slate-400 mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <GitBranch className="size-3.5 text-emerald-400" />
                      Agency Teams / Squads
                    </span>
                    <button
                      type="button"
                      onClick={() => openCreateTeamModal([member.id])}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 font-mono underline-offset-2 hover:underline"
                    >
                      + Make Team with {member.name.split(' ')[0]}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {agencyTeams
                      .filter((t) => {
                        const memId = String(member.id || '').trim();
                        const memEmail = String(member.email || '').toLowerCase().trim();
                        const inIds = Array.isArray(t.memberIds) && t.memberIds.some((id) => String(id).trim() === memId);
                        const inMembers = Array.isArray(t.members) && t.members.some(
                          (m) =>
                            String(m.userId || (m as any).id || '').trim() === memId ||
                            (memEmail && String(m.email || '').toLowerCase().trim() === memEmail)
                        );
                        return inIds || inMembers;
                      })
                      .map((t) => (
                        <span
                          key={t.id}
                          onClick={() => openEditTeamModal(t)}
                          title="Click to view or edit team"
                          className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all hover:brightness-110"
                          style={{
                            background: 'rgba(16, 185, 129, 0.14)',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            color: '#6ee7b7',
                          }}
                        >
                          <GitBranch className="size-3" />
                          <span>{t.name}</span>
                          {t.leadUserId === member.id && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              Lead
                            </span>
                          )}
                        </span>
                      ))}
                    {agencyTeams.filter((t) => {
                      const memId = String(member.id || '').trim();
                      const memEmail = String(member.email || '').toLowerCase().trim();
                      const inIds = Array.isArray(t.memberIds) && t.memberIds.some((id) => String(id).trim() === memId);
                      const inMembers = Array.isArray(t.members) && t.members.some(
                        (m) =>
                          String(m.userId || (m as any).id || '').trim() === memId ||
                          (memEmail && String(m.email || '').toLowerCase().trim() === memEmail)
                      );
                      return inIds || inMembers;
                    }).length === 0 && (
                      <span className="text-xs text-slate-500 italic py-0.5">Not assigned to an agency squad yet</span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2 mb-4 pb-4" style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Joined</span>
                  <span className="text-slate-300">{member.joinedDate ? formatDate(member.joinedDate) : 'N/A'}</span>
                </div>
                {member.lastActive && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Last active</span>
                    <span className="text-green-400">{getRelativeTime(member.lastActive)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Permissions</span>
                  <span className="text-cyan-400">{member.permissions.includes('all') ? 'All' : member.permissions.length}</span>
                </div>
              </div>

              {false && (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => goToOrgView?.('dashboard')}
                    className="w-full py-2 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all hover:brightness-110"
                    style={{
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(6, 182, 212, 0.18))',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      color: '#6ee7b7',
                    }}
                  >
                    <FileText className="size-3.5" />
                    Issue Monthly Payslip
                  </button>
                </div>
              )}

              <p className="text-xs text-slate-500">
                Updating the role saves immediately and updates access for that person.
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {activeView === 'teams' && (
        <div className="space-y-6">
          {/* Agency Squads Header Banner */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.12), rgba(168, 85, 247, 0.1))',
              border: '1px solid rgba(16, 185, 129, 0.35)',
            }}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Agency Squad Structure
                </span>
                <span className="text-xs font-mono text-cyan-300">Cross-Departmental Collaboration</span>
              </div>
              <h2 className="text-xl font-bold text-white">Cross-Functional Agency Teams & Squads</h2>
              <p className="text-sm text-slate-300 max-w-2xl">
                Build real agency delivery teams by combining employees across different departments (e.g., Development, Marketing, Design), assigning a Team Lead, and linking client projects. Employees immediately see their squad and teammates in the Employee Portal.
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => openCreateTeamModal()}
              className="px-5 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 shrink-0"
              style={{
                background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                color: '#ffffff',
                boxShadow: '0 10px 25px -8px rgba(16, 185, 129, 0.6)',
              }}
            >
              <Plus className="size-4" />
              Create Cross-Departmental Team
            </motion.button>
          </motion.div>

          {teamsLoading && agencyTeams.length === 0 ? (
            <div className="p-10 rounded-2xl text-center text-slate-400 text-sm" style={AXIOM.containers.list}>
              Loading agency teams…
            </div>
          ) : agencyTeams.length === 0 ? (
            <div
              className="p-12 rounded-2xl text-center space-y-4"
              style={AXIOM.containers.list}
            >
              <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30">
                <GitBranch className="size-7 text-emerald-400" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-lg font-bold text-white">No Cross-Departmental Teams Yet</h3>
                <p className="text-xs text-slate-400">
                  Select employees across Development, Marketing, Design, and Operations to assemble your first agency delivery squad.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openCreateTeamModal()}
                className="px-5 py-2.5 rounded-xl text-xs font-mono font-bold text-white bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 transition-all"
              >
                + Make Your First Team
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {agencyTeams.map((team, idx) => {
                const depts = team.departments && team.departments.length > 0
                  ? team.departments
                  : Array.from(new Set((team.members || []).map((m) => m.department).filter(Boolean)));
                return (
                  <motion.div
                    key={team.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + idx * 0.05 }}
                    className="p-6 rounded-2xl flex flex-col justify-between space-y-5"
                    style={AXIOM.containers.list}
                  >
                    <div className="space-y-4">
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xl font-bold text-white">{team.name}</h3>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              {team.members?.length || team.memberIds?.length || 0} Members
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                              {depts.length} {depts.length === 1 ? 'Department' : 'Departments'}
                            </span>
                          </div>
                          {team.description && (
                            <p className="text-xs text-slate-400">{team.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditTeamModal(team)}
                            className="px-3 py-1.5 rounded-lg text-xs font-mono text-cyan-300 hover:bg-cyan-500/15 border border-cyan-500/30 flex items-center gap-1 transition-all"
                          >
                            <Edit className="size-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={deletingTeamId === team.id}
                            onClick={() => void handleDeleteTeam(team)}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/15 border border-red-500/30 transition-all disabled:opacity-50"
                            title="Delete team"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Linked Project & Squad Lead Banner */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div
                          className="p-3 rounded-xl"
                          style={{
                            background: 'rgba(168, 85, 247, 0.08)',
                            border: '1px solid rgba(168, 85, 247, 0.25)',
                          }}
                        >
                          <p className="text-[10px] font-mono uppercase tracking-wider text-purple-300/80 mb-0.5">
                            Assigned Project
                          </p>
                          <p className="text-sm font-semibold text-white truncate">
                            {team.projectName || 'General Agency Delivery'}
                          </p>
                        </div>
                        <div
                          className="p-3 rounded-xl"
                          style={{
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.25)',
                          }}
                        >
                          <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300/80 mb-0.5">
                            Squad / Team Lead
                          </p>
                          <p className="text-sm font-semibold text-white flex items-center gap-1.5 truncate">
                            <Crown className="size-3.5 text-amber-400 shrink-0" />
                            <span>{team.leadName || team.members?.[0]?.name || 'Assigned Lead'}</span>
                          </p>
                        </div>
                      </div>

                      {/* Departments Collaborating */}
                      <div>
                        <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                          Departments Collaborating ({depts.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {depts.map((dept) => (
                            <span
                              key={dept}
                              className="px-2.5 py-0.5 rounded-md text-xs font-mono text-cyan-200 bg-slate-800/90 border border-cyan-500/30"
                            >
                              {dept}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Squad Roster */}
                      <div>
                        <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2">
                          Team Members ({team.members?.length || 0})
                        </p>
                        <div className="space-y-2">
                          {(team.members || []).map((m) => (
                            <div
                              key={m.userId}
                              className="p-2.5 rounded-xl flex items-center justify-between gap-3"
                              style={AXIOM.containers.item}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className="size-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                                  style={{ background: m.isLead ? AXIOM.iconBoxes.amber : AXIOM.iconBoxes.blue }}
                                >
                                  {(m.name || '?')[0].toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-semibold text-white truncate">{m.name}</p>
                                    {m.isLead && (
                                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                        Team Lead
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-400 font-mono truncate">
                                    {m.role} • {m.email}
                                  </p>
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 bg-slate-800/80 border border-slate-700 shrink-0">
                                {m.department}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
                      <span>Visible in Employee Portal → Team Directory</span>
                      <button
                        type="button"
                        onClick={() => openEditTeamModal(team)}
                        className="text-emerald-400 hover:text-emerald-300 font-semibold"
                      >
                        Manage Roster →
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeView === 'announcements' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(168, 85, 247, 0.12), rgba(245, 158, 11, 0.08))',
              border: '1px solid rgba(59, 130, 246, 0.35)',
            }}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Employee Portal Broadcast
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {announcements.filter(a => a.isPinned).length} pinned · {announcements.length} total
                </span>
              </div>
              <h2 className="text-2xl font-bold text-white">Company News & Announcements</h2>
              <p className="text-sm text-slate-400 max-w-2xl mt-1">
                Publish company-wide news, HR policy updates, financial notes, and team recognitions. Published notices instantly appear on the Employee Portal (<span className="text-emerald-400 font-mono">/employee</span>).
              </p>
            </div>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openCreateAnnouncementModal}
              className="px-5 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 shrink-0 shadow-lg shadow-blue-500/20"
              style={AXIOM.buttons.primary}
            >
              <Plus className="size-4" />
              Post Announcement
            </motion.button>
          </motion.div>

          {/* Search & Category Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search announcements by title, content, or author..."
                value={announcementSearch}
                onChange={(e) => setAnnouncementSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {['all', 'general', 'hr', 'finance', 'project', 'celebration'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setAnnouncementCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                    announcementCategoryFilter === cat
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                      : 'bg-slate-900/50 text-slate-400 hover:text-white hover:bg-slate-800/60 border border-slate-800/80'
                  }`}
                >
                  {cat === 'all' ? 'All Categories' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Announcements List */}
          {announcementsLoading && announcements.length === 0 ? (
            <div className="p-10 rounded-2xl text-center text-slate-400 text-sm" style={AXIOM.containers.list}>
              Loading company announcements...
            </div>
          ) : announcements.length === 0 ? (
            <div className="p-12 rounded-2xl text-center space-y-4" style={AXIOM.containers.list}>
              <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-blue-500/15 border border-blue-500/30 text-blue-400">
                <Megaphone className="size-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">No Announcements Published Yet</h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                  Keep your entire workforce aligned. Post your first company announcement to broadcast news, policies, or project updates to the employee portal.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateAnnouncementModal}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
                style={AXIOM.buttons.primary}
              >
                <Plus className="size-4" />
                Post First Announcement
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {announcements
                .filter((a) => {
                  const matchQ =
                    !announcementSearch ||
                    a.title.toLowerCase().includes(announcementSearch.toLowerCase()) ||
                    a.content.toLowerCase().includes(announcementSearch.toLowerCase()) ||
                    a.author.toLowerCase().includes(announcementSearch.toLowerCase());
                  const matchC =
                    announcementCategoryFilter === 'all' ||
                    a.category.toLowerCase() === announcementCategoryFilter.toLowerCase();
                  return matchQ && matchC;
                })
                .map((ann, idx) => {
                  const isPinned = ann.isPinned;
                  const catColors: Record<string, { bg: string; text: string; border: string }> = {
                    general: { bg: 'rgba(148, 163, 184, 0.1)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.2)' },
                    hr: { bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.25)' },
                    finance: { bg: 'rgba(16, 185, 129, 0.1)', text: '#34d399', border: 'rgba(16, 185, 129, 0.25)' },
                    project: { bg: 'rgba(168, 85, 247, 0.1)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.25)' },
                    celebration: { bg: 'rgba(245, 158, 11, 0.1)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.25)' },
                  };
                  const cc = catColors[ann.category] || catColors.general;

                  return (
                    <motion.div
                      key={ann.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="p-5 rounded-2xl relative overflow-hidden transition-all group"
                      style={{
                        ...AXIOM.containers.list,
                        border: isPinned ? '1px solid rgba(245, 158, 11, 0.4)' : undefined,
                        boxShadow: isPinned ? '0 10px 30px -10px rgba(245, 158, 11, 0.15)' : undefined,
                      }}
                    >
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          {isPinned && (
                            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              <Pin className="size-3 fill-amber-300" />
                              Pinned
                            </span>
                          )}
                          <span
                            className="px-2.5 py-0.5 rounded-md text-xs font-mono font-medium capitalize"
                            style={{ background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}
                          >
                            {ann.category}
                          </span>
                          <span className="text-xs text-slate-500 font-mono">
                            {new Date(ann.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">by {ann.author}</span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 self-end md:self-auto">
                          <button
                            type="button"
                            onClick={() => handleTogglePinAnnouncement(ann)}
                            title={isPinned ? 'Unpin from top' : 'Pin to top of employee portal'}
                            className={`p-1.5 rounded-lg text-xs font-medium border transition-colors ${
                              isPinned
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-white'
                            }`}
                          >
                            {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditAnnouncementModal(ann)}
                            title="Edit announcement"
                            className="p-1.5 rounded-lg text-xs bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:text-white transition-colors"
                          >
                            <Edit className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAnnouncement(ann.id)}
                            title="Delete announcement"
                            className="p-1.5 rounded-lg text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>

                      <h3 className="text-base font-bold text-white mb-1.5">{ann.title}</h3>
                      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{ann.content}</p>
                    </motion.div>
                  );
                })}
            </div>
          )}

          {/* Post/Edit Announcement Dialog Modal */}
          <Dialog open={announcementModalOpen} onOpenChange={setAnnouncementModalOpen}>
            <DialogContent className="max-w-xl bg-slate-900 border border-slate-800 text-white rounded-2xl p-6 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                  <Megaphone className="size-5 text-blue-400" />
                  {editingAnnouncement ? 'Edit Company Announcement' : 'Post Company Announcement'}
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-400">
                  This announcement will be published to the Employee Portal (<span className="text-emerald-400 font-mono">/employee</span>) for all team members.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Announcement Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Q4 Town Hall & Financial Bonus Policy Update"
                    value={announcementTitle}
                    onChange={(e) => setAnnouncementTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                    <select
                      value={announcementCategory}
                      onChange={(e) => setAnnouncementCategory(e.target.value as any)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="general">General Update</option>
                      <option value="hr">HR & People Policies</option>
                      <option value="finance">Finance & Compensation</option>
                      <option value="project">Project & Milestones</option>
                      <option value="celebration">Celebration & Recognition</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Author Byline</label>
                    <input
                      type="text"
                      placeholder="e.g. Leadership / Management"
                      value={announcementAuthor}
                      onChange={(e) => setAnnouncementAuthor(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Announcement Body <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    rows={6}
                    placeholder="Write your company announcement here. Multi-paragraph notices and bullet points are preserved..."
                    value={announcementContent}
                    onChange={(e) => setAnnouncementContent(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="isPinnedCheck"
                    checked={announcementIsPinned}
                    onChange={(e) => setAnnouncementIsPinned(e.target.checked)}
                    className="size-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500/20"
                  />
                  <label htmlFor="isPinnedCheck" className="text-sm text-slate-300 cursor-pointer select-none flex items-center gap-1.5">
                    <Pin className="size-3.5 text-amber-400" />
                    Pin this announcement to top of the employee portal
                  </label>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setAnnouncementModalOpen(false)}
                  disabled={savingAnnouncement}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAnnouncement}
                  disabled={savingAnnouncement}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-lg shadow-blue-500/20"
                  style={AXIOM.buttons.primary}
                >
                  {savingAnnouncement && <Loader2 className="size-4 animate-spin" />}
                  {editingAnnouncement ? 'Save Changes' : 'Publish Announcement'}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {activeView === 'roles' && (
        <div className="space-y-4">
          {/* Role Definitions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {roleDefinitions.map((role, index) => (
              <motion.div
                key={role.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + index * 0.1 }}
                className="p-6 rounded-2xl"
                style={AXIOM.containers.list}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{
                        background: role.color === 'purple' ? AXIOM.iconBoxes.purple :
                          role.color === 'cyan' ? AXIOM.iconBoxes.cyan :
                            role.color === 'blue' ? AXIOM.iconBoxes.blue :
                              AXIOM.iconBoxes.green,
                        boxShadow: role.color === 'purple' ? AXIOM.shadows.iconPurple :
                          role.color === 'cyan' ? AXIOM.shadows.iconCyan :
                            role.color === 'blue' ? AXIOM.shadows.iconBlue :
                              AXIOM.shadows.iconGreen,
                      }}
                    >
                      {role.id === 'org_admin' && <Crown className="size-6 text-white" />}
                      {role.id === 'accountant' && <DollarSign className="size-6 text-white" />}
                      {role.id === 'team_member' && <Users className="size-6 text-white" />}
                      {role.id === 'viewer' && <Eye className="size-6 text-white" />}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">{role.name}</h3>
                      <p className="text-sm text-slate-400">{role.description}</p>
                    </div>
                  </div>
                  <span
                    className="px-3 py-1 rounded-lg text-xs font-medium"
                    style={AXIOM.badges.info}
                  >
                    {roleMemberCounts[role.id] ?? 0}{' '}
                    {(roleMemberCounts[role.id] ?? 0) === 1 ? 'member' : 'members'}
                  </span>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-slate-500 font-medium uppercase">Permissions</p>
                  {role.permissions.includes('all') ? (
                    <div className="p-3 rounded-lg" style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                      <div className="flex items-center gap-2">
                        <Unlock className="size-4 text-purple-400" />
                        <span className="text-sm text-purple-400 font-medium">Full Access - All Permissions</span>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {role.permissions.slice(0, 6).map((perm) => {
                        const permission = allPermissions.find(p => p.id === perm);
                        if (!permission) return null;
                        return (
                          <div
                            key={perm}
                            className="p-2 rounded-lg text-xs flex items-center gap-2"
                            style={AXIOM.containers.item}
                          >
                            <CheckCircle className="size-3 text-green-400" />
                            <span className="text-slate-300">{permission.name}</span>
                          </div>
                        );
                      })}
                      {role.permissions.length > 6 && (
                        <div className="p-2 rounded-lg text-xs flex items-center gap-2" style={AXIOM.containers.item}>
                          <span className="text-cyan-400">+{role.permissions.length - 6} more</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full mt-4 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                  style={AXIOM.buttons.secondary}
                  onClick={() => openEditRoleModal(role.id)}
                >
                  <Edit className="size-4" />
                  Edit Role Permissions
                </motion.button>
              </motion.div>
            ))}
          </div>

          {/* All Permissions Matrix */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <h3 className="text-xl font-bold text-white mb-4">All Permissions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {allPermissions.map((permission) => {
                const Icon = permission.icon;
                return (
                  <div
                    key={permission.id}
                    className="p-4 rounded-xl"
                    style={AXIOM.containers.item}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{
                          background: permission.category === 'financial' ? AXIOM.iconBoxes.green :
                            permission.category === 'team' ? AXIOM.iconBoxes.purple :
                              permission.category === 'settings' ? AXIOM.iconBoxes.amber :
                                AXIOM.iconBoxes.cyan,
                        }}
                      >
                        <Icon className="size-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">{permission.name}</p>
                        <p className="text-xs text-slate-400 mt-1">{permission.description}</p>
                        <span
                          className="inline-block mt-2 px-2 py-1 rounded text-xs"
                          style={{
                            background: permission.category === 'financial' ? 'rgba(16, 185, 129, 0.1)' :
                              permission.category === 'team' ? 'rgba(168, 85, 247, 0.1)' :
                                permission.category === 'settings' ? 'rgba(245, 158, 11, 0.1)' :
                                  'rgba(6, 182, 212, 0.1)',
                            color: permission.category === 'financial' ? '#10b981' :
                              permission.category === 'team' ? '#a855f7' :
                                permission.category === 'settings' ? '#f59e0b' :
                                  '#06b6d4',
                          }}
                        >
                          {permission.category}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {activeView === 'activity' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-white">Recent Activity</h3>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <Filter className="size-4" />
              Filter
            </motion.button>
          </div>

          <div className="space-y-3">
            {activityLog.map((activity) => (
              <div
                key={activity.id}
                className="p-4 rounded-xl flex items-start gap-4"
                style={AXIOM.containers.item}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: activity.type === 'invite' ? AXIOM.iconBoxes.cyan :
                      activity.type === 'permission' ? AXIOM.iconBoxes.purple :
                        activity.type === 'role' ? AXIOM.iconBoxes.amber :
                          AXIOM.iconBoxes.green,
                    boxShadow: activity.type === 'invite' ? AXIOM.shadows.iconCyan :
                      activity.type === 'permission' ? AXIOM.shadows.iconPurple :
                        activity.type === 'role' ? AXIOM.shadows.iconAmber :
                          AXIOM.shadows.iconGreen,
                  }}
                >
                  {activity.type === 'invite' && <Mail className="size-5 text-white" />}
                  {activity.type === 'permission' && <Shield className="size-5 text-white" />}
                  {activity.type === 'role' && <Crown className="size-5 text-white" />}
                  {activity.type === 'login' && <Activity className="size-5 text-white" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-medium">{activity.user}</p>
                      <p className="text-sm text-slate-400">{activity.action}</p>
                      <p className="text-xs text-slate-500 mt-1">{activity.details}</p>
                    </div>
                    <span className="text-xs text-slate-500">{formatDateTime(activity.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {activeView === 'invitations' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-white">Pending Invitations</h3>
              <p className="text-sm text-slate-400 mt-1">Team members awaiting acceptance</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setInviteDialogOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Plus className="size-4" />
              New Invite
            </motion.button>
          </div>

          <div className="space-y-3">
            {teamMembers.filter(m => m.status === 'pending').map((member) => (
              <div
                key={member.id}
                className="p-6 rounded-xl"
                style={AXIOM.containers.item}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{
                        background: AXIOM.iconBoxes.amber,
                        boxShadow: AXIOM.shadows.iconAmber,
                      }}
                    >
                      <span className="text-white font-bold text-lg">{(member.name || '?')[0]}</span>
                    </div>
                    <div>
                      <p className="text-white font-medium">{member.name}</p>
                      <p className="text-sm text-slate-400">{member.email}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span
                          className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                          style={getRoleBadge(member.role)}
                        >
                          {getRoleIcon(member.role)}
                          {member.role.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-slate-500">
                          Invited {member.joinedDate ? formatDate(member.joinedDate) : 'recently'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                      style={AXIOM.buttons.secondary}
                      onClick={async () => {
                        try {
                          const res = await authService.resendInvite(orgId, member.id);
                          if (res.success) {
                            const link = (res.data as any)?.acceptInviteUrl || (res.data as any)?.previewUrl;
                            if (link && navigator.clipboard) {
                              try { await navigator.clipboard.writeText(link); } catch { }
                              toast.success(`Invitation email sent via Supabase! Link copied to clipboard.`);
                            } else {
                              toast.success(`Invitation email sent to ${member.email}`);
                            }
                          } else {
                            toast.error(res.error || 'Failed to resend invitation');
                          }
                        } catch {
                          toast.error('Failed to resend invitation');
                        }
                      }}
                    >
                      <Mail className="size-4" />
                      Resend
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                      style={AXIOM.buttons.danger}
                      onClick={async () => {
                        if (!window.confirm(`Cancel invitation for ${member.email}?`)) return;
                        try {
                          const res = await organizationService.removeMember(orgId, member.id);
                          if (res.success) {
                            toast.success(`Invitation cancelled for ${member.email}`);
                            await refetchMembers();
                          } else {
                            toast.error(res.error || 'Failed to cancel invitation');
                          }
                        } catch {
                          toast.error('Failed to cancel invitation');
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                      Cancel
                    </motion.button>

                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}


      <Dialog
        open={inviteDialogOpen}
        onOpenChange={(open) => {
          setInviteDialogOpen(open);
          if (!open) {
            setInviteModalError(null);
            setInviteModalSuccess(null);
            setBulkResults(null);
          }
        }}
      >
        <DialogContent className={inviteMode === 'bulk' ? "sm:max-w-4xl max-h-[90vh] flex flex-col p-6" : "sm:max-w-lg max-h-[90vh] flex flex-col p-6"}>
          {/* Datalists for custom typing & auto-complete */}
          <datalist id="role-presets">
            {ROLE_SUGGESTIONS.map(r => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <datalist id="dept-presets">
            {availableDepartments.map(d => (
              <option key={d.id} value={d.name} />
            ))}
          </datalist>

          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="size-5 text-emerald-400" />
                  Invite Team Members
                </DialogTitle>
                <DialogDescription className="text-slate-400 text-xs mt-0.5">
                  Send invitations with custom roles and departments to join through the Employee Portal.
                </DialogDescription>
              </div>
            </div>

            {/* Mode Toggle Switcher */}
            <div className="flex gap-2 p-1 bg-slate-900/80 border border-slate-800 rounded-xl mt-3">
              <button
                type="button"
                onClick={() => { setInviteMode('single'); setInviteModalError(null); setInviteModalSuccess(null); }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-medium transition-all ${inviteMode === 'single'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                Single Invite
              </button>
              <button
                type="button"
                onClick={() => { setInviteMode('bulk'); setInviteModalError(null); setInviteModalSuccess(null); }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-medium transition-all ${inviteMode === 'bulk'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                Bulk Invite ({bulkRows.filter(r => r.email.trim()).length || bulkRows.length} rows)
              </button>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-3 overflow-y-auto flex-1 pr-1">
            {inviteModalSuccess && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs">
                <CheckCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-emerald-200">Success!</p>
                  <p className="text-emerald-300/90 mt-0.5">{inviteModalSuccess}</p>
                </div>
              </div>
            )}
            {inviteModalError && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-rose-200">Could not send invite</p>
                  <p className="text-rose-300/90 mt-0.5">{inviteModalError}</p>
                </div>
              </div>
            )}

            {/* ── Single Invite Mode ────────────────────────────────────────── */}
            {inviteMode === 'single' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 font-mono font-medium">Email Address <span className="text-rose-400">*</span></label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="e.g. employee@company.com"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-300 font-mono font-medium">Full Name (optional)</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="e.g. Sarah Connor"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                {/* Access Role Dropdown */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-300 font-mono font-medium">Access Role <span className="text-rose-400">*</span></label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  >
                    <option value="employee">Team Member</option>
                    <option value="accountant">Accountant</option>
                    <option value="admin">Organization Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <p className="text-xs text-slate-500">Controls what features they can access</p>
                </div>

                {/* Position / Job Title Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-300 font-mono font-medium">Position / Job Title <span className="text-slate-500 font-normal">(optional)</span></label>
                  </div>
                  <input
                    type="text"
                    value={invitePosition}
                    onChange={(e) => setInvitePosition(e.target.value)}
                    placeholder="e.g. UI/UX Designer, Senior Developer, Marketing Manager..."
                    className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {['UI/UX Designer', 'Senior Developer', 'Frontend Engineer', 'Backend Engineer', 'Product Manager', 'Marketing Manager'].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setInvitePosition(r)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all ${invitePosition === r
                          ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                          : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                          }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">Displayed in team directory and profiles</p>
                </div>

                {/* Editable / Typeable Department Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-300 font-mono font-medium">
                      Department <span className="text-slate-500 font-normal">(select from organization or type custom)</span>
                    </label>
                    {orgDepartments.length > 0 && (
                      <span className="text-[11px] text-cyan-400 font-mono">
                        {orgDepartments.length} org department{orgDepartments.length > 1 ? 's' : ''} available
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    list="dept-presets"
                    value={inviteDepartment}
                    onChange={(e) => setInviteDepartment(e.target.value)}
                    placeholder="Select or type department (e.g. Development Department)..."
                    className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {availableDepartments.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setInviteDepartment(d.name)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${inviteDepartment.toLowerCase() === d.name.toLowerCase()
                          ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/60 shadow-sm'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60'
                          }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        {d.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Directly links team member to count toward that department's headcount for overhead allocation.
                  </p>
                </div>
              </div>
            )}

            {/* ── Bulk Invite Mode ─────────────────────────────────────────── */}
            {inviteMode === 'bulk' && (
              <div className="space-y-4">
                {/* Quick Paste Box */}
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-cyan-300 flex items-center gap-1.5">
                      <Mail className="size-3.5" /> Quick Paste Multiple Emails
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">Separated by comma, newline, or space</span>
                  </div>
                  <textarea
                    rows={2}
                    value={bulkPasteText}
                    onChange={(e) => setBulkPasteText(e.target.value)}
                    placeholder="e.g. alex@company.com, maria@company.com, john@company.com..."
                    className="w-full px-3 py-2 rounded-lg text-xs text-white font-mono resize-none"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => parsePastedEmails(bulkPasteText)}
                      disabled={!bulkPasteText.trim()}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40"
                    >
                      <Plus className="size-3.5" />
                      Add Emails to List
                    </button>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {bulkRows.filter(r => r.email.trim()).length} member(s) ready
                    </span>
                  </div>
                </div>

                {/* Bulk Default Fill Toolbar */}
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/90 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-300 font-mono font-medium">Apply defaults to all rows:</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={bulkDefaultRole}
                        onChange={(e) => setBulkDefaultRole(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-white font-mono bg-slate-800 border border-slate-700"
                      >
                        {ROLE_SUGGESTIONS.map((r) => (
                          <option key={r} value={r} className="bg-slate-900 text-white">
                            {r}
                          </option>
                        ))}
                      </select>
                      <select
                        value={bulkDefaultDept}
                        onChange={(e) => setBulkDefaultDept(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-white font-mono bg-slate-800 border border-slate-700"
                      >
                        {availableDepartments.map((d) => (
                          <option key={d.id} value={d.name} className="bg-slate-900 text-white">
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={applyDefaultsToAllRows}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-mono font-semibold border border-cyan-500/40 transition-all shadow-sm"
                      >
                        Apply to All
                      </button>
                    </div>
                  </div>

                  {/* Quick Role Preset Chips for Bulk Defaults */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-500 font-mono">Quick Roles:</span>
                    {['Team Member', 'Senior Developer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Developer', 'UI/UX Designer', 'Accountant', 'Organization Admin', 'Viewer'].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          setBulkDefaultRole(r);
                          setBulkRows(prev => prev.map(row => ({ ...row, role: r })));
                          toast.success(`Set all rows role to "${r}"`);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${bulkDefaultRole === r
                          ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                          : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                          }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  {/* Quick Dept Preset Chips for Bulk Defaults */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 font-mono">Org Depts:</span>
                    {availableDepartments.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          setBulkDefaultDept(d.name);
                          setBulkRows(prev => prev.map(row => ({ ...row, department: d.name })));
                          toast.success(`Set all rows department to "${d.name}"`);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all flex items-center gap-1 ${bulkDefaultDept.toLowerCase() === d.name.toLowerCase()
                          ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                          }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        {d.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Multi-Row Grid Table */}
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-[11px] font-mono text-slate-400 font-semibold">
                    <div className="col-span-4">Email Address *</div>
                    <div className="col-span-3">Full Name</div>
                    <div className="col-span-2">Role (All Options)</div>
                    <div className="col-span-2">Department</div>
                    <div className="col-span-1 text-center">Action</div>
                  </div>

                  <div className="divide-y divide-slate-800/60 max-h-60 overflow-y-auto">
                    {bulkRows.map((row, idx) => (
                      <div key={row.id} className="grid grid-cols-12 gap-2 px-3 py-2 items-center hover:bg-white/[0.02]">
                        <div className="col-span-4">
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => updateBulkRow(row.id, 'email', e.target.value)}
                            placeholder={`user${idx + 1}@company.com`}
                            className="w-full px-2.5 py-1.5 rounded text-xs text-white font-mono"
                            style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => updateBulkRow(row.id, 'name', e.target.value)}
                            placeholder="Name..."
                            className="w-full px-2.5 py-1.5 rounded text-xs text-white font-mono"
                            style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                          />
                        </div>
                        <div className="col-span-2">
                          <select
                            value={row.role}
                            onChange={(e) => updateBulkRow(row.id, 'role', e.target.value)}
                            className="w-full px-2 py-1.5 rounded text-xs text-white font-mono"
                            style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                          >
                            {ROLE_SUGGESTIONS.map((r) => (
                              <option key={r} value={r} className="bg-slate-900 text-white">
                                {r}
                              </option>
                            ))}
                            {!ROLE_SUGGESTIONS.includes(row.role) && row.role && (
                              <option value={row.role} className="bg-slate-900 text-white">
                                {row.role} (Custom)
                              </option>
                            )}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <select
                            value={row.department}
                            onChange={(e) => updateBulkRow(row.id, 'department', e.target.value)}
                            className="w-full px-2 py-1.5 rounded text-xs text-white font-mono"
                            style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                          >
                            {availableDepartments.map((d) => (
                              <option key={d.id} value={d.name} className="bg-slate-900 text-white">
                                {d.name}
                              </option>
                            ))}
                            {!availableDepartments.some(d => d.name.toLowerCase() === (row.department || '').toLowerCase()) && row.department && (
                              <option value={row.department} className="bg-slate-900 text-white">
                                {row.department} (Custom)
                              </option>
                            )}
                          </select>
                        </div>
                        <div className="col-span-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeBulkRow(row.id)}
                            disabled={bulkRows.length <= 1}
                            className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-30"
                            title="Remove row"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-2.5 bg-slate-900/50 border-t border-slate-800 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={addBulkRow}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-medium flex items-center gap-1.5 transition-all"
                    >
                      <Plus className="size-3.5" /> Add Another Row
                    </button>
                    <span className="text-xs font-mono text-slate-400">
                      {bulkRows.filter(r => r.email.trim()).length} of {bulkRows.length} rows valid
                    </span>
                  </div>
                </div>

                {/* Detailed Bulk Results Recap */}
                {bulkResults && (
                  <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-semibold text-white">Batch Results Summary:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">{bulkResults.successful} sent</span>
                        {bulkResults.failed > 0 && <span className="text-rose-400 font-bold">{bulkResults.failed} failed</span>}
                      </div>
                    </div>
                    <div className="max-h-32 overflow-y-auto divide-y divide-slate-800/40 text-xs font-mono">
                      {bulkResults.results.map((resItem, i) => (
                        <div key={i} className="py-1 flex items-center justify-between">
                          <span className="text-slate-300">{resItem.email}</span>
                          {resItem.success ? (
                            <span className="text-emerald-400 text-[11px] flex items-center gap-1">
                              <CheckCircle className="size-3" /> Sent
                            </span>
                          ) : (
                            <span className="text-rose-400 text-[11px] flex items-center gap-1">
                              <AlertCircle className="size-3" /> {resItem.error || 'Failed'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-2 pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              onClick={() => setInviteDialogOpen(false)}
              className="px-4 py-2 rounded-lg text-slate-400 text-sm font-mono"
              style={AXIOM.buttons.outline}
            >
              Cancel
            </button>
            {inviteMode === 'single' ? (
              <button
                onClick={() => void handleInvite()}
                disabled={inviteMutation.loading || (orgMemberRows || []).length >= maxSeatsAllowed}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-mono font-medium disabled:opacity-50 transition-all shadow-md shadow-emerald-500/20"
                style={AXIOM.buttons.success}
              >
                {inviteMutation.loading ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Send Invitation
              </button>
            ) : (
              <button
                onClick={() => void handleBulkInvite()}
                disabled={bulkIsSubmitting || bulkRows.filter(r => r.email.trim()).length === 0 || (orgMemberRows || []).length >= maxSeatsAllowed}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-mono font-medium disabled:opacity-50 transition-all shadow-md shadow-cyan-500/20 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
              >
                {bulkIsSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
                Send {bulkRows.filter(r => r.email.trim()).length || ''} Bulk Invites
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Role Permissions Dialog ───────────────────────────── */}
      {/* ── Create / Edit Cross-Departmental Agency Team Dialog ── */}
      <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
        <DialogContent
          className="sm:max-w-[680px] border max-h-[90vh] overflow-y-auto"
          style={{
            background: '#0f172a',
            borderColor: 'rgba(16, 185, 129, 0.35)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
          }}
        >
          <DialogHeader className="space-y-2 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                }}
              >
                <GitBranch className="size-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold text-white">
                  {editingTeam ? `Edit Team: ${editingTeam.name}` : 'Create Cross-Departmental Agency Team'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Select employees across different departments, assign a Squad Lead, and link an agency project.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 py-3">
            {/* Team Name & Linked Project */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate-300 mb-1.5">
                  Team / Squad Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Finance OS Product Squad"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate-300 mb-1.5">
                  Linked Agency Project
                </label>
                <select
                  value={teamProjectId}
                  onChange={(e) => setTeamProjectId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white font-mono"
                  style={{
                    background: AXIOM.inputs.background,
                    border: AXIOM.inputs.border,
                  }}
                >
                  <option value="" className="bg-slate-900 text-slate-300">
                    General / Multi-Project Squad
                  </option>
                  {orgProjects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                      {p.name} {p.clientName ? `(${p.clientName})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mission / Description */}
            <div>
              <label className="block text-xs font-mono uppercase text-slate-300 mb-1.5">
                Team Mission & Responsibilities
              </label>
              <input
                type="text"
                placeholder="e.g. Cross-functional engineering & marketing growth delivery squad"
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>

            {/* Select Employees Across Departments */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-mono uppercase text-slate-300">
                  Select Employees Across Departments ({teamMemberIds.length} selected)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTeamDeptFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all ${
                      teamDeptFilter === 'ALL'
                        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50'
                        : 'bg-slate-800/80 text-slate-400 border border-slate-700'
                    }`}
                  >
                    All Depts
                  </button>
                  {Array.from(
                    new Set(
                      teamMembers
                        .filter((m) => m.orgRole !== 'owner')
                        .map((m) => m.department || 'Development'),
                    ),
                  ).map((dept) => (
                    <button
                      key={dept}
                      type="button"
                      onClick={() => setTeamDeptFilter(dept)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all ${
                        teamDeptFilter === dept
                          ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50'
                          : 'bg-slate-800/80 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {dept}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                {teamMembers
                  .filter((m) => m.orgRole !== 'owner')
                  .filter((m) => teamDeptFilter === 'ALL' || (m.department || 'Development') === teamDeptFilter)
                  .map((emp) => {
                    const isSelected = teamMemberIds.includes(emp.id);
                    const isLead = teamLeadUserId === emp.id;
                    return (
                      <div
                        key={emp.id}
                        onClick={() => toggleTeamMemberSelection(emp.id)}
                        className="p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3"
                        style={{
                          background: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(15, 23, 42, 0.7)',
                          border: isSelected
                            ? '1px solid rgba(16, 185, 129, 0.5)'
                            : '1px solid rgba(148, 163, 184, 0.15)',
                        }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-emerald-500 text-slate-950 font-bold'
                                : 'border border-slate-600 bg-slate-800'
                            }`}
                          >
                            {isSelected && <Check className="size-3.5 stroke-[3]" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-white truncate">{emp.name}</p>
                              {isLead && isSelected && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  Lead
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-cyan-300 font-mono truncate">
                              {emp.customRole || 'Team Member'}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono truncate">
                              {emp.department || 'Development'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Team Lead Selector & Cross-Department Summary */}
            {teamMemberIds.length > 0 && (
              <div
                className="p-4 rounded-xl space-y-3"
                style={{
                  background: 'rgba(6, 182, 212, 0.07)',
                  border: '1px solid rgba(6, 182, 212, 0.25)',
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Crown className="size-4 text-amber-400" />
                      Designate Squad / Team Lead
                    </p>
                    <p className="text-[11px] text-slate-400">
                      The Team Lead coordinates deliverables across departments for this squad.
                    </p>
                  </div>
                  <select
                    value={teamLeadUserId || teamMemberIds[0] || ''}
                    onChange={(e) => setTeamLeadUserId(e.target.value)}
                    className="px-3 py-2 rounded-lg text-xs text-white font-mono"
                    style={{
                      background: AXIOM.inputs.background,
                      border: AXIOM.inputs.border,
                    }}
                  >
                    {teamMemberIds.map((uid) => {
                      const emp = teamMembers.find((m) => m.id === uid);
                      if (!emp) return null;
                      return (
                        <option key={uid} value={uid} className="bg-slate-900 text-white">
                          {emp.name} ({emp.department || 'Development'})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono text-emerald-300">
                  <span>
                    Squad Composition: {teamMemberIds.length} member(s) across{' '}
                    {
                      new Set(
                        teamMemberIds
                          .map((uid) => teamMembers.find((m) => m.id === uid)?.department)
                          .filter(Boolean),
                      ).size
                    }{' '}
                    department(s)
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setTeamDialogOpen(false)}
              className="px-4 py-2 rounded-lg text-slate-400 text-sm font-mono hover:text-white"
              style={AXIOM.buttons.outline}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingTeam}
              onClick={() => void handleSaveTeam()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-mono font-semibold disabled:opacity-50 bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 shadow-lg shadow-emerald-500/20"
            >
              {savingTeam ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {editingTeam ? 'Save Team Changes' : 'Create Agency Team'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Role Permissions Dialog ───────────────────────────── */}
      <Dialog open={editRoleDialogOpen} onOpenChange={setEditRoleDialogOpen}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto p-6"
          style={{
            background: '#090d16',
            border: '1px solid rgba(148, 163, 184, 0.15)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          }}
        >
          <DialogHeader className="space-y-2 pb-4 border-b border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      selectedRoleForEdit === 'org_admin' ? AXIOM.iconBoxes.purple :
                        selectedRoleForEdit === 'accountant' ? AXIOM.iconBoxes.cyan :
                          selectedRoleForEdit === 'team_member' ? AXIOM.iconBoxes.blue :
                            AXIOM.iconBoxes.green,
                  }}
                >
                  <Shield className="size-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                    Edit Role: {roleDefinitions.find(r => r.id === selectedRoleForEdit)?.name || selectedRoleForEdit}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-400">
                    Customize granted permissions for this role across your organization
                  </DialogDescription>
                </div>
              </div>

              {selectedRoleForEdit !== 'org_admin' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllPermissions}
                    className="px-2.5 py-1 rounded-lg text-xs font-mono text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/30 transition-all"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPermissionsToDefault}
                    className="px-2.5 py-1 rounded-lg text-xs font-mono text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700 transition-all flex items-center gap-1"
                    title="Reset to default role permissions"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                </div>
              )}
            </div>

            {selectedRoleForEdit === 'org_admin' && (
              <div
                className="p-3 rounded-xl flex items-start gap-2.5 text-xs text-purple-300"
                style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)' }}
              >
                <Crown className="size-4 flex-shrink-0 text-purple-400 mt-0.5" />
                <span>
                  Organization Admins have unrestricted system access to ensure organization management and prevent administrative lockout.
                </span>
              </div>
            )}
          </DialogHeader>

          {/* Permissions Grouped by Category */}
          <div className="space-y-5 py-4">
            {(['financial', 'data', 'team', 'settings'] as const).map((catKey) => {
              const catTitle =
                catKey === 'financial' ? 'Financial Management' :
                  catKey === 'data' ? 'Data & Statements' :
                    catKey === 'team' ? 'Team & Access Control' :
                      'Workspace Settings';

              const catPerms = allPermissions.filter(p => p.category === catKey);
              if (catPerms.length === 0) return null;

              return (
                <div key={catKey} className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-slate-400">
                    <span>{catTitle}</span>
                    <span className="text-[11px] text-slate-500">
                      {catPerms.filter(p => selectedRoleForEdit === 'org_admin' || editingPermissions.includes(p.id)).length} of {catPerms.length} active
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {catPerms.map((perm) => {
                      const Icon = perm.icon;
                      const isChecked = selectedRoleForEdit === 'org_admin' || editingPermissions.includes(perm.id);
                      const isLockedAdmin = selectedRoleForEdit === 'org_admin';

                      return (
                        <div
                          key={perm.id}
                          onClick={() => {
                            if (!isLockedAdmin) togglePermission(perm.id);
                          }}
                          className={`p-3 rounded-xl flex items-start gap-3 transition-all ${isLockedAdmin
                            ? 'cursor-not-allowed opacity-80'
                            : 'cursor-pointer hover:border-slate-600'
                            }`}
                          style={{
                            background: isChecked ? 'rgba(6, 182, 212, 0.08)' : 'rgba(15, 23, 42, 0.6)',
                            border: isChecked
                              ? '1px solid rgba(6, 182, 212, 0.4)'
                              : '1px solid rgba(148, 163, 184, 0.12)',
                          }}
                        >
                          <div
                            className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${isChecked
                              ? 'bg-cyan-500 text-slate-950 font-bold'
                              : 'border border-slate-600 bg-slate-800'
                              }`}
                          >
                            {isChecked && <Check className="size-3.5 stroke-[3]" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Icon className="size-3.5 text-slate-400 flex-shrink-0" />
                              <span className="text-xs font-semibold text-white truncate">
                                {perm.name}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                              {perm.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="mt-2 pt-4 border-t border-slate-800 flex items-center justify-between">
            <div className="text-xs font-mono text-slate-400">
              {selectedRoleForEdit === 'org_admin'
                ? 'All permissions active'
                : `${editingPermissions.length} of ${allPermissions.length} permissions granted`}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditRoleDialogOpen(false)}
                className="px-4 py-2 rounded-lg text-slate-400 text-sm font-mono hover:text-white transition-colors"
                style={AXIOM.buttons.outline}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRolePermissions()}
                disabled={savingRolePermissions}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-mono font-medium disabled:opacity-50 transition-all shadow-md shadow-cyan-500/20 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
              >
                {savingRolePermissions ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Save Permissions
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}