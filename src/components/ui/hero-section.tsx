import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Menu, X } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';

export default function HeroSection() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    }

    if (menuOpen) {
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onClickOutside);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClickOutside);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700&display=swap');
        .hero-font { font-family: 'Poppins', sans-serif; }
      `}</style>

      <section className="hero-font relative w-full bg-no-repeat bg-cover bg-center text-sm pb-32 md:pb-44 overflow-hidden bg-white">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage: `linear-gradient(to right, rgb(241 245 249 / 0.5) 1px, transparent 1px),
              linear-gradient(to bottom, rgb(241 245 249 / 0.5) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />

        <nav className="flex items-center justify-between p-4 md:px-16 lg:px-24 xl:px-32 md:py-6 w-full">
          <Link to="/" aria-label="Cybertect home" className="flex items-center">
            <div className="cybertect-logo flex items-baseline">
              <span className="cyber-text text-xl md:text-2xl font-semibold">cyber</span>
              <span className="tect-text text-xl md:text-2xl font-semibold">tect</span>
              <span className="com-text text-base md:text-lg">.com</span>
            </div>
          </Link>

          <div
            ref={menuRef}
            className={[
              'max-md:fixed max-md:inset-0 max-md:transition-all max-md:duration-300 max-md:z-50',
              'flex items-center gap-8 font-medium text-gray-800',
              'max-md:flex-col max-md:justify-center max-md:bg-white/95 max-md:backdrop-blur',
              menuOpen ? 'max-md:opacity-100 max-md:visible' : 'max-md:opacity-0 max-md:invisible max-md:pointer-events-none',
            ].join(' ')}
          >
            <Link to="/" onClick={() => setMenuOpen(false)} className="hover:text-gray-600 transition-colors">Home</Link>

            <div className="relative group flex items-center gap-1">
              <span className="cursor-default">Tools</span>
              <ChevronDown className="w-4 h-4 hidden md:block" strokeWidth={2} />
              <div className="absolute md:opacity-0 md:invisible md:group-hover:opacity-100 md:group-hover:visible flex flex-col gap-2 mt-2 md:mt-0 md:top-full md:left-0 md:bg-white md:rounded-lg md:p-4 md:shadow-lg md:border md:border-gray-100 md:z-50 md:w-max">
                <a href="/videotect" onClick={() => setMenuOpen(false)} className="hover:translate-x-1 hover:text-slate-500 transition-all py-1">Videotect</a>
                <a href="/ai-validation" onClick={() => setMenuOpen(false)} className="hover:translate-x-1 hover:text-slate-500 transition-all py-1">AI Validation</a>
              </div>
            </div>

            <a href="#solutions" onClick={() => setMenuOpen(false)} className="hover:text-gray-600 transition-colors">Solutions</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="hover:text-gray-600 transition-colors">Pricing</a>

            <div className="max-md:flex max-md:items-center max-md:gap-4 hidden">
              <ThemeToggle />
              {user ? (
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                    navigate('/', { replace: true });
                  }}
                  className="text-gray-700 font-medium"
                >
                  Sign out
                </button>
              ) : (
                <Link to="/auth" onClick={() => setMenuOpen(false)} className="text-gray-700 font-medium">Sign in</Link>
              )}
              <Link to="/dashboard" onClick={() => setMenuOpen(false)} className="bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-6 py-3 rounded-full font-medium transition">Dashboard</Link>
            </div>

            <button
              onClick={() => setMenuOpen(false)}
              className="md:hidden absolute top-6 right-6 bg-[#2563EB] hover:bg-[#1d4ed8] text-white p-2 rounded-md aspect-square font-medium transition"
              aria-label="Close menu"
            >
              <X className="w-6 h-6" strokeWidth={2} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            {user ? (
              <button
                onClick={async () => {
                  await signOut();
                  navigate('/', { replace: true });
                }}
                className="hidden md:flex text-gray-700 hover:text-gray-900 font-medium transition"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/auth"
                className="hidden md:flex text-gray-700 hover:text-gray-900 font-medium transition"
              >
                Sign in
              </Link>
            )}
            <Link
              to="/dashboard"
              className="hidden md:flex bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-6 py-3 rounded-full font-medium transition"
            >
              Dashboard
            </Link>
            <div className="flex md:hidden items-center gap-2">
              <ThemeToggle />
              <button
                onClick={() => setMenuOpen(true)}
                className="rounded-md bg-[#2563EB] hover:bg-[#1d4ed8] text-white p-2 aspect-square font-medium transition"
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6" strokeWidth={2} />
              </button>
            </div>
          </div>
        </nav>

        <a
          href="#scanner"
          className="flex items-center gap-2 border border-slate-300 hover:border-slate-400 rounded-full w-max mx-auto px-4 py-2 mt-24 md:mt-32 bg-white/90 backdrop-blur text-gray-700 transition-colors"
        >
          <span className="text-xs md:text-sm">Ad fraud forensics • Page-level verification</span>
          <span className="font-medium flex items-center gap-1">
            Learn more
            <ChevronDown className="w-4 h-4 rotate-[-90deg]" strokeWidth={2} />
          </span>
        </a>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-medium max-w-[850px] text-center mx-auto mt-8 text-gray-900 leading-tight">
          Stop Paying for Phantom Impressions
        </h1>

        <p className="text-sm md:text-base mx-auto max-w-2xl text-center mt-6 max-md:px-4 text-gray-600">
          Most fraud tools hunt bots. Cybertect audits the page itself—verifying which ad slots actually rendered, which beacons were real impressions, and where inflated telemetry quietly burns budget.
        </p>

        <div className="mx-auto w-full flex flex-col sm:flex-row items-center justify-center gap-3 mt-8 px-4">
          <button
            onClick={() => {
              if (user) navigate('/dashboard');
              else navigate('/auth');
            }}
            className="w-full sm:w-auto text-center bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-8 py-3 rounded-full font-medium transition"
          >
            Run Forensic Scan
          </button>
          <a
            href="#scanner"
            className="w-full sm:w-auto flex items-center justify-center gap-2 border border-slate-300 hover:bg-slate-50 rounded-full px-8 py-3 text-gray-800 transition-colors"
          >
            <span>View Sample Report</span>
            <ChevronDown className="w-4 h-4 rotate-[-90deg]" strokeWidth={2} />
          </a>
        </div>
      </section>
    </>
  );
}
