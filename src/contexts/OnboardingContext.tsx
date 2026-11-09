import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

interface OnboardingContextType {
  isOnboarding: boolean;
  currentStep: number;
  steps: OnboardingStep[];
  completedSteps: string[];
  showOnboarding: () => void;
  hideOnboarding: () => void;
  completeStep: (stepId: string) => void;
  resetOnboarding: () => void;
  nextStep: () => void;
  previousStep: () => void;
  skipOnboarding: () => void;
}

const ONBOARDING_CONTEXT_KEY = Symbol.for('finance_os.onboarding_context');
export const OnboardingContext = ((globalThis as any)[ONBOARDING_CONTEXT_KEY] ||
  ((globalThis as any)[ONBOARDING_CONTEXT_KEY] = createContext<OnboardingContextType | undefined>(undefined))) as React.Context<OnboardingContextType | undefined>;

const DEFAULT_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Finance OS',
    description: 'Your intelligent finance platform for agencies',
    completed: false
  },
  {
    id: 'connect-bank',
    title: 'Connect Your Bank',
    description: 'Link your accounts for automatic transaction imports',
    completed: false
  },
  {
    id: 'import-statements',
    title: 'Import Statements',
    description: 'Upload your first bank statement or CSV file',
    completed: false
  },
  {
    id: 'review-categories',
    title: 'Review Categorizations',
    description: 'Our AI has categorized your transactions - review and adjust',
    completed: false
  },
  {
    id: 'explore-insights',
    title: 'Explore Insights',
    description: 'See your profit intelligence and cash flow forecast',
    completed: false
  }
];

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [steps, setSteps] = useState<OnboardingStep[]>(DEFAULT_STEPS);

  // Check if user has completed onboarding before
  useEffect(() => {
    const hasCompletedOnboarding = localStorage.getItem('financeOS_onboarding_completed');
    const savedCompletedSteps = localStorage.getItem('financeOS_completed_steps');
    
    if (savedCompletedSteps) {
      setCompletedSteps(JSON.parse(savedCompletedSteps));
    }
    
    if (!hasCompletedOnboarding) {
      // First time user - show onboarding
      setIsOnboarding(true);
    }
  }, []);

  // Update steps based on completed steps
  useEffect(() => {
    setSteps(prev => prev.map(step => ({
      ...step,
      completed: completedSteps.includes(step.id)
    })));
  }, [completedSteps]);

  const showOnboarding = () => {
    setIsOnboarding(true);
    setCurrentStep(0);
  };

  const hideOnboarding = () => {
    setIsOnboarding(false);
    localStorage.setItem('financeOS_onboarding_completed', 'true');
  };

  const completeStep = (stepId: string) => {
    if (!completedSteps.includes(stepId)) {
      const updated = [...completedSteps, stepId];
      setCompletedSteps(updated);
      localStorage.setItem('financeOS_completed_steps', JSON.stringify(updated));
    }
  };

  const resetOnboarding = () => {
    setCompletedSteps([]);
    setCurrentStep(0);
    localStorage.removeItem('financeOS_onboarding_completed');
    localStorage.removeItem('financeOS_completed_steps');
    setIsOnboarding(true);
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      hideOnboarding();
    }
  };

  const previousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const skipOnboarding = () => {
    hideOnboarding();
  };

  return (
    <OnboardingContext.Provider
      value={{
        isOnboarding,
        currentStep,
        steps,
        completedSteps,
        showOnboarding,
        hideOnboarding,
        completeStep,
        resetOnboarding,
        nextStep,
        previousStep,
        skipOnboarding
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
