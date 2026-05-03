import React, { useRef, useEffect } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { useScrollAnimation } from '../hooks/useScrollAnimation';

export const Hero = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Optimized hook with no React state updates
    useScrollAnimation({
        frameCount: 80,
        imagePath: (i) => `/images/Dobby_Scene_${i.toString().padStart(3, '0')}.jpg`,
        canvasRef,
        cacheWindow: 15
    });

    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"]
    });

    // Stabilized positioning: minimal movement to prevent it from floating too high
    const indicatorY = useTransform(scrollYProgress, [0, 1], [0, -20]);
    const indicatorSpring = useSpring(indicatorY, { stiffness: 60, damping: 20 });
    const opacity = useTransform(scrollYProgress, [0, 0.9, 1], [1, 1, 0]);

    // Handle canvas sizing independently of scroll
    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.scale(dpr, dpr);
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <section ref={containerRef} className="relative h-[600vh] bg-black">
            {/* Full-screen Fixed Canvas */}
            <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden">
                <canvas
                    ref={canvasRef}
                    style={{ width: '100%', height: '100%' }}
                    className="absolute inset-0 object-cover"
                />

                {/* Prominent Scroll Indicator - Yellow for visibility */}
                <motion.div
                    style={{ y: indicatorSpring, x: "-50%", opacity }}
                    className="fixed bottom-12 left-1/2 z-50 flex flex-col items-center space-y-4 pointer-events-none"
                >
                    <div className="bg-[#fef08a] px-6 py-2 rounded-full shadow-[0_0_30px_rgba(254,240,138,0.4)]">
                        <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-black">
                            Scroll
                        </span>
                    </div>
                    <div className="w-[1px] h-12 bg-gradient-to-b from-[#fef08a]/60 to-transparent shadow-[0_0_10px_rgba(254,240,138,0.3)]" />
                </motion.div>
            </div>
        </section>
    );
};
