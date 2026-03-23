import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Plus, Pencil, ArrowLeft } from 'lucide-react';
import SourceValidationPanel from '@/components/SourceValidationPanel';

const EMPTY = { name: '', regime: 'US_BIS', feed_url: '', scraping_logic: '', notice_types_to_watch: [], is_active: true };
const NOTICE_TYPES = ['final_rule', 'proposed_rule', 'interim_rule', 'guidance', 'amendment'];

export default function Sources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [urlValidated, setUrlValidated] = useState(false);

  const load = () => base44.entities.RegulatorySource.list('-created_date', 100).then(d => { setSources(d); setLoading(false); });
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditing(null); setUrlValidated(false); setOpen(true); };
  const openEdit = (s) => { setForm({ ...s, notice_types_to_watch: s.notice_types_to_watch || [] }); setEditing(s.id); setUrlValidated(true); setOpen(true); };

  const toggleNoticeType = (type) => {
    const curr = form.notice_types_to_watch || [];
    setForm({ ...form, notice_types_to_watch: curr.includes(type) ? curr.filter(t => t !== type) : [...curr, type] });
  };

  const save = async () => {
    setSaving(true);
    if (editing) await base44.entities.RegulatorySource.update(editing, form);
    else await base44.entities.RegulatorySource.create(form);
    setSaving(false); setOpen(false); load();
  };

  const toggleActive = async (source) => {
    await base44.entities.RegulatorySource.update(source.id, { is_active: !source.is_active });
    load();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Globe className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Regulatory Sources</h1>
          <Button size="sm" className="ml-auto gap-1" onClick={openNew}><Plus className="w-4 h-4" /> Add Source</Button>
        </div>

        {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>
          : sources.map(source => (
            <Card key={source.id} className="mb-3">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-2 mb-1">
                      <p className="font-medium text-slate-800">{source.name}</p>
                      <Badge className="bg-blue-100 text-blue-700">{source.regime}</Badge>
                      <Badge className={source.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{source.is_active ? 'active' : 'inactive'}</Badge>
                    </div>
                    <a href={source.feed_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline break-all">{source.feed_url}</a>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(source.notice_types_to_watch || []).map(t => <Badge key={t} variant="outline" className="text-xs">{t.replace('_', ' ')}</Badge>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={source.is_active} onCheckedChange={() => toggleActive(source)} />
                    <Button size="icon" variant="ghost" onClick={() => openEdit(source)}><Pencil className="w-4 h-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        }
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit' : 'Add'} Regulatory Source</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Source Name *</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Regime</label>
              <Select value={form.regime} onValueChange={v => setForm({ ...form, regime: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['US_BIS', 'EU', 'UK'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-500 mb-1 block">Feed URL *</label>
              <Input value={form.feed_url} onChange={e => { setForm({ ...form, feed_url: e.target.value }); setUrlValidated(false); }} placeholder="https://..." />
              <SourceValidationPanel feedUrl={form.feed_url} onValidated={setUrlValidated} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Scraping Logic / Instructions</label>
              <Textarea value={form.scraping_logic} onChange={e => setForm({ ...form, scraping_logic: e.target.value })} className="h-24" placeholder="Describe how to extract notices from this source..." />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-2 block">Notice Types to Watch</label>
              <div className="flex flex-wrap gap-2">
                {NOTICE_TYPES.map(t => (
                  <Badge key={t} onClick={() => toggleNoticeType(t)} className={`cursor-pointer ${(form.notice_types_to_watch || []).includes(t) ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {t.replace('_', ' ')}
                  </Badge>
                ))}
              </div>
            </div>
            <Button onClick={save} disabled={saving || !form.name || !form.feed_url || !urlValidated} className="w-full">{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}