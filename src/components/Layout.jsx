import React, { useEffect, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Globe, BookOpen, Settings2, LayoutDashboard, Users, Library, Link2, Brain, ShieldAlert } from 'lucide-react';

const LOGO_URL = "https://media.base44.com/images/public/69ba6d0ca5a91905d233f849/7284640c8_Gemini_Generated_Image_29t6nw29t6nw29t6.png";
import { base44 } from '@/api/base44Client';

const nav = [
  { to: '/Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, label: 'Dashboard' },
  { to: '/ClientManagement', icon: <Users className="w-4 h-4" />, label: 'Clients' },
  { to: '/GlobalLibrary', icon: <Library className="w-4 h-4" />, label: 'Library' },
  { to: '/WatchlistManager', icon: <Link2 className="w-4 h-4" />, label: 'Watchlist' },
  { to: '/IntelligenceCenter', icon: <Brain className="w-4 h-4" />, label: 'Intelligence' },
  { to: '/Alerts', icon: <ShieldAlert className="w-4 h-4" />, label: 'Alerts' },
  { to: '/Sources', icon: <Globe className="w-4 h-4" />, label: 'Sources' },
  { to: '/AuditLedger', icon: <BookOpen className="w-4 h-4" />, label: 'Audit Ledger' },
  { to: '/Settings', icon: <Settings2 className="w-4 h-4" />, label: 'Settings' },
];

export default function Layout() {
  const [firmName, setFirmName] = useState('RegIntel');

  useEffect(() => {
    base44.entities.GlobalConfig.list().then(configs => {
      if (configs?.[0]?.firm_name) setFirmName(configs[0].firm_name);
    });
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <img src={LOGO_URL} alt="LexSense" className="w-7 h-7 object-contain" style={{mixBlendMode: 'screen', filter: 'brightness(1.1)'}} />
            <span className="font-bold text-sm text-white">LexSense</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Precision Regulatory Guidance</p>
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