import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService, useServiceArray } from '@/hooks/useService';
import { formatCurrency, formatDate } from '@/lib/formatters';
import type { Asset, DepreciationSchedule } from '@/services/types';
import {
  Building2,
  Laptop,
  Car,
  Package,
  TrendingDown,
  Plus,
  Search,
  Calendar,
  DollarSign,
  BarChart3,
  Trash2,
  Edit,
  Eye,
  AlertTriangle,
  X,
  CheckCircle,
  FileText,
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { AXIOM } from '../../../styles/axiom-tokens';

type AssetView = 'register' | 'depreciation' | 'analytics';

export function AssetsDepreciationView() {
  const [activeView, setActiveView] = useState<AssetView>('register');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewingAsset, setViewingAsset] = useState<Asset | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [disposingAsset, setDisposingAsset] = useState<Asset | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);

  // Form states for Add / Edit
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<Asset['category']>('equipment');
  const [formPurchasePrice, setFormPurchasePrice] = useState<number | ''>(0);
  const [formSalvageValue, setFormSalvageValue] = useState<number | ''>(0);
  const [formUsefulLifeYears, setFormUsefulLifeYears] = useState<number | ''>(5);
  const [formDepreciationMethod, setFormDepreciationMethod] = useState<'straight_line' | 'declining_balance'>('straight_line');
  const [formPurchaseDate, setFormPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [formDepartmentId, setFormDepartmentId] = useState('');
  const [formLocation, setFormLocation] = useState('');

  // Form states for Dispose
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalAmount, setDisposalAmount] = useState<number | ''>(0);

  // Notification / error feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const svc = useOrgServices();

  // Fetch departments for department selector
  const { data: departments } = useServiceArray(
    () => svc.departments.getAll(),
    [svc.orgId]
  );

  // Fetch assets via service layer
  const { data: assets, loading: assetsLoading, refetch: refetchAssets } = useServiceArray(
    () => svc.assets.getAll(),
    [svc.orgId]
  );

  // Fetch asset summary
  const { data: assetSummaryRaw, refetch: refetchSummary } = useService(
    () => svc.assets.getSummary(),
    [svc.orgId]
  );

  // Fetch depreciation schedules via API
  const { data: depSchedule, loading: depLoading, refetch: refetchSchedules } = useServiceArray(
    () => svc.assets.listDepreciationSchedules(),
    [svc.orgId]
  );

  // Fetch asset-specific schedules when viewing an asset
  const { data: viewingAssetSchedules, refetch: refetchViewingSchedules } = useServiceArray(
    () => viewingAsset ? svc.assets.getDepreciationSchedule(viewingAsset.id) : Promise.resolve({ success: true as const, data: [] }),
    [viewingAsset?.id]
  );

  // Normalise summary field names
  const assetSummary = {
    totalAssets: assetSummaryRaw?.totalAssets ?? assets.length,
    totalValue: assetSummaryRaw?.totalCurrentValue ?? assets.reduce((s, a) => s + (a.currentValue || 0), 0),
    totalPurchasePrice: assetSummaryRaw?.totalPurchaseValue ?? assets.reduce((s, a) => s + (a.purchasePrice || 0), 0),
    totalDepreciation: assetSummaryRaw?.totalDepreciation ?? assets.reduce((s, a) => s + (a.accumulatedDepreciation || 0), 0),
  };

  const categories = [
    { id: 'all', label: 'All Assets', icon: Package, color: 'cyan' },
    { id: 'equipment', label: 'Equipment', icon: Laptop, color: 'blue' },
    { id: 'vehicle', label: 'Vehicles', icon: Car, color: 'purple' },
    { id: 'furniture', label: 'Furniture', icon: Building2, color: 'green' },
    { id: 'property', label: 'Property', icon: Building2, color: 'orange' },
    { id: 'software', label: 'Software', icon: Laptop, color: 'cyan' },
  ];

  const filteredAssets = assets.filter(asset => {
    const q = searchQuery.toLowerCase();
    const name = (asset.name ?? '').toLowerCase();
    const code = (asset.assetCode ?? '').toLowerCase();
    const matchesSearch = !q || name.includes(q) || code.includes(q);
    const matchesCategory = !selectedCategory || selectedCategory === 'all' || asset.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const avgDepreciationPct =
    assetSummary.totalPurchasePrice > 0
      ? ((assetSummary.totalDepreciation / assetSummary.totalPurchasePrice) * 100).toFixed(1)
      : '0.0';

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'equipment': return Laptop;
      case 'vehicle': return Car;
      case 'furniture': return Building2;
      case 'property': return Building2;
      case 'software': return Laptop;
      default: return Package;
    }
  };

  const getCategoryColor = (catId: string) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return { bg: AXIOM.iconBoxes.cyan, shadow: AXIOM.shadows.iconCyan };
    
    switch (cat.color) {
      case 'blue': return { bg: AXIOM.iconBoxes.blue, shadow: AXIOM.shadows.iconBlue };
      case 'purple': return { bg: AXIOM.iconBoxes.purple, shadow: AXIOM.shadows.iconPurple };
      case 'green': return { bg: AXIOM.iconBoxes.green, shadow: AXIOM.shadows.iconGreen };
      case 'orange': return { bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.3), rgba(249, 115, 22, 0.3))', shadow: '0 10px 30px -10px rgba(251, 146, 60, 0.6)' };
      default: return { bg: AXIOM.iconBoxes.cyan, shadow: AXIOM.shadows.iconCyan };
    }
  };

  // Live depreciation calculation preview for form
  const liveDepreciationPreview = useMemo(() => {
    const cost = Number(formPurchasePrice) || 0;
    const salvage = Number(formSalvageValue) || 0;
    const life = Number(formUsefulLifeYears) || 1;
    if (cost <= 0 || life <= 0) return { monthly: 0, annual: 0, depreciable: 0 };
    const depreciable = Math.max(0, cost - salvage);

    if (formDepreciationMethod === 'straight_line') {
      const annual = depreciable / life;
      return { monthly: Math.round((annual / 12) * 100) / 100, annual: Math.round(annual * 100) / 100, depreciable };
    } else {
      // Declining balance (200% double declining)
      const rate = 2 / life;
      const annual = cost * rate;
      return { monthly: Math.round((annual / 12) * 100) / 100, annual: Math.round(annual * 100) / 100, depreciable };
    }
  }, [formPurchasePrice, formSalvageValue, formUsefulLifeYears, formDepreciationMethod]);

  // Get current month in YYYY-MM format
  const getCurrentPeriod = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  };

  // Check if depreciation has been posted for current month for a given asset
  const isDepreciationPostedThisMonth = (assetId: string) => {
    const currentPeriod = getCurrentPeriod();
    return depSchedule.some(
      s => s.assetId === assetId && s.period === currentPeriod && s.status === 'posted'
    );
  };

  const resetForm = () => {
    setFormName('');
    setFormCategory('equipment');
    setFormPurchasePrice(0);
    setFormSalvageValue(0);
    setFormUsefulLifeYears(5);
    setFormDepreciationMethod('straight_line');
    setFormPurchaseDate(new Date().toISOString().slice(0, 10));
    setFormDepartmentId('');
    setFormLocation('');
    setActionError(null);
  };

  const openAddModal = () => {
    resetForm();
    setIsAddModalOpen(true);
  };

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setFormName(asset.name);
    setFormCategory(asset.category);
    setFormPurchasePrice(asset.purchasePrice);
    setFormSalvageValue(asset.salvageValue);
    setFormUsefulLifeYears(asset.usefulLifeYears);
    setFormDepreciationMethod(asset.depreciationMethod === 'declining_balance' ? 'declining_balance' : 'straight_line');
    setFormPurchaseDate(asset.purchaseDate?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    setFormDepartmentId(asset.departmentId || '');
    setFormLocation(asset.locationDetails || '');
    setActionError(null);
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setActionError('Asset Name is required');
      return;
    }
    const cost = Number(formPurchasePrice);
    const salvage = Number(formSalvageValue);
    const life = Number(formUsefulLifeYears);

    if (cost < 0 || isNaN(cost)) {
      setActionError('Purchase price must be greater than or equal to 0');
      return;
    }
    if (salvage > cost) {
      setActionError('Salvage value cannot exceed purchase price');
      return;
    }
    if (life <= 0 || isNaN(life)) {
      setActionError('Useful life must be at least 1 year');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    const res = await svc.assets.create({
      name: formName.trim(),
      assetCode: '', // backend will generate unique code like AST-EQP-001
      category: formCategory,
      accountId: '',
      accumulatedDepreciationAccountId: '',
      depreciationExpenseAccountId: '',
      purchaseDate: formPurchaseDate,
      purchasePrice: cost,
      salvageValue: salvage,
      usefulLifeYears: life,
      depreciationMethod: formDepreciationMethod,
      currentValue: cost,
      accumulatedDepreciation: 0,
      status: 'active',
      departmentId: formDepartmentId || undefined,
      locationDetails: formLocation || undefined,
    });

    setIsSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Failed to create asset');
      return;
    }

    setIsAddModalOpen(false);
    setActionSuccess('Asset registered successfully!');
    setTimeout(() => setActionSuccess(null), 4000);
    refetchAssets();
    refetchSummary();
    refetchSchedules();
  };

  const handleUpdateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    if (!formName.trim()) {
      setActionError('Asset Name is required');
      return;
    }
    const salvage = Number(formSalvageValue);
    const life = Number(formUsefulLifeYears);

    if (salvage > editingAsset.purchasePrice) {
      setActionError('Salvage value cannot exceed original purchase price');
      return;
    }
    if (life <= 0 || isNaN(life)) {
      setActionError('Useful life must be at least 1 year');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    const res = await svc.assets.update(editingAsset.id, {
      name: formName.trim(),
      category: formCategory,
      salvageValue: salvage,
      usefulLifeYears: life,
      depreciationMethod: formDepreciationMethod,
      departmentId: formDepartmentId || undefined,
      locationDetails: formLocation || undefined,
    });

    setIsSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Failed to update asset');
      return;
    }

    setEditingAsset(null);
    setActionSuccess('Asset updated successfully!');
    setTimeout(() => setActionSuccess(null), 4000);
    refetchAssets();
    refetchSummary();
  };

  const handleDeleteAsset = async () => {
    if (!assetToDelete) return;
    setIsSubmitting(true);
    setActionError(null);

    const res = await svc.assets.delete(assetToDelete.id);
    setIsSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Cannot delete asset');
      return;
    }

    setAssetToDelete(null);
    setActionSuccess('Asset removed successfully.');
    setTimeout(() => setActionSuccess(null), 4000);
    refetchAssets();
    refetchSummary();
    refetchSchedules();
  };

  const handleDisposeAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposingAsset) return;

    const amount = Number(disposalAmount);
    if (isNaN(amount) || amount < 0) {
      setActionError('Disposal proceeds must be 0 or greater');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    const res = await svc.assets.dispose(disposingAsset.id, disposalDate, amount);
    setIsSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Failed to dispose asset');
      return;
    }

    setDisposingAsset(null);
    setActionSuccess('Asset disposed. Gain/Loss has been accounted for.');
    setTimeout(() => setActionSuccess(null), 4000);
    refetchAssets();
    refetchSummary();
  };

  const handlePostDepreciation = async (assetId: string, period?: string) => {
    const postPeriod = period || new Date().toISOString().slice(0, 7);
    if (postPeriod === getCurrentPeriod() && isDepreciationPostedThisMonth(assetId)) {
      setActionError(`Depreciation for ${postPeriod} has already been posted for this asset.`);
      return;
    }
    setIsSubmitting(true);
    setActionError(null);

    const res = await svc.assets.postDepreciation(assetId, postPeriod);
    setIsSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Failed to post depreciation');
      return;
    }

    setActionSuccess(`Depreciation for ${postPeriod} posted successfully!`);
    setTimeout(() => setActionSuccess(null), 4000);
    refetchAssets();
    refetchSummary();
    refetchSchedules();
    if (viewingAsset && viewingAsset.id === assetId) {
      refetchViewingSchedules();
    }
  };

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Toast notifications */}
      <AnimatePresence>
        {actionSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 right-6 z-50 p-4 rounded-xl flex items-center gap-3 text-sm font-medium shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.9), rgba(5, 150, 105, 0.9))',
              color: '#ffffff',
              border: '1px solid rgba(52, 211, 153, 0.5)',
            }}
          >
            <CheckCircle className="size-5" />
            <span>{actionSuccess}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Package className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Assets & Depreciation
              </h1>
              <p className="text-slate-400 text-sm">Manage fixed assets, automated depreciation schedules, and book values</p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={openAddModal}
            className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
              border: '1px solid rgba(6, 182, 212, 0.5)',
              boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
              color: '#ffffff',
            }}
          >
            <Plus className="size-4" />
            Add Asset
          </motion.button>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Total Assets</p>
              <p className="text-3xl font-bold text-white">{assetSummary.totalAssets}</p>
              <p className="text-xs text-cyan-400 mt-1">
                {assets.filter(a => a.status === 'active').length} active assets
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Package className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Current Value</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(assetSummary.totalValue)}</p>
              <p className="text-xs text-emerald-400 mt-1">Net book value</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.blue,
                boxShadow: AXIOM.shadows.iconBlue,
              }}
            >
              <DollarSign className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Purchase Cost</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(assetSummary.totalPurchasePrice)}</p>
              <p className="text-xs text-purple-400 mt-1">Original capitalized cost</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <BarChart3 className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Depreciation</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(assetSummary.totalDepreciation)}</p>
              <p className="text-xs text-orange-400 mt-1">{avgDepreciationPct}% accumulated</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.3), rgba(249, 115, 22, 0.3))',
                boxShadow: '0 10px 30px -10px rgba(251, 146, 60, 0.6)',
              }}
            >
              <TrendingDown className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 rounded-2xl" style={AXIOM.containers.list}>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActiveView('register')}
          className="flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all cursor-pointer"
          style={activeView === 'register' ? AXIOM.buttons.primary : { color: '#94a3b8' }}
        >
          <Package className="size-4" />
          Asset Register ({assets.length})
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActiveView('depreciation')}
          className="flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all cursor-pointer"
          style={activeView === 'depreciation' ? AXIOM.buttons.primary : { color: '#94a3b8' }}
        >
          <Calendar className="size-4" />
          Depreciation Schedule ({depSchedule.length})
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActiveView('analytics')}
          className="flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all cursor-pointer"
          style={activeView === 'analytics' ? AXIOM.buttons.primary : { color: '#94a3b8' }}
        >
          <BarChart3 className="size-4" />
          Analytics & Health
        </motion.button>
      </div>

      {/* Register View */}
      {activeView === 'register' && (
        <div className="space-y-4">
          {/* Search & Category Filter */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="flex flex-col md:flex-row gap-4 items-center justify-between"
          >
            <div className="relative w-full md:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search assets by name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none"
                style={{
                  background: AXIOM.inputs.background,
                  border: AXIOM.inputs.border,
                }}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const isSelected = selectedCategory === cat.id;
                return (
                  <motion.button
                    key={cat.id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedCategory(isSelected ? null : cat.id)}
                    className="px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-medium transition-all cursor-pointer"
                    style={isSelected ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
                  >
                    <Icon className="size-4" />
                    {cat.label}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>

          {/* Assets Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl overflow-hidden"
            style={AXIOM.containers.list}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ background: 'rgba(148, 163, 184, 0.05)' }}>
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Asset</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Code</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Category</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Purchase Date</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Purchase Price</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Current Value</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Depreciation</th>
                    <th className="text-center px-6 py-4 text-xs font-medium text-slate-400 uppercase">Status</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assetsLoading && assets.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-slate-400 text-sm">
                        Loading assets…
                      </td>
                    </tr>
                  )}
                  {!assetsLoading && filteredAssets.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-slate-400 text-sm">
                        {assets.length === 0
                          ? 'No assets registered yet. Click "+ Add Asset" above to record your first asset.'
                          : 'No assets match your search filter.'}
                      </td>
                    </tr>
                  )}
                  {filteredAssets.map((asset, index) => {
                    const Icon = getCategoryIcon(asset.category);
                    const iconStyle = getCategoryColor(asset.category);
                    return (
                      <motion.tr
                        key={asset.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + index * 0.02 }}
                        className="group hover:bg-slate-800/40 transition-colors"
                        style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                              style={{ background: iconStyle.bg, boxShadow: iconStyle.shadow }}
                            >
                              <Icon className="size-5 text-white" />
                            </div>
                            <div>
                              <div className="text-white font-medium">{asset.name}</div>
                              {asset.locationDetails && (
                                <div className="text-xs text-slate-500">{asset.locationDetails}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-slate-300 font-mono text-sm">{asset.assetCode}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-slate-400 capitalize">{asset.category}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-slate-400">{formatDate(asset.purchaseDate)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-white font-medium">{formatCurrency(asset.purchasePrice)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-cyan-400 font-medium">{formatCurrency(asset.currentValue)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-orange-400 font-medium">{formatCurrency(asset.accumulatedDepreciation)}</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span 
                            className="inline-flex px-3 py-1 rounded-lg text-xs font-medium"
                            style={
                              asset.status === 'active' ? AXIOM.badges.success :
                              asset.status === 'disposed' ? AXIOM.badges.danger :
                              { background: 'rgba(251, 146, 60, 0.1)', color: '#fb923c', border: '1px solid rgba(251, 146, 60, 0.3)' }
                            }
                          >
                            {(asset.status ?? 'active').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Post Depreciation Shortcut */}
                            {asset.status === 'active' && (
                              <>
                                {isDepreciationPostedThisMonth(asset.id) ? (
                                  <div 
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                                    style={{ background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' }}
                                    title={`Depreciation for ${getCurrentPeriod()} already posted`}
                                  >
                                    <CheckCircle className="size-3" />
                                    Posted
                                  </div>
                                ) : (
                                  <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => handlePostDepreciation(asset.id)}
                                    title={`Post depreciation for ${getCurrentPeriod()}`}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1"
                                    style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}
                                  >
                                    <TrendingDown className="size-3" />
                                    Post {getCurrentPeriod()}
                                  </motion.button>
                                )}
                              </>
                            )}

                            {/* View Asset */}
                            <motion.button 
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => setViewingAsset(asset)}
                              title="View Details & Schedule"
                              className="p-2 rounded-lg cursor-pointer"
                              style={{ background: 'rgba(6, 182, 212, 0.1)' }}
                            >
                              <Eye className="size-4 text-cyan-400" />
                            </motion.button>

                            {/* Edit Asset */}
                            {asset.status === 'active' && (
                              <motion.button 
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => openEditModal(asset)}
                                title="Edit Asset"
                                className="p-2 rounded-lg cursor-pointer"
                                style={{ background: 'rgba(59, 130, 246, 0.1)' }}
                              >
                                <Edit className="size-4 text-blue-400" />
                              </motion.button>
                            )}

                            {/* Dispose Asset */}
                            {asset.status === 'active' && (
                              <motion.button 
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => {
                                  setDisposingAsset(asset);
                                  setDisposalAmount(asset.currentValue);
                                  setDisposalDate(new Date().toISOString().slice(0, 10));
                                }}
                                title="Dispose Asset"
                                className="p-2 rounded-lg cursor-pointer"
                                style={{ background: 'rgba(251, 146, 60, 0.1)' }}
                              >
                                <DollarSign className="size-4 text-orange-400" />
                              </motion.button>
                            )}

                            {/* Delete Asset */}
                            <motion.button 
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => {
                                setAssetToDelete(asset);
                                setActionError(null);
                              }}
                              title="Delete Asset"
                              className="p-2 rounded-lg cursor-pointer"
                              style={{ background: 'rgba(239, 68, 68, 0.1)' }}
                            >
                              <Trash2 className="size-4 text-red-400" />
                            </motion.button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      )}

      {/* Depreciation Schedule View */}
      {activeView === 'depreciation' && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="rounded-2xl overflow-hidden"
            style={AXIOM.containers.list}
          >
            <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
              <div>
                <h3 className="text-lg font-semibold text-white">Monthly Depreciation Schedules</h3>
                <p className="text-sm text-slate-400 mt-1">Review posted accounting entries and schedule future depreciation</p>
              </div>
              <div className="text-xs text-slate-400">
                Total Schedules: <span className="text-white font-medium">{depSchedule.length}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ background: 'rgba(148, 163, 184, 0.05)' }}>
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Period</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Asset</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Opening Value</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Depreciation</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Closing Value</th>
                    <th className="text-center px-6 py-4 text-xs font-medium text-slate-400 uppercase">Status</th>
                    <th className="text-center px-6 py-4 text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {depLoading && depSchedule.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">
                        Loading schedules…
                      </td>
                    </tr>
                  )}
                  {!depLoading && depSchedule.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">
                        No depreciation entries have been recorded yet. Post depreciation from the Asset Register.
                      </td>
                    </tr>
                  )}
                  {depSchedule.map((schedule, index) => {
                    const asset = assets.find(a => a.id === schedule.assetId);
                    return (
                      <motion.tr
                        key={schedule.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + index * 0.02 }}
                        style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}
                      >
                        <td className="px-6 py-4">
                          <span className="text-white font-mono">{schedule.period}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-white font-medium">{asset?.name || 'Asset ID: ' + schedule.assetId}</div>
                          {asset?.assetCode && <div className="text-xs text-slate-500 font-mono">{asset.assetCode}</div>}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-slate-300">{formatCurrency(schedule.openingValue ?? 0)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-orange-400 font-medium">{formatCurrency(schedule.depreciationAmount ?? 0)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-cyan-400 font-medium">{formatCurrency(schedule.closingValue ?? 0)}</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span 
                            className="inline-flex px-3 py-1 rounded-lg text-xs font-medium"
                            style={
                              schedule.status === 'posted' ? AXIOM.badges.success :
                              schedule.status === 'scheduled' ? AXIOM.badges.info :
                              AXIOM.badges.danger
                            }
                          >
                            {schedule.status ?? 'posted'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {schedule.status === 'scheduled' ? (
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handlePostDepreciation(schedule.assetId, schedule.period)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                              style={{ background: 'rgba(6, 182, 212, 0.1)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.3)' }}
                            >
                              Post Entry
                            </motion.button>
                          ) : (
                            <span className="text-xs text-slate-500 font-mono">Posted to Ledger</span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      )}

      {/* Analytics View */}
      {activeView === 'analytics' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartBlue}
          >
            <h3 className="text-lg font-semibold text-white mb-4">Asset Capitalization by Category</h3>
            <div className="space-y-4">
              {categories.filter(c => c.id !== 'all').map((cat) => {
                const catAssets = assets.filter(a => a.category === cat.id);
                const count = catAssets.length;
                const value = catAssets.reduce((sum, a) => sum + (a.currentValue || 0), 0);
                const percentage = assetSummary.totalValue > 0 ? (value / assetSummary.totalValue) * 100 : 0;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center justify-between mb-2 text-sm">
                      <span className="text-slate-300 capitalize flex items-center gap-2">
                        {cat.label} ({count})
                      </span>
                      <span className="text-white font-medium">{formatCurrency(value)} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.8, delay: 0.1 }}
                        className="h-full rounded-full"
                        style={{
                          background: cat.color === 'cyan' ? 'linear-gradient(90deg, #06b6d4, #0891b2)' :
                                     cat.color === 'blue' ? 'linear-gradient(90deg, #3b82f6, #2563eb)' :
                                     cat.color === 'purple' ? 'linear-gradient(90deg, #a855f7, #9333ea)' :
                                     cat.color === 'green' ? 'linear-gradient(90deg, #10b981, #059669)' :
                                     'linear-gradient(90deg, #fb923c, #f97316)'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.chartBlue}
          >
            <h3 className="text-lg font-semibold text-white mb-4">Financial Health & Valuation Metrics</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Historical Purchase Cost</div>
                  <div className="text-xl font-bold text-white mt-1">{formatCurrency(assetSummary.totalPurchasePrice)}</div>
                </div>
                <div className="text-xs text-slate-400">Balance sheet basis</div>
              </div>
              <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Total Accumulated Depreciation</div>
                  <div className="text-xl font-bold text-orange-400 mt-1">{formatCurrency(assetSummary.totalDepreciation)}</div>
                </div>
                <div className="text-xs text-orange-300 font-medium">{avgDepreciationPct}% of asset base</div>
              </div>
              <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Net Book Value (Carrying Amount)</div>
                  <div className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(assetSummary.totalValue)}</div>
                </div>
                <div className="text-xs text-emerald-300 font-medium">
                  {assetSummary.totalPurchasePrice > 0
                    ? ((assetSummary.totalValue / assetSummary.totalPurchasePrice) * 100).toFixed(1) + '% remaining'
                    : '100% remaining'}
                </div>
              </div>
              <div className="p-4 rounded-xl flex items-center justify-between" style={AXIOM.containers.item}>
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Active / Fully Depreciated / Disposed</div>
                  <div className="text-sm font-semibold text-slate-200 mt-1">
                    {assets.filter(a => a.status === 'active').length} Active &bull; {assets.filter(a => a.status === 'fully_depreciated').length} Depreciated &bull; {assets.filter(a => a.status === 'disposed').length} Disposed
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ─── ADD ASSET MODAL ─── */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl"
              style={AXIOM.containers.list}
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400">
                    <Plus className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Add Fixed Asset</h2>
                    <p className="text-xs text-slate-400">Register new equipment, vehicle, furniture, or property</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
                >
                  <X className="size-5" />
                </button>
              </div>

              <form onSubmit={handleCreateAsset} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                {actionError && (
                  <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1">Asset Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. MacBook Pro M3 Max 64GB"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Category *</label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value as Asset['category'])}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    >
                      <option value="equipment">Equipment</option>
                      <option value="vehicle">Vehicles</option>
                      <option value="furniture">Furniture & Fixtures</option>
                      <option value="property">Property & Buildings</option>
                      <option value="software">Software & Licenses</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Purchase Date *</label>
                    <input
                      type="date"
                      required
                      value={formPurchaseDate}
                      onChange={(e) => setFormPurchaseDate(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Purchase Price ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formPurchasePrice}
                      onChange={(e) => setFormPurchasePrice(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Salvage Value ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formSalvageValue}
                      onChange={(e) => setFormSalvageValue(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Useful Life (Years) *</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="50"
                      required
                      value={formUsefulLifeYears}
                      onChange={(e) => setFormUsefulLifeYears(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Depreciation Method *</label>
                    <select
                      value={formDepreciationMethod}
                      onChange={(e) => setFormDepreciationMethod(e.target.value as 'straight_line' | 'declining_balance')}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    >
                      <option value="straight_line">Straight Line (Equal periodic)</option>
                      <option value="declining_balance">Declining Balance (Accelerated 200%)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Department</label>
                    <select
                      value={formDepartmentId}
                      onChange={(e) => setFormDepartmentId(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    >
                      <option value="">(None / General)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Location Details</label>
                    <input
                      type="text"
                      placeholder="e.g. Headquarters - Floor 3"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                </div>

                {/* Live Depreciation Summary Preview */}
                <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/20 space-y-2">
                  <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingDown className="size-4" />
                    Projected Depreciation Schedule
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm pt-1">
                    <div>
                      <div className="text-xs text-slate-400">Depreciable Base</div>
                      <div className="font-semibold text-white">{formatCurrency(liveDepreciationPreview.depreciable)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Annual Expense</div>
                      <div className="font-semibold text-orange-400">{formatCurrency(liveDepreciationPreview.annual)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Monthly Expense</div>
                      <div className="font-semibold text-cyan-400">{formatCurrency(liveDepreciationPreview.monthly)}/mo</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-xl text-sm font-medium text-white flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    style={AXIOM.buttons.primary}
                  >
                    {isSubmitting ? 'Registering...' : 'Register Asset'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── EDIT ASSET MODAL ─── */}
      <AnimatePresence>
        {editingAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
              style={AXIOM.containers.list}
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400">
                    <Edit className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Edit Asset</h2>
                    <p className="text-xs text-slate-400 font-mono">{editingAsset.assetCode}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingAsset(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
                >
                  <X className="size-5" />
                </button>
              </div>

              <form onSubmit={handleUpdateAsset} className="p-6 space-y-4">
                {actionError && (
                  <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Asset Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value as Asset['category'])}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    >
                      <option value="equipment">Equipment</option>
                      <option value="vehicle">Vehicles</option>
                      <option value="furniture">Furniture</option>
                      <option value="property">Property</option>
                      <option value="software">Software</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Department</label>
                    <select
                      value={formDepartmentId}
                      onChange={(e) => setFormDepartmentId(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    >
                      <option value="">(None / General)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Salvage Value ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formSalvageValue}
                      onChange={(e) => setFormSalvageValue(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Useful Life (Years)</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={formUsefulLifeYears}
                      onChange={(e) => setFormUsefulLifeYears(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                      className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Location Details</label>
                  <input
                    type="text"
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditingAsset(null)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-xl text-sm font-medium text-white cursor-pointer disabled:opacity-50"
                    style={AXIOM.buttons.primary}
                  >
                    {isSubmitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── VIEW ASSET DETAILS & SCHEDULE MODAL ─── */}
      <AnimatePresence>
        {viewingAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl"
              style={AXIOM.containers.list}
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400">
                    <Eye className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{viewingAsset.name}</h2>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono text-cyan-300">{viewingAsset.assetCode}</span>
                      <span>&bull;</span>
                      <span className="capitalize">{viewingAsset.category}</span>
                      <span>&bull;</span>
                      <span className="capitalize">{viewingAsset.status.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setViewingAsset(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                {/* Financial overview tiles */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-xs text-slate-400">Purchase Price</div>
                    <div className="text-lg font-bold text-white mt-1">{formatCurrency(viewingAsset.purchasePrice)}</div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-xs text-slate-400">Current Book Value</div>
                    <div className="text-lg font-bold text-cyan-400 mt-1">{formatCurrency(viewingAsset.currentValue)}</div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-xs text-slate-400">Accumulated Depr.</div>
                    <div className="text-lg font-bold text-orange-400 mt-1">{formatCurrency(viewingAsset.accumulatedDepreciation)}</div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-xs text-slate-400">Salvage Value</div>
                    <div className="text-lg font-bold text-slate-300 mt-1">{formatCurrency(viewingAsset.salvageValue)}</div>
                  </div>
                </div>

                {/* Properties list */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm bg-slate-900/40 p-4 rounded-xl border border-slate-800/60">
                  <div>
                    <span className="text-slate-400 text-xs block">Purchase Date</span>
                    <span className="text-white font-medium">{formatDate(viewingAsset.purchaseDate)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs block">Useful Life</span>
                    <span className="text-white font-medium">{viewingAsset.usefulLifeYears} Years</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs block">Method</span>
                    <span className="text-white font-medium capitalize">{viewingAsset.depreciationMethod.replace(/_/g, ' ')}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs block">Department</span>
                    <span className="text-white font-medium">
                      {departments.find(d => d.id === viewingAsset.departmentId)?.name || 'General / Unassigned'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs block">Location</span>
                    <span className="text-white font-medium">{viewingAsset.locationDetails || 'Not specified'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs block">Monthly Depr Rate</span>
                    <span className="text-cyan-400 font-medium">
                      {formatCurrency(
                        viewingAsset.depreciationMethod === 'straight_line'
                          ? (viewingAsset.purchasePrice - viewingAsset.salvageValue) / (viewingAsset.usefulLifeYears * 12)
                          : (viewingAsset.currentValue * (2 / viewingAsset.usefulLifeYears)) / 12
                      )}/mo
                    </span>
                  </div>
                </div>

                {/* Depreciation History table for this asset */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                      <Clock className="size-4 text-cyan-400" />
                      Depreciation Schedule History
                    </h3>
                    {viewingAsset.status === 'active' && (
                      <>
                        {isDepreciationPostedThisMonth(viewingAsset.id) ? (
                          <div 
                            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                            style={{ background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)' }}
                          >
                            <CheckCircle className="size-3" />
                            {getCurrentPeriod()} Posted
                          </div>
                        ) : (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handlePostDepreciation(viewingAsset.id)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5"
                            style={{ background: 'rgba(6, 182, 212, 0.2)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.4)' }}
                          >
                            <TrendingDown className="size-3" />
                            Post {getCurrentPeriod()}
                          </motion.button>
                        )}
                      </>
                    )}
                  </div>

                  {viewingAssetSchedules.length === 0 ? (
                    <div className="p-6 text-center text-sm text-slate-400 bg-slate-900/30 rounded-xl border border-slate-800/40">
                      No depreciation has been posted for this asset yet.
                    </div>
                  ) : (
                    <div className="rounded-xl overflow-hidden border border-slate-800">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-900/80 text-slate-400">
                          <tr>
                            <th className="text-left px-4 py-2.5">Period</th>
                            <th className="text-right px-4 py-2.5">Opening Value</th>
                            <th className="text-right px-4 py-2.5">Depreciation</th>
                            <th className="text-right px-4 py-2.5">Closing Value</th>
                            <th className="text-center px-4 py-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {viewingAssetSchedules.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-800/30">
                              <td className="px-4 py-2.5 font-mono text-white">{s.period}</td>
                              <td className="px-4 py-2.5 text-right text-slate-300">{formatCurrency(s.openingValue)}</td>
                              <td className="px-4 py-2.5 text-right text-orange-400 font-medium">-{formatCurrency(s.depreciationAmount)}</td>
                              <td className="px-4 py-2.5 text-right text-cyan-400 font-medium">{formatCurrency(s.closingValue)}</td>
                              <td className="px-4 py-2.5 text-center">
                                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400">
                                  {s.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setViewingAsset(null)}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white"
                  style={AXIOM.buttons.secondary}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── DISPOSE ASSET MODAL ─── */}
      <AnimatePresence>
        {disposingAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
              style={AXIOM.containers.list}
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-orange-500/20 text-orange-400">
                    <DollarSign className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Dispose Asset</h2>
                    <p className="text-xs text-slate-400 font-mono">{disposingAsset.assetCode}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDisposingAsset(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="size-5" />
                </button>
              </div>

              <form onSubmit={handleDisposeAsset} className="p-6 space-y-4">
                {actionError && (
                  <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Asset:</span>
                    <span className="text-white font-medium">{disposingAsset.name}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Current Carrying Value:</span>
                    <span className="text-cyan-400 font-medium">{formatCurrency(disposingAsset.currentValue)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Disposal Date *</label>
                  <input
                    type="date"
                    required
                    value={disposalDate}
                    onChange={(e) => setDisposalDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Disposal Proceeds ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={disposalAmount}
                    onChange={(e) => setDisposalAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                  <div className="text-xs text-slate-400 mt-1">
                    {Number(disposalAmount) > disposingAsset.currentValue ? (
                      <span className="text-emerald-400">
                        Gain on disposal: +{formatCurrency(Number(disposalAmount) - disposingAsset.currentValue)}
                      </span>
                    ) : Number(disposalAmount) < disposingAsset.currentValue ? (
                      <span className="text-orange-400">
                        Loss on disposal: -{formatCurrency(disposingAsset.currentValue - Number(disposalAmount))}
                      </span>
                    ) : (
                      <span>Break-even disposal ($0 gain/loss)</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDisposingAsset(null)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'Recording...' : 'Confirm Disposal'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── DELETE ASSET CONFIRMATION MODAL ─── */}
      <AnimatePresence>
        {assetToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl p-6 space-y-4"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center gap-3 text-red-400">
                <div className="p-3 rounded-xl bg-red-500/20">
                  <Trash2 className="size-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Delete Asset?</h3>
                  <p className="text-xs text-slate-400 font-mono">{assetToDelete.assetCode}</p>
                </div>
              </div>

              {actionError ? (
                <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs">
                  {actionError}
                </div>
              ) : (
                <p className="text-sm text-slate-300">
                  Are you sure you want to permanently delete <strong className="text-white">{assetToDelete.name}</strong>?
                  <br />
                  <span className="text-xs text-slate-400 mt-2 block">
                    Note: Assets with posted depreciation cannot be deleted for accounting audit compliance. If it has been decommissioned or sold, use <em>Dispose</em> instead.
                  </span>
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAssetToDelete(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleDeleteAsset}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}