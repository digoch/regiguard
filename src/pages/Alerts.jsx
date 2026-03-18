import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ShieldAlert, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

const severityColor = { low: 'bg-blue-100 text-blue-700', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };
const statusColor = { pending: 'bg-slate-100 text-slate-700', under_review: 'bg-yellow-100 text-yellow-700', confirmed: 'bg-green-100 text-green-700', dismissed: 'bg-gray-100 text-gray-500' };

function AlertRow({ alert, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(alert.status);
  const [confirmedSeverity, setConfirmedSeverity] = useState(alert.confirmed_severity || alert.ai_proposed_severity);
  const [reviewNotes, setReviewNotes] = useState(alert.review_notes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await base44.entities.ComplianceAlert.update(alert.id, { status, confirmed_severity: confirmedSeverity, review_notes: reviewNotes });
    setSaving(false);
    onUpdate();
  };

  return (
    <Card className="mb-3">
      <CardContent className="pt-4">
        <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-1">
              <Badge className={`text-xs ${severityColor[alert.ai_proposed_severity]}`}>{alert.ai_proposed_severity}</Badge>
              <Badge className={`text-xs ${statusColor[alert.status]}`}>{alert.status}</Badge>
              <span className="text-xs text-slate-400">{alert.notice_type?.replace('_', ' ')}</span>
            </div>
            <p className="font-medium text-slate-800 text-sm">{alert.title}</p>
            <p className="text-xs text-slate-400 mt-1">{alert.publication_date}</p>
          </div>
          <a href={alert.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-400 hover:text-blue-600">
            <ExternalLink className="w-4 h-4" />
          </a>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
        </div>

        {expanded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Impact Assessment</p>
              <p className="text-sm text-slate-700">{alert.impact_assessment}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">AI Summary</p>
              <p className="text-sm text-slate-600 whitespace-pre-wrap line-clamp-6">{alert.summary}</p>
            </div>

            {/* Review Controls */}
            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase">Human Review</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Status</label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['pending', 'under_review', 'confirmed', 'dismissed'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Confirmed Severity</label>
                  <Select value={confirmedSeverity} onValueChange={setConfirmedSeverity}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['low', 'medium', 'high', 'critical'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea placeholder="Review notes..." value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} className="text-sm h-20" />
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Review'}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  const load = () => {
    setLoading(true);
    base44.entities.ComplianceAlert.list('-created_date', 100).then(a => { setAlerts(a); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const filtered = alerts.filter(a =>
    (statusFilter === 'all' || a.status === statusFilter) &&
    (severityFilter === 'all' || a.ai_proposed_severity === severityFilter)
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <ShieldAlert className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Compliance Alerts</h1>
          <Badge className="ml-auto">{filtered.length}</Badge>
        </div>

        <div className="flex gap-3 mb-6">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {['pending', 'under_review', 'confirmed', 'dismissed'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              {['low', 'medium', 'high', 'critical'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>
          : filtered.length === 0 ? <p className="text-slate-400 text-center py-20">No alerts match the current filters.</p>
          : filtered.map(a => <AlertRow key={a.id} alert={a} onUpdate={load} />)
        }
      </div>
    </div>
  );
}