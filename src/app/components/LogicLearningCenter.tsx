import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Brain, TrendingUp, Zap, AlertCircle, Edit, Power } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useState } from 'react';
import { CategoryManagementDialog } from './CategoryManagementDialog';

interface LogicRule {
  id: string;
  pattern: string;
  category: string;
  confidence: number;
  timesSaved: number;
  lastUsed: string;
  type: 'ai' | 'automatic' | 'manual';
}

const mockLogicRules: LogicRule[] = [
  {
    id: '1',
    pattern: 'AWS*hosting*gener*',
    category: 'Software & Tools',
    confidence: 98,
    timesSaved: 454,
    lastUsed: '11/1/2024',
    type: 'ai'
  },
  {
    id: '2',
    pattern: '*salary*large*payroll*',
    category: 'Salaries & Wages',
    confidence: 96,
    timesSaved: 156,
    lastUsed: '12/25/2025',
    type: 'automatic'
  },
  {
    id: '3',
    pattern: '*domain*godaddy*name*cheap*',
    category: 'Software & Tools',
    confidence: 89,
    timesSaved: 234,
    lastUsed: '10/21/2025',
    type: 'automatic'
  },
  {
    id: '4',
    pattern: '*grocery*inperson*offline*',
    category: 'Office Supplies',
    confidence: 84,
    timesSaved: 89,
    lastUsed: '12/28/2025',
    type: 'manual'
  },
  {
    id: '5',
    pattern: '*adobe*figma*canva*',
    category: 'Software & Tools',
    confidence: 90,
    timesSaved: 234,
    lastUsed: '12/16/2025',
    type: 'automatic'
  }
];

export function LogicLearningCenter() {
  const navigate = useNavigate();
  const [selectedRule, setSelectedRule] = useState<LogicRule | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [rules, setRules] = useState<LogicRule[]>(mockLogicRules);

  const handleDisable = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ background: '#000000' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2" style={{
            background: 'linear-gradient(135deg, #ffffff 0%, #60a5fa 50%, #a855f7 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>Logic Learning Center</h1>
          <p className="text-slate-400">View and manage your AI classification rules</p>
        </div>

        <div className="flex items-center gap-3">
          <CategoryManagementDialog onCategoryCreated={() => {
            // Optionally refresh data here
            console.log('Category created successfully');
          }} />
          <Button variant="outline" className="border-white/10 hover:bg-white/5 text-white">
            <Brain className="size-4 mr-2" />
            Retrain AI
          </Button>
          <Button className="text-white" style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            boxShadow: '0 10px 20px -5px rgba(59, 130, 246, 0.5)',
          }}>
            <Edit className="size-4 mr-2" />
            Create Manual Rule
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-[#0f0f13] border-white/10">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-slate-400 text-sm font-medium">Total Rules</p>
                <h3 className="text-3xl font-bold text-white mt-2">{mockLogicRules.length}</h3>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
                boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.6)',
              }}>
                <Brain className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs">
                <TrendingUp className="w-3 h-3" />
                Active
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f13] border-white/10">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-slate-400 text-sm font-medium">Time Saved</p>
                <h3 className="text-3xl font-bold text-white mt-2">
                  {mockLogicRules.reduce((sum, rule) => sum + rule.timesSaved, 0)}
                </h3>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 10px 30px -10px rgba(16, 185, 129, 0.6)',
              }}>
                <Zap className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-xs">transactions</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f13] border-white/10">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-slate-400 text-sm font-medium">AI Rules</p>
                <h3 className="text-3xl font-bold text-white mt-2">
                  {mockLogicRules.filter(r => r.type === 'ai').length}
                </h3>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                boxShadow: '0 10px 30px -10px rgba(139, 92, 246, 0.6)',
              }}>
                <Brain className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f13] border-white/10">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-slate-400 text-sm font-medium">Manual Rules</p>
                <h3 className="text-3xl font-bold text-white mt-2">
                  {mockLogicRules.filter(r => r.type === 'manual').length}
                </h3>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                boxShadow: '0 10px 30px -10px rgba(236, 72, 153, 0.6)',
              }}>
                <Power className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logic Rules */}
      <Card className="bg-slate-900/50 border-white/10 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white">Logic Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rules.map((rule, index) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 hover:border-cyan-600/50 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <AlertCircle className="size-4 text-cyan-400" />
                    <span className="font-mono text-white font-medium">{rule.pattern}</span>
                    {rule.type === 'ai' && (
                      <Badge className="bg-cyan-600 text-white text-xs">AI</Badge>
                    )}
                    {rule.type === 'automatic' && (
                      <Badge className="bg-blue-600 text-white text-xs">Automatic</Badge>
                    )}
                    {rule.type === 'manual' && (
                      <Badge className="bg-purple-600 text-white text-xs">Manual</Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 mb-3">→ Applies to: {rule.category}</p>
                  <div className="flex items-center gap-6 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-cyan-500 rounded-full" 
                          style={{ width: `${rule.confidence}%` }}
                        />
                      </div>
                      <span className="text-cyan-400 font-semibold">{rule.confidence}%</span>
                    </div>
                    <span>Time Saved: {rule.timesSaved}</span>
                    <span>Last used: {rule.lastUsed}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/20"
                  >
                    <Edit className="size-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDisable(rule.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  >
                    <Power className="size-4 mr-1" />
                    Disable
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      {/* How Logic Learning Works */}
      <Card className="mt-6 bg-slate-900/50 border-white/10 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="size-5 text-cyan-400" />
            <CardTitle className="text-white">How Logic Learning Works</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-cyan-900/30 rounded-lg">
                  <span className="text-cyan-400 font-bold">1</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Pattern Detection</h3>
                  <p className="text-sm text-slate-400">
                    When you add a transaction or correct a classification, the system extracts the narration pattern
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-900/30 rounded-lg">
                  <span className="text-purple-400 font-bold">2</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Auto-Classification</h3>
                  <p className="text-sm text-slate-400">
                    Under narration in the future are automatically matched to the same category
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}