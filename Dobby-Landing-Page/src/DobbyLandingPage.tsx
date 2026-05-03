import React, { useRef } from 'react';
import { Hero } from './components/Hero';

export const DobbyLandingPage = () => {
    const footerRef = useRef<HTMLElement>(null);

    const scrollToFooter = (e: React.MouseEvent) => {
        e.preventDefault();
        footerRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="w-full bg-black selection:bg-white/10 selection:text-white">
            {/* Navigation (Transparent) */}
            <nav className="fixed top-0 left-0 w-full z-50 px-6 py-8 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
                <div className="text-2xl font-display font-bold text-white tracking-tighter uppercase">
                    DOBBY<span className="text-white/20">.</span>
                </div>
                <div className="hidden md:flex space-x-8 text-sm font-medium text-white/60">
                    <a href="#" className="hover:text-white transition-colors">Developer Docs</a>
                    <a href="#footer" onClick={scrollToFooter} className="hover:text-white transition-colors">Contact us</a>
                    <a href="https://github.com/Prthmsh7/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
                </div>
                <button className="text-sm font-bold bg-[#fef08a] text-black px-6 py-2 rounded-full hover:bg-[#fde047] transition-all duration-300 shadow-[0_0_20px_rgba(254,240,138,0.3)]">
                    Launch Codespace
                </button>
            </nav>

            <Hero />

            {/* Footer */}
            <footer id="footer" ref={footerRef} className="relative z-10 py-10 px-6 bg-black border-t border-white/5">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0 text-white/40 text-[10px] uppercase tracking-widest font-medium">
                    <div>© 2026 DOBBY Cloud — Encrypted Environment</div>
                    <div className="flex space-x-8">
                        <a href="#" className="hover:text-white transition-colors">Architecture</a>
                        <a href="#" className="hover:text-white transition-colors">Log</a>
                        <a href="#" className="hover:text-white transition-colors">Protocols</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};
