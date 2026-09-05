import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from '@/pages/Home';
import LandingPage from '@/pages/LandingPage';
import AuthPage from '@/pages/AuthPage';
import InvitePage from '@/pages/InvitePage';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';
import RequireAuth from '@/components/RequireAuth';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { SocketProvider } from '@/contexts/SocketContext';

function App() {
  return (
    // AuthProvider wraps SocketProvider: the socket handshake carries the
    // access token, so the session has to exist before a connection is opened.
    <AuthProvider>
      <SocketProvider>
        <Router>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/signin" element={<AuthPage />} />

            <Route
              path="/home"
              element={
                <RequireAuth>
                  <Home />
                </RequireAuth>
              }
            />
            <Route
              path="/invite/:token"
              element={
                <RequireAuth>
                  <InvitePage />
                </RequireAuth>
              }
            />
            <Route
              path="/room/:roomId"
              element={
                <RequireAuth>
                  <WorkspaceShell />
                </RequireAuth>
              }
            />

            {/* Fallback to landing if route not found */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </Router>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
