'use client';

import { useState, useEffect } from 'react';
import { Rocket } from 'lucide-react';

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.scrollY > 300) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', toggleVisibility);
    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  const scrollToTop = () => {
    setIsLaunching(true);
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
    
    // Reset launching state after animation completes
    setTimeout(() => {
      setIsLaunching(false);
    }, 1000);
  };

  return (
    <button
      onClick={scrollToTop}
      className={`group fixed bottom-[5.5rem] right-6 z-50 inline-flex items-center justify-center rounded-full p-3 bg-slate-50/90 dark:bg-gray-800 border border-slate-200/80 dark:border-gray-700 shadow-md text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-background overflow-hidden ${
        isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-75 pointer-events-none'
      }`}
      aria-label="Back to top"
    >
      <div className="relative flex items-center justify-center w-5 h-5">
        <Rocket 
          className={`absolute w-5 h-5 transition-all duration-500 ease-in-out ${
            isLaunching 
              ? '-translate-y-16 scale-110 opacity-0' 
              : 'group-hover:-translate-y-1 group-hover:scale-110'
          }`}
        />
        
        {/* Fire trail that appears during launch */}
        <div 
          className={`absolute bottom-[-16px] left-1/2 -translate-x-1/2 w-1.5 h-6 bg-gradient-to-t from-transparent via-orange-500 to-yellow-300 blur-[1px] rounded-full transition-all duration-500 ease-in-out ${
            isLaunching ? '-translate-y-[40px] opacity-100' : 'translate-y-10 opacity-0'
          }`}
        />
      </div>
    </button>
  );
}
