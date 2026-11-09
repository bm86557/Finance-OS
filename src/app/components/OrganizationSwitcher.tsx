import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Check, ChevronDown, Building2 } from 'lucide-react';

export const OrganizationSwitcher: React.FC = () => {
  const { currentOrganization, organizations, switchOrganization } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!currentOrganization) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0a0a0f]/50 border border-[#1a1a2e]/50 hover:border-cyan-500/30 transition-all duration-300 min-w-[220px]"
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center text-lg">
          {currentOrganization.logo || <Building2 className="w-4 h-4 text-cyan-400" />}
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-white">{currentOrganization.name}</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            <span>{currentOrganization.currency}</span>
            {currentOrganization?.settings?.features?.multi_currency && Array.isArray(currentOrganization?.settings?.enabledCurrencies) && currentOrganization.settings.enabledCurrencies.length > 1 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
                +{currentOrganization.settings.enabledCurrencies.length - 1} FX
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded-xl shadow-2xl shadow-cyan-500/10 overflow-hidden z-50 backdrop-blur-xl">
            <div className="p-2 space-y-1">
              {organizations.map((org) => {
                const isSelected = org.id === currentOrganization.id;
                return (
                  <button
                    key={org.id}
                    onClick={() => {
                      switchOrganization(org.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 ${
                      isSelected
                        ? 'bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/30'
                        : 'hover:bg-[#1a1a2e]/50 border border-transparent'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center text-lg flex-shrink-0">
                      {org.logo || <Building2 className="w-4 h-4 text-cyan-400" />}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-medium text-white truncate">{org.name}</div>
                      <div className="text-xs text-gray-400">{org.currency}</div>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[#1a1a2e] p-2">
              <button className="w-full px-3 py-2.5 text-sm text-gray-400 hover:text-cyan-400 transition-colors duration-300 text-left rounded-lg hover:bg-[#1a1a2e]/50">
                + Create Organization
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
