import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Alerts from '@/pages/Alerts';
import Sources from '@/pages/Sources';
import AuditLedger from '@/pages/AuditLedger';
import Settings from '@/pages/Settings';
import ClientManagement from '@/pages/ClientManagement';
import GlobalLibrary from '@/pages/GlobalLibrary';
import WatchlistManager from '@/pages/WatchlistManager';
import IntelligenceCenter from '@/pages/IntelligenceCenter';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/Dashboard" replace />} />
      <Route element={<Layout />}>
        <Route path="/Dashboard" element={<Dashboard />} />
        <Route path="/Alerts" element={<Alerts />} />
        <Route path="/Sources" element={<Sources />} />
        <Route path="/AuditLedger" element={<AuditLedger />} />
        <Route path="/Settings" element={<Settings />} />
        <Route path="/ClientManagement" element={<ClientManagement />} />
        <Route path="/GlobalLibrary" element={<GlobalLibrary />} />
        <Route path="/WatchlistManager" element={<WatchlistManager />} />
        <Route path="/IntelligenceCenter" element={<IntelligenceCenter />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;