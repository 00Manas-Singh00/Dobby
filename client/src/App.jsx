import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from '@/pages/Home';
import LandingPage from '@/pages/LandingPage';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';
import { Toaster } from '@/components/ui/sonner';
import { SocketProvider } from '@/contexts/SocketContext';

function App() {
  return (
    <SocketProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/home" element={<Home />} />
          <Route path="/room/:roomId" element={<WorkspaceShell />} />
          {/* Fallback to landing if route not found */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </Router>
    </SocketProvider>
  );
}

export default App;
