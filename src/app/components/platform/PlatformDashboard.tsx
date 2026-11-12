import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { PlatformLayout } from './PlatformLayout';
import { PlatformHome } from './PlatformHome';
import { OrganizationsView } from './OrganizationsView';
import { PlansView } from './PlansView';
import { PlatformSettingsView } from './PlatformSettingsView';

type PlatformView = 'home' | 'organizations' | 'plans' | 'settings';

export function PlatformDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawView = searchParams.get('view');

  useEffect(() => {
    if (rawView === 'ai-command') {
      navigate('/ai-portal', { replace: true });
    }
  }, [rawView, navigate]);

  const initialView = (rawView as PlatformView) || 'home';
  const [currentView, setCurrentView] = useState<PlatformView>(initialView === ('ai-command' as any) ? 'home' : initialView);
  const { user } = useAuth();

  useEffect(() => {
    const v = searchParams.get('view') as PlatformView;
    if (v && ['home', 'organizations', 'plans', 'settings'].includes(v)) {
      setCurrentView(v);
    }
  }, [searchParams]);

  const handleViewChange = (v: PlatformView) => {
    setCurrentView(v);
    if (v === 'home') {
      searchParams.delete('view');
      setSearchParams(searchParams);
    } else {
      setSearchParams({ view: v });
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return <PlatformHome onNavigate={(v) => handleViewChange(v as PlatformView)} />;
      case 'organizations':
        return <OrganizationsView />;
      case 'plans':
        return <PlansView />;
      case 'settings':
        return <PlatformSettingsView />;
      default:
        return <PlatformHome onNavigate={(v) => handleViewChange(v as PlatformView)} />;
    }
  };

  return (
    <PlatformLayout currentView={currentView} onViewChange={(v) => handleViewChange(v as PlatformView)}>
      {renderView()}
    </PlatformLayout>
  );
}
