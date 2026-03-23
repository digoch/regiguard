import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Globe, BookOpen, AlertTriangle, CheckCircle2, Clock, Users, ShieldAlert } from 'lucide-react';

const LOGO_URL = "https://media.base44.com/images/public/69ba6d0ca5a91905d233f849/7284640c8_Gemini_Generated_Image_29t6nw29t6nw29t6.png";

const severityColor = { low: 'bg-blue-100 text-blue-700', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };
const statusIcon = { pending: <Clock className="w-4 h-4 text-yellow-500" />, under_review: <AlertTriangle className="w-4 h-4 text-orange-500" />, confirmed: <CheckCircle2 className="w-4 h-4 text-green-500" />, dismissed: <CheckCircle2 className="w-4 h-4 text-gray-400" /> };

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [sources, setSources] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.ComplianceAlert.list('-created_date', 50),
      base44.entities.RegulatorySource.filter({ is_active: true }),
      base44.entities.Customer.list('-created_date', 500),
    ]).then(([a, s, c]) => { setAlerts(a); setSources(s); setCustomers(c); setLoading(false); });
  }, []);

  const customersMap = Object.fromEntries(customers.map(c => [c.id, c]));

  const pending = alerts.filter(a => a.status === 'pending').length;
  const critical = alerts.filter(a => a.ai_proposed_severity === 'critical').length;

  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  const high24h = alerts.filter(a =>
    ['high', 'critical'].includes(a.ai_proposed_severity) &&
    new Date(a.created_date).getTime() >= yesterday
  ).length;

  const recentAlerts = alerts.slice(0, 8);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><img src={LOGO_URL} alt="LexSense" className="w-9 h-9 object-contain mix-blend-multiply" /> Dashboard</h1>
          <p className="text-slate-500 mt-1">LexSense is active. Monitoring global ECCN/HS updates for your connected clients.</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Customers', value: customers.length, icon: <Users className="w-5 h-5 text-blue-600" />, color: 'text-blue-700' },
            { label: 'High Severity (24h)', value: high24h, icon: <AlertTriangle className="w-5 h-5 text-orange-600" />, color: 'text-orange-700' },
            { label: 'Critical Alerts', value: critical, icon: <ShieldAlert className="w-5 h-5 text-red-600" />, color: 'text-red-700' },
            { label: 'Pending Review', value: pending, icon: <Clock className="w-5 h-5 text-yellow-600" />, color: 'text-yellow-700' },
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
          {/* Recent Alerts Table */}
          <div className="md:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent Alerts</CardTitle>
                <Link to="/Alerts" className="text-sm text-slate-500 hover:text-slate-800">View all →</Link>
              </CardHeader>
              <CardContent className="p-0">
                {recentAlerts.length === 0 ? (
                  <p className="text-slate-400 text-sm p-4">No alerts yet. Run the daily scan to generate alerts.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Customer</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Item / Notice</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Severity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentAlerts.map(a => {
                        const customer = customersMap[a.customer_id];
                        return (
                          <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{customer?.customer_name || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{a.title}</td>
                            <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{a.publication_date}</td>
                            <td className="px-4 py-2.5">
                              <Badge className={`text-xs ${severityColor[a.ai_proposed_severity]}`}>{a.ai_proposed_severity}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            {[
              { to: '/ClientManagement', icon: <Users className="w-5 h-5" />, label: 'Clients', count: customers.length, desc: 'Manage client accounts' },
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