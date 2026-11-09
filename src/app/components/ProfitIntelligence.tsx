import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
// ── Phase 9A: Department profitability wired through service layer ────────────
import { useOrgServices } from '@/hooks/useOrgServices';
import { useService } from '@/hooks/useService';
import type { DepartmentProfitability } from '@/services/types';

/** Maps service DepartmentProfitability → local rendering shape */
function mapDeptProfitability(dp: DepartmentProfitability): Department {
  return {
    id: dp.departmentId,
    name: dp.departmentName,
    costPerHour: dp.costPerHour ?? 0,
    teamMembers: dp.headcount,
    monthlyRevenue: dp.revenue,
    monthlyCost: dp.directCosts,
    monthlyProfit: dp.netProfit,
    profitMargin: dp.profitMargin ?? 0,
    overheadAllocation: dp.allocatedOverhead,
    billableHours: dp.billableHours,
    totalHours: dp.totalHours ?? 0,
    utilization: dp.utilization ?? 0,
  };
}

interface Department {
  id: string; name: string; costPerHour: number; teamMembers: number;
  monthlyRevenue: number; monthlyCost: number; monthlyProfit: number;
  profitMargin: number; overheadAllocation: number; billableHours: number;
  totalHours: number; utilization: number;
}
interface Project {
  id: string; name: string; client: string; department: string;
  quotedAmount: number; actualCost: number; actualProfit: number;
  profitMargin: number; status: 'quoted' | 'in-progress' | 'completed';
  hoursQuoted: number; hoursActual: number; startDate: string; endDate?: string;
}
interface OverheadExpense {
  id: string; category: string; amount: number;
  frequency: 'monthly' | 'yearly';
  allocationType: 'equal' | 'revenue-based' | 'headcount-based';
  departments: string[];
}
interface ProfitAnalysis {
  byDepartment: { department: string; revenue: number; directCost: number; allocatedOverhead: number; netProfit: number; profitMargin: number }[];
  byScope: { scope: 'business' | 'personal'; income: number; expense: number; profit: number }[];
  byClient: { client: string; revenue: number; cost: number; profit: number; projects: number }[];
  overall: { totalRevenue: number; totalDirectCost: number; totalOverhead: number; grossProfit: number; netProfit: number; grossMargin: number; netMargin: number };
}
interface WhatIfScenario {
  id: string; name: string;
  changes: { type: 'cost-increase' | 'revenue-increase' | 'overhead-reduction' | 'rate-change'; target: string; percentage: number }[];
  projectedProfit: number; projectedMargin: number; impact: number;
}

