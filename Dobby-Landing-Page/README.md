# DOBBY Landing Page Component

A high-performance, cinematic, scroll-driven landing page component designed for luxury developer products. Optimized for 60 FPS scrolling and minimalist aesthetics.

## Features

- **Scroll-Driven Storytelling**: A fluid 80-frame image sequence mapped to page scroll.
- **High Performance**: Built with a `requestAnimationFrame` render loop and a bounded image cache to eliminate jank.
- **Luxury Aesthetic**: Dark theme, glassmorphism, and premium typography.
- **Standalone Component**: Easily integrate into any existing React + Tailwind CSS project.

## Integration Guide

### 1. Prerequisites

Ensure your project has the following dependencies installed:

```bash
npm install framer-motion lucide-react clsx tailwind-merge
```

### 2. Styles Setup

Copy the luxury styles from `src/index.css` into your global CSS file. These styles handle fonts, custom scrollbars, and the "luxury-button" utility.

### 3. Asset Setup

Place the sequence images in your project's `public/images/` directory. The component expects images named `Dobby_Scene_000.jpg` through `Dobby_Scene_079.jpg`.

### 4. Component Placement

Copy the following files into your `components/` directory:

- `src/DobbyLandingPage.tsx` (Main wrapper)
- `src/components/Hero.tsx` (Core animation logic)
- `src/hooks/useScrollAnimation.ts` (Performance-optimized hooks)

### 5. Usage

Import and use the `DobbyLandingPage` component in your main application logic:

```tsx
import { DobbyLandingPage } from './components/DobbyLandingPage';

function MyDashboard() {
  return (
    <div>
      {/* Your existing content */}
      <DobbyLandingPage />
    </div>
  );
}
```

## Configuration

The component is pre-configured for the DOBBY brand. You can modify the navigation links and brand text within `DobbyLandingPage.tsx` to match your target project.

---
*Optimized by Antigravity for DOBBY.*
