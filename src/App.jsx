import { useState } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import './index.css';

function App() {
  const [currentView, setCurrentView] = useState('landing');

  return (
    <div className="bg-white min-h-screen">
      {currentView === 'landing' ? (
        <LandingPage 
          onNavigateToDashboard={() => setCurrentView('dashboard')}
        />
      ) : (
        <Dashboard 
          onNavigateToLanding={() => setCurrentView('landing')}
        />
      )}
    </div>
  );
}

export default App;