// mockDepartments REMOVED — now fetched via svc.departments.getProfitability() below
const mockProjects: Project[] = [
  { id: 'proj-1', name: 'E-commerce Platform', client: 'TechCorp Ltd', department: 'Development', quotedAmount: 850000, actualCost: 620000, actualProfit: 230000, profitMargin: 27.1, status: 'in-progress', hoursQuoted: 200, hoursActual: 151, startDate: '2025-12-01' },
  { id: 'proj-2', name: 'Brand Identity', client: 'StartupXYZ', department: 'Design', quotedAmount: 320000, actualCost: 240000, actualProfit: 80000, profitMargin: 25.0, status: 'completed', hoursQuoted: 95, hoursActual: 86, startDate: '2025-11-15', endDate: '2025-12-20' },
  { id: 'proj-3', name: 'Social Media Campaign', client: 'FashionBrand', department: 'Marketing', quotedAmount: 180000, actualCost: 150000, actualProfit: 30000, profitMargin: 16.7, status: 'completed', hoursQuoted: 72, hoursActual: 60, startDate: '2025-12-01', endDate: '2025-12-31' },
  { id: 'proj-4', name: 'Mobile App Development', client: 'FinTech Solutions', department: 'Development', quotedAmount: 1200000, actualCost: 0, actualProfit: 0, profitMargin: 0, status: 'quoted', hoursQuoted: 300, hoursActual: 0, startDate: '2026-01-15' },
];
const mockOverheads: OverheadExpense[] = [
  { id: 'oh-1', category: 'Office Rent', amount: 200000, frequency: 'monthly', allocationType: 'equal', departments: ['Design', 'Development', 'Marketing', 'Sales & BD'] },
  { id: 'oh-2', category: 'Utilities', amount: 45000, frequency: 'monthly', allocationType: 'headcount-based', departments: ['Design', 'Development', 'Marketing', 'Sales & BD'] },
  { id: 'oh-3', category: 'Software Licenses', amount: 85000, frequency: 'monthly', allocationType: 'revenue-based', departments: ['Design', 'Development', 'Marketing'] },
  { id: 'oh-4', category: 'Admin Salaries', amount: 90000, frequency: 'monthly', allocationType: 'headcount-based', departments: ['Design', 'Development', 'Marketing', 'Sales & BD'] },
];
const mockProfitAnalysis: ProfitAnalysis = {
  byDepartment: [
    { department: 'Design', revenue: 680000, directCost: 448000, allocatedOverhead: 112000, netProfit: 120000, profitMargin: 17.6 },
    { department: 'Development', revenue: 985600, directCost: 738000, allocatedOverhead: 168000, netProfit: 79600, profitMargin: 8.1 },
    { department: 'Marketing', revenue: 375000, directCost: 300000, allocatedOverhead: 84000, netProfit: -9000, profitMargin: -2.4 },
    { department: 'Sales & BD', revenue: 256000, directCost: 204800, allocatedOverhead: 56000, netProfit: -4800, profitMargin: -1.9 },
  ],
  byScope: [
    { scope: 'business', income: 2296600, expense: 2110800, profit: 185800 },
    { scope: 'personal', income: 0, expense: 85000, profit: -85000 },
  ],
  byClient: [
    { client: 'TechCorp Ltd', revenue: 850000, cost: 620000, profit: 230000, projects: 1 },
    { client: 'StartupXYZ', revenue: 320000, cost: 240000, profit: 80000, projects: 1 },
    { client: 'FashionBrand', revenue: 180000, cost: 150000, profit: 30000, projects: 1 },
    { client: 'FinTech Solutions', revenue: 1200000, cost: 900000, profit: 300000, projects: 1 },
  ],
  overall: { totalRevenue: 2296600, totalDirectCost: 1690800, totalOverhead: 420000, grossProfit: 605800, netProfit: 185800, grossMargin: 26.4, netMargin: 8.1 },
};
const mockWhatIfScenarios: WhatIfScenario[] = [
  { id: 'wif-1', name: 'Increase Developer Rates by 15%', changes: [{ type: 'rate-change', target: 'Development', percentage: 15 }], projectedProfit: 333550, projectedMargin: 13.1, impact: 147750 },
  { id: 'wif-2', name: 'Reduce Overhead by 20%', changes: [{ type: 'overhead-reduction', target: 'All', percentage: 20 }], projectedProfit: 269800, projectedMargin: 11.1, impact: 84000 },
  { id: 'wif-3', name: 'Increase Revenue by 10%', changes: [{ type: 'revenue-increase', target: 'All', percentage: 10 }], projectedProfit: 291460, projectedMargin: 11.5, impact: 105660 },
];

import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Clock, 
  DollarSign, 
  Target,
  AlertCircle,
  Plus,
  Calculator,
  ArrowLeft,
  BarChart3,
  PieChart as PieChartIcon,
  Briefcase,
  Building2,
  Layers,
  Zap
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { NeuralBackground } from './ui/NeuralBackground';
import { HolographicCard } from './ui/HolographicCard';
import { useTheme } from '../../contexts/ThemeContext';
import { AXIOM } from '../../styles/axiom-tokens';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#2563eb'];

