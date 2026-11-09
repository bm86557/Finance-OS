import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Monitor, Smartphone, Tablet, MapPin, Clock, AlertTriangle, Shield } from 'lucide-react';
import { toast } from 'sonner';
// ── Phase 9C: Sessions wired through authService (no direct mockDatabase import) ──
import { authService } from '@/services/authService';
import { useAuth } from '@/contexts/AuthContext';
import type { ActiveSession } from '@/services/types';
import { ViewHeader } from './ViewHeader';

const fallbackSessionHistory = [
  { id: '1', action: 'Login', device: 'Chrome on Windows', location: 'New York', time: '2025-01-16 09:30 AM', status: 'success' },
  { id: '2', action: 'Login', device: 'Safari on iOS', location: 'New York', time: '2025-01-16 08:00 AM', status: 'success' },
  { id: '3', action: 'Logout', device: 'Chrome on Windows', location: 'New York', time: '2025-01-15 11:30 PM', status: 'success' },
  { id: '4', action: 'Failed Login', device: 'Chrome on Android', location: 'Unknown', time: '2025-01-15 03:22 PM', status: 'failed' },
  { id: '5', action: 'Login', device: 'Firefox on macOS', location: 'New York', time: '2025-01-14 05:45 PM', status: 'success' },
];

export function ActiveSessionsView() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<Array<{
    id: string;
    action: string;
    device: string;
    location: string;
    time: string;
    status: string;
  }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fetch session history when toggled
  useEffect(() => {
    if (showHistory && user?.id) {
      setLoadingHistory(true);
      authService.getSessionHistory(user.id).then(res => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setSessionHistory(res.data);
        } else if (res.success && Array.isArray(res.data) && res.data.length === 0) {
          setSessionHistory(fallbackSessionHistory);
        }
      }).catch(() => {
        setSessionHistory(fallbackSessionHistory);
      }).finally(() => {
        setLoadingHistory(false);
      });
    }
  }, [showHistory, user?.id]);

  // Fetch sessions from service on mount
  useEffect(() => {
    if (!user?.id) return;
    authService.getActiveSessions(user.id).then(res => {
      if (res.success) setSessions(res.data);
    });
  }, [user?.id]);

  const getDeviceIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('mobile')) {
      return <Smartphone className="size-5 text-blue-400" />;
    }
    if (lowerType.includes('tablet')) {
      return <Tablet className="size-5 text-purple-400" />;
    }
    return <Monitor className="size-5 text-cyan-400" />;
  };

  const handleEndSession = async (sessionId: string) => {
    const res = await authService.endSession(sessionId);
    if (!res.success) {
      toast.error(res.error || 'Failed to end session');
      return;
    }
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    toast.success('Session ended successfully');
  };

  const handleEndAllOtherSessions = async () => {
    if (!user?.id) return;
    const res = await authService.endAllOtherSessions(user.id);
    if (res.success) {
      setSessions(prev => prev.filter(s => s.isCurrentSession));
      toast.success('All other sessions have been ended');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <ViewHeader
        title="Active Sessions"
        description="Manage your active devices and login sessions"
      />

      {/* Security Alert */}
      <Card className="bg-amber-950/20 border-amber-900/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Shield className="size-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-amber-200 font-medium mb-1">Security Tip</p>
              <p className="text-xs text-amber-300/80">
                If you see a session you don't recognize, end it immediately and change your password.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Active Sessions ({sessions.length})</CardTitle>
              <CardDescription>Devices currently logged into your account</CardDescription>
            </div>
            {sessions.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleEndAllOtherSessions}
                className="border-red-900/50 text-red-400 hover:bg-red-950/20"
              >
                End All Others
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="p-4 bg-slate-950 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1">
                  {/* Device Icon */}
                  <div className="p-3 bg-slate-900 rounded-lg">
                    {getDeviceIcon(session.deviceType)}
                  </div>

                  {/* Session Details */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-white font-medium">{session.browser}</h4>
                      {session.isCurrentSession && (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                          Current Session
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Monitor className="size-4" />
                        <span>{session.deviceType}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <MapPin className="size-4" />
                        <span>{session.location} • {session.ipAddress}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <Clock className="size-4" />
                        <span>Last active: {session.lastActivity}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 text-xs">
                        <span>Logged in: {session.loginTime}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div>
                  {!session.isCurrentSession && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEndSession(session.id)}
                      className="border-slate-700 hover:bg-red-950/20 hover:border-red-900/50 hover:text-red-400"
                    >
                      End Session
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Session History */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Session History</CardTitle>
              <CardDescription>Login and logout activity from the past 30 days</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="border-slate-700 hover:bg-slate-800"
            >
              {showHistory ? 'Hide' : 'Show'} History
            </Button>
          </div>
        </CardHeader>
        {showHistory && (
          <CardContent>
            <div className="space-y-3">
              {sessionHistory.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-4 p-3 bg-slate-950 rounded-lg"
                >
                  <div className={`p-2 rounded-lg ${
                    event.status === 'failed' ? 'bg-red-950/20' : 'bg-slate-900'
                  }`}>
                    {event.status === 'failed' ? (
                      <AlertTriangle className="size-4 text-red-400" />
                    ) : (
                      <Shield className="size-4 text-green-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h5 className={`text-sm font-medium ${
                        event.status === 'failed' ? 'text-red-400' : 'text-white'
                      }`}>
                        {event.action}
                      </h5>
                      <span className="text-xs text-slate-500">{event.time}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {event.device} • {event.location}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Security Recommendations */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Shield className="size-5 text-blue-400" />
            Security Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-slate-950 rounded-lg">
            <h5 className="text-sm font-medium text-white mb-1">✓ Two-Factor Authentication</h5>
            <p className="text-xs text-slate-400">Add an extra layer of security to your account</p>
          </div>
          <div className="p-3 bg-slate-950 rounded-lg">
            <h5 className="text-sm font-medium text-white mb-1">✓ Regular Password Updates</h5>
            <p className="text-xs text-slate-400">Change your password every 90 days</p>
          </div>
          <div className="p-3 bg-slate-950 rounded-lg">
            <h5 className="text-sm font-medium text-white mb-1">✓ Review Session Activity</h5>
            <p className="text-xs text-slate-400">Check this page regularly for suspicious activity</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}