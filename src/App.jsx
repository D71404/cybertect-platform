import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import Videotect from './components/Videotect';
import './index.css';

function App() {
  const [currentView, setCurrentView] = useState('landing');

  // Handle routing based on URL path
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/videotect' || path === '/tools/videotect') {
      setCurrentView('videotect');
    } else if (path === '/dashboard' || path === '/scanner') {
      setCurrentView('dashboard');
    } else {
      setCurrentView('landing');
    }
  }, []);

  return (
    <div className="bg-white min-h-screen">
      {currentView === 'landing' ? (
        <LandingPage 
          onNavigateToDashboard={() => setCurrentView('dashboard')}
        />
      ) : currentView === 'videotect' ? (
        <Videotect />
      ) : (
        <Dashboard 
          onNavigateToLanding={() => setCurrentView('landing')}
        />
      )}
    </div>
  );
}

export default App;
