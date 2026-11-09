import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { 
  FileText, 
  Download, 
  FileSpreadsheet, 
  Calendar,
  TrendingUp,
  BarChart3,
  DollarSign,
  Wallet,
  CheckCircle2,
  Settings,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { useOrgServices } from '@/hooks/useOrgServices';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { exportToQuickBooks } from '@/lib/exportUtils';

interface ReportConfig {
  id: string;
  name: string;
  description: string;
  icon: any;
  availableFormats: ('pdf' | 'excel' | 'csv')[];
  enabled: boolean;
  lastGenerated?: string;
}

export function CompleteExportCenter() {
  const svc = useOrgServices();
  const { featureFlags } = usePlatformSettings();
  const [reports, setReports] = useState<ReportConfig[]>([
    {
      id: 'profit-loss',
      name: 'Profit & Loss Statement',
      description: 'Income and expenses breakdown',
      icon: TrendingUp,
      availableFormats: ['pdf', 'excel', 'csv'],
      enabled: true,
      lastGenerated: '2025-01-15',
    },
    {
      id: 'balance-sheet',
      name: 'Balance Sheet',
      description: 'Assets, liabilities, and equity',
      icon: BarChart3,
      availableFormats: ['pdf', 'excel'],
      enabled: true,
      lastGenerated: '2025-01-15',
    },
    {
      id: 'cash-flow',
      name: 'Cash Flow Statement',
      description: 'Operating, investing, financing activities',
      icon: DollarSign,
      availableFormats: ['pdf', 'excel', 'csv'],
      enabled: true,
      lastGenerated: '2025-01-14',
    },
    {
      id: 'net-worth',
      name: 'Net Worth Report',
      description: 'Total assets minus liabilities over time',
      icon: Wallet,
      availableFormats: ['pdf', 'excel'],
      enabled: true,
      lastGenerated: '2025-01-15',
    },
    {
      id: 'transactions',
      name: 'Transactions Ledger',
      description: 'Complete transaction history',
      icon: FileText,
      availableFormats: ['excel', 'csv'],
      enabled: true,
      lastGenerated: '2025-01-15',
    },
    {
      id: 'department-costing',
      name: 'Department Costing Report',
      description: 'Expenses by department with overhead allocation',
      icon: BarChart3,
      availableFormats: ['pdf', 'excel'],
      enabled: false,
    },
  ]);

  const [dateFrom, setDateFrom] = useState('2025-01-01');
  const [dateTo, setDateTo] = useState('2025-01-31');
  const [selectedFormat, setSelectedFormat] = useState<'pdf' | 'excel' | 'csv'>('pdf');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [comparePrevious, setComparePrevious] = useState(true);
  const [selectedReports, setSelectedReports] = useState<string[]>(['profit-loss', 'balance-sheet', 'cash-flow', 'net-worth']);

  const toggleReport = (id: string) => {
    setSelectedReports(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  const toggleAllReports = () => {
    if (selectedReports.length === reports.filter(r => r.enabled).length) {
      setSelectedReports([]);
    } else {
      setSelectedReports(reports.filter(r => r.enabled).map(r => r.id));
    }
  };

  const handleGenerateReports = () => {
    if (selectedReports.length === 0) {
      toast.error('Please select at least one report');
      return;
    }

    const formatLabel = selectedFormat === 'pdf' ? 'PDF' : selectedFormat === 'excel' ? 'Excel' : 'CSV';
    toast.success(`Generating ${selectedReports.length} reports in ${formatLabel} format...`);

    // Simulate report generation
    setTimeout(() => {
      toast.success(`✅ Generated ${selectedReports.length} reports successfully!`);
    }, 2000);
  };

  const handlePreviewReport = (reportId: string) => {
    toast.success(`Opening preview for ${reports.find(r => r.id === reportId)?.name}...`);
  };

  const getFormatIcon = (format: string) => {
    switch (format) {
      case 'pdf':
        return <FileText className="size-4 text-red-400" />;
      case 'excel':
        return <FileSpreadsheet className="size-4 text-green-400" />;
      case 'csv':
        return <FileText className="size-4 text-blue-400" />;
      default:
        return <FileText className="size-4 text-slate-400" />;
    }
  };

  const enabledReports = reports.filter(r => r.enabled);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Export Center</h2>
          <p className="text-slate-400">Generate and download financial reports</p>
        </div>
          <Button
            onClick={handleGenerateReports}
            className="bg-gradient-to-r from-blue-600 to-cyan-600"
            disabled={selectedReports.length === 0}
          >
            <Download className="size-4 mr-2" />
            Generate {selectedReports.length > 0 && `(${selectedReports.length})`}
          </Button>
          {featureFlags.export_to_quickbooks && (
            <Button
              onClick={async () => {
                const txRes = await svc.transactions.getAll({ pageSize: 1000 });
                const txList = txRes.success && txRes.data?.items ? txRes.data.items : [];
                exportToQuickBooks(txList, `quickbooks-export-${dateFrom}-to-${dateTo}`, 'iif');
                toast.success('Exported ledger in QuickBooks (.IIF) format');
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white ml-2"
            >
              <FileSpreadsheet className="size-4 mr-2" />
              Export to QuickBooks
            </Button>
          )}
      </div>

      {/* Export Configuration */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="size-5 text-blue-400" />
            <CardTitle className="text-white">Export Configuration</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date Range */}
          <div>
            <Label className="text-white mb-3 block">Report Period</Label>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-400 text-xs mb-2 block">From Date</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-slate-950 border-slate-700"
                />
              </div>
              <div>
                <Label className="text-slate-400 text-xs mb-2 block">To Date</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-slate-950 border-slate-700"
                />
              </div>
            </div>
          </div>

          {/* Format Selection */}
          <div>
            <Label className="text-white mb-3 block">Export Format</Label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setSelectedFormat('pdf')}
                className={`p-4 rounded-lg border transition-all ${
                  selectedFormat === 'pdf'
                    ? 'bg-red-500/10 border-red-500/50 text-red-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <FileText className="size-6 mx-auto mb-2" />
                <div className="font-medium text-sm">PDF</div>
                <div className="text-xs opacity-70">Professional reports</div>
              </button>
              <button
                onClick={() => setSelectedFormat('excel')}
                className={`p-4 rounded-lg border transition-all ${
                  selectedFormat === 'excel'
                    ? 'bg-green-500/10 border-green-500/50 text-green-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <FileSpreadsheet className="size-6 mx-auto mb-2" />
                <div className="font-medium text-sm">Excel</div>
                <div className="text-xs opacity-70">Editable spreadsheets</div>
              </button>
              <button
                onClick={() => setSelectedFormat('csv')}
                className={`p-4 rounded-lg border transition-all ${
                  selectedFormat === 'csv'
                    ? 'bg-blue-500/10 border-blue-500/50 text-blue-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <FileText className="size-6 mx-auto mb-2" />
                <div className="font-medium text-sm">CSV</div>
                <div className="text-xs opacity-70">Raw data</div>
              </button>
            </div>
          </div>

          {/* Export Options */}
          <div className="space-y-3">
            <Label className="text-white mb-3 block">Export Options</Label>
            
            {selectedFormat === 'pdf' && (
              <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg">
                <div>
                  <p className="text-sm text-white font-medium">Include Charts & Graphs</p>
                  <p className="text-xs text-slate-400">Visual representations of data</p>
                </div>
                <Switch
                  checked={includeCharts}
                  onCheckedChange={setIncludeCharts}
                />
              </div>
            )}

            <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg">
              <div>
                <p className="text-sm text-white font-medium">Compare with Previous Period</p>
                <p className="text-xs text-slate-400">Show period-over-period changes</p>
              </div>
              <Switch
                checked={comparePrevious}
                onCheckedChange={setComparePrevious}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg">
              <div>
                <p className="text-sm text-white font-medium">Include Notes & Comments</p>
                <p className="text-xs text-slate-400">Add explanatory notes to reports</p>
              </div>
              <Switch
                checked={includeNotes}
                onCheckedChange={setIncludeNotes}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Selection */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Select Reports</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleAllReports}
              className="border-slate-700 hover:bg-slate-800"
            >
              {selectedReports.length === enabledReports.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {reports.map((report) => {
            const Icon = report.icon;
            const isSelected = selectedReports.includes(report.id);
            const supportsFormat = report.availableFormats.includes(selectedFormat);

            return (
              <div
                key={report.id}
                className={`p-4 rounded-lg border transition-all ${
                  !report.enabled
                    ? 'opacity-50 bg-slate-950/50 border-slate-800'
                    : isSelected
                    ? 'bg-blue-950/20 border-blue-900/50'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                } ${!supportsFormat && report.enabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`p-3 rounded-lg ${
                    isSelected ? 'bg-blue-500/20' : 'bg-slate-900'
                  }`}>
                    <Icon className={`size-5 ${
                      isSelected ? 'text-blue-400' : 'text-slate-400'
                    }`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="text-white font-medium mb-1">{report.name}</h4>
                        <p className="text-sm text-slate-400">{report.description}</p>
                      </div>
                      {report.enabled && (
                        <button
                          onClick={() => supportsFormat && toggleReport(report.id)}
                          disabled={!supportsFormat}
                          className={`size-6 rounded border transition-all flex items-center justify-center ${
                            isSelected
                              ? 'bg-blue-500 border-blue-500'
                              : 'border-slate-700 hover:border-slate-600'
                          } ${!supportsFormat ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {isSelected && <CheckCircle2 className="size-4 text-white" />}
                        </button>
                      )}
                    </div>

                    {/* Format Badges */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {report.availableFormats.map((format) => (
                        <Badge
                          key={format}
                          className={`text-xs ${
                            format === selectedFormat
                              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {format.toUpperCase()}
                        </Badge>
                      ))}
                    </div>

                    {/* Last Generated */}
                    {report.lastGenerated && (
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          <span>Last generated: {report.lastGenerated}</span>
                        </div>
                        <button
                          onClick={() => handlePreviewReport(report.id)}
                          className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                        >
                          <Eye className="size-3" />
                          Preview
                        </button>
                      </div>
                    )}

                    {/* Format Warning */}
                    {!supportsFormat && report.enabled && (
                      <div className="mt-2 text-xs text-amber-400">
                        ⚠️ Not available in {selectedFormat.toUpperCase()} format
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Export Summary */}
      <Card className="bg-gradient-to-br from-blue-950/20 to-cyan-950/20 border-blue-900/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Download className="size-6 text-blue-400" />
            </div>
            <div className="flex-1">
              <h4 className="text-white font-medium mb-1">Export Summary</h4>
              <div className="grid md:grid-cols-4 gap-4 text-sm mt-3">
                <div>
                  <span className="text-slate-500">Reports Selected:</span>
                  <span className="text-white ml-2 font-medium">{selectedReports.length}</span>
                </div>
                <div>
                  <span className="text-slate-500">Format:</span>
                  <span className="text-white ml-2 font-medium uppercase">{selectedFormat}</span>
                </div>
                <div>
                  <span className="text-slate-500">Period:</span>
                  <span className="text-white ml-2 font-medium">{dateFrom} to {dateTo}</span>
                </div>
                <div>
                  <span className="text-slate-500">Options:</span>
                  <span className="text-white ml-2 font-medium">
                    {[includeCharts && 'Charts', comparePrevious && 'Compare', includeNotes && 'Notes']
                      .filter(Boolean)
                      .join(', ') || 'None'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Export Presets */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Quick Export Presets</CardTitle>
          <CardDescription>Common report combinations for quick access</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-3">
            <button
              onClick={() => {
                setSelectedReports(['profit-loss', 'balance-sheet', 'cash-flow']);
                setSelectedFormat('pdf');
                toast.success('Loaded Financial Statements preset');
              }}
              className="p-4 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors text-left"
            >
              <h5 className="text-white font-medium mb-1">📊 Financial Statements</h5>
              <p className="text-xs text-slate-400">P&L, Balance Sheet, Cash Flow (PDF)</p>
            </button>
            <button
              onClick={() => {
                setSelectedReports(['transactions']);
                setSelectedFormat('excel');
                toast.success('Loaded Data Export preset');
              }}
              className="p-4 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors text-left"
            >
              <h5 className="text-white font-medium mb-1">📈 Data Export</h5>
              <p className="text-xs text-slate-400">All transactions (Excel)</p>
            </button>
            <button
              onClick={() => {
                setSelectedReports(['profit-loss', 'net-worth', 'department-costing']);
                setSelectedFormat('pdf');
                toast.success('Loaded Executive Summary preset');
              }}
              className="p-4 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors text-left"
            >
              <h5 className="text-white font-medium mb-1">💼 Executive Summary</h5>
              <p className="text-xs text-slate-400">P&L, Net Worth, Dept Costing (PDF)</p>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
