/**
 * components/RequireAuth.jsx
 * Route guard. Everything behind it is unreachable without a session.
 *
 * This is a UX control, not a security one — the server rejects unauthenticated
 * REST calls and socket handshakes regardless. It exists so a signed-out user
 * lands on the sign-in page instead of an empty workspace full of errors.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const RequireAuth = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();
    const location = useLocation();

    // Rendering the redirect before the session check resolves would sign out
    // every returning user on page load.
    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#fffdf5] font-mono">
                <p className="text-black font-black uppercase tracking-widest">Loading…</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <Navigate
                to="/signin"
                replace
                state={{ from: location.pathname + location.search }}
            />
        );
    }

    return children;
};

export default RequireAuth;
