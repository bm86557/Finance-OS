import { useEffect } from 'react';
import { useNavigate } from 'react-router';

export function AuthErrorHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthError = () => {
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.substring(1));
      
      const error = params.get('error');
      const errorCode = params.get('error_code');
      const errorDescription = params.get('error_description');

      if (error === 'access_denied' && errorCode === 'otp_expired') {
        // Clear the error from URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Redirect to login with a helpful message
        navigate('/login?message=email_expired', { replace: true });
      }
    };

    handleAuthError();
  }, [navigate]);

  return null; // This component doesn't render anything
}