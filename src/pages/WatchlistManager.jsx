import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Plus, Trash2, Link2, Search, Pencil, X, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const severityColors = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

// Simple searchable combobox-like select
function SearchableSelect({ items, value, onChange, placeholder, getLabel, getValue }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = items.filter(i =>
    getLabel(i).toLowerCase().includes(search.toLowerCase())
  );

  const selected = items.find(i => getValue(i) === value);

  return (
    <div className="relative">
      <div
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm cursor-pointer items-center justify-between"
        onClick={() => setOpen(o => !o)}
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <span className="text-muted-foreground text-xs">▾</span>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                autoFocus
                className="w-full pl-7 pr-2 py-1 text-sm border border-slate-200 rounded focus:outline-none"
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">No results</p>
            ) : filtered.map(i => (
              <div
                key={getValue(i)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 ${getValue(i) === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-800'}`}
                onClick={() => { onChange(getValue(i)); setOpen(false); setSearch(''); }}
              >
                {getLabel(i)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WatchlistManager() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const preFilteredCustomerId = urlParams.get('customer_id') || '';

  const [customers, setCustomers] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [watchlistEntries, setWatchlistEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [editEntry, setEditEntry] = useState(null); // entry being edited
  const [editForm, setEditForm] = useState({ client_specific_notes: '', custom_severity_override: '' });
  const [editSaving, setEditSaving] = useState(false);

  const [form, setForm] = useState({
    customer_link: preFilteredCustomerId,
    library_item_link: '',
    client_specific_notes: '',
    custom_severity_override: '',
  });

  const [tableFilter, setTableFilter] = useState(preFilteredCustomerId);

  const load = async () => {
    setLoading(true);
    const [c, l, w] = await Promise.all([
      base44.entities.Customer.list('-created_date', 500),
      base44.entities.GlobalLibrary.list('-created_date', 500),
      base44.entities.CustomerWatchlist.list('-created_date', 500),
    ]);
    setCustomers(c);
    setLibraryItems(l);
    setWatchlistEntries(w);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const customerMap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
  const libraryMap = useMemo(() => Object.fromEntries(libraryItems.map(l => [l.id, l])), [libraryItems]);

  const linkedPairs = useMemo(() => new Set(watchlistEntries.map(e => `${e.customer_link}__${e.library_item_link}`)), [watchlistEntries]);

  const handleAdd = async () => {
    if (!form.customer_link || !form.library_item_link) return;
    setSaving(true);
    await base44.entities.CustomerWatchlist.create({
      customer_link: form.customer_link,
      library_item_link: form.library_item_link,
      client_specific_notes: form.client_specific_notes || undefined,
      custom_severity_override: form.custom_severity_override || undefined,
    });
    setForm(f => ({ ...f, library_item_link: '', client_specific_notes: '', custom_severity_override: '' }));
    setSaving(false);
    load();
  };

  const openEdit = (entry) => {
    setEditEntry(entry);
    setEditForm({
      customer_link: entry.customer_link || '',
      library_item_link: entry.library_item_link || '',
      client_specific_notes: entry.client_specific_notes || '',
      custom_severity_override: entry.custom_severity_override || '',
    });
  };

  const handleEditSave = async () => {
    if (!editForm.customer_link || !editForm.library_item_link) return;
    setEditSaving(true);
    await base44.entities.CustomerWatchlist.update(editEntry.id, {
      customer_link: editForm.customer_link,
      library_item_link: editForm.library_item_link,
      client_specific_notes: editForm.client_specific_notes || undefined,
      custom_severity_override: editForm.custom_severity_override || undefined,
    });
    setEditSaving(false);
    setEditEntry(null);
    load();
  };

  const handleRemove = async (id) => {
    setRemoving(id);
    await base44.entities.CustomerWatchlist.delete(id);
    setRemoving(null);
    load();
  };

  const preFilteredCustomer = preFilteredCustomerId ? customerMap[preFilteredCustomerId] : null;

  const filteredEntries = tableFilter
    ? watchlistEntries.filter(e => e.customer_link === tableFilter)
    : watchlistEntries;

  const availableLibraryItems = libraryItems.filter(l =>
    !form.customer_link || !linkedPairs.has(`${form.customer_link}__${l.id}`)
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/ClientManagement')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Link2 className="w-6 h-6 text-slate-700" />
              LexSense Watchlist Nexus
              {preFilteredCustomer && (
                <span className="text-blue-600">— {preFilteredCustomer.customer_name}</span>
              )}
            </h1>
            <p className="text-sm text-slate-500">Link customers to controlled items from the Global Library</p>
          </div>
        </div>

        {/* Add Form */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add New Link
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Customer *</Label>
                {preFilteredCustomerId ? (
                  <div className="flex h-9 items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
                    {preFilteredCustomer?.customer_name || 'Loading...'}
                  </div>
                ) : (
                  <SearchableSelect
                    items={customers}
                    value={form.customer_link}
                    onChange={v => setForm(f => ({ ...f, customer_link: v, library_item_link: '' }))}
                    placeholder="Select customer..."
                    getLabel={c => c.customer_name}
                    getValue={c => c.id}
                  />
                )}
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Library Item *</Label>
                <SearchableSelect
                  items={availableLibraryItems}
                  value={form.library_item_link}
                  onChange={v => setForm(f => ({ ...f, library_item_link: v }))}
                  placeholder={form.customer_link ? 'Select item...' : 'Select customer first'}
                  getLabel={l => `${l.item_name}${l.eccn ? ` (${l.eccn})` : ''}`}
                  getValue={l => l.id}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs text-slate-500 mb-1 block">Client Notes</Label>
                <Textarea
                  value={form.client_specific_notes}
                  onChange={e => setForm(f => ({ ...f, client_specific_notes: e.target.value }))}
                  placeholder="e.g., Used in Project X drone engines for export to France..."
                  className="h-20"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Priority Override</Label>
                <Select
                  value={form.custom_severity_override || '_none'}
                  onValueChange={v => setForm(f => ({ ...f, custom_severity_override: v === '_none' ? '' : v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None (use AI default)</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleAdd}
                  disabled={saving || !form.customer_link || !form.library_item_link}
                  className="gap-2 w-full md:w-auto"
                >
                  <Plus className="w-4 h-4" />
                  {saving ? 'Adding...' : 'Add Link'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Watchlist Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Active Watchlist</CardTitle>
            <div className="flex items-center gap-2">
              {!preFilteredCustomerId && (
                <SearchableSelect
                  items={[{ id: '', customer_name: 'All Customers' }, ...customers]}
                  value={tableFilter}
                  onChange={setTableFilter}
                  placeholder="Filter by customer..."
                  getLabel={c => c.customer_name}
                  getValue={c => c.id}
                />
              )}
              <span className="text-xs text-slate-400">{filteredEntries.length} link{filteredEntries.length !== 1 ? 's' : ''}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
              </div>
            ) : filteredEntries.length === 0 ? (
              <p className="text-center text-slate-400 py-12 text-sm">No watchlist links found.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Item Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">ECCN</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Client Notes</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Priority</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map(entry => {
                    const customer = customerMap[entry.customer_link];
                    const lib = libraryMap[entry.library_item_link];
                    return (
                      <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          {customer?.customer_name || <span className="text-red-400 text-xs italic">⚠ unresolved ID: {entry.customer_link?.slice(0,8)}…</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-800">
                          {lib?.item_name || <span className="text-red-400 text-xs italic">⚠ unresolved ID: {entry.library_item_link?.slice(0,8)}…</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {lib?.eccn || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-500 max-w-xs">
                          {entry.client_specific_notes
                            ? <span className="italic line-clamp-2">"{entry.client_specific_notes}"</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {entry.custom_severity_override ? (
                            <Badge className={`text-xs ${severityColors[entry.custom_severity_override]}`}>
                              {entry.custom_severity_override}
                            </Badge>
                          ) : <span className="text-slate-300 text-xs">AI default</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                         <div className="flex items-center justify-end gap-1">
                           <Button
                             size="sm"
                             variant="ghost"
                             className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 gap-1"
                             onClick={() => openEdit(entry)}
                           >
                             <Pencil className="w-3.5 h-3.5" />
                             Edit
                           </Button>
                           <Button
                             size="sm"
                             variant="ghost"
                             className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1"
                             disabled={removing === entry.id}
                             onClick={() => handleRemove(entry.id)}
                           >
                             <Trash2 className="w-3.5 h-3.5" />
                             {removing === entry.id ? 'Removing...' : 'Remove'}
                           </Button>
                         </div>
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

      {/* Edit Dialog */}
      <Dialog open={!!editEntry} onOpenChange={open => !open && setEditEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" /> Edit Watchlist Link
            </DialogTitle>
          </DialogHeader>

          {editEntry && (() => {
            const customerChanged = editForm.customer_link !== editEntry.customer_link;
            const itemChanged = editForm.library_item_link !== editEntry.library_item_link;
            const connectionChanged = customerChanged || itemChanged;
            return (
              <div className="space-y-4">
                {/* Editable connections */}
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Customer *</Label>
                    <SearchableSelect
                      items={customers}
                      value={editForm.customer_link}
                      onChange={v => setEditForm(f => ({ ...f, customer_link: v }))}
                      placeholder="Select customer..."
                      getLabel={c => c.customer_name}
                      getValue={c => c.id}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">Library Item *</Label>
                    <SearchableSelect
                      items={libraryItems}
                      value={editForm.library_item_link}
                      onChange={v => setEditForm(f => ({ ...f, library_item_link: v }))}
                      placeholder="Select library item..."
                      getLabel={l => `${l.item_name}${l.eccn ? ` (${l.eccn})` : ''}`}
                      getValue={l => l.id}
                    />
                  </div>
                  {connectionChanged && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                      <span className="mt-0.5">ℹ️</span>
                      <span>Note: Changing the core connection will re-route future alerts. Existing alerts tied to the previous connection will remain archived under their original IDs.</span>
                    </div>
                  )}
                </div>

                {/* Editable fields */}
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Client Notes</Label>
                  <Textarea
                    value={editForm.client_specific_notes}
                    onChange={e => setEditForm(f => ({ ...f, client_specific_notes: e.target.value }))}
                    placeholder="e.g., Used in Project X drone engines..."
                    className="h-24"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Priority Override</Label>
                  <Select
                    value={editForm.custom_severity_override || '_none'}
                    onValueChange={v => setEditForm(f => ({ ...f, custom_severity_override: v === '_none' ? '' : v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None (use AI default)</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)} disabled={editSaving}>
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving || !editForm.customer_link || !editForm.library_item_link}>
              <Check className="w-4 h-4 mr-1" />
              {editSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}