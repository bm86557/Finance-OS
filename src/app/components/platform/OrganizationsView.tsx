import { useState } from 'react';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
// ── Live tenant data: rows come from the `organizations` table in Supabase ───
import { platformOrganizationService } from '@/services/platformOrganizationService';
import type { PlatformOrganization } from '@/services/platformOrganizationService';
import { orgInvitationService } from '@/services/orgInvitationService';
import { useService, useServiceArray } from '@/hooks/useService';
import { platformService } from '@/services/platformService';
import { usePlatformOrganizations } from '@/hooks/usePlatformOrganizations';
import { Search, Plus, Building2, Users, FileText, Settings, Eye, Globe, Loader2, Mail, Clock, Radio } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

type EnrichedOrg = PlatformOrganization;

export function OrganizationsView() {
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'free' | 'paid'>('all');
  const { data: platformPlans = [] } = useServiceArray(
    () => platformService.getPlans(),
    [],
    ['platformPlans']
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState('');
  const [newOrgAdminName, setNewOrgAdminName] = useState('');
  const [newOrgPlan, setNewOrgPlan] = useState('basic');
  const [creatingOrg, setCreatingOrg] = useState(false);

  // Real tenants straight from the Supabase `organizations` table, kept live via Realtime.
  const {
    organizations: allOrgs,
    loading,
    error: orgsError,
    realtime,
    refetch: refetchOrgs,
  } = usePlatformOrganizations();

  // Fetch pending invitations
  const { data: invitationsResult, loading: invitationsLoading, refetch: refetchInvitations } = useService(
    () => orgInvitationService.getAllInvitations(),
    []
  );

  const pendingInvitations = invitationsResult?.filter(inv => inv.status === 'pending') || [];

  // Helper to check if an organization came from an accepted invitation
  const getOrgInvitationStatus = (org: EnrichedOrg) => {
    // Check if there's an accepted invitation that created this org
    const acceptedInvite = invitationsResult?.find(
      inv => inv.createdOrganizationId === org.id && inv.status === 'accepted'
    );
    
    if (acceptedInvite) {
      return { 
        type: 'active' as const, 
        label: '✅ Joined Finance OS', 
        admin: acceptedInvite.adminEmail,
        joinedAt: acceptedInvite.acceptedAt,
        color: 'emerald'
      };
    }
    
    // Check if there's a pending invitation for an org with this exact name
    const pendingInvite = pendingInvitations.find(
      inv => inv.organizationName.toLowerCase() === org.name.toLowerCase()
    );
    
    if (pendingInvite) {
      return { 
        type: 'pending' as const, 
        label: '⏳ Invitation Pending', 
        admin: pendingInvite.adminEmail,
        color: 'amber',
        inviteToken: pendingInvite.token
      };
    }
    
    // Organization exists but no invitation record - likely created directly or invitation deleted
    return { 
      type: 'no_invite' as const, 
      label: '✅ Active (No Invite Record)', 
      admin: null,
      color: 'blue'
    };
  };


  const handleCreateOrg = async () => {
    const name = newOrgName.trim();
    const email = newOrgAdminEmail.trim();
    
    if (!name) {
      toast.error('Enter an organization name.');
      return;
    }
    
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      toast.error('Enter a valid admin email address.');
      return;
    }

    setCreatingOrg(true);
    
    try {
      // Create invitation instead of directly creating organization
      const res = await orgInvitationService.createInvitation({
        organizationName: name,
        adminEmail: email,
        adminName: newOrgAdminName.trim() || undefined,
        plan: newOrgPlan || 'basic',
      });

      console.log('[handleCreateOrg] Invitation service response:', res);

      if (!res.success) {
        console.error('[handleCreateOrg] Invitation creation failed:', res.error);
        toast.error(res.error || 'Could not send invitation.');
        setCreatingOrg(false);
        return;
      }

      const inviteLink = `${window.location.origin}/accept-org-invite/${res.data.token}`;
      
      toast.success(`Invitation created for ${email}`, {
        description: `Copy the invitation link and send it to the admin.`,
        duration: 6000,
      });
      
      // Show invitation link in console
      console.log('📧 Invitation Link:', inviteLink);
      
      setShowCreateForm(false);
      setNewOrgName('');
      setNewOrgAdminEmail('');
      setNewOrgAdminName('');
      setNewOrgPlan('basic');
      
      await refetchOrgs();
      await refetchInvitations();
    } catch (error) {
      console.error('[handleCreateOrg] Unexpected error:', error);
      toast.error(`Failed to create invitation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setCreatingOrg(false);
    }
  };

  const [viewingOrg, setViewingOrg] = useState<EnrichedOrg | null>(null);
  const [managingOrg, setManagingOrg] = useState<EnrichedOrg | null>(null);
  const [manageName, setManageName] = useState('');
  const [manageCurrency, setManageCurrency] = useState('');
  const [manageFiscalYearStart, setManageFiscalYearStart] = useState('');
  const [managePlan, setManagePlan] = useState('basic');
  const [savingManage, setSavingManage] = useState(false);

  const openManage = (org: EnrichedOrg) => {
    setManagingOrg(org);
    setManageName(org.name);
    setManageCurrency(org.currency);
    setManageFiscalYearStart(org.fiscalYearStart);
    setManagePlan(org.plan?.toLowerCase() || 'basic');
  };

  const handleSaveManage = async () => {
    if (!managingOrg) return;
    const name = manageName.trim();
    if (!name) {
      toast.error('Organization name cannot be empty.');
      return;
    }
    setSavingManage(true);
    const res = await platformOrganizationService.update(managingOrg.id, {
      name,
      currency: manageCurrency.trim().toUpperCase(),
      fiscalYearStart: manageFiscalYearStart,
      plan: managePlan,
    });
    setSavingManage(false);
    if (!res.success) {
      toast.error(res.error || 'Could not update organization.');
      return;
    }
    toast.success('Organization updated.');
    setManagingOrg(null);
    await refetchOrgs();
  };

  const filteredOrgs = allOrgs.filter(org => {
    const matches = org.name.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matches) return false;
    const isFree = org.plan?.toLowerCase() === 'basic' || (org.billing?.amount || 0) === 0;
    if (tierFilter === 'free') return isFree;
    if (tierFilter === 'paid') return !isFree;
    return true;
  });

  const statusConfig: Record<string, { color: string; bg: string; border: string }> = {
    active: { color: '#34d399', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)' },
    trial: { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.3)' },
    suspended: { color: '#f87171', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)' },
    churn_risk: { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)' },
  };

  return (
    <div className="p-8 space-y-8" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>Organizations</h1>
          <p className="text-slate-400 font-mono">Manage all client organizations across the platform</p>
          <p className="text-xs font-mono mt-2 flex items-center gap-2" style={{ color: realtime === 'live' ? '#34d399' : '#94a3b8' }}>
            <Radio className="size-3.5" />
            {realtime === 'live'
              ? 'Live — synced with Supabase'
              : realtime === 'connecting'
                ? 'Connecting to Supabase realtime...'
                : 'Auto-refresh every 30s (realtime offline)'}
            <span className="text-slate-500">· {allOrgs.length} in database</span>
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-medium"
          style={AXIOM.buttons.action}
        >
          <Plus className="size-5" />
          Create Organization
        </button>
      </motion.div>

      {/* Error */}
      {orgsError && (
        <div className="rounded-xl p-4 text-sm font-mono" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5' }}>
          {orgsError}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Active', count: filteredOrgs.filter(o => o.status === 'active').length, color: 'green', icon: Building2 },
          { label: 'Trial', count: filteredOrgs.filter(o => o.status === 'trial').length, color: 'blue', icon: Globe },
          { label: 'Suspended', count: filteredOrgs.filter(o => o.status === 'suspended').length, color: 'red', icon: Settings },
          { label: 'Churn Risk', count: filteredOrgs.filter(o => o.status === 'churn_risk').length, color: 'amber', icon: Users },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="rounded-xl p-5"
            style={{
              background: AXIOM.backgrounds.chartContainer,
              border: AXIOM.borders[item.color as keyof typeof AXIOM.borders],
              boxShadow: AXIOM.shadows[item.color as keyof typeof AXIOM.shadows],
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-mono mb-1">{item.label.toUpperCase()}</p>
                <p className="text-2xl font-bold text-white">{item.count}</p>
              </div>
              <div className="size-10 rounded-lg flex items-center justify-center" style={{
                background: AXIOM.iconBoxes[item.color as keyof typeof AXIOM.iconBoxes],
              }}>
                <item.icon className="size-5 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Create Form - Now sends invitation instead of creating directly */}
      {showCreateForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="rounded-2xl p-6"
          style={{
            background: AXIOM.backgrounds.chartContainer,
            border: '1px solid rgba(168, 85, 247, 0.3)',
            boxShadow: '0 20px 60px -20px rgba(168, 85, 247, 0.3)',
          }}
        >
          <h3 className="text-white font-bold mb-2 flex items-center gap-2">
            <Mail className="size-5 text-purple-400" />
            Invite Organization Admin
          </h3>
          <p className="text-xs text-slate-400 font-mono mb-4">
            Send an invitation email to create a new organization. The admin will set their password and activate the organization.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Organization Name *</label>
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Acme Corporation"
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Admin Email *</label>
              <input
                type="email"
                value={newOrgAdminEmail}
                onChange={(e) => setNewOrgAdminEmail(e.target.value)}
                placeholder="admin@acme.com"
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Admin Name (Optional)</label>
              <input
                type="text"
                value={newOrgAdminName}
                onChange={(e) => setNewOrgAdminName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Subscription Plan</label>
              <select
                value={newOrgPlan}
                onChange={(e) => setNewOrgPlan(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              >
                <option value="basic">Basic (Trial)</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <p className="text-xs text-slate-500 font-mono mt-1">Select initial subscription plan for organization</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => void handleCreateOrg()}
              disabled={creatingOrg}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={AXIOM.buttons.success}
            >
              {creatingOrg ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              {creatingOrg ? 'Sending Invitation...' : 'Send Invitation'}
            </button>
            <button onClick={() => setShowCreateForm(false)} className="px-4 py-2 rounded-lg text-slate-400 text-sm" style={AXIOM.buttons.outline}>
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Pending Invitations Section */}
      {pendingInvitations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-6"
          style={{
            background: AXIOM.backgrounds.chartContainer,
            border: '1px solid rgba(251, 191, 36, 0.3)',
            boxShadow: '0 20px 60px -20px rgba(251, 191, 36, 0.2)',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Clock className="size-5 text-amber-400" />
              Pending Invitations ({pendingInvitations.length})
            </h3>
          </div>
          <div className="space-y-3">
            {pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-4 rounded-lg"
                style={{
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(251, 191, 36, 0.2)',
                }}
              >
                <div className="flex-1">
                  <p className="text-white font-medium">{inv.organizationName}</p>
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    Invited: {inv.adminEmail}
                  </p>
                  <p className="text-xs text-amber-400 font-mono mt-1">
                    Expires: {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs text-emerald-400 bg-black/30 px-2 py-1 rounded font-mono">
                      {window.location.origin}/accept-org-invite/{inv.token.substring(0, 12)}...
                    </code>
                    <button
                      onClick={() => {
                        const link = `${window.location.origin}/accept-org-invite/${inv.token}`;
                        navigator.clipboard.writeText(link);
                        toast.success('Invitation link copied!', {
                          description: 'Share this link with the organization admin',
                        });
                      }}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1"
                    >
                      <Mail className="size-3" />
                      Copy Link
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Pending
                  </span>
                  <button
                    onClick={async () => {
                      const result = await orgInvitationService.resendInvitation(inv.id);
                      if (result.success) {
                        toast.success('Invitation email resent!', {
                          description: 'Check the admin\'s email inbox',
                        });
                      } else {
                        toast.error(result.error || 'Failed to resend email');
                      }
                    }}
                    className="text-xs px-3 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30 font-mono"
                  >
                    Resend
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm('Cancel this invitation?')) {
                        await orgInvitationService.cancelInvitation(inv.id);
                        toast.success('Invitation cancelled');
                        await refetchInvitations();
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-300 font-mono"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Search & Dynamic Tier Filter */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search organizations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-lg text-white font-mono text-sm"
              style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
            />
          </div>
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/80 border border-slate-800 shrink-0 font-mono text-xs">
            <button
              type="button"
              onClick={() => setTierFilter('all')}
              className={'px-3 py-1.5 rounded-lg transition-all ' + (tierFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold' : 'text-slate-400 hover:text-slate-200')}
            >
              All Tiers ({allOrgs.length})
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('free')}
              className={'px-3 py-1.5 rounded-lg transition-all ' + (tierFilter === 'free' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold' : 'text-slate-400 hover:text-slate-200')}
            >
              Free Tier ({allOrgs.filter(o => o.plan?.toLowerCase() === 'basic' || (o.billing?.amount || 0) === 0).length})
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('paid')}
              className={'px-3 py-1.5 rounded-lg transition-all ' + (tierFilter === 'paid' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold' : 'text-slate-400 hover:text-slate-200')}
            >
              Paid Tiers ({allOrgs.filter(o => o.plan?.toLowerCase() !== 'basic' && (o.billing?.amount || 0) > 0).length})
            </button>
          </div>
        </div>
      </motion.div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 text-blue-400 animate-spin" />
          <span className="ml-3 text-slate-400 font-mono">Loading organizations...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredOrgs.length === 0 && (
        <div
          className="rounded-2xl p-10 text-center"
          style={{ background: AXIOM.backgrounds.chartContainer, border: '1px solid rgba(148, 163, 184, 0.2)' }}
        >
          <Building2 className="size-8 mx-auto mb-3 text-slate-500" />
          <p className="text-white font-medium">
            {searchTerm ? 'No organization matches your search' : 'No organizations yet'}
          </p>
          <p className="text-xs text-slate-400 font-mono mt-1">
            {searchTerm
              ? 'Try a different name.'
              : 'The organizations table in Supabase is empty — create the first tenant to get started.'}
          </p>
        </div>
      )}

      {/* Organizations Grid */}
      {!loading && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredOrgs.map((org, i) => {
          const sc = statusConfig[org.status] || statusConfig.active;
          const inviteStatus = getOrgInvitationStatus(org);
          
          return (
            <motion.div
              key={org.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.05 }}
              className="rounded-2xl p-6 hover:bg-white/5 transition-colors cursor-pointer group"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: `1px solid ${sc.border}`,
                boxShadow: `0 20px 60px -20px ${sc.color}30`,
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-xl flex items-center justify-center" style={{
                    background: AXIOM.iconBoxes.purple,
                    boxShadow: AXIOM.shadows.iconPurple,
                  }}>
                    <Building2 className="size-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-white font-bold group-hover:text-purple-400 transition-colors">{org.name}</h3>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">Created {new Date(org.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-1 rounded capitalize" style={{
                  background: sc.bg,
                  border: `1px solid ${sc.border}`,
                  color: sc.color,
                }}>
                  {org.status.replace('_', ' ')}
                </span>
              </div>

              {/* Invitation Status Row */}
              <div className="mb-4 p-3 rounded-lg" style={{
                background: inviteStatus.color === 'emerald' 
                  ? 'rgba(16, 185, 129, 0.1)' 
                  : inviteStatus.color === 'amber'
                  ? 'rgba(251, 191, 36, 0.1)'
                  : 'rgba(59, 130, 246, 0.1)',
                border: inviteStatus.color === 'emerald'
                  ? '1px solid rgba(16, 185, 129, 0.3)'
                  : inviteStatus.color === 'amber'
                  ? '1px solid rgba(251, 191, 36, 0.3)'
                  : '1px solid rgba(59, 130, 246, 0.3)',
              }}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-xs font-mono mb-1" style={{
                      color: inviteStatus.color === 'emerald' 
                        ? '#34d399' 
                        : inviteStatus.color === 'amber'
                        ? '#fbbf24'
                        : '#60a5fa'
                    }}>
                      {inviteStatus.label}
                    </p>
                    {inviteStatus.admin && (
                      <p className="text-xs text-slate-400 font-mono">
                        Admin: {inviteStatus.admin}
                      </p>
                    )}
                    {inviteStatus.joinedAt && (
                      <p className="text-xs text-slate-500 font-mono">
                        Joined: {new Date(inviteStatus.joinedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {inviteStatus.type === 'pending' && inviteStatus.inviteToken && (
                    <button
                      onClick={() => {
                        const link = `${window.location.origin}/accept-org-invite/${inviteStatus.inviteToken}`;
                        navigator.clipboard.writeText(link);
                        toast.success('Invitation link copied!');
                      }}
                      className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 font-mono flex items-center gap-1"
                    >
                      <Mail className="size-3" />
                      Copy Link
                    </button>
                  )}
                </div>
              </div>

              {/* Plan & Billing */}
              <div className="flex items-center justify-between p-3 rounded-lg mb-4" style={{
                ...AXIOM.containers.item,
              }}>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-xs text-slate-400 font-mono">Plan</p>
                    {(org.plan?.toLowerCase() === 'basic' || (org.billing?.amount || 0) === 0) ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                        Free Tier
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold">
                        Paid Tier
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white font-medium">{org.plan}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400 font-mono">Next Invoice</p>
                  <p className="text-sm text-white font-medium font-mono">Rs {org.billing.amount.toLocaleString()}</p>
                  {org.billing.daysRemaining != null && org.billing.amount > 0 && (
                    <p className="text-[10px] font-mono text-cyan-400">
                      {org.billing.daysRemaining}d remaining
                    </p>
                  )}
                </div>
              </div>

              {/* Usage Stats */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Users', value: `${org.limits.usersUsed}/${org.limits.users}`, icon: Users, color: 'blue' },
                  { label: 'Statements', value: `${org.limits.statementsUsed}/${org.limits.statements}`, icon: FileText, color: 'cyan' },
                  { label: 'Currencies', value: `${org.limits.currenciesUsed}/${org.limits.currencies}`, icon: Globe, color: 'purple' },
                ].map((stat) => (
                  <div key={stat.label} className="text-center p-3 rounded-lg" style={AXIOM.containers.item}>
                    <stat.icon className="size-4 mx-auto mb-1" style={{ color: AXIOM.charts.colors[stat.color as keyof typeof AXIOM.charts.colors] }} />
                    <p className="text-[10px] text-slate-400 font-mono">{stat.label}</p>
                    <p className="text-sm text-white font-mono">{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setViewingOrg(org)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono transition-all"
                  style={AXIOM.buttons.info}
                >
                  <Eye className="size-4" /> View Details
                </button>
                <button
                  onClick={() => openManage(org)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono transition-all"
                  style={AXIOM.buttons.outline}
                >
                  <Settings className="size-4" /> Manage
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
      )}

      {/* View Details */}
      <Dialog open={viewingOrg != null} onOpenChange={(open) => { if (!open) setViewingOrg(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewingOrg?.name}</DialogTitle>
            <DialogDescription>
              Created {viewingOrg ? new Date(viewingOrg.createdAt).toLocaleDateString() : ''}
            </DialogDescription>
          </DialogHeader>
          {viewingOrg && (
            <div className="space-y-3 py-2 text-sm font-mono">
              <div className="flex justify-between"><span className="text-slate-400">Status</span><span className="text-white capitalize">{viewingOrg.status.replace('_', ' ')}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Plan</span><span className="text-white">{viewingOrg.plan}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Currency</span><span className="text-white">{viewingOrg.currency}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Fiscal year start</span><span className="text-white">{viewingOrg.fiscalYearStart}</span></div>
              <div className="flex justify-between">
                <span className="text-slate-400">Next invoice</span>
                <span className="text-white">
                  Rs {viewingOrg.billing.amount.toLocaleString()}
                  {viewingOrg.billing.daysRemaining != null && viewingOrg.billing.amount > 0 && (
                    <span className="text-cyan-400 text-xs ml-2">({viewingOrg.billing.daysRemaining} days remaining)</span>
                  )}
                </span>
              </div>
              <div className="border-t border-white/10 pt-3 space-y-2">
                <div className="flex justify-between"><span className="text-slate-400">Users</span><span className="text-white">{viewingOrg.limits.usersUsed}/{viewingOrg.limits.users}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Statements</span><span className="text-white">{viewingOrg.limits.statementsUsed}/{viewingOrg.limits.statements}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Currencies</span><span className="text-white">{viewingOrg.limits.currenciesUsed}/{viewingOrg.limits.currencies}</span></div>
              </div>
              <div className="border-t border-white/10 pt-3 text-xs text-slate-500">Org ID: {viewingOrg.id}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage */}
      <Dialog open={managingOrg != null} onOpenChange={(open) => { if (!open) setManagingOrg(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage {managingOrg?.name}</DialogTitle>
            <DialogDescription>Edits save to this organization's real record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Organization name</label>
              <input
                type="text"
                value={manageName}
                onChange={(e) => setManageName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Currency</label>
              <input
                type="text"
                value={manageCurrency}
                onChange={(e) => setManageCurrency(e.target.value)}
                maxLength={3}
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm uppercase"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Fiscal year start (MM-DD)</label>
              <input
                type="text"
                value={manageFiscalYearStart}
                onChange={(e) => setManageFiscalYearStart(e.target.value)}
                placeholder="01-01"
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-mono">Subscription Plan</label>
              <select
                value={managePlan}
                onChange={(e) => setManagePlan(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-white font-mono text-sm"
                style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
              >
                <optgroup label="Free Tier" className="bg-slate-900 text-slate-300">
                  {(platformPlans.filter(p => p.price === 0).length > 0 ? platformPlans.filter(p => p.price === 0) : [{ slug: 'basic', name: 'Basic' }]).map(p => (
                    <option key={p.slug} value={p.slug}>{p.name} (Free)</option>
                  ))}
                </optgroup>
                <optgroup label="Paid Tiers" className="bg-slate-900 text-slate-300">
                  {(platformPlans.filter(p => p.price > 0).length > 0 ? platformPlans.filter(p => p.price > 0) : [{ slug: 'professional', name: 'Professional', price: 49900 }, { slug: 'enterprise', name: 'Enterprise', price: 99900 }]).map(p => (
                    <option key={p.slug} value={p.slug}>{p.name} (Rs {(p.price || 0).toLocaleString()}/mo)</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setManagingOrg(null)} className="px-4 py-2 rounded-lg text-slate-400 text-sm" style={AXIOM.buttons.outline}>
              Cancel
            </button>
            <button
              onClick={() => void handleSaveManage()}
              disabled={savingManage}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={AXIOM.buttons.success}
            >
              {savingManage ? <Loader2 className="size-4 animate-spin" /> : null}
              Save Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}