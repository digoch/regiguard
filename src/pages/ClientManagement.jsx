import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Plus, Search, Pencil, ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';

const EMPTY_FORM = { customer_name: '', industry: '', risk_tolerance: 'medium', primary_contact_email: '' };

const riskColors = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

export default function ClientManagement() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [watchlistCustomer, setWatchlistCustomer] = useState(null);
  const { toast } = useToast();

  const fetchCustomers = async () => {
    setLoading(true);
    const data = await base44.entities.Customer.list('-created_date', 200);
    setCustomers(data);
    setLoading(false);
  };

  useEffect(() => { fetchCustomers(); }, []);

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ customer_name: c.customer_name, industry: c.industry || '', risk_tolerance: c.risk_tolerance || 'medium', primary_contact_email: c.primary_contact_email }); setDialogOpen(true); };

  const handleSave = async () => {
    setSaving(true);
    if (editing) {
      await base44.entities.Customer.update(editing.id, form);
      toast({ title: 'Customer updated.' });
    } else {
      await base44.entities.Customer.create(form);
      toast({ title: 'Customer added.' });
    }
    setSaving(false);
    setDialogOpen(false);
    fetchCustomers();
  };

  const filtered = customers.filter(c =>
    c.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-slate-700" />
            <h1 className="text-2xl font-bold text-slate-900">Client Management</h1>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="w-4 h-4" /> Add Customer
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by customer name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Customer Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Industry</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Risk Tolerance</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Primary Contact</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">No customers found.</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.customer_name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.industry || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge className={riskColors[c.risk_tolerance] || riskColors.medium}>
                      {c.risk_tolerance || 'medium'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.primary_contact_email}</td>
                  <td className="px-4 py-3 text-right flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setWatchlistCustomer(c)} className="gap-1">
                      <ListChecks className="w-3.5 h-3.5" /> Watchlist
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)} className="gap-1">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerWatchlistModal
        customer={watchlistCustomer}
        open={!!watchlistCustomer}
        onClose={() => setWatchlistCustomer(null)}
      />

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Customer Name *</Label>
              <Input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="Acme Corp" />
            </div>
            <div>
              <Label>Industry</Label>
              <Input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Defense, Semiconductors..." />
            </div>
            <div>
              <Label>Risk Tolerance</Label>
              <Select value={form.risk_tolerance} onValueChange={v => setForm(f => ({ ...f, risk_tolerance: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Primary Contact Email *</Label>
              <Input type="email" value={form.primary_contact_email} onChange={e => setForm(f => ({ ...f, primary_contact_email: e.target.value }))} placeholder="contact@example.com" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.customer_name || !form.primary_contact_email}>
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Customer'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}