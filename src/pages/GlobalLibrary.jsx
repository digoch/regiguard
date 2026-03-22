import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Library, Plus, Pencil, Search } from 'lucide-react';

const EMPTY = { library_item_id: '', item_name: '', eccn: '', eu_control_number: '', hs_code: '', technical_description: '', keywords: [] };

export default function GlobalLibrary() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    base44.entities.GlobalLibrary.list('-created_date', 200).then(d => { setItems(d); setLoading(false); });

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (item) => { setForm({ ...item, keywords: item.keywords || [] }); setEditing(item.id); setOpen(true); };

  const save = async () => {
    setSaving(true);
    const data = {
      ...form,
      keywords: typeof form.keywords === 'string'
        ? form.keywords.split(',').map(k => k.trim()).filter(Boolean)
        : form.keywords,
    };
    if (editing) await base44.entities.GlobalLibrary.update(editing, data);
    else await base44.entities.GlobalLibrary.create(data);
    setSaving(false);
    setOpen(false);
    load();
  };

  const filtered = items.filter(i =>
    !search ||
    i.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    i.eccn?.toLowerCase().includes(search.toLowerCase()) ||
    i.technical_description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Library className="w-6 h-6 text-slate-700" />
            <h1 className="text-2xl font-bold text-slate-900">Global Library</h1>
            <span className="text-sm text-slate-400 ml-1">— Golden Records for Controlled Items</span>
          </div>
          <Button onClick={openNew} className="gap-2">
            <Plus className="w-4 h-4" /> Add Item
          </Button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by name, ECCN, description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-16">No library items yet. Click "Add Item" to get started.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => (
              <Card key={item.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-semibold text-slate-900">{item.item_name}</p>
                        {item.library_item_id && (
                          <Badge variant="outline" className="text-xs font-mono">{item.library_item_id}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mb-2 line-clamp-2">{item.technical_description}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                        {item.eccn && <span>ECCN: <b className="text-slate-600">{item.eccn}</b></span>}
                        {item.eu_control_number && <span>EU: <b className="text-slate-600">{item.eu_control_number}</b></span>}
                        {item.hs_code && <span>HS: <b className="text-slate-600">{item.hs_code}</b></span>}
                      </div>
                      {item.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.keywords.map(k => (
                            <Badge key={k} variant="outline" className="text-xs">{k}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(item)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit' : 'Add'} Library Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {[
              ['library_item_id', 'Item ID (e.g. ECCN-3A001-001)'],
              ['item_name', 'Item Name *'],
              ['eccn', 'ECCN'],
              ['eu_control_number', 'EU Control Number'],
              ['hs_code', 'HS Code'],
            ].map(([k, label]) => (
              <div key={k}>
                <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                <Input value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Technical Description * (used for AI semantic matching)</label>
              <Textarea
                value={form.technical_description || ''}
                onChange={e => setForm(f => ({ ...f, technical_description: e.target.value }))}
                className="h-24"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Keywords (comma-separated)</label>
              <Input
                value={Array.isArray(form.keywords) ? form.keywords.join(', ') : form.keywords || ''}
                onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                placeholder="microprocessor, dual-use, semiconductor..."
              />
            </div>
            <Button
              onClick={save}
              disabled={saving || !form.item_name || !form.technical_description}
              className="w-full"
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}