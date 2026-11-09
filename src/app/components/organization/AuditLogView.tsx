import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  PlusCircle,
  Edit3,
  Trash2,
  Download,
  FileText,
  Settings,
  Activity,
  Filter,
  Calendar,
  User,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
// ── Wired to auditService ───────────────────────────────────────────────
import { auditService } from '@/services/auditService';
import { useServiceArray } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import { ViewHeader } from './ViewHeader';

// ── AuditEntry type (previously implicit / mismatched with old mockAuditLogs) ─
interface AuditEntry {
  id: string;
  user: { name: string; role: string } | null;
  action: string;
  entityType: string;
  entityName: string;
  timestamp: string;
  rawTimestamp?: string;
  changes?: { field: string; oldValue: string; newValue: string }[];
  metadata?: { ipAddress?: string; location?: string; device?: string };
}

export function AuditLogView() {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [filterEntity, setFilterEntity] = useState('all');
  const currentYear = new Date().getFullYear();
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`);
  const [dateTo, setDateTo] = useState(`${currentYear}-12-31`);

  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';

  const { data: rawLogs, loading } = useServiceArray(
    () => (orgId ? auditService.getAll(orgId) : Promise.resolve({ success: true, data: [] })),
    [orgId]
  );

  // Map service data to view model safely
  const logs: AuditEntry[] = (rawLogs || []).map(l => ({
    id: l.id,
    user: { name: l.userName || 'System Admin', role: 'admin' },
    action: (l.action || 'activity').toLowerCase(),
    entityType: (l.resource || 'financial').toLowerCase(),
    entityName: l.details || 'System event',
    timestamp: l.timestamp ? new Date(l.timestamp).toLocaleString() : new Date().toLocaleString(),
    rawTimestamp: l.timestamp || new Date().toISOString(),
    metadata: { ipAddress: l.ipAddress || '127.0.0.1' },
  }));

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'created':
        return <PlusCircle className="size-4 text-green-400" />;
      case 'edited':
        return <Edit3 className="size-4 text-blue-400" />;
      case 'deleted':
        return <Trash2 className="size-4 text-red-400" />;
      case 'imported':
        return <Download className="size-4 text-purple-400" />;
      case 'exported':
        return <FileText className="size-4 text-cyan-400" />;
      case 'settings_changed':
        return <Settings className="size-4 text-amber-400" />;
      default:
        return <Activity className="size-4 text-slate-400" />;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'created':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'edited':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'deleted':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'imported':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'exported':
        return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      case 'settings_changed':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const handleExport = () => {
    const csvContent = [
      ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity Name', 'Changes', 'IP Address', 'Location'].join(','),
      ...logs.map(log => [
        log.timestamp,
        log.user?.name || 'Unknown',
        log.action,
        log.entityType,
        log.entityName,
        log.changes?.map(c => `${c.field}: ${c.oldValue} → ${c.newValue}`).join('; ') || '',
        log.metadata?.ipAddress || '',
        log.metadata?.location || '',
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Audit log exported successfully');
  };

  const filteredLogs = logs.filter(log => {
    if (filterUser && !log.user?.name?.toLowerCase().includes(filterUser.toLowerCase())) return false;
    if (filterAction !== 'all' && log.action !== filterAction) return false;
    if (filterEntity !== 'all' && log.entityType !== filterEntity) return false;
    if (dateFrom && log.rawTimestamp && new Date(log.rawTimestamp) < new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && log.rawTimestamp && new Date(log.rawTimestamp) > new Date(`${dateTo}T23:59:59`)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <ViewHeader
        title="Audit Log"
        description="Track all changes and activities in your organization"
      >
        <Button onClick={handleExport} className="bg-gradient-to-r from-blue-600 to-cyan-600">
          <Download className="size-4 mr-2" />
          Export Log
        </Button>
      </ViewHeader>

      {/* Filters */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Filter className="size-5 text-blue-400" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label>User</Label>
              <Input
                placeholder="Search by user name"
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="bg-slate-950 border-slate-700 mt-2"
              />
            </div>
            <div>
              <Label>Action Type</Label>
              <select
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-slate-950 border border-slate-700 text-white mt-2"
              >
                <option value="all">All Actions</option>
                <option value="created">Created</option>
                <option value="edited">Edited</option>
                <option value="deleted">Deleted</option>
                <option value="imported">Imported</option>
                <option value="exported">Exported</option>
                <option value="settings_changed">Settings Changed</option>
              </select>
            </div>
            <div>
              <Label>Entity Type</Label>
              <select
                value={filterEntity}
                onChange={(e) => setFilterEntity(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-slate-950 border border-slate-700 text-white mt-2"
              >
                <option value="all">All Entities</option>
                <option value="transaction">Transactions</option>
                <option value="rule">Rules</option>
                <option value="account">Accounts</option>
                <option value="user">Users</option>
                <option value="import">Imports</option>
                <option value="settings">Settings</option>
              </select>
            </div>
            <div>
              <Label>Date Range</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-xs"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-xs"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Timeline */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Activity Timeline ({filteredLogs.length} entries)</CardTitle>
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
              Last 30 Days
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredLogs.map((log) => (
              <div key={log.id} className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                {/* Main Log Entry */}
                <div
                  className="p-4 cursor-pointer hover:bg-slate-900/50 transition-colors"
                  onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className="p-2 bg-slate-900 rounded-lg">
                      {getActionIcon(log.action)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={getActionColor(log.action)}>
                            {log.action.replace('_', ' ')}
                          </Badge>
                          <span className="text-sm text-slate-400">{log.entityType}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Calendar className="size-3" />
                          {log.timestamp}
                        </div>
                      </div>

                      <h4 className="text-white font-medium mb-2">{log.entityName}</h4>

                      <div className="flex items-center gap-4 text-sm text-slate-400">
                        <div className="flex items-center gap-1">
                          <User className="size-3" />
                          {log.user?.name || 'Unknown User'}
                        </div>
                        <span className="text-slate-600">&bull;</span>
                        <span className="text-slate-500">{log.user?.role || 'N/A'}</span>
                      </div>
                    </div>

                    {/* Expand Icon */}
                    {log.changes && log.changes.length > 0 && (
                      <div>
                        {expandedLog === log.id ? (
                          <ChevronDown className="size-5 text-slate-400" />
                        ) : (
                          <ChevronRight className="size-5 text-slate-400" />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedLog === log.id && log.changes && log.changes.length > 0 && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-800">
                    <h5 className="text-xs font-medium text-slate-400 uppercase mb-3">Changes</h5>
                    <div className="space-y-2">
                      {log.changes.map((change, idx) => (
                        <div key={idx} className="p-3 bg-slate-900 rounded">
                          <div className="text-xs text-slate-500 mb-1 font-medium">{change.field}</div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-red-400 line-through">{change.oldValue}</span>
                            <span className="text-slate-600">&rarr;</span>
                            <span className="text-green-400">{change.newValue}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Metadata */}
                    {log.metadata && (
                      <div className="mt-4 pt-4 border-t border-slate-800">
                        <h5 className="text-xs font-medium text-slate-400 uppercase mb-2">Metadata</h5>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {log.metadata.ipAddress && (
                            <div>
                              <span className="text-slate-500">IP Address:</span>
                              <span className="text-slate-300 ml-2">{log.metadata.ipAddress}</span>
                            </div>
                          )}
                          {log.metadata.location && (
                            <div>
                              <span className="text-slate-500">Location:</span>
                              <span className="text-slate-300 ml-2">{log.metadata.location}</span>
                            </div>
                          )}
                          {log.metadata.device && (
                            <div className="col-span-2">
                              <span className="text-slate-500">Device:</span>
                              <span className="text-slate-300 ml-2">{log.metadata.device}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-white mb-1">
              {logs.filter(l => l.action === 'created').length}
            </div>
            <div className="text-sm text-slate-400">Items Created</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-white mb-1">
              {logs.filter(l => l.action === 'edited').length}
            </div>
            <div className="text-sm text-slate-400">Items Edited</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-white mb-1">
              {logs.filter(l => l.action === 'deleted').length}
            </div>
            <div className="text-sm text-slate-400">Items Deleted</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-white mb-1">
              {logs.filter(l => l.action === 'imported').length}
            </div>
            <div className="text-sm text-slate-400">Imports</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}