import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, Play, Terminal, AlertTriangle, CheckCircle2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

const severityColors = {
  low: 'bg-green-100 text-green-700 border-green-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
};

function AlertResultCard({ alert }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={`text-xs border ${severityColors[alert.severity] || severityColors.medium}`}>
              {alert.severity?.toUpperCase()}
            </Badge>
            <span className="font-semibold text-slate-900 text-sm truncate">{alert.item_name}</span>
            <span className="text-slate-400 text-xs">→</span>
            <span className="text-blue-700 text-sm font-medium">{alert.customer_name}</span>
          </div>
          <p className="text-xs text-slate-500 italic line-clamp-2">{alert.rationale}</p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-slate-400 hover:text-slate-700 shrink-0 mt-0.5">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Personalized Impact</p>
          <p className="text-sm text-slate-700">{alert.impact_assessment}</p>
          <p className="text-xs text-slate-400 mt-2">Alert ID: {alert.alert?.id}</p>
        </div>
      )}
    </div>
  );
}

export default function IntelligenceCenter() {
  const [noticeText, setNoticeText] = useState('');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeType, setNoticeType] = useState('guidance');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const logsEndRef = useRef(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    loadPendingAlerts();
  }, []);

  const loadPendingAlerts = async () => {
    setLoadingPending(true);
    const results = await base44.entities.ComplianceAlert.filter({ status: 'pending' }, '-created_date', 20);
    setPendingAlerts(results);
    setLoadingPending(false);
  };

  const handleRun = async () => {
    if (!noticeText.trim()) return;
    setRunning(true);
    setLogs(['[System] Starting compliance scan...']);
    setAlerts([]);
    setDone(false);
    setError('');

    const response = await base44.functions.invoke('manualComplianceScan', {
      notice_text: noticeText,
      notice_title: noticeTitle || 'Manual Notice',
      notice_type: noticeType,
      publication_date: new Date().toISOString().split('T')[0],
    });

    const data = response.data;

    if (data.error) {
      setError(data.error);
      setLogs(l => [...l, `[Error] ${data.error}`]);
    } else {
      setLogs(data.logs || []);
      setAlerts(data.alerts || []);
      setDone(true);
      loadPendingAlerts();
    }
    setRunning(false);
  };

  const handleConfirm = async (alertId) => {
    await base44.entities.ComplianceAlert.update(alertId, { status: 'confirmed' });
    loadPendingAlerts();
  };

  const handleDismiss = async (alertId) => {
    await base44.entities.ComplianceAlert.update(alertId, { status: 'dismissed' });
    loadPendingAlerts();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Intelligence Center</h1>
            <p className="text-sm text-slate-500">Manually test the compliance scan engine against a regulatory notice</p>
          </div>
        </div>

        {/* Input Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="w-4 h-4" /> Paste Regulatory Notice
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Notice Title (optional)</Label>
                <Input
                  placeholder="e.g., BIS Amendment to EAR Part 774"
                  value={noticeTitle}
                  onChange={e => setNoticeTitle(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Notice Type</Label>
                <Select value={noticeType} onValueChange={setNoticeType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="final_rule">Final Rule</SelectItem>
                    <SelectItem value="proposed_rule">Proposed Rule</SelectItem>
                    <SelectItem value="interim_rule">Interim Rule</SelectItem>
                    <SelectItem value="guidance">Guidance</SelectItem>
                    <SelectItem value="amendment">Amendment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Paste Regulatory Notice *</Label>
              <Textarea
                placeholder="Paste the full text of the regulatory notice here. The AI will match it against your Global Library and fan out alerts to linked customers..."
                value={noticeText}
                onChange={e => setNoticeText(e.target.value)}
                className="h-48 font-mono text-sm"
              />
            </div>
            <Button
              onClick={handleRun}
              disabled={running || !noticeText.trim()}
              className="gap-2 w-full md:w-auto"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? 'Scanning...' : 'Run Compliance Scan'}
            </Button>
          </CardContent>
        </Card>

        {/* Real-time Log */}
        {(logs.length > 0 || running) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="w-4 h-4 text-green-600" /> Scan Log
                {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" />}
                {done && <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-400 max-h-56 overflow-y-auto space-y-0.5">
                {logs.map((line, i) => (
                  <div key={i} className="leading-relaxed">{line}</div>
                ))}
                {running && <div className="animate-pulse text-slate-500">▋</div>}
                {error && <div className="text-red-400">[Error] {error}</div>}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Scan Results */}
        {alerts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                Scan Results — {alerts.length} Alert{alerts.length !== 1 ? 's' : ''} Generated
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.map((alert, i) => (
                <AlertResultCard key={i} alert={alert} />
              ))}
            </CardContent>
          </Card>
        )}

        {done && alerts.length === 0 && !error && (
          <div className="text-center py-8 text-slate-400 text-sm">
            No matches found. The notice did not match any items in your Global Library.
          </div>
        )}

        {/* Pending Alerts Queue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              Pending Alerts Queue
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={loadPendingAlerts} className="text-xs text-slate-500">Refresh</Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadingPending ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
              </div>
            ) : pendingAlerts.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">No pending alerts.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Title</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Severity</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Created</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingAlerts.map(alert => (
                    <tr key={alert.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800 max-w-xs">
                        <span className="line-clamp-1">{alert.title}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs border ${severityColors[alert.ai_proposed_severity] || ''}`}>
                          {alert.ai_proposed_severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {new Date(alert.created_date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" className="text-xs h-7 text-green-700 border-green-300 hover:bg-green-50" onClick={() => handleConfirm(alert.id)}>
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs h-7 text-slate-400 hover:text-red-500" onClick={() => handleDismiss(alert.id)}>
                            Dismiss
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}