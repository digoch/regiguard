import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

const severityColor = { low: 'bg-blue-100 text-blue-700', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };

function AuditRow({ alert }) {
  const [expanded, setExpanded] = useState(false);
  const meta = alert.audit_metadata || {};

  return (
    <Card className="mb-3 border-l-4 border-l-slate-300">
      <CardContent className="pt-4">
        <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 text-sm">{alert.title}</p>
            <div className="flex flex-wrap gap-2 mt-1">
              <Badge className={`text-xs ${severityColor[alert.ai_proposed_severity]}`}>{alert.ai_proposed_severity}</Badge>
              <span className="text-xs text-slate-400">{alert.publication_date}</span>
              <span className="text-xs text-slate-400 font-mono">{meta.model_version || '—'}</span>
            </div>
          </div>
          <a href={alert.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-400 hover:text-blue-600">
            <ExternalLink className="w-4 h-4" />
          </a>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
        </div>

        {expanded && (
          <div className="mt-4 border-t pt-4 space-y-4">
            {/* Audit Metadata */}
            <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-300 space-y-1">
              <p className="text-slate-400 uppercase text-xs mb-2 font-sans font-semibold">Audit Metadata</p>
              <p><span className="text-slate-400">model_version:</span> {meta.model_version || '—'}</p>
              <p><span className="text-slate-400">chunk_indices_matched:</span> [{(meta.chunk_indices_matched || []).join(', ')}]</p>
              <p><span className="text-slate-400">total_chunks_processed:</span> {meta.total_chunks_processed ?? '—'}</p>
              <p><span className="text-slate-400">token_usage.prompt_tokens:</span> {meta.token_usage?.prompt_tokens ?? '—'}</p>
              <p><span className="text-slate-400">token_usage.completion_tokens:</span> {meta.token_usage?.completion_tokens ?? '—'}</p>
              <p><span className="text-slate-400">token_usage.total_tokens:</span> {meta.token_usage?.total_tokens ?? '—'}</p>
              <p><span className="text-slate-400">scan_timestamp:</span> {meta.scan_timestamp || '—'}</p>
            </div>

            {/* Rationale */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">AI Rationale</p>
              <div className="bg-amber-50 border border-amber-200 rounded p-3">
                <p className="text-sm text-amber-900">{meta.rationale || alert.impact_assessment || '—'}</p>
              </div>
            </div>

            {/* Impact Assessment */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Impact Assessment</p>
              <p className="text-sm text-slate-700">{alert.impact_assessment}</p>
            </div>

            {/* Human Review */}
            {alert.review_notes && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Human Review Notes</p>
                <p className="text-sm text-slate-700 bg-green-50 border border-green-200 rounded p-3">{alert.review_notes}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AuditLedger() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.ComplianceAlert.list('-created_date', 200).then(a => { setAlerts(a); setLoading(false); });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Audit Ledger</h1>
        </div>
        <p className="text-slate-500 text-sm mb-6">Immutable record of all LLM decisions. Each entry shows the exact model, chunks, rationale, and token usage used to generate a compliance alert.</p>

        {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>
          : alerts.length === 0 ? <p className="text-slate-400 text-center py-20">No audit records yet. Run the daily scan to populate the ledger.</p>
          : alerts.map(a => <AuditRow key={a.id} alert={a} />)
        }
      </div>
    </div>
  );
}