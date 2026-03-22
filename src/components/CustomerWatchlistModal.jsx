import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ListChecks } from 'lucide-react';

export default function CustomerWatchlistModal({ customer, open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ library_item_link: '', client_specific_notes: '', custom_severity_override: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [e, lib] = await Promise.all([
      base44.entities.CustomerWatchlist.filter({ customer_link: customer.id }),
      base44.entities.GlobalLibrary.list(),
    ]);
    setEntries(e);
    setLibraryItems(lib);
    setLoading(false);
  };

  useEffect(() => {
    if (open && customer) load();
  }, [open, customer]);

  const handleAdd = async () => {
    if (!form.library_item_link) return;
    setSaving(true);
    await base44.entities.CustomerWatchlist.create({
      customer_link: customer.id,
      library_item_link: form.library_item_link,
      client_specific_notes: form.client_specific_notes || undefined,
      custom_severity_override: form.custom_severity_override || undefined,
    });
    setForm({ library_item_link: '', client_specific_notes: '', custom_severity_override: '' });
    setAdding(false);
    setSaving(false);
    load();
  };

  const handleRemove = async (id) => {
    await base44.entities.CustomerWatchlist.delete(id);
    load();
  };

  const libMap = Object.fromEntries(libraryItems.map(l => [l.id, l]));
  const linkedIds = new Set(entries.map(e => e.library_item_link));
  const severityColors = { low: 'bg-green-100 text-green-700', medium: 'bg-yellow-100 text-yellow-700', high: 'bg-red-100 text-red-700' };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="w-5 h-5" />
            Watchlist — {customer?.customer_name}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {entries.length === 0 && !adding && (
              <p className="text-sm text-slate-400 text-center py-4">No items tracked for this client yet.</p>
            )}

            {entries.map(entry => {
              const lib = libMap[entry.library_item_link];
              return (
                <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm">{lib?.item_name || 'Unknown item'}</p>
                    {lib?.eccn && <p className="text-xs text-slate-400">ECCN: {lib.eccn}</p>}
                    {entry.client_specific_notes && (
                      <p className="text-xs text-slate-500 mt-1 italic">"{entry.client_specific_notes}"</p>
                    )}
                    {entry.custom_severity_override && (
                      <Badge className={`text-xs mt-1 ${severityColors[entry.custom_severity_override]}`}>
                        Override: {entry.custom_severity_override}
                      </Badge>
                    )}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => handleRemove(entry.id)} className="shrink-0 text-slate-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}

            {adding ? (
              <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-white">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Library Item *</label>
                  <Select value={form.library_item_link} onValueChange={v => setForm(f => ({ ...f, library_item_link: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select item..." /></SelectTrigger>
                    <SelectContent>
                      {libraryItems.filter(l => !linkedIds.has(l.id)).map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.item_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Client-Specific Notes</label>
                  <Textarea
                    value={form.client_specific_notes}
                    onChange={e => setForm(f => ({ ...f, client_specific_notes: e.target.value }))}
                    placeholder="e.g., Used in Project X drone engines..."
                    className="h-16"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Custom Severity Override</label>
                  <Select value={form.custom_severity_override} onValueChange={v => setForm(f => ({ ...f, custom_severity_override: v }))}>
                    <SelectTrigger><SelectValue placeholder="None (use AI default)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>None</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleAdd} disabled={saving || !form.library_item_link} size="sm">
                    {saving ? 'Adding...' : 'Add'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full gap-2" onClick={() => setAdding(true)}>
                <Plus className="w-4 h-4" /> Add Library Item
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}