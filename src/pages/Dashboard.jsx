import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { ShieldAlert, ListChecks, Globe, BookOpen, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

const severityColor = { low: 'bg-blue-100 text-blue-700', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };
const statusIcon = { pending: <Clock className="w-4 h-4 text-yellow-500" />, under_review: <AlertTriangle className="w-4 h-4 text-orange-500" />, confirmed: <CheckCircle2 className="w-4 h-4 text-green-500" />, dismissed: <CheckCircle2 className="w-4 h-4 text-gray-400" /> };

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.ComplianceAlert.list('-created_date', 50),
      base44.entities.WatchlistItem.filter({ status: 'active' }),
      base44.entities.RegulatorySource.filter({ is_active: true }),
    ]).then(([a, w, s]) => { setAlerts(a); setWatchlist(w); setSources(s); setLoading(false); });
  }, []);

  const pending = alerts.filter(a => a.status === 'pending').length;
  const critical = alerts.filter(a => a.ai_proposed_severity === 'critical').length;
  const high = alerts.filter(a => a.ai_proposed_severity === 'high').length;
  const recentAlerts = alerts.slice(0, 8);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-8 h-8 text-slate-700" /> Regulatory Intelligence</h1>
          <p className="text-slate-500 mt-1">Automated export control compliance monitoring</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Pending Review', value: pending, icon: <Clock className="w-5 h-5 text-yellow-600" />, color: 'text-yellow-700' },
            { label: 'Critical Alerts', value: critical, icon: <AlertTriangle className="w-5 h-5 text-red-600" />, color: 'text-red-700' },
            { label: 'High Alerts', value: high, icon: <ShieldAlert className="w-5 h-5 text-orange-600" />, color: 'text-orange-700' },
            { label: 'Active Sources', value: sources.length, icon: <Globe className="w-5 h-5 text-blue-600" />, color: 'text-blue-700' },
          ].map(k => (
            <Card key={k.label}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">{k.label}</p>
                    <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
                  </div>
                  {k.icon}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Recent Alerts */}
          <div className="md:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent Alerts</CardTitle>
                <Link to="/Alerts" className="text-sm text-slate-500 hover:text-slate-800">View all →</Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {recentAlerts.length === 0 && <p className="text-slate-400 text-sm">No alerts yet. Run the daily scan to generate alerts.</p>}
                {recentAlerts.map(a => (
                  <Link to={`/Alerts?id=${a.id}`} key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 border border-slate-100 block">
                    <span className="mt-0.5">{statusIcon[a.status]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.title}</p>
                      <p className="text-xs text-slate-400">{a.publication_date}</p>
                    </div>
                    <Badge className={`text-xs shrink-0 ${severityColor[a.ai_proposed_severity]}`}>{a.ai_proposed_severity}</Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            {[
              { to: '/Watchlist', icon: <ListChecks className="w-5 h-5" />, label: 'Watchlist Items', count: watchlist.length, desc: 'Monitored controlled items' },
              { to: '/Sources', icon: <Globe className="w-5 h-5" />, label: 'Regulatory Sources', count: sources.length, desc: 'Active feed sources' },
              { to: '/AuditLedger', icon: <BookOpen className="w-5 h-5" />, label: 'Audit Ledger', count: null, desc: 'LLM decision audit trail' },
            ].map(l => (
              <Link to={l.to} key={l.to}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="text-slate-600">{l.icon}</div>
                      <div>
                        <p className="font-medium text-slate-800">{l.label}{l.count !== null && <span className="ml-2 text-slate-400 font-normal text-sm">({l.count})</span>}</p>
                        <p className="text-xs text-slate-400">{l.desc}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}