export function ProfitIntelligence() {
  const navigate = useNavigate();
  const { theme = 'dark' } = useTheme();
  const svc = useOrgServices();

  // ── Phase 9A: Department profitability from service ──────────────────────
  const { data: rawDeptProfit } = useService(
    () => svc.departments.getProfitability(),
    [svc.orgId]
  );
  const mockDepartments: Department[] = (rawDeptProfit || []).map(mapDeptProfitability);

  return (
    <div 
      className="min-h-screen"
      style={{
        background: theme === 'dark' ? AXIOM.backgrounds.main : '#f8fafc',
      }}
    >
      {/* Ambient gradient orbs - ONLY IN DARK MODE */}
      {theme === 'dark' && (
        <>
          <div className="fixed top-20 left-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-cyan-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
          <div className="fixed bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-indigo-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />
        </>
      )}

      {/* Header - BLUE THEME */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-50 backdrop-blur-lg border-b px-8 py-6"
        style={{
          background: theme === 'dark' 
            ? AXIOM.backgrounds.topBar
            : 'linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.9) 100%)',
          borderBottom: theme === 'dark' 
            ? AXIOM.borders.topBar
            : '1px solid rgba(148, 163, 184, 0.2)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05, x: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/organization')}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <ArrowLeft className="size-4" />
              Back
            </motion.button>
            <div className="flex items-center gap-3">
              <div 
                className="p-3 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <BarChart3 className="size-6 text-white" />
              </div>
              <div>
                <h1 
                  className="text-4xl font-bold"
                  style={AXIOM.text.titleStyle}
                >
                  Profit Intelligence
                </h1>
                <p 
                  className="text-sm"
                  style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                >
                  Agency-Specific Profitability Analysis
                </p>
              </div>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
            style={AXIOM.buttons.action}
          >
            <Plus className="size-4" />
            New What-If Scenario
          </motion.button>
        </div>
      </motion.div>

      <div className="container mx-auto px-6 py-8">
        {/* Overall Metrics - BLUE THEME */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4 }}
            className="p-6 rounded-2xl"
            style={{
              background: theme === 'dark'
                ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(10, 10, 10, 0.8))'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 252, 0.9))',
              border: theme === 'dark' ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(148, 163, 184, 0.3)',
              boxShadow: theme === 'dark'
                ? '0 10px 30px -10px rgba(0, 0, 0, 0.5)'
                : '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <DollarSign className="size-5 text-white" />
              </div>
              <p 
                className="text-sm font-medium"
                style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
              >
                Total Revenue
              </p>
            </div>
            <p 
              className="text-3xl font-bold mb-1"
              style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
            >
              PKR {(mockProfitAnalysis.overall.totalRevenue / 1000).toFixed(0)}K
            </p>
            <p 
              className="text-sm"
              style={{ color: theme === 'dark' ? '#60a5fa' : '#3b82f6' }}
            >
              This month
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            whileHover={{ y: -4 }}
            className="p-6 rounded-2xl"
            style={{
              background: theme === 'dark'
                ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(10, 10, 10, 0.8))'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 252, 0.9))',
              border: theme === 'dark' ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(148, 163, 184, 0.3)',
              boxShadow: theme === 'dark'
                ? '0 10px 30px -10px rgba(0, 0, 0, 0.5)'
                : '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <TrendingUp className="size-5 text-white" />
              </div>
              <p 
                className="text-sm font-medium"
                style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
              >
                Gross Profit
              </p>
            </div>
            <p 
              className="text-3xl font-bold mb-1"
              style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
            >
              PKR {(mockProfitAnalysis.overall.grossProfit / 1000).toFixed(0)}K
            </p>
            <p 
              className="text-sm"
              style={{ color: theme === 'dark' ? '#10b981' : '#059669' }}
            >
              Margin: {mockProfitAnalysis.overall.grossMargin.toFixed(1)}%
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            whileHover={{ y: -4 }}
            className="p-6 rounded-2xl"
            style={{
              background: theme === 'dark'
                ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(10, 10, 10, 0.8))'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 252, 0.9))',
              border: theme === 'dark' ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(148, 163, 184, 0.3)',
              boxShadow: theme === 'dark'
                ? '0 10px 30px -10px rgba(0, 0, 0, 0.5)'
                : '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <Target className="size-5 text-white" />
              </div>
              <p 
                className="text-sm font-medium"
                style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
              >
                Net Profit
              </p>
            </div>
            <p 
              className="text-3xl font-bold mb-1"
              style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
            >
              PKR {(mockProfitAnalysis.overall.netProfit / 1000).toFixed(0)}K
            </p>
            <p 
              className="text-sm"
              style={{ color: theme === 'dark' ? '#60a5fa' : '#3b82f6' }}
            >
              Margin: {mockProfitAnalysis.overall.netMargin.toFixed(1)}%
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            whileHover={{ y: -4 }}
            className="p-6 rounded-2xl"
            style={{
              background: theme === 'dark'
                ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(10, 10, 10, 0.8))'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(248, 250, 252, 0.9))',
              border: theme === 'dark' ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(148, 163, 184, 0.3)',
              boxShadow: theme === 'dark'
                ? '0 10px 30px -10px rgba(0, 0, 0, 0.5)'
                : '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <Calculator className="size-5 text-white" />
              </div>
              <p 
                className="text-sm font-medium"
                style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
              >
                Total Overhead
              </p>
            </div>
            <p 
              className="text-3xl font-bold mb-1"
              style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
            >
              PKR {(mockProfitAnalysis.overall.totalOverhead / 1000).toFixed(0)}K
            </p>
            <p 
              className="text-sm"
              style={{ color: theme === 'dark' ? '#f59e0b' : '#d97706' }}
            >
              {((mockProfitAnalysis.overall.totalOverhead / mockProfitAnalysis.overall.totalRevenue) * 100).toFixed(1)}% of revenue
            </p>
          </motion.div>
        </div>

        {/* Main Tabs - BLUE THEME */}
        <Tabs defaultValue="departments" className="space-y-6">
          <TabsList 
            className="backdrop-blur-sm p-1.5 rounded-xl"
            style={{
              background: theme === 'dark' ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.8)',
              border: theme === 'dark' ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            <TabsTrigger 
              value="departments" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-500 data-[state=active]:text-white"
            >
              Departments
            </TabsTrigger>
            <TabsTrigger 
              value="projects" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-500 data-[state=active]:text-white"
            >
              Projects
            </TabsTrigger>
            <TabsTrigger 
              value="clients" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-500 data-[state=active]:text-white"
            >
              Clients
            </TabsTrigger>
            <TabsTrigger 
              value="overhead" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-500 data-[state=active]:text-white"
            >
              Overhead
            </TabsTrigger>
            <TabsTrigger 
              value="whatif" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-500 data-[state=active]:text-white"
            >
              What-If
            </TabsTrigger>
            <TabsTrigger 
              value="scope" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-500 data-[state=active]:text-white"
            >
              Business vs Personal
            </TabsTrigger>
          </TabsList>

          {/* Department Analysis */}
          <TabsContent value="departments" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Department Profit Chart - MATCHING DASHBOARD */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                className="rounded-3xl p-8 relative overflow-hidden"
                style={{
                  background: theme === 'dark'
                    ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                  border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                  boxShadow: theme === 'dark' 
                    ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                    : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
                }}
              >
                <div 
                  className="absolute inset-0 opacity-40"
                  style={{
                    background: theme === 'dark'
                      ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                      : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                  }}
                />
                
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-6">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                      }}
                    >
                      <BarChart3 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 
                      className="text-2xl font-bold"
                      style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                    >
                      Department Profitability
                    </h2>
                    <p 
                      className="text-sm"
                      style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                    >
                      Revenue, Cost & Net Profit
                    </p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={mockProfitAnalysis.byDepartment}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.05)' : 'rgba(148, 163, 184, 0.1)'} />
                    <XAxis 
                      dataKey="department" 
                      stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'}
                      style={{ fontSize: '12px', fontWeight: 600 }}
                    />
                    <YAxis 
                      stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'}
                      style={{ fontSize: '12px', fontWeight: 600 }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: theme === 'dark' ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)', 
                        border: `2px solid ${theme === 'dark' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.3)'}`,
                        backdropFilter: 'blur(20px)',
                        borderRadius: '12px',
                        padding: '12px 16px',
                      }} 
                    />
                    <Legend />
                    <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="directCost" fill="#f59e0b" name="Direct Cost" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="netProfit" fill="#10b981" name="Net Profit" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                </div>
              </motion.div>

              {/* Profit Margin Distribution - MATCHING DASHBOARD */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                whileHover={{ y: -4 }}
                className="rounded-3xl p-8 relative overflow-hidden"
                style={{
                  background: theme === 'dark'
                    ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                  border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                  boxShadow: theme === 'dark' 
                    ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                    : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
                }}
              >
                <div 
                  className="absolute inset-0 opacity-40"
                  style={{
                    background: theme === 'dark'
                      ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                      : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                  }}
                />
                
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-6">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                      }}
                    >
                      <PieChartIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 
                      className="text-2xl font-bold"
                      style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                    >
                      Profit Margin by Department
                    </h2>
                    <p 
                      className="text-sm"
                      style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                    >
                      After overhead allocation
                    </p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={mockProfitAnalysis.byDepartment}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry: any) => `${entry.department}: ${Number(entry.profitMargin || 0).toFixed(1)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="netProfit"
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        fill: theme === 'dark' ? '#ffffff' : '#1e293b',
                      }}
                    >
                      {mockProfitAnalysis.byDepartment.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: theme === 'dark' ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)', 
                        border: `2px solid ${theme === 'dark' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.3)'}`,
                        backdropFilter: 'blur(20px)',
                        borderRadius: '12px',
                        padding: '12px 16px',
                        color: theme === 'dark' ? '#ffffff' : '#1e293b',
                      }}
                      labelStyle={{
                        color: theme === 'dark' ? '#ffffff' : '#1e293b',
                        fontWeight: 700,
                      }}
                      itemStyle={{
                        color: theme === 'dark' ? '#94a3b8' : '#64748b',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                </div>
              </motion.div>
            </div>

            {/* Department Details - MATCHING DASHBOARD */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              whileHover={{ y: -4 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                    }}
                  >
                    <Users className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 
                    className="text-2xl font-bold"
                    style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                  >
                    Department Details
                  </h2>
                  <p 
                    className="text-sm"
                    style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                  >
                    Cost per hour, utilization & profitability
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {mockDepartments.map((dept, index) => (
                  <motion.div
                    key={dept.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.01, x: 4 }}
                    className="p-5 rounded-xl border transition-colors"
                    style={{
                      background: theme === 'dark'
                        ? 'rgba(15, 23, 42, 0.4)'
                        : 'rgba(255, 255, 255, 0.7)',
                      borderColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.15)' : '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 
                          className="text-lg font-semibold mb-1"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {dept.name}
                        </h3>
                        <div 
                          className="flex items-center gap-3 text-sm"
                          style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                        >
                          <span className="flex items-center gap-1">
                            <Users className="size-4" />
                            {dept.teamMembers} members
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="size-4" />
                            {dept.utilization.toFixed(1)}% utilization
                          </span>
                        </div>
                      </div>
                      <Badge 
                        variant={dept.profitMargin > 20 ? 'default' : dept.profitMargin > 0 ? 'secondary' : 'destructive'}
                        className={
                          dept.profitMargin > 20 ? 'bg-green-600' :
                          dept.profitMargin > 0 ? 'bg-yellow-600' : 'bg-red-600'
                        }
                      >
                        {dept.profitMargin.toFixed(1)}% margin
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Cost/Hour
                        </p>
                        <p 
                          className="text-lg font-bold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          PKR {dept.costPerHour.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Revenue
                        </p>
                        <p className="text-lg font-bold text-green-400">PKR {(dept.monthlyRevenue / 1000).toFixed(0)}K</p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Direct Cost
                        </p>
                        <p className="text-lg font-bold text-orange-400">PKR {(dept.monthlyCost / 1000).toFixed(0)}K</p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Overhead
                        </p>
                        <p className="text-lg font-bold text-blue-400">PKR {(dept.overheadAllocation / 1000).toFixed(0)}K</p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Net Profit
                        </p>
                        <p className={`text-lg font-bold ${mockProfitAnalysis.byDepartment[index].netProfit > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          PKR {(mockProfitAnalysis.byDepartment[index].netProfit / 1000).toFixed(0)}K
                        </p>
                      </div>
                    </div>

                    <div 
                      className="mt-4 pt-4"
                      style={{
                        borderTop: `1px solid ${theme === 'dark' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(148, 163, 184, 0.2)'}`,
                      }}
                    >
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span 
                            style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                          >
                            Billable Hours:
                          </span>
                          <span 
                            className="ml-2 font-semibold"
                            style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                          >
                            {dept.billableHours} / {dept.totalHours}
                          </span>
                        </div>
                        <div>
                          <span 
                            style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                          >
                            Avg Rate:
                          </span>
                          <span 
                            className="ml-2 font-semibold"
                            style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                          >
                            PKR {dept.billableHours > 0 ? (dept.monthlyRevenue / dept.billableHours).toFixed(0) : 0}/hr
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* Project Analysis - MATCHING DASHBOARD */}
          <TabsContent value="projects" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                    }}
                  >
                    <Briefcase className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 
                    className="text-2xl font-bold"
                    style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                  >
                    Project Profitability
                  </h2>
                  <p 
                    className="text-sm"
                    style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                  >
                    Quote vs Actual analysis
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {mockProjects.map((project, index) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.01, x: 4 }}
                    className="p-5 rounded-xl border"
                    style={{
                      background: theme === 'dark'
                        ? 'rgba(15, 23, 42, 0.4)'
                        : 'rgba(255, 255, 255, 0.7)',
                      borderColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 
                          className="text-lg font-semibold mb-1"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {project.name}
                        </h3>
                        <p 
                          className="text-sm"
                          style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                        >
                          {project.client} • {project.department}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-white/20">
                          {project.status}
                        </Badge>
                        {project.status !== 'quoted' && project.profitMargin > 0 && (
                          <Badge className="bg-green-600">
                            {project.profitMargin.toFixed(1)}% margin
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Quoted Amount
                        </p>
                        <p 
                          className="text-lg font-bold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          PKR {(project.quotedAmount / 1000).toFixed(0)}K
                        </p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Actual Cost
                        </p>
                        <p className="text-lg font-bold text-orange-400">
                          {project.status === 'quoted' ? 'TBD' : `PKR ${(project.actualCost / 1000).toFixed(0)}K`}
                        </p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Profit
                        </p>
                        <p className={`text-lg font-bold ${project.actualProfit > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                          {project.status === 'quoted' ? 'TBD' : `PKR ${(project.actualProfit / 1000).toFixed(0)}K`}
                        </p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Hours
                        </p>
                        <p 
                          className="text-lg font-bold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {project.hoursActual > 0 ? `${project.hoursActual} / ${project.hoursQuoted}` : `${project.hoursQuoted}h`}
                        </p>
                      </div>
                    </div>

                    {project.status !== 'quoted' && project.hoursActual < project.hoursQuoted && (
                      <div className="flex items-center gap-2 text-sm text-green-400 bg-green-950/30 p-2 rounded">
                        <TrendingUp className="size-4" />
                        <span>Under budget by {project.hoursQuoted - project.hoursActual} hours</span>
                      </div>
                    )}
                    {project.status !== 'quoted' && project.hoursActual > project.hoursQuoted && (
                      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-950/30 p-2 rounded">
                        <AlertCircle className="size-4" />
                        <span>Over budget by {project.hoursActual - project.hoursQuoted} hours</span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* Client Analysis - MATCHING DASHBOARD */}
          <TabsContent value="clients" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                    }}
                  >
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 
                      className="text-2xl font-bold"
                      style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                    >
                      Client Profitability
                    </h2>
                    <p 
                      className="text-sm"
                      style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                    >
                      Revenue and profit by client
                    </p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={400}>
                <BarChart data={mockProfitAnalysis.byClient}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.05)' : 'rgba(148, 163, 184, 0.1)'} />
                  <XAxis 
                    dataKey="client" 
                    stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'}
                    style={{ fontSize: '12px', fontWeight: 600 }}
                  />
                  <YAxis 
                    stroke={theme === 'dark' ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'}
                    style={{ fontSize: '12px', fontWeight: 600 }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: theme === 'dark' ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)', 
                      border: `2px solid ${theme === 'dark' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.3)'}`,
                      backdropFilter: 'blur(20px)',
                      borderRadius: '12px',
                      padding: '12px 16px',
                    }} 
                  />
                  <Legend />
                  <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="cost" fill="#f59e0b" name="Cost" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="profit" fill="#10b981" name="Profit" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </motion.div>
          </TabsContent>

          {/* Overhead Analysis - MATCHING DASHBOARD */}
          <TabsContent value="overhead" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                  }}
                >
                  <Layers className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 
                    className="text-2xl font-bold"
                    style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                  >
                    Overhead Allocation
                  </h2>
                  <p 
                    className="text-sm"
                    style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                  >
                    How overhead is distributed across departments
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {mockOverheads.map((overhead, index) => (
                  <motion.div 
                    key={overhead.id} 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.01, x: 4 }}
                    className="p-4 rounded-xl border"
                    style={{
                      background: theme === 'dark'
                        ? 'rgba(15, 23, 42, 0.4)'
                        : 'rgba(255, 255, 255, 0.7)',
                      borderColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 
                          className="font-semibold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {overhead.category}
                        </h4>
                        <p 
                          className="text-sm"
                          style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                        >
                          Allocation: {overhead.allocationType.replace('-', ' ')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p 
                          className="text-xl font-bold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          PKR {overhead.amount.toLocaleString()}
                        </p>
                        <p 
                          className="text-sm"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          {overhead.frequency}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {overhead.departments.map((dept) => (
                        <Badge key={dept} variant="outline" className="border-white/20">
                          {dept}
                        </Badge>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* What-If Scenarios - MATCHING DASHBOARD */}
          <TabsContent value="whatif" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                  }}
                >
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 
                    className="text-2xl font-bold"
                    style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                  >
                    What-If Scenarios
                  </h2>
                  <p 
                    className="text-sm"
                    style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                  >
                    Simulate changes and see impact
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {mockWhatIfScenarios.map((scenario, index) => (
                  <motion.div
                    key={scenario.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.01, x: 4 }}
                    className="p-5 rounded-xl border"
                    style={{
                      background: theme === 'dark'
                        ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.1) 100%)'
                        : 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(37, 99, 235, 0.05) 100%)',
                      borderColor: theme === 'dark' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)',
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 
                          className="text-lg font-semibold mb-2"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {scenario.name}
                        </h3>
                        <div className="space-y-1">
                          {scenario.changes.map((change, idx) => (
                            <p 
                              key={idx} 
                              className="text-sm"
                              style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                            >
                              • {change.type.replace('-', ' ')}: {change.target} by {change.percentage}%
                            </p>
                          ))}
                        </div>
                      </div>
                      <Badge className="bg-green-600">
                        +PKR {(scenario.impact / 1000).toFixed(0)}K
                      </Badge>
                    </div>

                    <div 
                      className="grid grid-cols-3 gap-4 pt-4"
                      style={{
                        borderTop: `1px solid ${theme === 'dark' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(148, 163, 184, 0.2)'}`,
                      }}
                    >
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Projected Profit
                        </p>
                        <p className="text-xl font-bold text-green-400">PKR {(scenario.projectedProfit / 1000).toFixed(0)}K</p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Projected Margin
                        </p>
                        <p 
                          className="text-xl font-bold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {scenario.projectedMargin.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p 
                          className="text-xs mb-1"
                          style={{ color: theme === 'dark' ? '#7dd3fc' : '#0ea5e9' }}
                        >
                          Impact
                        </p>
                        <p className="text-xl font-bold text-blue-400">+{((scenario.impact / mockProfitAnalysis.overall.netProfit) * 100).toFixed(0)}%</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            </motion.div>
          </TabsContent>

          {/* Business vs Personal - MATCHING DASHBOARD */}
          <TabsContent value="scope" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
                border: `1px solid rgba(59, 130, 246, ${theme === 'dark' ? '0.3' : '0.4'})`,
                boxShadow: theme === 'dark' 
                  ? '0 20px 60px -20px rgba(59, 130, 246, 0.5)'
                  : '0 10px 30px -10px rgba(59, 130, 246, 0.3)',
              }}
            >
              <div 
                className="absolute inset-0 opacity-40"
                style={{
                  background: theme === 'dark'
                    ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)'
                    : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
              />
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                  }}
                >
                  <Target className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 
                    className="text-2xl font-bold"
                    style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                  >
                    Business vs Personal Finance
                  </h2>
                  <p 
                    className="text-sm"
                    style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                  >
                    Segregated profit analysis
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {mockProfitAnalysis.byScope.map((scope, index) => (
                  <motion.div
                    key={scope.scope}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.02 }}
                    className="p-6 rounded-2xl border"
                    style={{
                      background: scope.scope === 'business' 
                        ? theme === 'dark'
                          ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.15) 100%)'
                          : 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.08) 100%)'
                        : theme === 'dark'
                          ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(168, 85, 247, 0.15) 100%)'
                          : 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(168, 85, 247, 0.08) 100%)',
                      borderColor: scope.scope === 'business'
                        ? theme === 'dark' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)'
                        : theme === 'dark' ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.2)',
                    }}
                  >
                    <h3 
                      className="text-xl font-bold mb-4 capitalize"
                      style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                    >
                      {scope.scope}
                    </h3>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span 
                          style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                        >
                          Income
                        </span>
                        <span className="text-xl font-bold text-green-400">
                          PKR {(scope.income / 1000).toFixed(0)}K
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span 
                          style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                        >
                          Expense
                        </span>
                        <span className="text-xl font-bold text-red-400">
                          PKR {(scope.expense / 1000).toFixed(0)}K
                        </span>
                      </div>
                      <div 
                        className="h-px my-3"
                        style={{
                          background: theme === 'dark' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                        }}
                      />
                      <div className="flex justify-between items-center">
                        <span 
                          className="font-semibold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          Net Profit
                        </span>
                        <span className={`text-2xl font-bold ${scope.profit > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          PKR {(scope.profit / 1000).toFixed(0)}K
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span 
                          className="text-sm"
                          style={{ color: theme === 'dark' ? '#93c5fd' : '#60a5fa' }}
                        >
                          Profit Margin
                        </span>
                        <span 
                          className="text-lg font-bold"
                          style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                        >
                          {scope.income > 0 ? ((scope.profit / scope.income) * 100).toFixed(1) : '0'}%
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              </div>
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}