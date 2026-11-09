import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import {
  Users,
  Search,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Building2,
  Check,
  X,
  Sparkles,
  GitBranch,
  Crown,
  FolderKanban,
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { organizationService, type AgencyTeam } from '@/services/organizationService';
import { useAuth } from '@/contexts/AuthContext';
import { useService, useServiceArray } from '@/hooks/useService';
import { toast } from 'sonner';

export function TeamDirectory() {
  const { currentOrganization, user, membership, acceptInvite, declineInvite } = useAuth();
  const orgId = currentOrganization?.id || '';
  const [isProcessing, setIsProcessing] = useState(false);

  // Service-backed team directory
  const { data: svcTeam, loading, error, refetch } = useService(
    () => (orgId ? employeeService.getTeamDirectory(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId],
  );

  // Cross-departmental agency teams / squads
  const {
    data: agencyTeams = [],
    loading: teamsLoading,
    refetch: refetchTeams,
  } = useServiceArray(
    () => (orgId ? organizationService.getTeams(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId],
    ['agency_teams', orgId],
  );

  const isPending = membership?.status === 'pending';

  const handleAccept = async () => {
    if (!currentOrganization || !user) return;
    setIsProcessing(true);
    try {
      const res = await acceptInvite(currentOrganization.id, user.id);
      if (res.success) {
        toast.success('Invitation accepted! You are now an active team member.');
        await Promise.all([refetch(), refetchTeams()]);
      } else {
        toast.error(res.error || 'Failed to accept invitation');
      }
    } catch {
      toast.error('Failed to accept invitation');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!currentOrganization || !user) return;
    if (!window.confirm('Are you sure you want to decline this organization invitation?')) return;
    setIsProcessing(true);
    try {
      const res = await declineInvite(currentOrganization.id, user.id);
      if (res.success) {
        toast.info('Invitation declined');
      } else {
        toast.error(res.error || 'Failed to decline invitation');
      }
    } catch {
      toast.error('Failed to decline invitation');
    } finally {
      setIsProcessing(false);
    }
  };

  const [activeTab, setActiveTab] = useState<'my_teams' | 'directory' | 'all_squads'>('my_teams');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');

  const teamMembers = useMemo(() => {
    return (svcTeam ?? []).map((m: any, i: number) => {
      const rawName = (m.name || m.email?.split('@')[0] || 'Member').trim();
      const initials =
        rawName
          .split(/\s+/)
          .filter(Boolean)
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2) || '?';

      const isOwnerRole =
        String(m.role || '').toLowerCase().includes('owner') ||
        String(m.orgRole || '').toLowerCase() === 'owner';

      return {
        id: m.id || `tm-${i}`,
        userId: m.userId || m.id || `tm-${i}`,
        name: rawName,
        email: m.email || '',
        role: isOwnerRole ? 'Organization Owner' : m.role || 'Team Member',
        department: isOwnerRole ? m.department || 'Management' : m.department || 'Development',
        avatar: initials,
        color: ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#f97316'][i % 8],
        phone: String((m as any).phone || '').trim(),
        location: '',
        status: m.status || 'active',
        isPending: m.status === 'pending' || Boolean(m.isPending),
      };
    });
  }, [svcTeam]);

  // Identify the logged-in employee's assigned cross-departmental teams
  const myTeams: AgencyTeam[] = useMemo(() => {
    if (!user) return [];
    const myEmail = (user.email || '').toLowerCase().trim();
    return (agencyTeams || []).filter((t) => {
      if ((t.memberIds || []).includes(user.id)) return true;
      return (t.members || []).some(
        (m) => m.userId === user.id || (myEmail && (m.email || '').toLowerCase().trim() === myEmail),
      );
    });
  }, [agencyTeams, user]);

  // Dynamic department list from real organization members
  const departments = useMemo(() => {
    const depts = new Set<string>(['All']);
    for (const m of teamMembers) {
      if (m.department) depts.add(m.department);
    }
    return Array.from(depts);
  }, [teamMembers]);

  const filtered = teamMembers.filter((m) => {
    if (selectedDept !== 'All' && (m.department || '').toLowerCase() !== selectedDept.toLowerCase()) return false;
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const nameMatch = (m.name || '').toLowerCase().includes(q);
      const roleMatch = (m.role || '').toLowerCase().includes(q);
      const emailMatch = (m.email || '').toLowerCase().includes(q);
      const deptMatch = (m.department || '').toLowerCase().includes(q);
      if (!nameMatch && !roleMatch && !emailMatch && !deptMatch) return false;
    }
    return true;
  });

  const renderSquadCard = (team: AgencyTeam, isMySquad: boolean, idx: number) => {
    const depts =
      team.departments && team.departments.length > 0
        ? team.departments
        : Array.from(new Set((team.members || []).map((m) => m.department).filter(Boolean)));
    const myEmail = (user?.email || '').toLowerCase().trim();

    return (
      <motion.div
        key={team.id}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 * idx }}
        className="rounded-2xl p-6 space-y-5 relative overflow-hidden"
        style={{
          background: AXIOM.backgrounds.chartContainer,
          border: isMySquad ? '1px solid rgba(16, 185, 129, 0.45)' : AXIOM.borders.default,
          boxShadow: isMySquad ? '0 15px 35px -15px rgba(16, 185, 129, 0.25)' : undefined,
        }}
      >
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{
            background: isMySquad
              ? 'linear-gradient(90deg, #10b981, #06b6d4, #a855f7)'
              : 'linear-gradient(90deg, #3b82f6, #a855f7)',
          }}
        />

        {/* Squad Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="size-9 rounded-xl flex items-center justify-center bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                <GitBranch className="size-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-white">{team.name}</h3>
                  {isMySquad && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Your Team
                    </span>
                  )}
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    {depts.length} {depts.length === 1 ? 'Department' : 'Departments'}
                  </span>
                </div>
                {team.description && (
                  <p className="text-xs text-slate-400 mt-0.5">{team.description}</p>
                )}
              </div>
            </div>
          </div>
          <span className="px-3 py-1 rounded-lg text-xs font-mono text-slate-300 bg-slate-800/80 border border-slate-700">
            {team.members?.length || 0} {team.members?.length === 1 ? 'Member' : 'Members'}
          </span>
        </div>

        {/* Project & Squad Lead Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className="p-3.5 rounded-xl flex items-center gap-3"
            style={{
              background: 'rgba(168, 85, 247, 0.08)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
            }}
          >
            <FolderKanban className="size-5 text-purple-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-purple-300/80">
                Assigned Project
              </p>
              <p className="text-sm font-bold text-white truncate">
                {team.projectName || 'Multi-Project Agency Squad'}
              </p>
            </div>
          </div>

          <div
            className="p-3.5 rounded-xl flex items-center gap-3"
            style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
            }}
          >
            <Crown className="size-5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300/80">
                Team / Squad Lead
              </p>
              <p className="text-sm font-bold text-white truncate">
                {team.leadName || team.members?.[0]?.name || 'Assigned Lead'}
              </p>
            </div>
          </div>
        </div>

        {/* Cross-Departmental Diversity Badges */}
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
            Departments Collaborating in this Team
          </p>
          <div className="flex flex-wrap gap-1.5">
            {depts.map((d) => (
              <span
                key={d}
                className="px-2.5 py-1 rounded-md text-xs font-mono text-cyan-200 bg-slate-800/90 border border-cyan-500/30 flex items-center gap-1.5"
              >
                <Building2 className="size-3 text-cyan-400" />
                {d}
              </span>
            ))}
          </div>
        </div>

        {/* Squad Members Roster */}
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2.5">
            Squad Members ({team.members?.length || 0})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(team.members || []).map((m, mIdx) => {
              const isMe =
                m.userId === user?.id ||
                (myEmail && (m.email || '').toLowerCase().trim() === myEmail);
              const initials =
                (m.name || 'M')
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2) || '?';
              const color = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#06b6d4', '#ec4899'][mIdx % 6];

              return (
                <div
                  key={m.userId}
                  className="p-3.5 rounded-xl flex items-center justify-between gap-3"
                  style={{
                    background: isMe ? 'rgba(16, 185, 129, 0.1)' : 'rgba(15, 23, 42, 0.65)',
                    border: isMe
                      ? '1px solid rgba(16, 185, 129, 0.4)'
                      : '1px solid rgba(148, 163, 184, 0.14)',
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="size-10 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${color}, ${color}aa)`,
                      }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-bold text-white truncate">{m.name}</p>
                        {isMe && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40">
                            You
                          </span>
                        )}
                        {m.isLead && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            Lead
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-cyan-300 font-mono truncate">{m.role}</p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">{m.department}</p>
                    </div>
                  </div>

                  {m.email && (
                    <a
                      href={`mailto:${m.email}`}
                      title={`Email ${m.name} (${m.email})`}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-blue-300 hover:bg-blue-500/20 border border-blue-500/30 shrink-0 flex items-center gap-1 transition-all"
                    >
                      <Mail className="size-3.5" />
                      Email
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="p-8 space-y-8 h-full overflow-y-auto" style={{ background: AXIOM.backgrounds.main }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>
            My Teams & Agency Directory
          </h1>
          <p className="text-slate-400 font-mono text-sm">
            {loading && svcTeam === null
              ? 'Loading directory…'
              : `${myTeams.length} assigned squad(s) • ${teamMembers.length} organization members`}
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex flex-wrap gap-2 p-1.5 rounded-xl" style={AXIOM.containers.list}>
          <button
            type="button"
            onClick={() => setActiveTab('my_teams')}
            className="px-4 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all"
            style={activeTab === 'my_teams' ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
          >
            <GitBranch className="size-3.5" />
            My Squads ({myTeams.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('directory')}
            className="px-4 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all"
            style={activeTab === 'directory' ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
          >
            <Building2 className="size-3.5" />
            People Directory ({teamMembers.length})
          </button>
        </div>
      </motion.div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-amber-200 text-sm font-mono border border-amber-500/30"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}
        >
          {error}
        </div>
      )}

      <AnimatePresence>
        {isPending && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="p-6 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-teal-500/20 to-cyan-500/20 border-2 border-emerald-500/50 backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-emerald-500/20"
          >
            <div className="flex items-start gap-4">
              <div className="size-12 rounded-2xl bg-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0 shadow-lg shadow-emerald-500/30 border border-emerald-500/40">
                <Sparkles className="size-6 text-emerald-300 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-white text-lg font-bold">Organization Invitation</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Awaiting Response
                  </span>
                </div>
                <p className="text-slate-200 text-sm">
                  You have been invited to join{' '}
                  <strong className="text-emerald-300">{currentOrganization?.name || 'this organization'}</strong> in
                  the <span className="text-cyan-300 font-semibold font-mono">{membership?.department || 'Development'}</span>{' '}
                  department.
                </p>
                <p className="text-slate-400 text-xs font-mono">
                  Accept to unlock your team directory, timesheets, payslips, and collaborate with your coworkers.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
              <button
                onClick={handleAccept}
                disabled={isProcessing}
                className="flex-1 md:flex-none px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-sm font-bold font-mono flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/40 disabled:opacity-50 active:scale-95"
              >
                <Check className="size-4" />
                {isProcessing ? 'Accepting...' : 'Accept & Join Team'}
              </button>
              <button
                onClick={handleDecline}
                disabled={isProcessing}
                className="flex-1 md:flex-none px-5 py-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-sm font-bold font-mono flex items-center justify-center gap-2 transition-all disabled:opacity-50 active:scale-95"
              >
                <X className="size-4" />
                Decline
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TAB 1: MY TEAMS & SQUADS */}
      {activeTab === 'my_teams' && (
        <div className="space-y-6">
          <div
            className="p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.1))',
              border: '1px solid rgba(16, 185, 129, 0.35)',
            }}
          >
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <GitBranch className="size-5 text-emerald-400" />
                Your Assigned Cross-Departmental Teams
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                View your squad teammates across Development, Marketing, Design, and Operations, along with your Squad Lead and linked project.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('directory')}
              className="px-4 py-2 rounded-xl text-xs font-mono text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 shrink-0"
            >
              Browse All People →
            </button>
          </div>

          {teamsLoading && agencyTeams.length === 0 ? (
            <p className="text-slate-400 font-mono text-sm">Loading your teams…</p>
          ) : myTeams.length === 0 ? (
            <div
              className="p-10 rounded-2xl text-center space-y-3"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: AXIOM.borders.default,
              }}
            >
              <GitBranch className="size-10 text-slate-500 mx-auto" />
              <h3 className="text-lg font-bold text-white">You haven't been assigned to a squad yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Once your Organization Admin creates a cross-departmental team and adds you in Team & Permissions, your squad, Team Lead, and teammates will appear right here.
              </p>
              <div className="pt-2 flex justify-center gap-3">
                {agencyTeams.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('all_squads')}
                    className="px-4 py-2 rounded-xl text-xs font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30"
                  >
                    View {agencyTeams.length} Organization Squad(s)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('directory')}
                  className="px-4 py-2 rounded-xl text-xs font-mono text-blue-300 bg-blue-500/15 border border-blue-500/30"
                >
                  Open People Directory
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {myTeams.map((team, idx) => renderSquadCard(team, true, idx))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PEOPLE & DEPARTMENT DIRECTORY */}
      {activeTab === 'directory' && (
        <>
          {/* Search & Department Filter */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col md:flex-row items-stretch md:items-center gap-4"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, role, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {departments.map((dept) => (
                <button
                  key={dept}
                  onClick={() => setSelectedDept(dept)}
                  className="px-4 py-2.5 rounded-lg text-xs font-mono transition-all"
                  style={selectedDept === dept ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
                >
                  {dept}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Team Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {svcTeam === null && loading && (
              <p className="text-slate-400 font-mono text-sm col-span-full">Loading team…</p>
            )}
            {!loading && !error && teamMembers.length === 0 && (
              <p className="text-slate-400 font-mono text-sm col-span-full">No team members to show.</p>
            )}
            {filtered.map((member, i) => {
              const memberTeams = agencyTeams.filter(
                (t) =>
                  (t.memberIds || []).includes(member.userId) ||
                  (t.members || []).some(
                    (tm) =>
                      tm.userId === member.userId ||
                      (member.email && (tm.email || '').toLowerCase() === member.email.toLowerCase()),
                  ),
              );

              return (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.04 }}
                  className="rounded-2xl p-6 hover:bg-white/5 transition-colors group relative"
                  style={{
                    background: AXIOM.backgrounds.chartContainer,
                    border: AXIOM.borders.default,
                  }}
                >
                  {/* Top accent */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
                    style={{ background: member.color, opacity: 0.5 }}
                  />

                  {/* Pending badge */}
                  {member.isPending && (
                    <div className="absolute top-3 right-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        Pending
                      </span>
                    </div>
                  )}

                  <div className="flex items-start gap-4">
                    <div
                      className="size-14 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${member.color}, ${member.color}99)`,
                        boxShadow: `0 10px 30px -10px ${member.color}80`,
                      }}
                    >
                      {member.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-bold group-hover:text-blue-400 transition-colors">
                        {member.name}
                      </h3>
                      <p className="text-sm text-slate-400 font-mono">{member.role}</p>
                      {member.department && (
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{member.department}</p>
                      )}
                    </div>
                  </div>

                  {/* Assigned Squad Badges */}
                  {memberTeams.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {memberTeams.map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        >
                          <GitBranch className="size-3" />
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {member.department && (
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                        <Building2 className="size-3.5 text-slate-500" />
                        <span>{member.department}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <Briefcase className="size-3.5 text-slate-500" />
                      <span>{member.role}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <Mail className="size-3.5 text-slate-500" />
                      <span className="truncate">{member.email}</span>
                    </div>
                    {member.location && (
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                        <MapPin className="size-3.5 text-slate-500" />
                        <span>{member.location}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 flex gap-2" style={{ borderTop: AXIOM.borders.default }}>
                    <a
                      href={`mailto:${member.email}`}
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-mono text-blue-400 transition-all hover:bg-blue-400/10 text-center"
                      style={{
                        background: 'rgba(59, 130, 246, 0.05)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                      }}
                    >
                      <Mail className="size-3.5 inline mr-1.5" />
                      Email
                    </a>
                    <button
                      disabled
                      title="No phone number on file for this member"
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-mono text-slate-500 cursor-not-allowed opacity-50"
                      style={{
                        border: AXIOM.borders.default,
                      }}
                    >
                      <Phone className="size-3.5 inline mr-1.5" />
                      Call
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
