import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ListChecks, Plus, Pencil, Archive, Users } from 'lucide-react';

const EMPTY = { item_name: '', description: '', eccn: '', eu_control_number: '', uk_control_entry: '', hs_code: '', keywords: [], notes: '', status: 'active' };

export default function Watchlist() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Customer linking state
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkingItem, setLinkingItem] = useState(null);
  const [allCustomers, setAllCustomers] = useState([]);
  const [linkedIds, setLinkedIds] = useState(new Set());
  const [existingLinks, setExistingLinks] = useState([]);
  const [linkSaving, setLinkSaving] = useState(false);

  const load = () => base44.entities.GlobalWatchlistLibrary.list('-created_date', 200).then(d => { setItems(d); setLoading(false); });
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (item) => { setForm({ ...item, keywords: item.keywords || [] }); setEditing(item.id); setOpen(true); };

  const save = async () => {
    setSaving(true);
    const data = { ...form, keywords: typeof form.keywords === 'string' ? form.keywords.split(',').map(k => k.trim()).filter(Boolean) : form.keywords };
    if (editing) await base44.entities.GlobalWatchlistLibrary.update(editing, data);
    else await base44.entities.GlobalWatchlistLibrary.create(data);
    setSaving(false); setOpen(false); load();
  };

  const archive = async (id) => {
    await base44.entities.GlobalWatchlistLibrary.update(id, { status: 'archived' });
    load();
  };

  const openLink = async (item) => {
    setLinkingItem(item);
    const [customers, links] = await Promise.all([
      base44.entities.Customer.list(),
      base44.entities.CustomerLibraryLink.filter({ library_item_id: item.id }),
    ]);
    setAllCustomers(customers);
    setExistingLinks(links);
    setLinkedIds(new Set(links.map(l => l.customer_id)));
    setLinkOpen(true);
  };

  const toggleCustomer = (customerId) => {
    setLinkedIds(prev => {
      const next = new Set(prev);
      next.has(customerId) ? next.delete(customerId) : next.add(customerId);
      return next;
    });
  };

  const saveLinks = async () => {
    setLinkSaving(true);
    const prevIds = new Set(existingLinks.map(l => l.customer_id));
    const toAdd = [...linkedIds].filter(id => !prevIds.has(id));
    const toRemove = existingLinks.filter(l => !linkedIds.has(l.customer_id));

    await Promise.all([
      ...toAdd.map(cid => base44.entities.CustomerLibraryLink.create({ customer_id: cid, library_item_id: linkingItem.id })),
      ...toRemove.map(l => base44.entities.CustomerLibraryLink.delete(l.id)),
    ]);
    setLinkSaving(false);
    setLinkOpen(false);
  };

  const filtered = items.filter(i => !search || i.item_name.toLowerCase().includes(search.toLowerCase()) || i.description?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <ListChecks className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Watchlist Library</h1>
          <Button size="sm" className="ml-auto gap-1" onClick={openNew}><Plus className="w-4 h-4" /> Add Item</Button>
        </div>

        <Input placeholder="Search library..." value={search} onChange={e => setSearch(e.target.value)} className="mb-4" />

        {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>
          : filtered.map(item => (
            <Card key={item.id} className="mb-3">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-2 mb-1">
                      <p className="font-medium text-slate-800">{item.item_name}</p>
                      <Badge className={item.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{item.status}</Badge>
                    </div>
                    <p className="text-sm text-slate-500 mb-2">{item.description}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      {item.eccn && <span>ECCN: <b className="text-slate-600">{item.eccn}</b></span>}
                      {item.eu_control_number && <span>EU: <b className="text-slate-600">{item.eu_control_number}</b></span>}
                      {item.uk_control_entry && <span>UK: <b className="text-slate-600">{item.uk_control_entry}</b></span>}
                      {item.hs_code && <span>HS: <b className="text-slate-600">{item.hs_code}</b></span>}
                    </div>
                    {item.keywords?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.keywords.map(k => <Badge key={k} variant="outline" className="text-xs">{k}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => openLink(item)} className="gap-1">
                      <Users className="w-3.5 h-3.5" /> Clients
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    {item.status === 'active' && <Button size="icon" variant="ghost" onClick={() => archive(item.id)}><Archive className="w-4 h-4" /></Button>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        }
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit' : 'Add'} Library Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {[['item_name', 'Item Name *'], ['eccn', 'ECCN'], ['eu_control_number', 'EU Control Number'], ['uk_control_entry', 'UK Control Entry'], ['hs_code', 'HS Code']].map(([k, label]) => (
              <div key={k}>
                <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                <Input value={form[k] || ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Description *</label>
              <Textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} className="h-20" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Keywords (comma-separated)</label>
              <Input value={Array.isArray(form.keywords) ? form.keywords.join(', ') : form.keywords || ''} onChange={e => setForm({ ...form, keywords: e.target.value })} />
            </div>
            <Button onClick={save} disabled={saving || !form.item_name || !form.description} className="w-full">{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Customers Dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Clients — {linkingItem?.item_name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 mb-3">Select which clients should receive alerts for this item.</p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {allCustomers.map(c => (
              <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={linkedIds.has(c.id)}
                  onChange={() => toggleCustomer(c.id)}
                  className="w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-slate-800">{c.customer_name}</p>
                  <p className="text-xs text-slate-400">{c.primary_contact_email}</p>
                </div>
              </label>
            ))}
            {allCustomers.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No customers yet. Add them in Client Management.</p>}
          </div>
          <Button onClick={saveLinks} disabled={linkSaving} className="w-full mt-4">
            {linkSaving ? 'Saving...' : 'Save Links'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}