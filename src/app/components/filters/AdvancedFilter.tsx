import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Filter, 
  Plus, 
  X, 
  Save, 
  Sparkles,
  Calendar,
  DollarSign,
  Tag,
  Building2,
  ChevronDown
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string | number;
}

export interface SavedView {
  id: string;
  name: string;
  filters: FilterCondition[];
  createdAt: Date;
}

const FILTER_FIELDS = [
  { value: 'date', label: 'Date', icon: Calendar },
  { value: 'amount', label: 'Amount', icon: DollarSign },
  { value: 'category', label: 'Category', icon: Tag },
  { value: 'account', label: 'Account', icon: Building2 },
  { value: 'narration', label: 'Description', icon: Sparkles }
];

const OPERATORS = {
  date: [
    { value: 'is', label: 'Is' },
    { value: 'before', label: 'Before' },
    { value: 'after', label: 'After' },
    { value: 'between', label: 'Between' }
  ],
  amount: [
    { value: 'equals', label: 'Equals' },
    { value: 'greater', label: 'Greater than' },
    { value: 'less', label: 'Less than' },
    { value: 'between', label: 'Between' }
  ],
  category: [
    { value: 'is', label: 'Is' },
    { value: 'is_not', label: 'Is not' },
    { value: 'contains', label: 'Contains' }
  ],
  account: [
    { value: 'is', label: 'Is' },
    { value: 'is_not', label: 'Is not' }
  ],
  narration: [
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Does not contain' },
    { value: 'starts_with', label: 'Starts with' }
  ]
};

const QUICK_FILTERS = [
  { id: 'this-month', label: 'This Month', filters: [] },
  { id: 'last-month', label: 'Last Month', filters: [] },
  { id: 'this-quarter', label: 'This Quarter', filters: [] },
  { id: 'uncategorized', label: 'Uncategorized', filters: [] },
  { id: 'high-value', label: 'Over PKR 1000', filters: [] }
];

