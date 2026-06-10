import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
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
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Navigate to="/Dashboard" replace />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
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
          <Toaster />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;