import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSlogan?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showSlogan = false,
  className = '',
}) => {
  const iconSizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
  };

  const titleSizeClasses = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Área Reservada para o Logótipo Oficial do Students Hub */}
      <div
        className={`${iconSizeClasses[size]} rounded-xl bg-slate-900 text-white flex items-center justify-center font-black tracking-tight shadow-xs border border-slate-800 shrink-0 select-none`}
        aria-label="Students Hub Logo"
      >
        <span className="font-serif italic font-bold">SH</span>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span
            className={`${titleSizeClasses[size]} font-black tracking-tight text-slate-900 block leading-tight font-sans`}
          >
            Students Hub
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
            Secundário
          </span>
        </div>

        {showSlogan ? (
          <p className="text-xs text-slate-500 font-medium tracking-normal mt-0.5">
            Apontamentos que ajudam, exercícios que resultam. Rumo ao 20.
          </p>
        ) : (
          <span className="text-[11px] font-medium text-slate-500 block">
            Rumo ao 20
          </span>
        )}
      </div>
    </div>
  );
};
