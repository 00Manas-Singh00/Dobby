import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

export const NewHero = ({ onLaunch }) => {
    const containerRef = useRef(null);
    const titleRef = useRef(null);
    const subtitleRef = useRef(null);
    const ctaRef = useRef(null);
    const lottieRef = useRef(null);

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.5 } });

        tl.from(titleRef.current.querySelectorAll('.char'), {
            y: 100,
            opacity: 0,
            stagger: 0.05,
            delay: 0.5
        })
        .from(subtitleRef.current, {
            y: 30,
            opacity: 0 }, "-=1")
        .from(ctaRef.current, {
            scale: 0.8,
            opacity: 0,
            duration: 1
        }, "-=1.2")
        .from(lottieRef.current, {
            opacity: 0,
            scale: 0.9,
            duration: 2
        }, "-=1.5");
    }, { scope: containerRef });

    const title = "Collaborate. Create. Conquer.";
    const chars = title.split("");

    return (
        <section ref={containerRef} className="relative min-h-screen flex flex-col items-center justify-center pt-20 px-6 overflow-hidden bg-white text-black border-b-4 border-black">
            {/* Background pattern (Brutalist grid) */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

            <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
                {/* Left Content */}
                <div className="flex flex-col items-start space-y-8">
                    

                    <h1 ref={titleRef} className="text-6xl md:text-8xl font-black tracking-tight leading-[0.9] flex flex-wrap uppercase">
                        {chars.map((char, i) => (
                            <span key={i} className="char inline-block min-w-[0.2em] hover:text-[#FF4081] transition-colors cursor-default">
                                {char === " " ? "\u00A0" : char}
                            </span>
                        ))}
                    </h1>

                    <p ref={subtitleRef} className="text-lg md:text-xl text-black font-semibold max-w-xl leading-relaxed border-l-4 border-black pl-4">
                        Experience the world's most advanced collaborative coding environment. 
                        AI-powered assistance, real-time sync, and sandboxed execution—all in one place.
                    </p>

                    <div ref={ctaRef} className="flex flex-col sm:flex-row items-center gap-6 w-full sm:w-auto mt-4">
                        <button 
                            onClick={onLaunch}
                            className="group relative px-8 py-4 bg-[#FFEB3B] text-black font-black border-4 border-black neo-shadow-hover w-full sm:w-auto overflow-hidden uppercase tracking-wider"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                Launch Codespace <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </span>
                        </button>
                        
                        <a 
                            href="https://github.com/Prthmsh7/Dobby" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-8 py-4 bg-white hover:bg-slate-100 text-black font-black border-4 border-black neo-shadow-hover w-full sm:w-auto text-center uppercase tracking-wider"
                        >
                            View Source
                        </a>
                    </div>

                    <div className="flex items-center gap-8 pt-8 font-mono">
                        <div className="flex flex-col">
                            <span className="text-3xl font-black">14+</span>
                            <span className="text-xs text-black font-bold uppercase tracking-widest border-t-4 border-black pt-1">Languages</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-3xl font-black">5ms</span>
                            <span className="text-xs text-black font-bold uppercase tracking-widest border-t-4 border-black pt-1">Latency</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-3xl font-black">100%</span>
                            <span className="text-xs text-black font-bold uppercase tracking-widest border-t-4 border-black pt-1">Sandboxed</span>
                        </div>
                    </div>
                </div>

                {/* Right Visual */}
                <div ref={lottieRef} className="relative aspect-square w-full max-w-xl mx-auto lg:mr-0 border-4 border-black neo-shadow bg-[#FFEB3B] p-4 overflow-hidden">
                    <svg viewBox="0 0 600 600" className="w-full h-full relative z-10">
                        <defs>
                            <linearGradient id="heroBg" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#00E5FF" />
                                <stop offset="100%" stopColor="#FF4081" />
                            </linearGradient>
                        </defs>
                        <rect x="0" y="0" width="600" height="600" fill="#fff9c4" />
                        <rect x="40" y="60" width="520" height="360" rx="16" fill="#111" stroke="#000" strokeWidth="8" />
                        <rect x="40" y="60" width="520" height="48" fill="url(#heroBg)" />
                        <circle cx="78" cy="84" r="8" fill="#FFEB3B">
                            <animate attributeName="r" values="8;10;8" dur="2.4s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="106" cy="84" r="8" fill="#00E5FF">
                            <animate attributeName="r" values="8;10;8" dur="2.2s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="134" cy="84" r="8" fill="#FF4081">
                            <animate attributeName="r" values="8;10;8" dur="2s" repeatCount="indefinite" />
                        </circle>

                        <rect x="68" y="142" width="170" height="14" fill="#00E5FF">
                            <animate attributeName="width" values="90;200;120;170" dur="3s" repeatCount="indefinite" />
                        </rect>
                        <rect x="68" y="176" width="240" height="14" fill="#FFEB3B">
                            <animate attributeName="width" values="180;260;140;240" dur="2.8s" repeatCount="indefinite" />
                        </rect>
                        <rect x="68" y="210" width="200" height="14" fill="#FF4081">
                            <animate attributeName="width" values="140;220;160;200" dur="3.2s" repeatCount="indefinite" />
                        </rect>
                        <rect x="68" y="244" width="120" height="14" fill="#ffffff">
                            <animate attributeName="width" values="100;180;140;120" dur="2.6s" repeatCount="indefinite" />
                        </rect>

                        <g>
                            <rect x="370" y="150" width="170" height="170" rx="14" fill="#1c1c1c" stroke="#00E5FF" strokeWidth="6" />
                            <path d="M420 230 L455 195 M455 195 L490 230" stroke="#FFEB3B" strokeWidth="10" fill="none" strokeLinecap="round" />
                            <path d="M420 240 L455 275 M455 275 L490 240" stroke="#FF4081" strokeWidth="10" fill="none" strokeLinecap="round" />
                            <animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="2.4s" repeatCount="indefinite" />
                        </g>

                        <circle cx="470" cy="470" r="44" fill="#00E5FF" stroke="#000" strokeWidth="6">
                            <animate attributeName="r" values="38;48;38" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        <polygon points="458,448 458,492 496,470" fill="#000">
                            <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="1.8s" repeatCount="indefinite" />
                        </polygon>
                    </svg>
                </div>
            </div>
            
            {/* Scroll Indicator */}
            <motion.div 
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-black font-black"
            >
                <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
                <div className="w-[4px] h-12 bg-black" />
            </motion.div>
        </section>
    );
};
