import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { ShieldAlert, ListChecks, Globe, BookOpen, Settings2, LayoutDashboard } from 'lucide-react';

const nav = [
  { to: '/Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, label: 'Dashboard' },
  { to: '/Alerts', icon: <ShieldAlert className="w-4 h-4" />, label: 'Alerts' },
  { to: '/Watchlist', icon: <ListChecks className="w-4 h-4" />, label: 'Watchlist' },
  { to: '/Sources', icon: <Globe className="w-4 h-4" />, label: 'Sources' },
  { to: '/AuditLedger', icon: <BookOpen className="w-4 h-4" />, label: 'Audit Ledger' },
  { to: '/Settings', icon: <Settings2 className="w-4 h-4" />, label: 'Settings' },
];

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-blue-400" />
            <span className="font-bold text-sm text-white">RegIntel</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Export Control AI</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}