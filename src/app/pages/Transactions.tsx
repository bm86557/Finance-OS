import { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Plus,
  Upload,
  Download,
  Filter,
  Search,
  Calendar,
  Tag,
  DollarSign,
  TrendingUp,
  Eye,
  Edit,
  Trash2,
  Check,
  X,
  Clock,
  AlertCircle
} from 'lucide-react';
import { ModernTable, Column, TableAction } from '../components/table/ModernTable';
import { BulkActionsBar } from '../components/bulk-actions/BulkActionsBar';
import { AdvancedFilter } from '../components/filters/AdvancedFilter';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { PremiumStatCard } from '../components/widgets/DataWidgets';

interface Transaction {
  id: number;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: 'income' | 'expense';
  status: 'completed' | 'pending' | 'scheduled';
  account: string;
  confidence?: number;
  needsReview?: boolean;
}

export function Transactions() {
  const [selectedTransactions, setSelectedTransactions] = useState<Transaction[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Sample transaction data
  const transactions: Transaction[] = [
    {
      id: 1,
      date: '2024-01-28',
      description: 'Client Payment - ABC Corp Project',
      category: 'Revenue',
      amount: 15000,
      type: 'income',
      status: 'completed',
      account: 'HBL Current',
      confidence: 98
    },
    {
      id: 2,
      date: '2024-01-27',
      description: 'AWS Monthly Invoice',
      category: 'Cloud Infrastructure',
      amount: -1250,
      type: 'expense',
      status: 'completed',
      account: 'HBL Current',
      confidence: 95
    },
    {
      id: 3,
      date: '2024-01-27',
      description: 'Salary - Engineering Team',
      category: 'Salaries',
      amount: -45000,
      type: 'expense',
      status: 'completed',
      account: 'HBL Payroll',
      confidence: 100
    },
    {
      id: 4,
      date: '2024-01-26',
      description: 'Facebook Ads Campaign',
      category: 'Marketing',
      amount: -3500,
      type: 'expense',
      status: 'completed',
      account: 'HBL Current',
      confidence: 92
    },
    {
      id: 5,
      date: '2024-01-25',
      description: 'Office Supplies - Stationers Inc',
      category: 'Office Expenses',
      amount: -850,
      type: 'expense',
      status: 'completed',
      account: 'HBL Current',
      confidence: 88,
      needsReview: true
    },
    {
      id: 6,
      date: '2024-01-25',
      description: 'Client Deposit - XYZ Ltd',
      category: 'Revenue',
      amount: 8000,
      type: 'income',
      status: 'completed',
      account: 'HBL Current',
      confidence: 97
    },
    {
      id: 7,
      date: '2024-01-24',
      description: 'Google Workspace Subscription',
      category: 'Software & Tools',
      amount: -420,
      type: 'expense',
      status: 'completed',
      account: 'HBL Current',
      confidence: 100
    },
    {
      id: 8,
      date: '2024-01-23',
      description: 'Freelance Designer Payment',
      category: 'Contract Work',
      amount: -2500,
      type: 'expense',
      status: 'completed',
      account: 'HBL Current',
      confidence: 94
    },
    {
      id: 9,
      date: '2024-01-30',
      description: 'Scheduled: Monthly Rent',
      category: 'Office Expenses',
      amount: -12000,
      type: 'expense',
      status: 'scheduled',
      account: 'HBL Current',
      confidence: 100
    },
    {
      id: 10,
      date: '2024-01-22',
      description: 'Internet & Utilities',
      category: 'Office Expenses',
      amount: -680,
      type: 'expense',
      status: 'pending',
      account: 'HBL Current',
      confidence: 75,
      needsReview: true
    },
    {
      id: 11,
      date: '2024-01-22',
      description: 'Client Payment - DEF Company',
      category: 'Revenue',
      amount: 12500,
      type: 'income',
      status: 'completed',
      account: 'HBL Current',
      confidence: 99
    },
    {
      id: 12,
      date: '2024-01-21',
      description: 'Slack Premium Subscription',
      category: 'Software & Tools',
      amount: -160,
      type: 'expense',
      status: 'completed',
      account: 'HBL Current',
      confidence: 100
    }
  ];

  // Table columns configuration
  const columns: Column<Transaction>[] = [
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      width: '120px',
      render: (value) => (
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="text-slate-300 text-sm">
            {new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )
    },
    {
      key: 'description',
      label: 'Description',
      sortable: true,
      render: (value, row) => (
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            row.type === 'income'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}>
            {row.type === 'income' ? <TrendingUp className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium text-sm truncate">{value}</p>
            <p className="text-slate-500 text-xs">{row.account}</p>
          </div>
          {row.needsReview && (
            <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded border border-amber-500/20 whitespace-nowrap">
              Needs Review
            </span>
          )}
        </div>
      )
    },
    {
      key: 'category',
      label: 'Category',
      sortable: true,
      width: '180px',
      render: (value, row) => (
        <div className="flex items-center gap-2">
          <Tag className="w-3 h-3 text-slate-500" />
          <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded border border-blue-500/20">
            {value}
          </span>
          {!!row.confidence && row.confidence < 90 && (
            <span className="text-xs text-slate-500">({row.confidence}%)</span>
          )}
        </div>
      )
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      align: 'right',
      width: '140px',
      render: (value, row) => (
        <div className="flex items-center justify-end gap-2">
          <span className={`font-semibold ${
            row.type === 'income' ? 'text-green-400' : 'text-red-400'
          }`}>
            {row.type === 'income' ? '+' : '-'}${Math.abs(value).toLocaleString()}
          </span>
        </div>
      )
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '120px',
      render: (value) => {
        const statusConfig = {
          completed: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20', icon: Check },
          pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20', icon: Clock },
          scheduled: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', icon: Calendar }
        };
        const config = statusConfig[value as keyof typeof statusConfig];
        const Icon = config.icon;
        
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-1 ${config.bg} ${config.text} text-xs rounded border ${config.border}`}>
            <Icon className="w-3 h-3" />
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </span>
        );
      }
    }
  ];

  // Table actions
  const tableActions: TableAction<Transaction>[] = [
    { 
      label: 'View Details', 
      icon: Eye, 
      onClick: (row) => console.log('View', row) 
    },
    { 
      label: 'Edit Transaction', 
      icon: Edit, 
      onClick: (row) => console.log('Edit', row) 
    },
    { 
      label: 'Delete', 
      icon: Trash2, 
      onClick: (row) => console.log('Delete', row), 
      variant: 'destructive' 
    }
  ];

  // Calculate summary stats
  const totalIncome = transactions
    .filter(t => t.type === 'income' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const totalExpenses = transactions
    .filter(t => t.type === 'expense' && t.status === 'completed')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  const needsReviewCount = transactions.filter(t => t.needsReview).length;

  return (
    <div className="min-h-screen bg-[#000000] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2" style={{
            background: 'linear-gradient(135deg, #ffffff 0%, #60a5fa 50%, #a855f7 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>Transactions</h1>
          <p className="text-slate-400">Manage and categorize all your financial transactions</p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="border-white/10 hover:bg-white/5 text-white"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>
          
          <Button
            variant="outline"
            className="border-white/10 hover:bg-white/5 text-white"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>

          <Button className="bg-blue-500 hover:bg-blue-600 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Add Transaction
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <PremiumStatCard
          title="Total Income"
          value={totalIncome}
          change={12.5}
          icon={TrendingUp}
          gradient="from-green-500 to-emerald-500"
          prefix="$"
        />
        
        <PremiumStatCard
          title="Total Expenses"
          value={totalExpenses}
          change={-3.2}
          icon={DollarSign}
          gradient="from-red-500 to-pink-500"
          prefix="$"
        />

        <PremiumStatCard
          title="Net Cash Flow"
          value={totalIncome - totalExpenses}
          change={8.7}
          icon={TrendingUp}
          gradient="from-blue-500 to-cyan-500"
          prefix="$"
        />

        <Card className="bg-[#0f0f13] border-white/10">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-slate-400 text-sm font-medium">Needs Review</p>
                <h3 className="text-3xl font-bold text-amber-400 mt-2">{needsReviewCount}</h3>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                boxShadow: '0 10px 30px -10px rgba(245, 158, 11, 0.6)',
              }}>
                <AlertCircle className="w-6 h-6 text-white" />
              </div>
            </div>
            <Button className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20">
              Review Now
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <AdvancedFilter />
        </motion.div>
      )}

      {/* Transactions Table */}
      <ModernTable
        columns={columns}
        data={transactions}
        actions={tableActions}
        selectable
        onSelectionChange={setSelectedTransactions}
        searchable
        filterable
        exportable
        hoverable
        rowsPerPage={10}
      />

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedTransactions.length}
        totalCount={transactions.length}
        onClearSelection={() => setSelectedTransactions([])}
        onSelectAll={() => setSelectedTransactions(transactions)}
        onCategorize={() => console.log('Categorize', selectedTransactions)}
        onExport={() => console.log('Export', selectedTransactions)}
        onDelete={() => console.log('Delete', selectedTransactions)}
        onApprove={() => console.log('Approve', selectedTransactions)}
        customActions={[
          {
            label: 'Mark as Reviewed',
            icon: Check,
            onClick: () => console.log('Mark reviewed', selectedTransactions)
          },
          {
            label: 'Flag for Review',
            icon: AlertCircle,
            onClick: () => console.log('Flag', selectedTransactions)
          }
        ]}
      />
    </div>
  );
}