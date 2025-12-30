import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Scanner from './components/Scanner';
import Videotect from './components/Videotect';
import AIValidation from './components/AIValidation';
import './index.css';

function App() {
  // Set initial view based on base URL - if we're in ai-validation build, start there
  const getInitialView = () => {
    const base = import.meta.env.BASE_URL || '/';
    if (base === '/ai-validation/') {
      return 'ai-validation';
    }
    return 'scanner';
  };
  
  const [currentView, setCurrentView] = useState(getInitialView());

  // Handle routing based on URL path
  useEffect(() => {
    const updateView = () => {
      const base = import.meta.env.BASE_URL || '/'; // Get base path from Vite config (e.g., '/ai-validation/')
      const fullPath = window.location.pathname;
      
      // Special case: if we're at the base URL for ai-validation, show AI validation
      if (base === '/ai-validation/' && (fullPath === '/ai-validation/' || fullPath === '/ai-validation')) {
        setCurrentView('ai-validation');
        return;
      }
      
      // Remove base path to get the actual route
      // e.g., '/ai-validation/videotect' -> '/videotect'
      const path = fullPath.startsWith(base) 
        ? fullPath.slice(base.length - 1) // Remove base, keep leading slash
        : fullPath;
      
      if (path === '/videotect' || path === '/tools/videotect' || path === 'videotect' || path === 'tools/videotect') {
        setCurrentView('videotect');
      } else if (path === '/ai-validation' || path === '/tools/ai-validation' || path === 'ai-validation' || path === 'tools/ai-validation') {
        setCurrentView('ai-validation');
      } else if (path === '/landing' || path === 'landing') {
        setCurrentView('landing');
      } else {
        // default route and /dashboard or /scanner render the main scanner UI
        setCurrentView('scanner');
      }
    };

    // Initial route check
    updateView();

    // Listen for browser back/forward navigation
    window.addEventListener('popstate', updateView);
    
    // Listen for link clicks (for SPA navigation)
    const handleClick = (e) => {
      const link = e.target.closest('a');
      if (link && link.href && link.origin === window.location.origin) {
        const href = link.getAttribute('href');
        if (href && (href.startsWith('/videotect') || href.startsWith('/ai-validation') || href.startsWith('/dashboard') || href.startsWith('/scanner') || href.startsWith('/landing'))) {
          e.preventDefault();
          window.history.pushState({}, '', href);
          updateView();
        }
      }
    };
    document.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('popstate', updateView);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <div className="bg-white min-h-screen">
      {currentView === 'landing' ? (
        <LandingPage 
          onNavigateToDashboard={() => setCurrentView('scanner')}
        />
      ) : currentView === 'videotect' ? (
        <Videotect />
      ) : currentView === 'ai-validation' ? (
        <AIValidation />
      ) : (
        <Scanner />
      )}
    </div>
  );
}

export default App;