export function AdvancedFilter() {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([
    {
      id: '1',
      name: 'Recurring Expenses',
      filters: [],
      createdAt: new Date()
    },
    {
      id: '2',
      name: 'Client Payments',
      filters: [],
      createdAt: new Date()
    }
  ]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewName, setViewName] = useState('');

  const addFilter = () => {
    const newFilter: FilterCondition = {
      id: `filter_${Date.now()}`,
      field: 'date',
      operator: 'is',
      value: ''
    };
    setFilters([...filters, newFilter]);
  };

  const removeFilter = (id: string) => {
    setFilters(filters.filter(f => f.id !== id));
  };

  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    setFilters(filters.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const saveView = () => {
    const newView: SavedView = {
      id: `view_${Date.now()}`,
      name: viewName,
      filters: [...filters],
      createdAt: new Date()
    };
    setSavedViews([...savedViews, newView]);
    setShowSaveDialog(false);
    setViewName('');
  };

  const loadView = (view: SavedView) => {
    setFilters([...view.filters]);
    setIsOpen(true);
  };

  const applyFilters = () => {
    // TODO: Implement actual filtering logic
    console.log('Applying filters:', filters);
    setIsOpen(false);
  };

  const clearFilters = () => {
    setFilters([]);
  };

  const activeFilterCount = filters.length;

  return (
    <div className="relative">
      {/* Filter Button */}
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="border-white/10 hover:bg-white/5 text-white relative"
      >
        <Filter className="w-4 h-4 mr-2" />
        Filters
        {activeFilterCount > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full">
            {activeFilterCount}
          </span>
        )}
      </Button>

      {/* Filter Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute right-0 top-12 w-[min(500px,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-50"
            >
              <Card className="bg-slate-900 border-0">
                <CardContent className="p-0">
                  {/* Header */}
                  <div className="px-4 py-3 border-b border-white/10 bg-slate-950">
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-medium">Advanced Filters</h3>
                      <button
                        onClick={() => setIsOpen(false)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Quick Filters */}
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-xs text-slate-400 mb-2">Quick Filters</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_FILTERS.map(qf => (
                        <button
                          key={qf.id}
                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-white transition-colors"
                        >
                          {qf.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Saved Views */}
                  {savedViews.length > 0 && (
                    <div className="px-4 py-3 border-b border-white/10">
                      <p className="text-xs text-slate-400 mb-2">Saved Views</p>
                      <div className="space-y-1">
                        {savedViews.map(view => (
                          <button
                            key={view.id}
                            onClick={() => loadView(view)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white transition-colors"
                          >
                            <span>{view.name}</span>
                            <span className="text-xs text-slate-400">
                              {view.filters.length} filter{view.filters.length !== 1 ? 's' : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Filter Builder */}
                  <div className="px-4 py-3 max-h-[400px] overflow-y-auto">
                    {filters.length === 0 ? (
                      <div className="text-center py-8">
                        <Filter className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                        <p className="text-slate-400 mb-2">No filters applied</p>
                        <p className="text-xs text-slate-500 mb-4">
                          Click "Add Filter" to create custom filters
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filters.map((filter, index) => (
                          <FilterRow
                            key={filter.id}
                            filter={filter}
                            index={index}
                            onUpdate={(updates) => updateFilter(filter.id, updates)}
                            onRemove={() => removeFilter(filter.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="px-4 py-3 border-t border-white/10 bg-slate-950 space-y-2">
                    <Button
                      onClick={addFilter}
                      variant="outline"
                      className="w-full border-white/10 hover:bg-white/5 text-white"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Filter
                    </Button>

                    <div className="flex gap-2">
                      <Button
                        onClick={clearFilters}
                        variant="outline"
                        className="flex-1 border-white/10 hover:bg-white/5 text-white"
                        disabled={filters.length === 0}
                      >
                        Clear All
                      </Button>
                      {filters.length > 0 && (
                        <Button
                          onClick={() => setShowSaveDialog(true)}
                          variant="outline"
                          className="flex-1 border-white/10 hover:bg-white/5 text-white"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          Save View
                        </Button>
                      )}
                    </div>

                    <Button
                      onClick={applyFilters}
                      className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                      disabled={filters.length === 0}
                    >
                      Apply Filters
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Save View Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-slate-900 border border-white/10 rounded-xl p-6"
          >
            <h3 className="text-xl font-bold text-white mb-4">Save Filter View</h3>
            <input
              type="text"
              placeholder="Enter view name..."
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-400 mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSaveDialog(false)}
                className="flex-1 border-white/10 hover:bg-white/5 text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={saveView}
                disabled={!viewName.trim()}
                className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
              >
                <Save className="w-4 h-4 mr-2" />
                Save
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// Filter Row Component
function FilterRow({
  filter,
  index,
  onUpdate,
  onRemove
}: {
  filter: FilterCondition;
  index: number;
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const fieldConfig = FILTER_FIELDS.find(f => f.value === filter.field);
  const operators = OPERATORS[filter.field as keyof typeof OPERATORS] || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2 p-3 bg-white/5 border border-white/10 rounded-lg"
    >
      {index > 0 && (
        <div className="text-xs text-slate-400 font-medium pt-2">AND</div>
      )}
      
      <div className="flex-1 space-y-2">
        {/* Field Select */}
        <select
          value={filter.field}
          onChange={(e) => onUpdate({ field: e.target.value, operator: OPERATORS[e.target.value as keyof typeof OPERATORS][0].value })}
          className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
        >
          {FILTER_FIELDS.map(field => (
            <option key={field.value} value={field.value}>
              {field.label}
            </option>
          ))}
        </select>

        {/* Operator Select */}
        <select
          value={filter.operator}
          onChange={(e) => onUpdate({ operator: e.target.value })}
          className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
        >
          {operators.map(op => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>

        {/* Value Input */}
        <input
          type={filter.field === 'amount' ? 'number' : filter.field === 'date' ? 'date' : 'text'}
          value={filter.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder="Enter value..."
          className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-slate-400"
        />
      </div>

      <button
        onClick={onRemove}
        className="text-slate-400 hover:text-red-400 transition-colors mt-2"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
