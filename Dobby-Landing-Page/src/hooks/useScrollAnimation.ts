import { useEffect, useRef, useCallback } from 'react';

interface UseScrollAnimationOptions {
    frameCount: number;
    imagePath: (index: number) => string;
    canvasRef: React.RefObject<HTMLCanvasElement>;
    cacheWindow?: number; // ± size around current frame
}

export const useScrollAnimation = ({
    frameCount,
    imagePath,
    canvasRef,
    cacheWindow = 20
}: UseScrollAnimationOptions) => {
    const imagesRef = useRef<Map<number, HTMLImageElement>>(new Map());
    const currentFrameRef = useRef<number>(0);
    const targetFrameRef = useRef<number>(0);
    const requestRef = useRef<number>();
    const isMountedRef = useRef<boolean>(true);

    // FPS/Instrumentation
    const lastTimeRef = useRef<number>(performance.now());
    const frameCountDebugRef = useRef<number>(0);

    const loadImage = useCallback((index: number) => {
        if (imagesRef.current.has(index)) return Promise.resolve(imagesRef.current.get(index));

        return new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.src = imagePath(index);
            img.onload = () => {
                imagesRef.current.set(index, img);
                resolve(img);
            };
            img.onerror = () => resolve(img); // Resolve anyway to avoid blocking
        });
    }, [imagePath]);

    const cleanCache = useCallback((currentIndex: number) => {
        const keys = Array.from(imagesRef.current.keys());
        keys.forEach(key => {
            if (Math.abs(key - currentIndex) > cacheWindow) {
                imagesRef.current.delete(key);
            }
        });
    }, [cacheWindow]);

    const render = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // Smoothly interpolate towards target frame
        const delta = targetFrameRef.current - currentFrameRef.current;
        if (Math.abs(delta) < 0.1) {
            currentFrameRef.current = targetFrameRef.current;
        } else {
            currentFrameRef.current += delta * 0.2; // Easing constant
        }

        const frameIndex = Math.round(currentFrameRef.current);
        const img = imagesRef.current.get(frameIndex);

        if (img) {
            const scale = Math.max(canvas.width / (img.width * (window.devicePixelRatio || 1)), canvas.height / (img.height * (window.devicePixelRatio || 1)));
            const x = (canvas.width / 2) - (img.width * (window.devicePixelRatio || 1) / 2) * scale;
            const y = (canvas.height / 2) - (img.height * (window.devicePixelRatio || 1) / 2) * scale;

            ctx.drawImage(img, x / (window.devicePixelRatio || 1), y / (window.devicePixelRatio || 1), img.width * scale, img.height * scale);
        }

        // Instrumentation
        if (import.meta.env.DEV) {
            frameCountDebugRef.current++;
            const now = performance.now();
            if (now - lastTimeRef.current >= 1000) {
                console.log(`[Dobby Perf] FPS: ${frameCountDebugRef.current}`);
                frameCountDebugRef.current = 0;
                lastTimeRef.current = now;
            }
        }

        requestRef.current = requestAnimationFrame(render);
    }, [canvasRef]);

    useEffect(() => {
        isMountedRef.current = true;
        requestRef.current = requestAnimationFrame(render);

        const handleScroll = () => {
            const scrollTop = window.scrollY;
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const progress = Math.max(0, Math.min(scrollTop / maxScroll, 1));

            const newTargetFrame = Math.floor(progress * (frameCount - 1));
            targetFrameRef.current = newTargetFrame;

            // Proactively load frames around the target
            for (let i = -5; i <= 5; i++) {
                const idx = newTargetFrame + i;
                if (idx >= 0 && idx < frameCount) {
                    loadImage(idx);
                }
            }

            cleanCache(newTargetFrame);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });

        // Initial load of first few frames
        for (let i = 0; i < Math.min(10, frameCount); i++) {
            loadImage(i);
        }

        return () => {
            isMountedRef.current = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            window.removeEventListener('scroll', handleScroll);
        };
    }, [frameCount, loadImage, render, cleanCache]);

    return { currentFrame: currentFrameRef };
};
