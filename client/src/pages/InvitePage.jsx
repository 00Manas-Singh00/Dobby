/**
 * pages/InvitePage.jsx
 * Redeems an invite token from a shared link, then drops the user into the room.
 *
 * Wrapped in RequireAuth, so an unauthenticated visitor signs in first and is
 * returned here — the invite survives the round trip.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { redeemInvite } from '@/services/roomService';
import { toast } from 'sonner';

const InvitePage = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    // Invites are single-use; React's development double-effect would otherwise
    // redeem once and then report the second attempt as an error.
    const redeemed = useRef(false);

    useEffect(() => {
        if (!token || redeemed.current) return;
        redeemed.current = true;

        (async () => {
            try {
                const { room, alreadyMember } = await redeemInvite(token);
                toast.success(alreadyMember ? 'Welcome back' : `Joined ${room.name}`);
                navigate(`/room/${room.id}`, { replace: true });
            } catch (err) {
                setError(err.message || 'This invite could not be used.');
            }
        })();
    }, [token, navigate]);

    return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#fffdf5] font-mono px-4">
            <div className="border-4 border-black bg-white p-8 shadow-[8px_8px_0_0_#000] max-w-md w-full text-center">
                <h1 className="text-2xl font-black uppercase tracking-widest text-black mb-4">
                    {error ? 'Invite unusable' : 'Joining room…'}
                </h1>
                <p className="font-bold text-black/70">
                    {error || 'Checking your invite with the server.'}
                </p>
                {error && (
                    <button
                        onClick={() => navigate('/home')}
                        className="mt-6 w-full border-4 border-black bg-[#FFEB3B] hover:bg-[#ffd600] h-14 font-black uppercase tracking-widest text-black transition-none"
                    >
                        Back to your rooms
                    </button>
                )}
            </div>
        </div>
    );
};

export default InvitePage;
