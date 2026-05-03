import React from 'react';
import { cn } from '@/lib/utils';

const WorkspaceContainer = ({ activeModule, children }) => {
    return (
        <div className="flex-1 relative overflow-hidden bg-slate-950">
            {React.Children.map(children, (child) => {
                if (!child) return null;

                // Support both direct props and forwarded props from component wrappers
                const moduleId = child.props?.moduleId;
                const isActive = moduleId === activeModule;

                return (
                    <div
                        key={moduleId}
                        className={cn(
                            "absolute inset-0 transition-opacity duration-200",
                            isActive ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
                        )}
                    >
                        {child}
                    </div>
                );
            })}
        </div>
    );
};

export default WorkspaceContainer;
