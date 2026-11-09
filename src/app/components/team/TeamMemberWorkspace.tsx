import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';
import { formatCurrency } from '@/lib/formatters';
import { LogOut, Plus, Receipt, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { QuickAdd } from '../organization/QuickAdd';

export function TeamMemberWorkspace() {
  const [currentView, setCurrentView] = useState<'home' | 'add'>('home');
  const { user, currentOrganization, logout } = useAuth();
  const svc = useOrgServices();

  // Fetch recent transactions via the service layer
  const { data: txnResult, loading: txnLoading } = useService(
    () => svc.transactions.getAll({ page: 1, pageSize: 5 }),
    [svc.orgId]
  );

  const recentTransactions = txnResult?.items ?? [];

  if (currentView === 'add') {
    return (
      <div className="size-full bg-slate-950">
        <div className="border-b border-slate-800 p-4 flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => setCurrentView('home')}
            className="text-slate-400 hover:text-white"
          >
            ← Back to Home
          </Button>
          <Button variant="outline" className="border-slate-700" onClick={logout}>
            <LogOut className="size-4 mr-2" />
            Sign Out
          </Button>
        </div>
        <QuickAdd />
      </div>
    );
  }

  return (
    <div className="size-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-auto">
      <div className="p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Team Dashboard</h1>
            <p className="text-slate-400">Welcome back, {user?.name}</p>
          </div>
          <Button variant="outline" className="border-slate-700 hover:bg-slate-800" onClick={logout}>
            <LogOut className="size-4 mr-2" />
            Sign Out
          </Button>
        </div>

        {/* Organization Info */}
        {currentOrganization && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="size-16 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">{currentOrganization.name[0]}</span>
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-white mb-1">{currentOrganization.name}</h2>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                      {currentOrganization.currency} Currency
                    </Badge>
                    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                      Team Member
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card 
            className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/20 cursor-pointer hover:border-cyan-500/40 transition-colors"
            onClick={() => setCurrentView('add')}
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Plus className="size-6 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">Add Transaction</h3>
                  <p className="text-sm text-slate-400">Quick add income or expense</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Receipt className="size-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">View Transactions</h3>
                  <p className="text-sm text-slate-400">See your transaction history</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Permissions */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Your Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-green-400" />
              <span className="text-slate-300">Add transactions</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-green-400" />
              <span className="text-slate-300">View reports</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 text-slate-500" />
              <span className="text-slate-500">Upload statements (restricted)</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 text-slate-500" />
              <span className="text-slate-500">Manage team (restricted)</span>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {txnLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 text-blue-400 animate-spin" />
                <span className="ml-2 text-slate-400 text-sm">Loading transactions...</span>
              </div>
            )}
            {!txnLoading && recentTransactions.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                No transactions yet. Add your first transaction above!
              </div>
            )}
            {!txnLoading && recentTransactions.map((txn) => {
              // Map new type system: 'credit' → income (green), 'debit' → expense (red)
              const isIncome = txn.type === 'credit';
              return (
                <div key={txn.id} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg">
                  <div className="flex-1">
                    <p className="text-white font-medium">{txn.narration || txn.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-slate-400">{new Date(txn.date).toLocaleDateString()}</p>
                      <Badge className={
                        isIncome
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }>
                        {isIncome ? 'income' : 'expense'}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isIncome ? 'text-green-400' : 'text-red-400'}`}>
                      {isIncome ? '+' : '-'}{formatCurrency(txn.amount, txn.currency)}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}