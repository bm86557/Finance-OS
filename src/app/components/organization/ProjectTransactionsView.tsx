import { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { useSearchParams } from 'react-router';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { exportToCSV } from '@/lib/exportUtils';
import { AXIOM } from '../../../styles/axiom-tokens';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Receipt,
  Briefcase,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Search,
  Filter,
  Download,
  Plus,
  Calendar,
  Building2,
  FolderOpen,
  ArrowUpDown,
  Tag,
  CheckCircle2,
  Layers,
  ChevronRight,
  Clock,
  ExternalLink,
} from 'lucide-react';

export function ProjectTransactionsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const svc = useOrgServices();
  const { currentOrganization } = useAuth();
  const goToOrgView = useOrgWorkspaceNav();
  const displayCurrency = currentOrganization?.currency ?? 'PKR';

  // Read projectId from query parameter
  const initialProjectId = searchParams.get('projectId') || 'all';
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId);

  // Sync state if URL query param changes
  useEffect(() => {
    const pId = searchParams.get('projectId');
    if (pId) {
      setSelectedProjectId(pId);
    }
  }, [searchParams]);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');

  // Fetch projects
  const { data: projects = [], loading: projectsLoading } = useServiceArray(
    () => svc.projects.getAll(),
    [svc.orgId],
    ['projects'],
  );

  // Fetch all transactions
  const { data: txnResult, loading: txnsLoading, refetch: refetchTxns } = useService(
    () => svc.transactions.getAll({ pageSize: 1500 }),
    [svc.orgId],
    ['transactions'],
  );
  const allTransactions = txnResult?.items ?? [];

  // Fetch categories, departments, bank accounts for labels
  const { data: categories = [] } = useServiceArray(
    () => svc.categories.getAll(),
    [svc.orgId],
    ['categories'],
  );

  const { data: departments = [] } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId],
    ['departments'],
  );

  const { data: bankAccounts = [] } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts'],
  );

  const categoryMap = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const deptMap = useMemo(() => new Map(departments.map(d => [d.id, d.name])), [departments]);
  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const bankMap = useMemo(
    () => new Map(bankAccounts.map(b => [b.id, `${b.bankName} (${b.accountNumber?.slice(-4) || '----'})`])),
    [bankAccounts],
  );

  // Active selected project metadata
  const currentProject = useMemo(() => {
    if (selectedProjectId === 'all') return null;
    return projectMap.get(selectedProjectId) || null;
  }, [selectedProjectId, projectMap]);

  // Handle switching project selector
  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('view', 'project-transactions');
      if (projectId && projectId !== 'all') {
        next.set('projectId', projectId);
      } else {
        next.delete('projectId');
      }
      return next;
    });
  };

  // Navigate back to Project Profitability
  const handleBackToProjects = () => {
    if (goToOrgView) {
      goToOrgView('projects');
    } else {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('view', 'projects');
        next.delete('projectId');
        return next;
      });
    }
  };

  // Base transactions for the chosen project (or all projects)
  const baseProjectTransactions = useMemo(() => {
    if (selectedProjectId === 'all') {
      // Include all transactions that have a project assigned
      return allTransactions.filter(t => Boolean(t.projectId));
    }
    return allTransactions.filter(t => t.projectId === selectedProjectId);
  }, [allTransactions, selectedProjectId]);

  // =========================================================================
  // SEPARATE DEDICATED CALCULATIONS FOR THIS PROJECT TRANSACTIONS PAGE
  // strictly calculated from actual transaction entries (independent from main page)
  // =========================================================================
  const calculations = useMemo(() => {
    let inflowTotal = 0;
    let outflowTotal = 0;
    let inflowCount = 0;
    let outflowCount = 0;
    const catSpendMap = new Map<string, number>();

    for (const t of baseProjectTransactions) {
      const status = String(t.status || '').toLowerCase();
      if (status === 'pending' || status === 'draft' || status === 'rejected' || status === 'reversed' || status === 'cancelled') {
        continue;
      }
      if ((t as any).worldScope === 'personal' || (t as any).world_scope === 'personal') {
        continue;
      }
      const tags = Array.isArray(t.tags) ? t.tags : [];
      if (tags.includes('personal')) continue;

      const amt = Math.abs(Number(t.amount) || 0);
      if (t.type === 'credit') {
        inflowTotal += amt;
        inflowCount += 1;
      } else if (t.type === 'debit') {
        const desc = (t.description || (t as any).narration || '').toLowerCase();
        if (
          tags.includes('reimbursement_settlement') ||
          tags.includes('payroll_payout') ||
          tags.includes('salary') ||
          tags.includes('payroll') ||
          desc.includes('reimbursement settlement') ||
          desc.includes('salary payout') ||
          desc.includes('payroll transfer')
        ) {
          continue;
        }
        outflowTotal += amt;
        outflowCount += 1;
        const catName = categoryMap.get(t.categoryId ?? '') || 'Uncategorized';
        catSpendMap.set(catName, (catSpendMap.get(catName) || 0) + amt);
      }
    }

    const netRealizedFlow = inflowTotal - outflowTotal;
    const totalCount = baseProjectTransactions.length;
    const avgSpendPerDebit = outflowCount > 0 ? outflowTotal / outflowCount : 0;
    const realizedMarginPct = inflowTotal > 0 ? (netRealizedFlow / inflowTotal) * 100 : 0;

    // Sort category spend for visual breakdown
    const categoryBreakdown = Array.from(catSpendMap.entries())
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: outflowTotal > 0 ? (amount / outflowTotal) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      inflowTotal,
      outflowTotal,
      netRealizedFlow,
      inflowCount,
      outflowCount,
      totalCount,
      avgSpendPerDebit,
      realizedMarginPct,
      categoryBreakdown,
    };
  }, [baseProjectTransactions, categoryMap]);

  // Filtered & Sorted Transactions for the table
  const displayedTransactions = useMemo(() => {
    let list = [...baseProjectTransactions];

    // Filter by type
    if (typeFilter !== 'all') {
      list = list.filter(t => t.type === typeFilter);
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      list = list.filter(t => t.categoryId === categoryFilter);
    }

    // Filter by date range
    if (dateFrom) {
      list = list.filter(t => t.date && t.date >= dateFrom);
    }
    if (dateTo) {
      list = list.filter(t => t.date && t.date <= dateTo);
    }

    // Filter by search query
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      list = list.filter(t => {
        const desc = (t.narration || t.description || '').toLowerCase();
        const cat = (categoryMap.get(t.categoryId ?? '') || '').toLowerCase();
        const pName = (projectMap.get(t.projectId ?? '')?.name || '').toLowerCase();
        const bank = (bankMap.get(t.bankAccountId ?? '') || '').toLowerCase();
        const amtStr = String(t.amount);
        return desc.includes(query) || cat.includes(query) || pName.includes(query) || bank.includes(query) || amtStr.includes(query);
      });
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'date_desc') {
        const diff = (b.date || '').localeCompare(a.date || '');
        return diff !== 0 ? diff : (b.createdAt || '').localeCompare(a.createdAt || '');
      }
      if (sortBy === 'date_asc') {
        const diff = (a.date || '').localeCompare(b.date || '');
        return diff !== 0 ? diff : (a.createdAt || '').localeCompare(b.createdAt || '');
      }
      if (sortBy === 'amount_desc') {
        return Math.abs(b.amount) - Math.abs(a.amount);
      }
      if (sortBy === 'amount_asc') {
        return Math.abs(a.amount) - Math.abs(b.amount);
      }
      return 0;
    });

    return list;
  }, [baseProjectTransactions, typeFilter, categoryFilter, dateFrom, dateTo, searchTerm, sortBy, categoryMap, projectMap, bankMap]);

  // Export CSV
  const handleExportCSV = () => {
    if (displayedTransactions.length === 0) {
      toast.info('No transactions to export.');
      return;
    }

    const exportRows = displayedTransactions.map(t => {
      const proj = projectMap.get(t.projectId || '');
      return {
        Date: t.date ? formatDate(t.date) : '',
        Project: proj?.name || 'Unassigned',
        'Project Code': proj?.code || '',
        Type: t.type === 'credit' ? 'Income / Inflow' : 'Expense / Outflow',
        Category: categoryMap.get(t.categoryId || '') || 'Uncategorized',
        Account: bankMap.get(t.bankAccountId || '') || '—',
        Narration: t.narration || t.description || '',
        Amount: t.amount,
        Currency: t.currency || displayCurrency,
        Status: t.status || 'classified',
      };
    });

    const headers = ['Date', 'Project', 'Project Code', 'Type', 'Category', 'Account', 'Narration', 'Amount', 'Currency', 'Status'];
    const filename = currentProject
      ? `${currentProject.code || currentProject.name}_Transactions`
      : 'All_Project_Transactions';

    const res = exportToCSV(exportRows, headers, filename);
    if (res.success) {
      toast.success('Project transactions exported successfully');
    } else {
      toast.error('Failed to export CSV');
    }
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setCategoryFilter('all');
    setDateFrom('');
    setDateTo('');
    setSortBy('date_desc');
  };

  const hasActiveFilters = Boolean(searchTerm || typeFilter !== 'all' || categoryFilter !== 'all' || dateFrom || dateTo || sortBy !== 'date_desc');

  return (
    <div className="min-h-screen p-4 sm:p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Top Breadcrumb & Navigation Bar */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleBackToProjects}
              className="p-2.5 rounded-xl flex items-center justify-center text-slate-300 hover:text-white border border-slate-700/60 bg-slate-800/40 hover:bg-slate-800/80 transition-all cursor-pointer"
              title="Return to Project Profitability"
            >
              <ArrowLeft className="size-5" />
            </motion.button>
            <div
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Receipt className="size-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                <span className="hover:text-cyan-400 cursor-pointer" onClick={handleBackToProjects}>
                  Projects
                </span>
                <ChevronRight className="size-3 text-slate-600" />
                <span className="text-cyan-400 font-semibold">Transactions Ledger</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold" style={AXIOM.text.titleStyle}>
                Project Transactions
              </h1>
            </div>
          </div>

          {/* Project Selector & Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-700/60 rounded-xl px-3 py-1.5 shadow-sm">
              <Briefcase className="size-4 text-cyan-400 shrink-0" />
              <label htmlFor="project-picker" className="text-xs text-slate-400 font-mono hidden sm:inline">
                Project:
              </label>
              <select
                id="project-picker"
                value={selectedProjectId}
                onChange={e => handleSelectProject(e.target.value)}
                className="bg-transparent text-white text-sm font-medium focus:outline-none cursor-pointer pr-2"
              >
                <option value="all" className="bg-slate-900 text-white">
                  All Projects ({projects.length})
                </option>
                {projects.map(p => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name} {p.code ? `(${p.code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleExportCSV}
              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-1.5 text-slate-200 bg-slate-800/80 border border-slate-700 hover:bg-slate-700/80 transition-all cursor-pointer"
            >
              <Download className="size-4 text-slate-300" />
              <span>Export CSV</span>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                if (goToOrgView) goToOrgView('quick-add');
              }}
              className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-1.5 text-white transition-all cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 8px 20px -8px rgba(6, 182, 212, 0.5)',
              }}
            >
              <Plus className="size-4" />
              <span>Record Transaction</span>
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Selected Project Info Header Banner (when a specific project is selected) */}
      {currentProject && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl relative overflow-hidden"
          style={{
            ...AXIOM.containers.list,
            border: '1px solid rgba(6, 182, 212, 0.25)',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(6, 182, 212, 0.05) 100%)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xl font-bold text-white tracking-tight">{currentProject.name}</span>
                {currentProject.code && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800/80 text-cyan-300 border border-cyan-500/30">
                    {currentProject.code}
                  </span>
                )}
                <span
                  className="px-2 py-0.5 rounded-lg text-xs font-medium capitalize"
                  style={
                    currentProject.status === 'completed'
                      ? AXIOM.badges.success
                      : currentProject.status === 'active'
                      ? AXIOM.badges.info
                      : AXIOM.badges.warning
                  }
                >
                  {currentProject.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-3 flex-wrap">
                <span>
                  Client: <strong className="text-slate-300 font-medium">{currentProject.clientName}</strong>
                </span>
                <span>•</span>
                <span>
                  Department: <strong className="text-slate-300 font-medium">{deptMap.get(currentProject.departmentId) || 'Department'}</strong>
                </span>
                <span>•</span>
                <span>
                  Timeline: <strong className="text-slate-300 font-medium">{formatDate(currentProject.startDate)}</strong>
                  {currentProject.endDate ? ` to ${formatDate(currentProject.endDate)}` : ' (Ongoing)'}
                </span>
              </p>
            </div>

            {/* Reference baseline chip - explicitly separated so user knows quote is reference */}
            <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block">Quoted Baseline (Ref)</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {formatCurrency(currentProject.quotedAmount, displayCurrency)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <span className="text-[11px] text-slate-400 block">Baseline Cost (Ref)</span>
                <span className="font-mono font-semibold text-slate-300">
                  {formatCurrency(currentProject.actualCost, displayCurrency)}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* =====================================================================
          SEPARATE CALCULATION KPI CARDS
          Independent calculations derived purely from transaction entries
      ===================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Direct Inflow Received */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="p-5 rounded-2xl relative overflow-hidden"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">
                Project Inflow (Credits)
              </p>
              <p className="text-2xl font-bold text-emerald-400 font-mono">
                {formatCurrency(calculations.inflowTotal, displayCurrency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {calculations.inflowCount} {calculations.inflowCount === 1 ? 'incoming deposit' : 'incoming deposits'}
              </p>
            </div>
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <TrendingUp className="size-5 text-white" />
            </div>
          </div>
        </motion.div>

        {/* Card 2: Direct Outflow Spent */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 rounded-2xl relative overflow-hidden"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">
                Project Outflow (Debits)
              </p>
              <p className="text-2xl font-bold text-red-400 font-mono">
                {formatCurrency(calculations.outflowTotal, displayCurrency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {calculations.outflowCount} {calculations.outflowCount === 1 ? 'expense disbursement' : 'expense disbursements'}
              </p>
            </div>
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: AXIOM.iconBoxes.red,
                boxShadow: AXIOM.shadows.iconRed,
              }}
            >
              <TrendingDown className="size-5 text-white" />
            </div>
          </div>
        </motion.div>

        {/* Card 3: Realized Net Cash Flow */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-5 rounded-2xl relative overflow-hidden"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">
                Realized Net Cash Flow
              </p>
              <p
                className={`text-2xl font-bold font-mono ${
                  calculations.netRealizedFlow >= 0 ? 'text-cyan-400' : 'text-amber-400'
                }`}
              >
                {calculations.netRealizedFlow >= 0 ? '+' : ''}
                {formatCurrency(calculations.netRealizedFlow, displayCurrency)}
              </p>
              <p className="text-xs text-cyan-300 mt-1">
                {calculations.inflowTotal > 0
                  ? `${calculations.realizedMarginPct.toFixed(1)}% cash retention`
                  : 'Based purely on transactions'}
              </p>
            </div>
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: calculations.netRealizedFlow >= 0 ? AXIOM.iconBoxes.cyan : AXIOM.iconBoxes.amber,
                boxShadow: calculations.netRealizedFlow >= 0 ? AXIOM.shadows.iconCyan : AXIOM.shadows.iconAmber,
              }}
            >
              <DollarSign className="size-5 text-white" />
            </div>
          </div>
        </motion.div>

        {/* Card 4: Total Transaction Count & Avg Spend */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-5 rounded-2xl relative overflow-hidden"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">
                Transaction Activity
              </p>
              <p className="text-2xl font-bold text-white font-mono">
                {calculations.totalCount}{' '}
                <span className="text-sm font-normal text-slate-400">total</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Avg spend: <span className="text-slate-300 font-mono">{formatCurrency(calculations.avgSpendPerDebit, displayCurrency)}</span>
              </p>
            </div>
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Receipt className="size-5 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Category Spend Distribution Micro-breakdown (if expenses exist) */}
      {calculations.categoryBreakdown.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl"
          style={AXIOM.containers.item}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="size-3.5 text-cyan-400" />
              Direct Expense Distribution by Category
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Total Spent: {formatCurrency(calculations.outflowTotal, displayCurrency)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {calculations.categoryBreakdown.slice(0, 4).map(cat => (
              <div
                key={cat.name}
                className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white font-medium truncate">{cat.name}</span>
                  <span className="text-cyan-400 font-mono text-[11px]">{cat.percentage.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-1.5 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(5, cat.percentage))}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {formatCurrency(cat.amount, displayCurrency)}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Filter and Search Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 rounded-2xl space-y-3"
        style={AXIOM.containers.list}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="size-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search narration, category, account, amount..."
              className="w-full pl-10 pr-4 py-2 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
              }}
            />
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
            className="px-3.5 py-2 rounded-xl text-white text-sm focus:outline-none cursor-pointer"
            style={{
              background: AXIOM.inputs.background,
              border: AXIOM.inputs.border,
            }}
          >
            <option value="all">All Types (Income & Expenses)</option>
            <option value="credit">Inflow (Credits only)</option>
            <option value="debit">Outflow (Debits only)</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl text-white text-sm focus:outline-none cursor-pointer"
            style={{
              background: AXIOM.inputs.background,
              border: AXIOM.inputs.border,
            }}
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-3.5 py-2 rounded-xl text-white text-sm focus:outline-none cursor-pointer"
            style={{
              background: AXIOM.inputs.background,
              border: AXIOM.inputs.border,
            }}
          >
            <option value="date_desc">Date (Newest first)</option>
            <option value="date_asc">Date (Oldest first)</option>
            <option value="amount_desc">Amount (Highest first)</option>
            <option value="amount_asc">Amount (Lowest first)</option>
          </select>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-mono underline underline-offset-2 px-2 py-1"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Date Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <span className="flex items-center gap-1.5 font-mono">
            <Calendar className="size-3.5 text-cyan-400" />
            Date Filter:
          </span>
          <div className="flex items-center gap-2">
            <label htmlFor="date-from" className="text-[11px] text-slate-500">From:</label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-2.5 py-1 rounded-lg text-white text-xs bg-slate-900 border border-slate-700 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="date-to" className="text-[11px] text-slate-500">To:</label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-2.5 py-1 rounded-lg text-white text-xs bg-slate-900 border border-slate-700 focus:outline-none"
            />
          </div>
          <span className="ml-auto font-mono text-[11px] text-slate-400">
            Showing {displayedTransactions.length} of {baseProjectTransactions.length} transactions
          </span>
        </div>
      </motion.div>

      {/* Transactions Table / List */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden border border-slate-800"
        style={AXIOM.containers.list}
      >
        {txnsLoading ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <div className="animate-spin size-6 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto" />
            <p className="text-sm">Loading project transactions...</p>
          </div>
        ) : displayedTransactions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FolderOpen className="size-12 text-slate-600 mx-auto" />
            <h3 className="text-lg font-semibold text-white">No transactions found</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              {baseProjectTransactions.length === 0
                ? selectedProjectId === 'all'
                  ? 'No transactions are currently linked to any project. Allocate projects to transactions via Quick Add or Transactions Ledger.'
                  : `No transactions are currently allocated to "${currentProject?.name || 'this project'}". Use Quick Add or Import Statements to allocate expenses and revenue.`
                : 'No transactions match the selected filters. Try broadening your search or resetting filters.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-medium text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/10 transition-all cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 text-xs font-mono uppercase tracking-wider">
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Narration / Description</th>
                  {selectedProjectId === 'all' && <th className="py-3.5 px-4">Project</th>}
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Account / Wallet</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4 text-right">Amount</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {displayedTransactions.map((txn, idx) => {
                  const isCredit = txn.type === 'credit';
                  const proj = projectMap.get(txn.projectId || '');
                  const catName = categoryMap.get(txn.categoryId || '') || 'Uncategorized';
                  const bankName = bankMap.get(txn.bankAccountId || '') || '—';

                  return (
                    <motion.tr
                      key={txn.id || idx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(0.2, idx * 0.02) }}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      {/* Date */}
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-300 whitespace-nowrap">
                        {txn.date ? formatDate(txn.date) : '—'}
                      </td>

                      {/* Narration */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-white font-medium truncate" title={txn.narration || txn.description || ''}>
                          {txn.narration || txn.description || 'Transaction'}
                        </p>
                        {txn.tags && txn.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {txn.tags.slice(0, 2).map((tg, i) => (
                              <span
                                key={i}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                              >
                                #{tg}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Project (if All Projects is selected) */}
                      {selectedProjectId === 'all' && (
                        <td className="py-3.5 px-4">
                          <button
                            type="button"
                            onClick={() => txn.projectId && handleSelectProject(txn.projectId)}
                            className="text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer"
                          >
                            {proj?.name || 'Project'}
                          </button>
                        </td>
                      )}

                      {/* Category */}
                      <td className="py-3.5 px-4">
                        <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-800/80 text-slate-300 border border-slate-700/60">
                          {catName}
                        </span>
                      </td>

                      {/* Account */}
                      <td className="py-3.5 px-4 text-xs text-slate-400 whitespace-nowrap">
                        {bankName}
                      </td>

                      {/* Type */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${
                            isCredit
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/10 text-red-400 border border-red-500/30'
                          }`}
                        >
                          {isCredit ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                          {isCredit ? 'Inflow' : 'Outflow'}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span
                          className={`font-mono font-bold text-sm ${
                            isCredit ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {isCredit ? '+' : '−'}
                          {formatCurrency(Math.abs(txn.amount), txn.currency || displayCurrency)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded capitalize bg-slate-800/60 text-slate-400">
                          {txn.status || 'classified'}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
