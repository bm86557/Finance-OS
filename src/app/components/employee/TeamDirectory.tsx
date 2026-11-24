import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import {
  Search,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Building2,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { useAuth } from '@/contexts/AuthContext';
import { useService } from '@/hooks/useService';
import { toast } from 'sonner';
import { SkeletonLine } from '../loading/LoadingStates';

export function TeamDirectory() {
  const { currentOrganization, user, membership, acceptInvite, declineInvite } = useAuth();
  const orgId = currentOrganization?.id || '';
  const [isProcessing, setIsProcessing] = useState(false);

  // Service-backed team directory
  const { data: svcTeam, loading, error, refetch } = useService(
    () => (orgId ? employeeService.getTeamDirectory(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId],
  );

  const isPending = membership?.status === 'pending';

  const handleAccept = async () => {
    if (!currentOrganization || !user) return;
    setIsProcessing(true);
    try {
      const res = await acceptInvite(currentOrganization.id, user.id);
      if (res.success) {
        toast.success('Invitation accepted! You are now an active team member.');
        await refetch();
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

  return (
    <div className="p-8 space-y-8 h-full overflow-y-auto" style={{ background: AXIOM.backgrounds.main }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>
            Team Directory
          </h1>
          <p className="text-slate-400 font-mono text-sm">
            {loading && svcTeam === null
              ? 'Loading directory…'
              : `${teamMembers.length} organization members`}
          </p>
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
          [0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="rounded-2xl p-6 space-y-4"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: AXIOM.borders.default,
              }}
            >
              <div className="flex items-start gap-4">
                <SkeletonLine width="56px" height="56px" className="rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <SkeletonLine width="65%" height="18px" />
                  <SkeletonLine width="50%" height="14px" />
                  <SkeletonLine width="40%" height="12px" />
                </div>
              </div>
              <div className="space-y-2">
                <SkeletonLine width="60%" height="12px" />
                <SkeletonLine width="55%" height="12px" />
                <SkeletonLine width="80%" height="12px" />
              </div>
              <div className="pt-4 flex gap-2" style={{ borderTop: AXIOM.borders.default }}>
                <SkeletonLine width="50%" height="34px" className="rounded-lg" />
                <SkeletonLine width="50%" height="34px" className="rounded-lg" />
              </div>
            </div>
          ))
        )}
        {!loading && !error && teamMembers.length === 0 && (
          <p className="text-slate-400 font-mono text-sm col-span-full">No team members to show.</p>
        )}
        {filtered.map((member, i) => (
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
        ))}
      </div>
    </div>
  );
}
