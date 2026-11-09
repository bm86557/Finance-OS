import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { 
  Megaphone, 
  Calendar, 
  AlertCircle, 
  Bell, 
  ChevronRight, 
  Pin, 
  Users, 
  Star,
  User,
  X,
  Sparkles,
  BookOpen
} from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { useService } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';

const categoryMeta: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
  general: { label: 'General', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.25)', icon: Megaphone },
  hr: { label: 'People & HR', color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.25)', icon: Users },
  finance: { label: 'Finance & Policy', color: '#34d399', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)', icon: Bell },
  project: { label: 'Projects & Ops', color: '#c084fc', bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.25)', icon: AlertCircle },
  celebration: { label: 'Celebration', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)', icon: Star },
};

function normalizeCategory(cat?: string): string {
  const c = (cat || 'general').toLowerCase();
  if (c === 'recognition') return 'celebration';
  if (c === 'policy') return 'finance';
  if (c === 'important') return 'general';
  return categoryMeta[c] ? c : 'general';
}

interface FormattedAnnouncement {
  id: string;
  title: string;
  body: string;
  date: string;
  author: string;
  category: string;
  pinned: boolean;
  department: string;
}

export function CompanyAnnouncements() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<FormattedAnnouncement | null>(null);

  // Service-backed announcements from backend / organizations / Supabase
  const { data: svcAnnouncements, loading, error, refetch } = useService(
    () => (orgId ? employeeService.getAnnouncements(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId]
  );

  const announcements: FormattedAnnouncement[] = useMemo(() => {
    return (svcAnnouncements ?? []).map(a => {
      const cat = normalizeCategory(a.category);
      return {
        id: a.id,
        title: a.title,
        body: a.content,
        date: new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        author: a.author || 'Leadership Team',
        category: cat,
        pinned: Boolean(a.isPinned),
        department: 'All Organization',
      };
    });
  }, [svcAnnouncements]);

  // Counts per category
  const counts = useMemo(() => {
    const res: Record<string, number> = { all: announcements.length };
    announcements.forEach(a => {
      res[a.category] = (res[a.category] || 0) + 1;
    });
    return res;
  }, [announcements]);

  const filteredAnnouncements = useMemo(() => {
    if (selectedCategory === 'all') return announcements;
    return announcements.filter(a => a.category === selectedCategory);
  }, [announcements, selectedCategory]);

  const pinnedAnnouncements = useMemo(() => {
    return filteredAnnouncements.filter(a => a.pinned);
  }, [filteredAnnouncements]);

  const standardAnnouncements = useMemo(() => {
    return filteredAnnouncements.filter(a => !a.pinned);
  }, [filteredAnnouncements]);

  return (
    <div className="p-8 space-y-8" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>Announcements</h1>
          <p className="text-slate-400 font-mono">Company news, updates, and important notices</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 flex items-center gap-2 text-xs font-mono text-slate-300">
            <Megaphone className="size-3.5 text-blue-400" />
            <span>{announcements.length} Total Notice{announcements.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </motion.div>

      {/* Category Filter Pills */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none"
      >
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-4 py-2 rounded-xl text-xs font-mono transition-all flex items-center gap-2 cursor-pointer border ${
            selectedCategory === 'all'
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
              : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200'
          }`}
        >
          <span>All News</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedCategory === 'all' ? 'bg-blue-500/30 text-blue-300' : 'bg-white/10 text-slate-400'}`}>
            {counts.all || 0}
          </span>
        </button>

        {Object.entries(categoryMeta).map(([catKey, meta]) => {
          const CatIcon = meta.icon;
          const isSelected = selectedCategory === catKey;
          const count = counts[catKey] || 0;
          return (
            <button
              key={catKey}
              onClick={() => setSelectedCategory(catKey)}
              className={`px-4 py-2 rounded-xl text-xs font-mono transition-all flex items-center gap-2 cursor-pointer border ${
                isSelected
                  ? 'border-transparent text-white shadow-lg'
                  : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200'
              }`}
              style={isSelected ? { background: meta.bg, borderColor: meta.border, color: meta.color } : {}}
            >
              <CatIcon className="size-3.5" style={isSelected ? { color: meta.color } : {}} />
              <span>{meta.label}</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/10">
                {count}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Error Banner */}
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-amber-200 text-sm font-mono border border-amber-500/30 flex items-center justify-between"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="size-5 text-amber-400 shrink-0" />
            <span>Failed to load announcements: {error}</span>
          </div>
          <button 
            onClick={() => refetch()} 
            className="text-xs text-amber-400 underline font-mono hover:text-amber-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {svcAnnouncements === null && loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((k) => (
            <div
              key={k}
              className="rounded-2xl p-6 border border-white/5 animate-pulse space-y-4"
              style={{ background: AXIOM.backgrounds.chartContainer }}
            >
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-2/3 bg-white/10 rounded" />
                  <div className="h-4 w-full bg-white/5 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State when no announcements exist */}
      {!loading && announcements.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl p-12 text-center border border-white/10 relative overflow-hidden"
          style={{ background: AXIOM.backgrounds.chartContainer }}
        >
          <div
            className="size-16 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-xl"
            style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)' }}
          >
            <Megaphone className="size-8 text-blue-400" />
          </div>
          <h3 className="text-white font-bold text-xl mb-2">No Announcements Posted Yet</h3>
          <p className="text-slate-400 font-mono text-sm max-w-md mx-auto leading-relaxed">
            Your leadership team has not posted any company news or notices yet. Check back soon for policy updates, events, and milestone celebrations!
          </p>
        </motion.div>
      )}

      {/* Empty State when filter yields 0 */}
      {!loading && announcements.length > 0 && filteredAnnouncements.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl p-10 text-center border border-white/5"
          style={{ background: AXIOM.backgrounds.chartContainer }}
        >
          <Megaphone className="size-10 text-slate-500 mx-auto mb-3 opacity-60" />
          <h4 className="text-white font-medium text-base mb-1">No {categoryMeta[selectedCategory]?.label || selectedCategory} notices</h4>
          <p className="text-slate-400 font-mono text-xs mb-4">
            There are currently no announcements matching the selected filter.
          </p>
          <button
            onClick={() => setSelectedCategory('all')}
            className="px-4 py-2 rounded-xl bg-white/10 text-white font-mono text-xs hover:bg-white/15 transition cursor-pointer"
          >
            Show All News ({announcements.length})
          </button>
        </motion.div>
      )}

      {/* Pinned Announcements Spotlight */}
      {pinnedAnnouncements.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold">
            <Pin className="size-3.5 rotate-45" />
            <span>Featured & Pinned Notices</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {pinnedAnnouncements.map((item, i) => {
              const meta = categoryMeta[item.category] || categoryMeta.general;
              const TypeIcon = meta.icon;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  onClick={() => setSelectedAnnouncement(item)}
                  className="group rounded-2xl p-6 cursor-pointer hover:border-amber-400/50 hover:bg-white/5 transition-all relative overflow-hidden"
                  style={{
                    background: AXIOM.backgrounds.chartContainer,
                    border: `1px solid ${meta.border}`,
                    boxShadow: `0 20px 60px -20px ${meta.color}30`,
                  }}
                >
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-medium">
                    <Pin className="size-3" />
                    <span>Pinned</span>
                  </div>

                  <div className="flex items-start gap-4">
                    <div
                      className="size-12 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
                      style={{
                        background: meta.bg,
                        border: `1px solid ${meta.border}`,
                      }}
                    >
                      <TypeIcon className="size-6" style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0 pr-12">
                      <h3 className="text-white font-bold text-lg mb-2 group-hover:text-blue-300 transition-colors line-clamp-1">
                        {item.title}
                      </h3>
                      <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed mb-4">
                        {item.body}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                          <Calendar className="size-3" /> {item.date}
                        </span>
                        <span className="text-xs font-mono" style={{ color: meta.color }}>
                          by {item.author}
                        </span>
                        <span
                          className="text-[11px] font-mono px-2 py-0.5 rounded capitalize"
                          style={{
                            background: meta.bg,
                            border: `1px solid ${meta.border}`,
                            color: meta.color,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Announcements List Feed */}
      {filteredAnnouncements.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl overflow-hidden border border-white/10"
          style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}
        >
          <div className="p-6 pb-4 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Megaphone className="size-5 text-blue-400" />
              <span>
                {selectedCategory === 'all' ? 'All Company Announcements' : `${categoryMeta[selectedCategory]?.label} Notices`}
              </span>
            </h3>
            <span className="text-xs font-mono text-slate-400">
              Showing {filteredAnnouncements.length} item{filteredAnnouncements.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="divide-y divide-white/5">
            {filteredAnnouncements.map((item, i) => {
              const meta = categoryMeta[item.category] || categoryMeta.general;
              const TypeIcon = meta.icon;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.03 }}
                  onClick={() => setSelectedAnnouncement(item)}
                  className="group px-6 py-5 hover:bg-white/5 transition-all cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
                      style={{
                        background: meta.bg,
                        border: `1px solid ${meta.border}`,
                      }}
                    >
                      <TypeIcon className="size-5" style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h4 className="text-white font-semibold text-base group-hover:text-blue-300 transition-colors">
                          {item.title}
                        </h4>
                        {item.pinned && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                            <Pin className="size-2.5" /> Pinned
                          </span>
                        )}
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded capitalize"
                          style={{
                            background: meta.bg,
                            border: `1px solid ${meta.border}`,
                            color: meta.color,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-400 line-clamp-1 mb-2 font-sans">
                        {item.body}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-slate-500 font-mono">
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3" /> {item.date}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="size-3" /> {item.author}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-slate-500 group-hover:text-blue-400 transition-colors shrink-0">
                    <span className="text-xs font-mono hidden md:inline">Read Notice</span>
                    <ChevronRight className="size-5" />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Detail Dialog Modal */}
      <Dialog open={!!selectedAnnouncement} onOpenChange={(open) => !open && setSelectedAnnouncement(null)}>
        <DialogContent
          className="max-w-2xl border-white/10 text-white shadow-2xl backdrop-blur-xl"
          style={{ background: '#0f172a', borderRadius: '1.25rem' }}
        >
          {selectedAnnouncement && (() => {
            const meta = categoryMeta[selectedAnnouncement.category] || categoryMeta.general;
            const TypeIcon = meta.icon;
            return (
              <>
                <DialogHeader className="space-y-3 pb-4 border-b border-white/10">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div
                      className="px-2.5 py-1 rounded-md text-xs font-mono font-medium flex items-center gap-1.5"
                      style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }}
                    >
                      <TypeIcon className="size-3.5" />
                      <span>{meta.label}</span>
                    </div>
                    {selectedAnnouncement.pinned && (
                      <div className="px-2.5 py-1 rounded-md text-xs font-mono font-medium flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-300">
                        <Pin className="size-3" />
                        <span>Pinned to Top</span>
                      </div>
                    )}
                    <span className="text-xs text-slate-400 font-mono ml-auto flex items-center gap-1">
                      <Calendar className="size-3.5" />
                      {selectedAnnouncement.date}
                    </span>
                  </div>

                  <DialogTitle className="text-2xl font-bold text-white tracking-tight leading-snug">
                    {selectedAnnouncement.title}
                  </DialogTitle>

                  <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                    <div className="flex items-center gap-1.5 text-blue-400">
                      <User className="size-3.5" />
                      <span>{selectedAnnouncement.author}</span>
                    </div>
                    <span>•</span>
                    <span className="text-slate-500">{selectedAnnouncement.department}</span>
                  </div>
                </DialogHeader>

                <div className="py-6 max-h-[60vh] overflow-y-auto space-y-4 pr-2">
                  <div className="text-slate-200 text-sm md:text-base leading-relaxed whitespace-pre-line font-sans">
                    {selectedAnnouncement.body}
                  </div>
                </div>

                <DialogFooter className="pt-4 border-t border-white/10 flex justify-end">
                  <button
                    onClick={() => setSelectedAnnouncement(null)}
                    className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-mono text-xs font-semibold transition cursor-pointer"
                  >
                    Close Notice
                  </button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
