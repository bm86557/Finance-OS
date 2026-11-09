import { useState } from 'react';
import { motion } from 'motion/react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useServiceArray, useService } from '@/hooks/useService';
import { formatCurrency, formatDate } from '@/lib/formatters';
import type { InventoryItem, InventoryTransaction } from '@/services/types';
import { 
  Package, 
  TrendingUp,
  AlertTriangle,
  Plus,
  Search,
  BarChart3,
  DollarSign,
  ShoppingCart,
  Archive,
  Edit,
  Eye,
  RefreshCw,
  X,
  Trash2,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { AXIOM } from '../../../styles/axiom-tokens';

type InventoryView = 'items' | 'transactions' | 'analytics';

export function InventoryManagementView() {
  const [activeView, setActiveView] = useState<InventoryView>('items');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal states
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isEditItemModalOpen, setIsEditItemModalOpen] = useState(false);
  const [isDeleteItemModalOpen, setIsDeleteItemModalOpen] = useState(false);
  const [isNewPurchaseModalOpen, setIsNewPurchaseModalOpen] = useState(false);
  const [isNewSaleModalOpen, setIsNewSaleModalOpen] = useState(false);
  const [isNewAdjustmentModalOpen, setIsNewAdjustmentModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  
  // Add Item form states
  const [formSku, setFormSku] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formUnit, setFormUnit] = useState('unit');
  const [formReorderLevel, setFormReorderLevel] = useState<number | ''>('');
  const [formReorderQuantity, setFormReorderQuantity] = useState<number | ''>('');
  const [formSellingPrice, setFormSellingPrice] = useState<number | ''>('');
  
  // New Purchase form states
  const [purchaseItemId, setPurchaseItemId] = useState('');
  const [purchaseQuantity, setPurchaseQuantity] = useState<number | ''>('');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState<number | ''>('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseReference, setPurchaseReference] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [purchaseBankAccountId, setPurchaseBankAccountId] = useState(''); // NEW
  
  // Sale form states
  const [saleItemId, setSaleItemId] = useState('');
  const [saleQuantity, setSaleQuantity] = useState<number | ''>('');
  const [saleUnitPrice, setSaleUnitPrice] = useState<number | ''>('');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [saleReference, setSaleReference] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [saleBankAccountId, setSaleBankAccountId] = useState(''); // NEW
  
  // Adjustment form states
  const [adjustmentItemId, setAdjustmentItemId] = useState('');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState<number | ''>('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [adjustmentNotes, setAdjustmentNotes] = useState('');

  const svc = useOrgServices();

  const { data: inventoryItems, loading: itemsLoading, error: itemsError, refetch: refetchItems } = useServiceArray(
    () => svc.inventory.getAll(),
    [svc.orgId],
    ['inventoryItems'],
  );

  const { data: inventoryTransactions, loading: txnLoading, error: txnError, refetch: refetchTransactions } = useServiceArray(
    () => svc.inventory.getAllTransactions(),
    [svc.orgId],
    ['inventoryTransactions', 'inventoryItems'],
  );
  
  // NEW: Fetch bank accounts for payment selection
  const { data: bankAccounts, loading: accountsLoading } = useServiceArray(
    () => svc.accounts.getBankAccounts(),
    [svc.orgId],
    ['bankAccounts'],
  );
  
  // Fetch real turnover data
  const { data: turnoverData, loading: turnoverLoading } = useService(
    () => svc.inventory.getTurnover(12), // 12 months
    [svc.orgId],
    ['inventoryTransactions', 'inventoryItems']
  );

  const loadError = itemsError || txnError;

  // Derive summary from items list (avoids a second network round-trip)
  const inventorySummary = {
    totalItems: inventoryItems.length,
    totalValue: inventoryItems.reduce((sum, i) => sum + i.currentStock * i.averageCost, 0),
    lowStockCount: inventoryItems.filter(i => i.currentStock <= i.reorderLevel).length,
    totalUnits: inventoryItems.reduce((sum, i) => sum + i.currentStock, 0),
  };

  const lowStockItems = inventoryItems.filter(item => item.currentStock <= item.reorderLevel);

  const filteredItems = inventoryItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const getStockStatus = (item: typeof inventoryItems[0]) => {
    if (item.currentStock === 0) return { label: 'Out of Stock', color: 'red' };
    if (item.currentStock <= item.reorderLevel) return { label: 'Low Stock', color: 'orange' };
    return { label: 'In Stock', color: 'green' };
  };
  
  // Handler: Add new inventory item
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    
    if (!formSku || !formName) {
      setActionError('SKU and Name are required');
      return;
    }
    
    setIsSubmitting(true);
    
    const res = await svc.inventory.create({
      sku: formSku.trim(),
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      category: formCategory.trim() || '',
      unit: formUnit || 'unit',
      costingMethod: 'weighted_average',
      currentStock: 0,
      reorderLevel: Number(formReorderLevel) || 0,
      reorderQuantity: Number(formReorderQuantity) || 0,
      averageCost: 0,
      lastCost: 0,
      sellingPrice: Number(formSellingPrice) || 0,
      assetAccountId: '', // TODO: Link to accounts
      cogsAccountId: '', // TODO: Link to accounts
      isActive: true,
    });
    
    setIsSubmitting(false);
    
    if (!res.success) {
      setActionError(res.error || 'Failed to create item');
      return;
    }
    
    setActionSuccess(`Item "${formName}" created successfully!`);
    setTimeout(() => setActionSuccess(null), 3000);
    
    // Reset form and close modal
    setFormSku('');
    setFormName('');
    setFormDescription('');
    setFormCategory('');
    setFormUnit('unit');
    setFormReorderLevel('');
    setFormReorderQuantity('');
    setFormSellingPrice('');
    setIsAddItemModalOpen(false);
    refetchItems();
  };
  
  // Handler: Record new purchase transaction
  const handleNewPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    
    if (!purchaseItemId || !purchaseQuantity || !purchaseUnitCost) {
      setActionError('Item, quantity, and unit cost are required');
      return;
    }
    
    if (!purchaseBankAccountId) {
      setActionError('Please select a bank account for payment');
      return;
    }
    
    const quantity = Number(purchaseQuantity);
    const unitCost = Number(purchaseUnitCost);
    
    if (quantity <= 0) {
      setActionError('Quantity must be greater than zero');
      return;
    }
    
    if (unitCost < 0) {
      setActionError('Unit cost cannot be negative');
      return;
    }
    
    setIsSubmitting(true);
    
    console.log('[handleNewPurchase] Submitting with bankAccountId:', purchaseBankAccountId);
    
    const res = await svc.inventory.recordTransaction({
      inventoryItemId: purchaseItemId,
      date: purchaseDate,
      type: 'purchase',
      quantity: quantity,
      unitCost: unitCost,
      totalAmount: quantity * unitCost,
      referenceNumber: purchaseReference.trim() || undefined,
      notes: purchaseNotes.trim() || undefined,
      bankAccountId: purchaseBankAccountId, // NEW: Include bank account
      idempotencyKey: `purchase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
    
    console.log('[handleNewPurchase] Response:', res);
    
    setIsSubmitting(false);
    
    if (!res.success) {
      setActionError(res.error || 'Failed to record purchase');
      return;
    }
    
    const item = inventoryItems.find(i => i.id === purchaseItemId);
    const account = bankAccounts.find(a => a.id === purchaseBankAccountId);
    setActionSuccess(`Purchase recorded for "${item?.name}"! Stock updated and expense recorded in ${account?.bankName || 'selected account'}.`);
    setTimeout(() => setActionSuccess(null), 4000);
    
    // Reset form and close modal
    setPurchaseItemId('');
    setPurchaseQuantity('');
    setPurchaseUnitCost('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setPurchaseReference('');
    setPurchaseNotes('');
    setPurchaseBankAccountId('');
    setIsNewPurchaseModalOpen(false);
    refetchItems();
    refetchTransactions();
  };
  
  // Handler: Edit existing item
  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    
    if (!selectedItem || !formSku || !formName) {
      setActionError('SKU and Name are required');
      return;
    }
    
    setIsSubmitting(true);
    
    const res = await svc.inventory.update(selectedItem.id, {
      sku: formSku.trim(),
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      category: formCategory.trim() || '',
      unit: formUnit || 'unit',
      reorderLevel: Number(formReorderLevel) || 0,
      reorderQuantity: Number(formReorderQuantity) || 0,
      sellingPrice: Number(formSellingPrice) || 0,
    });
    
    setIsSubmitting(false);
    
    if (!res.success) {
      setActionError(res.error || 'Failed to update item');
      return;
    }
    
    setActionSuccess(`Item "${formName}" updated successfully!`);
    setTimeout(() => setActionSuccess(null), 3000);
    
    // Reset and close
    setFormSku('');
    setFormName('');
    setFormDescription('');
    setFormCategory('');
    setFormUnit('unit');
    setFormReorderLevel('');
    setFormReorderQuantity('');
    setFormSellingPrice('');
    setSelectedItem(null);
    setIsEditItemModalOpen(false);
    refetchItems();
  };
  
  // Handler: Delete item (soft delete)
  const handleDeleteItem = async () => {
    if (!selectedItem) return;
    
    setActionError(null);
    setIsSubmitting(true);
    
    const res = await svc.inventory.update(selectedItem.id, { isActive: false });
    
    setIsSubmitting(false);
    
    if (!res.success) {
      setActionError(res.error || 'Failed to delete item');
      return;
    }
    
    setActionSuccess(`Item "${selectedItem.name}" deleted successfully!`);
    setTimeout(() => setActionSuccess(null), 3000);
    
    setSelectedItem(null);
    setIsDeleteItemModalOpen(false);
    refetchItems();
  };
  
  // Handler: Record new sale transaction
  const handleNewSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    
    if (!saleItemId || !saleQuantity || !saleUnitPrice) {
      setActionError('Item, quantity, and unit price are required');
      return;
    }
    
    if (!saleBankAccountId) {
      setActionError('Please select a bank account to receive payment');
      return;
    }
    
    const quantity = Number(saleQuantity);
    const unitPrice = Number(saleUnitPrice);
    
    if (quantity <= 0) {
      setActionError('Quantity must be greater than zero');
      return;
    }
    
    if (unitPrice < 0) {
      setActionError('Unit price cannot be negative');
      return;
    }
    
    // Validate stock availability
    const item = inventoryItems.find(i => i.id === saleItemId);
    if (!item) {
      setActionError('Item not found');
      return;
    }
    
    if (item.currentStock < quantity) {
      setActionError(`Insufficient stock. Available: ${item.currentStock}, Requested: ${quantity}`);
      return;
    }
    
    setIsSubmitting(true);
    
    console.log('[handleNewSale] Submitting with bankAccountId:', saleBankAccountId);
    
    const res = await svc.inventory.recordTransaction({
      inventoryItemId: saleItemId,
      date: saleDate,
      type: 'sale',
      quantity: -quantity, // Negative for sales
      unitCost: item.averageCost, // Freeze cost basis at sale time
      totalAmount: quantity * unitPrice, // Revenue
      referenceNumber: saleReference.trim() || undefined,
      notes: saleNotes.trim() || undefined,
      bankAccountId: saleBankAccountId, // NEW: Include bank account for income
      idempotencyKey: `sale-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
    
    console.log('[handleNewSale] Response:', res);
    
    setIsSubmitting(false);
    
    if (!res.success) {
      setActionError(res.error || 'Failed to record sale');
      return;
    }
    
    const account = bankAccounts.find(a => a.id === saleBankAccountId);
    setActionSuccess(`Sale recorded for "${item.name}"! Stock updated and revenue recorded in ${account?.bankName || 'selected account'}.`);
    setTimeout(() => setActionSuccess(null), 4000);
    
    // Reset form and close modal
    setSaleItemId('');
    setSaleQuantity('');
    setSaleUnitPrice('');
    setSaleDate(new Date().toISOString().slice(0, 10));
    setSaleReference('');
    setSaleNotes('');
    setSaleBankAccountId('');
    setIsNewSaleModalOpen(false);
    refetchItems();
    refetchTransactions();
  };
  
  // Handler: Record adjustment (correction)
  const handleNewAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    
    if (!adjustmentItemId || !adjustmentQuantity) {
      setActionError('Item and quantity are required');
      return;
    }
    
    const quantity = Number(adjustmentQuantity);
    
    if (quantity === 0) {
      setActionError('Adjustment quantity cannot be zero');
      return;
    }
    
    const item = inventoryItems.find(i => i.id === adjustmentItemId);
    if (!item) {
      setActionError('Item not found');
      return;
    }
    
    // Validate negative adjustments don't create negative stock
    if (quantity < 0 && item.currentStock + quantity < 0) {
      setActionError(`Invalid adjustment. Current stock: ${item.currentStock}, Adjustment: ${quantity}`);
      return;
    }
    
    setIsSubmitting(true);
    
    const res = await svc.inventory.recordTransaction({
      inventoryItemId: adjustmentItemId,
      date: adjustmentDate,
      type: 'adjustment',
      quantity: quantity,
      unitCost: item.averageCost,
      totalAmount: 0, // Adjustments don't affect financials directly
      referenceNumber: adjustmentReason.trim() || undefined,
      notes: adjustmentNotes.trim() || undefined,
      idempotencyKey: `adjustment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
    
    setIsSubmitting(false);
    
    if (!res.success) {
      setActionError(res.error || 'Failed to record adjustment');
      return;
    }
    
    setActionSuccess(`Adjustment recorded for "${item.name}"! Stock ${quantity > 0 ? 'increased' : 'decreased'}.`);
    setTimeout(() => setActionSuccess(null), 3000);
    
    // Reset form and close modal
    setAdjustmentItemId('');
    setAdjustmentQuantity('');
    setAdjustmentReason('');
    setAdjustmentDate(new Date().toISOString().slice(0, 10));
    setAdjustmentNotes('');
    setIsNewAdjustmentModalOpen(false);
    refetchItems();
    refetchTransactions();
  };
  
  // Helper: Open edit modal with selected item data
  const openEditModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setFormSku(item.sku);
    setFormName(item.name);
    setFormDescription(item.description || '');
    setFormCategory(item.category);
    setFormUnit(item.unit);
    setFormReorderLevel(item.reorderLevel);
    setFormReorderQuantity(item.reorderQuantity);
    setFormSellingPrice(item.sellingPrice);
    setActionError(null);
    setIsEditItemModalOpen(true);
  };
  
  // Helper: Open delete modal with selected item
  const openDeleteModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setActionError(null);
    setIsDeleteItemModalOpen(true);
  };

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
              <Package className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Inventory Management
              </h1>
              <p className="text-slate-400 text-sm">Track stock levels, costing, and valuations</p>
            </div>
          </div>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsNewAdjustmentModalOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <RefreshCw className="size-4" />
              Adjustment
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsNewSaleModalOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <Archive className="size-4" />
              Record Sale
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsNewPurchaseModalOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <ShoppingCart className="size-4" />
              New Purchase
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsAddItemModalOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                border: '1px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                color: '#ffffff',
              }}
            >
              <Plus className="size-4" />
              Add Item
            </motion.button>
          </div>
        </div>
      </motion.div>

      {loadError && (
        <div
          className="rounded-xl px-4 py-3 text-sm text-amber-100"
          style={{
            background: 'rgba(251, 146, 60, 0.12)',
            border: '1px solid rgba(251, 146, 60, 0.35)',
          }}
          role="alert"
        >
          {loadError}
        </div>
      )}

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
              <p className="text-slate-400 text-sm mb-1">Total Items</p>
              <p className="text-3xl font-bold text-white">{itemsLoading ? '—' : inventorySummary.totalItems}</p>
              <p className="text-xs text-cyan-400 mt-1">{itemsLoading ? '…' : `${inventorySummary.totalUnits} total units`}</p>
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
              <p className="text-slate-400 text-sm mb-1">Total Value</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(inventorySummary.totalValue)}</p>
              <p className="text-xs text-blue-400 mt-1">At average cost</p>
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
              <p className="text-slate-400 text-sm mb-1">Low Stock</p>
              <p className="text-3xl font-bold text-white">{itemsLoading ? '—' : inventorySummary.lowStockCount}</p>
              <p className="text-xs text-orange-400 mt-1">Items need reorder</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.3), rgba(249, 115, 22, 0.3))',
                boxShadow: '0 10px 30px -10px rgba(251, 146, 60, 0.6)',
              }}
            >
              <AlertTriangle className="size-6 text-white" />
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
              <p className="text-slate-400 text-sm mb-1">Turnover Rate</p>
              <p className="text-3xl font-bold text-white">
                {turnoverLoading ? '—' : 
                 turnoverData?.turnoverRatio ? `${turnoverData.turnoverRatio}x` : 
                 'N/A'}
              </p>
              <p className="text-xs text-emerald-400 mt-1">
                {turnoverData?.hasSufficientHistory === false ? 'Insufficient data' : 'Annual average'}
              </p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <TrendingUp className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 rounded-2xl"
          style={{
            background: 'rgba(251, 146, 60, 0.1)',
            border: '1px solid rgba(251, 146, 60, 0.3)',
          }}
        >
          <div className="flex items-start gap-4">
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.3), rgba(249, 115, 22, 0.3))',
                boxShadow: '0 10px 30px -10px rgba(251, 146, 60, 0.6)',
              }}
            >
              <AlertTriangle className="size-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-1">Low Stock Alert</h3>
              <p className="text-slate-400 text-sm mb-3">
                {lowStockItems.length} items are below reorder level and need to be restocked
              </p>
              <div className="flex flex-wrap gap-2">
                {lowStockItems.slice(0, 3).map((item) => (
                  <span 
                    key={item.id} 
                    className="px-3 py-1 rounded-lg text-sm text-orange-400"
                    style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.3)' }}
                  >
                    {item.name} ({item.currentStock} left)
                  </span>
                ))}
                {lowStockItems.length > 3 && (
                  <span 
                    className="px-3 py-1 rounded-lg text-sm text-orange-400"
                    style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.3)' }}
                  >
                    +{lowStockItems.length - 3} more
                  </span>
                )}
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 flex-shrink-0"
              style={{
                background: 'rgba(251, 146, 60, 0.3)',
                color: '#ffffff',
                border: '1px solid rgba(251, 146, 60, 0.5)',
              }}
            >
              <ShoppingCart className="size-4" />
              Create PO
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* View Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="flex gap-2 p-1 rounded-2xl"
        style={AXIOM.containers.list}
      >
        {[
          { id: 'items' as InventoryView, label: 'Inventory Items', icon: Package },
          { id: 'transactions' as InventoryView, label: 'Transactions', icon: RefreshCw },
          { id: 'analytics' as InventoryView, label: 'Analytics', icon: BarChart3 },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1 px-4 py-3 flex items-center justify-center gap-2 text-sm font-medium rounded-xl transition-all"
              style={isActive ? AXIOM.buttons.primary : { background: 'transparent', color: '#94a3b8' }}
            >
              <Icon className="size-4" />
              {tab.label}
            </motion.button>
          );
        })}
      </motion.div>

      {/* Content Area */}
      {activeView === 'items' && (
        <div className="space-y-4">
          {/* Search */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="relative"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search inventory items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl text-white placeholder-slate-500"
              style={{
                background: AXIOM.inputs.background,
                border: AXIOM.inputs.border,
              }}
            />
          </motion.div>

          {/* Items Grid */}
          {itemsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-72 rounded-2xl animate-pulse"
                  style={{ background: 'rgba(148, 163, 184, 0.12)' }}
                />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-2xl p-14 text-center" style={AXIOM.containers.list}>
              <Package className="mx-auto size-12 text-slate-500 mb-4" />
              <p className="text-base font-medium text-white">
                {inventoryItems.length === 0 ? 'No inventory items yet' : 'No items match your search'}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {inventoryItems.length === 0
                  ? 'Add items to track stock, costs, and low-stock alerts.'
                  : 'Try a different search or clear the filter.'}
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item, index) => {
              const stockStatus = getStockStatus(item);
              const stockValue = item.currentStock * item.averageCost;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 + index * 0.03 }}
                  className="p-6 rounded-2xl"
                  style={AXIOM.containers.list}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{
                        background: AXIOM.iconBoxes.cyan,
                        boxShadow: AXIOM.shadows.iconCyan,
                      }}
                    >
                      <Package className="size-6 text-white" />
                    </div>
                    <span 
                      className="px-3 py-1 rounded-lg text-xs font-medium"
                      style={
                        stockStatus.color === 'green' ? AXIOM.badges.success :
                        stockStatus.color === 'orange' ? { background: 'rgba(251, 146, 60, 0.1)', color: '#fb923c', border: '1px solid rgba(251, 146, 60, 0.3)' } :
                        AXIOM.badges.danger
                      }
                    >
                      {stockStatus.label}
                    </span>
                  </div>

                  <h3 className="text-lg font-semibold text-white mb-1 line-clamp-2">{item.name}</h3>
                  <p className="text-sm text-slate-400 mb-4">{item.sku} • {item.category}</p>

                  <div className="space-y-3 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Current Stock</span>
                      <span className="text-sm font-medium text-white">{item.currentStock} {item.unit}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Average Cost</span>
                      <span className="text-sm font-medium text-cyan-400">{formatCurrency(item.averageCost)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Stock Value</span>
                      <span className="text-sm font-medium text-emerald-400">{formatCurrency(stockValue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Reorder Level</span>
                      <span className="text-sm font-medium text-orange-400">{item.reorderLevel} {item.unit}</span>
                    </div>
                  </div>

                  <div className="pt-4 flex gap-2" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => openEditModal(item)}
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                      style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}
                    >
                      <Edit className="size-3" />
                      Edit
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => openDeleteModal(item)}
                      className="px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    >
                      <Trash2 className="size-3" />
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {activeView === 'transactions' && (
        <div className="space-y-4">
          {/* Transactions Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl overflow-hidden"
            style={AXIOM.containers.list}
          >
            <div className="p-6" style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
              <h3 className="text-lg font-semibold text-white">Recent Inventory Transactions</h3>
              <p className="text-sm text-slate-400 mt-1">Track purchases, sales, and adjustments</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ background: 'rgba(148, 163, 184, 0.05)' }}>
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Date</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Item</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Type</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Quantity</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Unit Cost</th>
                    <th className="text-right px-6 py-4 text-xs font-medium text-slate-400 uppercase">Total Amount</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-slate-400 uppercase">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {txnLoading && inventoryTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-14 text-center text-sm text-slate-400">
                        Loading transactions…
                      </td>
                    </tr>
                  ) : !txnLoading && inventoryTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-14 text-center">
                        <p className="text-base font-medium text-white">No inventory transactions yet</p>
                        <p className="mt-2 text-sm text-slate-400">
                          Purchases, sales, and adjustments appear here when recorded.
                        </p>
                      </td>
                    </tr>
                  ) : (
                  inventoryTransactions.map((txn, index) => {
                    const item = inventoryItems.find(i => i.id === txn.inventoryItemId);
                    const isIncrease = txn.type === 'purchase' || txn.type === 'adjustment';
                    return (
                      <motion.tr
                        key={txn.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.45 + index * 0.03 }}
                        style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}
                      >
                        <td className="px-6 py-4">
                          <span className="text-slate-300">{formatDate(txn.date)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-white font-medium">{item?.name || 'Unknown Item'}</div>
                          <div className="text-xs text-slate-500">{item?.sku}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span 
                            className="inline-flex px-3 py-1 rounded-lg text-xs font-medium"
                            style={
                              txn.type === 'purchase' ? AXIOM.badges.success :
                              txn.type === 'sale' ? AXIOM.badges.info :
                              txn.type === 'adjustment' ? { background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)' } :
                              { background: 'rgba(251, 146, 60, 0.1)', color: '#fb923c', border: '1px solid rgba(251, 146, 60, 0.3)' }
                            }
                          >
                            {txn.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={cn(
                            'font-medium',
                            isIncrease ? 'text-emerald-400' : 'text-orange-400'
                          )}>
                            {isIncrease ? '+' : ''}{txn.quantity}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-slate-300">{formatCurrency(txn.unitCost)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-white font-medium">{formatCurrency(Math.abs(txn.totalAmount))}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-slate-400 text-sm font-mono">{txn.referenceNumber || '-'}</span>
                        </td>
                      </motion.tr>
                    );
                  })
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      )}

      {activeView === 'analytics' && (
        <div className="space-y-6">
          {/* First Row: Stock Levels and Valuation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.chartBlue}
            >
              <h3 className="text-lg font-semibold text-white mb-4">Stock Levels Overview</h3>
              <div className="space-y-4">
                {filteredItems.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4">No items to chart yet. Add inventory items to see levels here.</p>
                ) : filteredItems.map((item, idx) => {
                  const cap = Math.max((item.reorderQuantity || 0) * 2, (item.reorderLevel || 0) * 2, item.currentStock || 1);
                  const stockPercentage = (item.currentStock / cap) * 100;
                  const stockStatus = getStockStatus(item);
                  return (
                    <div key={item.id}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white font-medium">{item.name}</span>
                        <span 
                          className="text-xs px-2 py-1 rounded-lg"
                          style={
                            stockStatus.color === 'green' ? { background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' } :
                            stockStatus.color === 'orange' ? { background: 'rgba(251, 146, 60, 0.1)', color: '#fb923c' } :
                            { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }
                          }
                        >
                          {item.currentStock} {item.unit}
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(stockPercentage, 100)}%` }}
                          transition={{ duration: 1, delay: 0.2 + idx * 0.05 }}
                          className="h-full"
                          style={{
                            background: stockStatus.color === 'green' ? 'linear-gradient(90deg, #10b981, #059669)' :
                                       stockStatus.color === 'orange' ? 'linear-gradient(90deg, #fb923c, #f97316)' :
                                       'linear-gradient(90deg, #ef4444, #dc2626)'
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
              transition={{ delay: 0.45 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.chartBlue}
            >
              <h3 className="text-lg font-semibold text-white mb-4">Valuation Summary</h3>
              <div className="space-y-4">
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <div className="text-sm text-slate-400 mb-1">Current Inventory Value</div>
                  <div className="text-2xl font-bold text-cyan-400">
                    {itemsLoading ? '—' : formatCurrency(inventorySummary.totalValue)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {itemsLoading ? '...' : `${inventorySummary.totalUnits} units at weighted avg cost`}
                  </div>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <div className="text-sm text-slate-400 mb-1">Potential Revenue</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    {itemsLoading ? '—' : formatCurrency(inventoryItems.reduce((sum, item) => sum + (item.currentStock * item.sellingPrice), 0))}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">If all remaining stock sold</div>
                </div>
                <div className="p-4 rounded-xl" style={AXIOM.containers.item}>
                  <div className="text-sm text-slate-400 mb-1">Potential Profit (Unrealized)</div>
                  <div className={`text-2xl font-bold ${itemsLoading ? 'text-purple-400' : (() => {
                    const totalProfit = inventoryItems.reduce((sum, item) => {
                      const profit = (item.sellingPrice - item.averageCost) * item.currentStock;
                      return sum + profit;
                    }, 0);
                    return totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400';
                  })()}`}>
                    {itemsLoading ? '—' : formatCurrency(inventoryItems.reduce((sum, item) => {
                      const profit = (item.sellingPrice - item.averageCost) * item.currentStock;
                      return sum + profit;
                    }, 0))}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {!itemsLoading && (() => {
                      const totalCost = inventorySummary.totalValue;
                      const totalRevenue = inventoryItems.reduce((sum, item) => sum + (item.currentStock * item.sellingPrice), 0);
                      const marginPercent = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost * 100) : 0;
                      return `Margin: ${marginPercent.toFixed(1)}% on remaining stock`;
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Second Row: Transaction Analytics with Realized P&L */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16, 185, 129, 0.15)' }}>
                  <ShoppingCart className="size-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Total Purchases</p>
                  <p className="text-xl font-bold text-white">
                    {txnLoading ? '—' : inventoryTransactions.filter(t => t.type === 'purchase').length}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Total spent: {txnLoading ? '—' : formatCurrency(
                  inventoryTransactions
                    .filter(t => t.type === 'purchase')
                    .reduce((sum, t) => sum + Math.abs(t.totalAmount), 0)
                )}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                  <Archive className="size-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Total Sales</p>
                  <p className="text-xl font-bold text-white">
                    {txnLoading ? '—' : inventoryTransactions.filter(t => t.type === 'sale').length}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Revenue: {txnLoading ? '—' : formatCurrency(
                  inventoryTransactions
                    .filter(t => t.type === 'sale')
                    .reduce((sum, t) => sum + Math.abs(t.totalAmount), 0)
                )}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(168, 85, 247, 0.15)' }}>
                  <DollarSign className="size-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Realized Profit</p>
                  <p className={`text-xl font-bold ${(() => {
                    if (txnLoading) return 'text-white';
                    const sales = inventoryTransactions.filter(t => t.type === 'sale');
                    const totalRevenue = sales.reduce((sum, t) => sum + Math.abs(t.totalAmount), 0);
                    const totalCOGS = sales.reduce((sum, t) => {
                      const unitCost = (t as any).unitCost || 0;
                      return sum + (Math.abs(t.quantity) * unitCost);
                    }, 0);
                    const profit = totalRevenue - totalCOGS;
                    return profit >= 0 ? 'text-emerald-400' : 'text-red-400';
                  })()}`}>
                    {txnLoading ? '—' : (() => {
                      const sales = inventoryTransactions.filter(t => t.type === 'sale');
                      const totalRevenue = sales.reduce((sum, t) => sum + Math.abs(t.totalAmount), 0);
                      const totalCOGS = sales.reduce((sum, t) => {
                        const unitCost = (t as any).unitCost || 0;
                        return sum + (Math.abs(t.quantity) * unitCost);
                      }, 0);
                      return formatCurrency(totalRevenue - totalCOGS);
                    })()}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                From completed sales
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(251, 146, 60, 0.15)' }}>
                  <RefreshCw className="size-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Adjustments</p>
                  <p className="text-xl font-bold text-white">
                    {txnLoading ? '—' : inventoryTransactions.filter(t => t.type === 'adjustment').length}
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Stock corrections
              </div>
            </motion.div>
          </div>

          {/* Third Row: Item-by-Item Analytics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="p-6 rounded-2xl"
            style={AXIOM.containers.list}
          >
            <h3 className="text-lg font-semibold text-white mb-4">Item-by-Item Analysis</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ background: 'rgba(148, 163, 184, 0.05)' }}>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase">Item</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Stock</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Avg Cost</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Value</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Sell Price</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Margin %</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase">Potential Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                        Loading analytics…
                      </td>
                    </tr>
                  ) : inventoryItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                        No inventory items yet. Add items to see analytics.
                      </td>
                    </tr>
                  ) : (
                    inventoryItems.map((item, idx) => {
                      const stockValue = item.currentStock * item.averageCost;
                      const potentialRevenue = item.currentStock * item.sellingPrice;
                      const potentialProfit = potentialRevenue - stockValue;
                      const marginPercent = item.averageCost > 0 
                        ? ((item.sellingPrice - item.averageCost) / item.averageCost * 100)
                        : 0;
                      
                      return (
                        <motion.tr
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.75 + idx * 0.05 }}
                          style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}
                        >
                          <td className="px-4 py-3">
                            <div className="text-white font-medium text-sm">{item.name}</div>
                            <div className="text-xs text-slate-500">{item.sku}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-white text-sm">{item.currentStock} {item.unit}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-cyan-400">
                            {formatCurrency(item.averageCost)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-blue-400">
                            {formatCurrency(stockValue)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-emerald-400">
                            {formatCurrency(item.sellingPrice)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-sm font-medium ${marginPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {marginPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-sm font-medium ${potentialProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {formatCurrency(potentialProfit)}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      )}
      
      {/* Success/Error Messages */}
      {actionSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm text-white"
          style={{
            background: 'rgba(16, 185, 129, 0.2)',
            border: '1px solid rgba(16, 185, 129, 0.5)',
            boxShadow: '0 10px 40px -10px rgba(16, 185, 129, 0.6)',
          }}
        >
          {actionSuccess}
        </motion.div>
      )}
      
      {/* Add Item Modal */}
      {isAddItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-2xl rounded-2xl p-6"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Add New Inventory Item</h2>
              <button
                onClick={() => {
                  setIsAddItemModalOpen(false);
                  setActionError(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="size-5 text-slate-400" />
              </button>
            </div>
            
            {actionError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm text-amber-100" style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.35)' }}>
                {actionError}
              </div>
            )}
            
            <form onSubmit={handleAddItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">SKU *</label>
                  <input
                    type="text"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="e.g., PROD-001"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Item Name *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="e.g., Laptop"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="Optional description"
                  rows={2}
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="e.g., Electronics"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Unit</label>
                  <input
                    type="text"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="unit, pcs, kg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Selling Price</label>
                  <input
                    type="number"
                    value={formSellingPrice}
                    onChange={(e) => setFormSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Reorder Level</label>
                  <input
                    type="number"
                    value={formReorderLevel}
                    onChange={(e) => setFormReorderLevel(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="Alert when stock reaches this level"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Reorder Quantity</label>
                  <input
                    type="number"
                    value={formReorderQuantity}
                    onChange={(e) => setFormReorderQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="Suggested reorder amount"
                  />
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddItemModalOpen(false);
                    setActionError(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Item'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      
      {/* New Purchase Modal */}
      {isNewPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-2xl p-6"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Record New Purchase</h2>
              <button
                onClick={() => {
                  setIsNewPurchaseModalOpen(false);
                  setActionError(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="size-5 text-slate-400" />
              </button>
            </div>
            
            {actionError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm text-amber-100" style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.35)' }}>
                {actionError}
              </div>
            )}
            
            <form onSubmit={handleNewPurchase} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Select Item *</label>
                <select
                  value={purchaseItemId}
                  onChange={(e) => setPurchaseItemId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  required
                >
                  <option value="">Choose an item...</option>
                  {inventoryItems.filter(i => i.isActive).map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku}) - Current: {item.currentStock}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Quantity *</label>
                  <input
                    type="number"
                    value={purchaseQuantity}
                    onChange={(e) => setPurchaseQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="e.g., 10"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Unit Cost *</label>
                  <input
                    type="number"
                    value={purchaseUnitCost}
                    onChange={(e) => setPurchaseUnitCost(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
              </div>
              
              {purchaseQuantity && purchaseUnitCost && (
                <div className="p-4 rounded-xl" style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-300">Total Amount:</span>
                    <span className="text-lg font-bold text-cyan-400">
                      {formatCurrency(Number(purchaseQuantity) * Number(purchaseUnitCost))}
                    </span>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Bank Account * <span className="text-xs text-slate-500">(Payment Method)</span></label>
                <select
                  value={purchaseBankAccountId}
                  onChange={(e) => setPurchaseBankAccountId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  required
                >
                  <option value="">Select payment account...</option>
                  {bankAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.bankName} - {account.accountType} ({formatCurrency(account.balance, account.currency)})
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  💡 This purchase will be recorded as an expense in the selected account's transactions
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Reference Number</label>
                <input
                  type="text"
                  value={purchaseReference}
                  onChange={(e) => setPurchaseReference(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="PO number, invoice, etc."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={purchaseNotes}
                  onChange={(e) => setPurchaseNotes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="Optional notes"
                  rows={2}
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPurchaseModalOpen(false);
                    setActionError(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Recording...' : 'Record Purchase'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      
      {/* Edit Item Modal */}
      {isEditItemModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-2xl rounded-2xl p-6"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Edit Inventory Item</h2>
              <button
                onClick={() => {
                  setIsEditItemModalOpen(false);
                  setSelectedItem(null);
                  setActionError(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="size-5 text-slate-400" />
              </button>
            </div>
            
            {actionError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm text-amber-100" style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.35)' }}>
                {actionError}
              </div>
            )}
            
            <form onSubmit={handleEditItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">SKU *</label>
                  <input
                    type="text"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Item Name *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  rows={2}
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Unit</label>
                  <input
                    type="text"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Selling Price</label>
                  <input
                    type="number"
                    value={formSellingPrice}
                    onChange={(e) => setFormSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    step="0.01"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Reorder Level</label>
                  <input
                    type="number"
                    value={formReorderLevel}
                    onChange={(e) => setFormReorderLevel(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Reorder Quantity</label>
                  <input
                    type="number"
                    value={formReorderQuantity}
                    onChange={(e) => setFormReorderQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  />
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditItemModalOpen(false);
                    setSelectedItem(null);
                    setActionError(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      
      {/* Delete Item Confirmation Modal */}
      {isDeleteItemModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl p-6"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Delete Item</h2>
              <button
                onClick={() => {
                  setIsDeleteItemModalOpen(false);
                  setSelectedItem(null);
                  setActionError(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="size-5 text-slate-400" />
              </button>
            </div>
            
            {actionError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm text-amber-100" style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.35)' }}>
                {actionError}
              </div>
            )}
            
            <div className="mb-6">
              <div 
                className="p-4 rounded-xl mb-4"
                style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="size-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-300 font-medium">Are you sure you want to delete this item?</p>
                    <p className="text-xs text-red-400 mt-1">This will mark the item as inactive. Historical transactions will remain.</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Item:</span>
                  <span className="text-sm text-white font-medium">{selectedItem.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">SKU:</span>
                  <span className="text-sm text-white font-mono">{selectedItem.sku}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Current Stock:</span>
                  <span className="text-sm text-white">{selectedItem.currentStock} {selectedItem.unit}</span>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteItemModalOpen(false);
                  setSelectedItem(null);
                  setActionError(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                style={AXIOM.buttons.secondary}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteItem}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: '#ffffff',
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Deleting...' : 'Delete Item'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      
      {/* Record Sale Modal */}
      {isNewSaleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-2xl p-6"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Record Sale</h2>
              <button
                onClick={() => {
                  setIsNewSaleModalOpen(false);
                  setActionError(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="size-5 text-slate-400" />
              </button>
            </div>
            
            {actionError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm text-amber-100" style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.35)' }}>
                {actionError}
              </div>
            )}
            
            <form onSubmit={handleNewSale} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Select Item *</label>
                <select
                  value={saleItemId}
                  onChange={(e) => setSaleItemId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  required
                >
                  <option value="">Choose an item...</option>
                  {inventoryItems.filter(i => i.isActive && i.currentStock > 0).map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku}) - Stock: {item.currentStock}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Quantity *</label>
                  <input
                    type="number"
                    value={saleQuantity}
                    onChange={(e) => setSaleQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="e.g., 5"
                    min="1"
                    max={saleItemId ? inventoryItems.find(i => i.id === saleItemId)?.currentStock : undefined}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Unit Price *</label>
                  <input
                    type="number"
                    value={saleUnitPrice}
                    onChange={(e) => setSaleUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
              </div>
              
              {saleQuantity && saleUnitPrice && (
                <div className="p-4 rounded-xl" style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-slate-300">Total Revenue:</span>
                    <span className="text-lg font-bold text-emerald-400">
                      {formatCurrency(Number(saleQuantity) * Number(saleUnitPrice))}
                    </span>
                  </div>
                  {saleItemId && (() => {
                    const item = inventoryItems.find(i => i.id === saleItemId);
                    if (!item) return null;
                    const cost = Number(saleQuantity) * item.averageCost;
                    const revenue = Number(saleQuantity) * Number(saleUnitPrice);
                    const profit = revenue - cost;
                    return (
                      <>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400">Cost (@ {formatCurrency(item.averageCost)}):</span>
                          <span className="text-slate-300">{formatCurrency(cost)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs mt-1 pt-1" style={{ borderTop: '1px solid rgba(16, 185, 129, 0.2)' }}>
                          <span className="text-slate-400">Profit:</span>
                          <span className={profit >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                            {formatCurrency(profit)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Bank Account * <span className="text-xs text-slate-500">(Revenue Destination)</span></label>
                <select
                  value={saleBankAccountId}
                  onChange={(e) => setSaleBankAccountId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  required
                >
                  <option value="">Select account to receive payment...</option>
                  {bankAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.bankName} - {account.accountType} ({formatCurrency(account.balance, account.currency)})
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  💰 This sale will be recorded as income in the selected account's transactions
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Reference Number</label>
                <input
                  type="text"
                  value={saleReference}
                  onChange={(e) => setSaleReference(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="Invoice number, receipt, etc."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="Optional notes"
                  rows={2}
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewSaleModalOpen(false);
                    setActionError(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Recording...' : 'Record Sale'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      
      {/* Record Adjustment Modal */}
      {isNewAdjustmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-2xl p-6"
            style={AXIOM.containers.list}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Record Stock Adjustment</h2>
              <button
                onClick={() => {
                  setIsNewAdjustmentModalOpen(false);
                  setActionError(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="size-5 text-slate-400" />
              </button>
            </div>
            
            {actionError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm text-amber-100" style={{ background: 'rgba(251, 146, 60, 0.15)', border: '1px solid rgba(251, 146, 60, 0.35)' }}>
                {actionError}
              </div>
            )}
            
            <div className="mb-4 px-4 py-3 rounded-xl text-sm text-purple-200" style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
              Use adjustments to correct stock discrepancies from losses, damage, or physical count corrections. Use positive numbers to increase stock, negative to decrease.
            </div>
            
            <form onSubmit={handleNewAdjustment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Select Item *</label>
                <select
                  value={adjustmentItemId}
                  onChange={(e) => setAdjustmentItemId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  required
                >
                  <option value="">Choose an item...</option>
                  {inventoryItems.filter(i => i.isActive).map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku}) - Current: {item.currentStock}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Adjustment Quantity *</label>
                <input
                  type="number"
                  value={adjustmentQuantity}
                  onChange={(e) => setAdjustmentQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="e.g., +10 or -5"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Positive to add stock, negative to remove</p>
              </div>
              
              {adjustmentQuantity && adjustmentItemId && (() => {
                const item = inventoryItems.find(i => i.id === adjustmentItemId);
                if (!item) return null;
                const newStock = item.currentStock + Number(adjustmentQuantity);
                return (
                  <div className="p-4 rounded-xl" style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-300">New Stock Level:</span>
                      <span className="text-lg font-bold text-purple-400">
                        {item.currentStock} → {newStock} {item.unit}
                      </span>
                    </div>
                  </div>
                );
              })()}
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Reason *</label>
                <input
                  type="text"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="e.g., Physical count correction, Damaged goods"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
                <input
                  type="date"
                  value={adjustmentDate}
                  onChange={(e) => setAdjustmentDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={adjustmentNotes}
                  onChange={(e) => setAdjustmentNotes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  style={{ background: AXIOM.inputs.background, border: AXIOM.inputs.border }}
                  placeholder="Additional details"
                  rows={2}
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewAdjustmentModalOpen(false);
                    setActionError(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.secondary}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={AXIOM.buttons.primary}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Recording...' : 'Record Adjustment'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}