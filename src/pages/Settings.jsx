import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Settings2, Play } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    base44.entities.GlobalConfig.list().then(configs => {
      if (configs[0]) { setConfig(configs[0]); setEmail(configs[0].compliance_alert_email || ''); }
    });
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    if (config?.id) await base44.entities.GlobalConfig.update(config.id, { compliance_alert_email: email });
    else { const created = await base44.entities.GlobalConfig.create({ compliance_alert_email: email }); setConfig(created); }
    setSaving(false);
    toast({ title: 'Settings saved.' });
  };

  const runScan = async () => {
    setRunning(true);
    try {
      const res = await base44.functions.invoke('dailyRegulatoryScan', {});
      toast({ title: 'Scan complete', description: res.data?.summary || 'Done.' });
    } catch (e) {
      toast({ title: 'Scan failed', description: e.message, variant: 'destructive' });
    }
    setRunning(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Settings2 className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Alert Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Email for High/Critical Alerts</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="compliance@example.com" />
            </div>
            <Button onClick={saveConfig} disabled={saving || !email}>{saving ? 'Saving...' : 'Save Settings'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Manual Scan</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500 mb-4">Trigger the daily regulatory scan manually. This will process all active sources against your watchlist and create alerts. The scan also runs automatically at 8:00 AM daily.</p>
            <Button onClick={runScan} disabled={running} variant="outline" className="gap-2">
              <Play className="w-4 h-4" />
              {running ? 'Running scan...' : 'Run Scan Now'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}