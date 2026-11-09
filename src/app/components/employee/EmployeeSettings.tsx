import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { User, Bell, Shield, HelpCircle, Loader2, Check, Send, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { employeeService } from '@/services/employeeService';
import type {
  EmployeeNotificationPreferences,
  EmployeeSecuritySettings,
  EmployeeSessionTimeout,
} from '@/services/types';
import { toast } from 'sonner';

const SESSION_TIMEOUT_OPTIONS: EmployeeSessionTimeout[] = [
  '15 minutes',
  '30 minutes',
  '1 hour',
  '4 hours',
  '8 hours',
];

export function EmployeeSettings() {
  const {
    user,
    currentOrganization,
    membership,
    refreshUserProfile,
    setSessionTimeoutPreference,
  } = useAuth();
  const { refresh: refreshNotifications } = useNotifications();

  const [fullName, setFullName] = useState<string>(user?.name ?? '');
  const [email, setEmail] = useState<string>(user?.email ?? '');
  const [phone, setPhone] = useState<string>(user?.phone || '+1 555-0105');
  const [department, setDepartment] = useState<string>(
    membership?.department || 'Development',
  );

  const [notifications, setNotifications] =
    useState<EmployeeNotificationPreferences>({
      emailNotifications: true,
      expenseApprovals: true,
      timesheetReminders: true,
      projectUpdates: false,
      companyAnnouncements: true,
    });

  const [security, setSecurity] = useState<EmployeeSecuritySettings>({
    twoFactorEnabled: true,
    sessionTimeout: '30 minutes',
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [justSaved, setJustSaved] = useState<boolean>(false);

  const loadSettings = useCallback(async () => {
    const orgId = currentOrganization?.id;
    const userId = user?.id;
    if (!orgId || !userId) {
      if (user?.name) setFullName(user.name);
      if (user?.email) setEmail(user.email);
      if (membership?.department) setDepartment(membership.department);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await employeeService.getMySettings(orgId, userId);
      if (res.success && res.data) {
        const s = res.data;
        if (s.profile.fullName) setFullName(s.profile.fullName);
        else if (user?.name) setFullName(user.name);
        setEmail(s.profile.email || user?.email || '');
        if (s.profile.phone) setPhone(s.profile.phone);
        setDepartment(
          s.profile.department || membership?.department || 'Development',
        );
        setNotifications(s.notifications);
        setSecurity(s.security);
        setSessionTimeoutPreference(s.security.sessionTimeout, user?.id);
      }
    } catch (err) {
      console.warn('[EmployeeSettings] Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentOrganization?.id, user?.id]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleToggleNotification = (
    key: keyof EmployeeNotificationPreferences,
  ) => {
    setJustSaved(false);
    setNotifications((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleToggleTwoFactor = () => {
    setJustSaved(false);
    setSecurity((prev) => ({
      ...prev,
      twoFactorEnabled: !prev.twoFactorEnabled,
    }));
  };

  const handleSessionTimeoutChange = (val: EmployeeSessionTimeout) => {
    setJustSaved(false);
    setSecurity((prev) => ({
      ...prev,
      sessionTimeout: val,
    }));
  };

  const handleSaveChanges = async () => {
    const trimmedName = fullName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      toast.error('Full Name must be at least 2 characters.');
      return;
    }

    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^[+\d\s\-().]{5,30}$/.test(trimmedPhone)) {
      toast.error('Please enter a valid phone number (e.g. +1 555-0105).');
      return;
    }

    const orgId = currentOrganization?.id;
    const userId = user?.id;
    if (!orgId || !userId) {
      toast.error('Unable to resolve active organization or user session.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await employeeService.updateMySettings(orgId, userId, {
        profile: {
          fullName: trimmedName,
          phone: trimmedPhone,
        },
        notifications,
        security,
      });

      if (!res.success) {
        toast.error(res.error || 'Failed to save settings.');
        return;
      }

      if (res.data) {
        setFullName(res.data.profile.fullName);
        setPhone(res.data.profile.phone);
        setDepartment(
          res.data.profile.department || membership?.department || department,
        );
        setNotifications(res.data.notifications);
        setSecurity(res.data.security);
      }

      // Immediately propagate profile & security updates across the entire portal
      refreshUserProfile({
        name: trimmedName,
        phone: trimmedPhone,
      });
      setSessionTimeoutPreference(security.sessionTimeout, user?.id);
      await refreshNotifications();

      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      toast.success('Settings saved successfully');
    } catch (err: any) {
      toast.error(err?.message || 'An error occurred while saving settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const sections = [
    {
      title: 'Profile Settings',
      icon: User,
      color: 'blue',
      items: [
        {
          key: 'fullName',
          label: 'Full Name',
          value: fullName,
          type: 'text' as const,
          onChange: (v: string) => {
            setJustSaved(false);
            setFullName(v);
          },
          placeholder: 'Enter your full name',
        },
        {
          key: 'email',
          label: 'Email',
          value: email,
          type: 'readonly-input' as const,
        },
        {
          key: 'phone',
          label: 'Phone',
          value: phone,
          type: 'text' as const,
          onChange: (v: string) => {
            setJustSaved(false);
            setPhone(v);
          },
          placeholder: '+1 555-0105',
        },
        {
          key: 'department',
          label: 'Department',
          value: department,
          type: 'readonly' as const,
        },
      ],
    },
    {
      title: 'Notification Preferences',
      icon: Bell,
      color: 'purple',
      items: [
        {
          key: 'emailNotifications',
          label: 'Email Notifications',
          value: notifications.emailNotifications,
          type: 'toggle' as const,
          onToggle: () => handleToggleNotification('emailNotifications'),
        },
        {
          key: 'expenseApprovals',
          label: 'Expense Approvals',
          value: notifications.expenseApprovals,
          type: 'toggle' as const,
          onToggle: () => handleToggleNotification('expenseApprovals'),
        },
        {
          key: 'timesheetReminders',
          label: 'Timesheet Reminders',
          value: notifications.timesheetReminders,
          type: 'toggle' as const,
          onToggle: () => handleToggleNotification('timesheetReminders'),
        },
        {
          key: 'projectUpdates',
          label: 'Project Updates',
          value: notifications.projectUpdates,
          type: 'toggle' as const,
          onToggle: () => handleToggleNotification('projectUpdates'),
        },
        {
          key: 'companyAnnouncements',
          label: 'Company Announcements',
          value: notifications.companyAnnouncements,
          type: 'toggle' as const,
          onToggle: () => handleToggleNotification('companyAnnouncements'),
        },
      ],
    },
    {
      title: 'Security',
      icon: Shield,
      color: 'green',
      items: [
        {
          key: 'twoFactorEnabled',
          label: 'Two-Factor Authentication',
          value: security.twoFactorEnabled,
          type: 'toggle' as const,
          onToggle: handleToggleTwoFactor,
        },
        {
          key: 'sessionTimeout',
          label: 'Session Timeout',
          value: security.sessionTimeout,
          type: 'select' as const,
          options: SESSION_TIMEOUT_OPTIONS,
          onSelect: (v: string) =>
            handleSessionTimeoutChange(v as EmployeeSessionTimeout),
        },
      ],
    },
  ];

  return (
    <div
      className="p-8 space-y-8"
      style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}
    >
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1
          className="text-4xl font-bold mb-2"
          style={AXIOM.text.titleStyle as any}
        >
          My Settings
        </h1>
        <p className="text-slate-400 font-mono">
          Manage your profile and preferences
        </p>
      </motion.div>

      {sections.map((section, si) => (
        <motion.div
          key={section.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + si * 0.1 }}
          className="rounded-2xl p-6"
          style={{
            background: AXIOM.backgrounds.chartContainer,
            border: AXIOM.borders[section.color as keyof typeof AXIOM.borders],
            boxShadow:
              AXIOM.shadows[section.color as keyof typeof AXIOM.shadows],
          }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div
              className="size-10 rounded-lg flex items-center justify-center"
              style={{
                background:
                  AXIOM.iconBoxes[section.color as keyof typeof AXIOM.iconBoxes],
              }}
            >
              <section.icon className="size-5 text-white" />
            </div>
            <h3 className="text-white font-bold">{section.title}</h3>
          </div>

          <div className="space-y-4">
            {section.items.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between p-4 rounded-lg"
                style={{
                  ...AXIOM.containers.item,
                }}
              >
                <span className="text-sm text-slate-300 font-mono">
                  {item.label}
                </span>
                {item.type === 'toggle' ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(item.value)}
                    aria-label={item.label}
                    onClick={item.onToggle}
                    disabled={isLoading || isSaving}
                    className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors outline-none ${
                      item.value ? 'bg-blue-500/50' : 'bg-slate-700/50'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 size-5 rounded-full transition-all ${
                        item.value
                          ? 'left-6 bg-blue-400'
                          : 'left-0.5 bg-slate-500'
                      }`}
                    />
                  </button>
                ) : item.type === 'readonly' ? (
                  <span className="text-sm text-slate-500 font-mono">
                    {String(item.value)}
                  </span>
                ) : item.type === 'readonly-input' ? (
                  <input
                    type="email"
                    value={String(item.value)}
                    readOnly
                    title="Email is managed by your organization administrator"
                    className="text-sm text-white font-mono text-right bg-transparent border-none outline-none w-64 cursor-default"
                  />
                ) : item.type === 'select' ? (
                  <select
                    aria-label={item.label}
                    value={String(item.value)}
                    disabled={isLoading || isSaving}
                    onChange={(e) => item.onSelect?.(e.target.value)}
                    className="text-sm text-white font-mono text-right bg-transparent border-none outline-none cursor-pointer"
                  >
                    {(item.options || []).map((opt) => (
                      <option
                        key={opt}
                        value={opt}
                        className="bg-slate-900 text-white"
                      >
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label={item.label}
                    value={String(item.value)}
                    placeholder={item.placeholder}
                    disabled={isLoading || isSaving}
                    onChange={(e) => item.onChange?.(e.target.value)}
                    className="text-sm text-white font-mono text-right bg-transparent border-none outline-none w-64 focus:ring-1 focus:ring-blue-500/40 rounded px-2 py-0.5"
                  />
                )}
              </div>
            ))}
          </div>
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex justify-end"
      >
        <button
          type="button"
          onClick={handleSaveChanges}
          disabled={isLoading || isSaving}
          className="px-8 py-3 rounded-xl text-white font-medium flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          style={AXIOM.buttons.action}
        >
          {isSaving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving...
            </>
          ) : justSaved ? (
            <>
              <Check className="size-4" />
              Saved
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </motion.div>
    </div>
  );
}

export function EmployeeHelp() {
  const { currentOrganization } = useAuth();
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const faqs = [
    {
      q: 'How do I submit an expense claim?',
      a: 'Go to My Expenses and click "New Expense". Fill in the details, attach a receipt, and submit.',
    },
    {
      q: 'How do I log my hours?',
      a: 'Use the Timesheet page to either start the live timer or manually add time entries.',
    },
    {
      q: 'When are payslips available?',
      a: 'Payslips are generated on the last day of each month and available on the Payslips page.',
    },
    {
      q: 'Who approves my expenses?',
      a: 'Your department head or the finance team reviews all expense claims.',
    },
    {
      q: 'How do I change my notification settings?',
      a: 'Go to My Settings > Notification Preferences to customize.',
    },
  ];

  const handleSubmitSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast.error('Please enter both a subject and message.');
      return;
    }
    if (!currentOrganization?.id) {
      toast.error('No active organization found.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await employeeService.submitSupportRequest(
        currentOrganization.id,
        {
          subject: subject.trim(),
          category,
          message: message.trim(),
        },
      );
      if (res.success) {
        toast.success(
          res.message ||
            'Support request sent to your organization administrator',
        );
        setSubject('');
        setMessage('');
        setIsSupportOpen(false);
      } else {
        toast.error(res.error || 'Failed to submit support request');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit support request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="p-8 space-y-8"
      style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}
    >
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1
          className="text-4xl font-bold mb-2"
          style={AXIOM.text.titleStyle as any}
        >
          Help & Support
        </h1>
        <p className="text-slate-400 font-mono">
          Frequently asked questions and support resources
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl overflow-hidden"
        style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}
      >
        <div className="p-6 pb-4">
          <h3 className="text-white font-bold flex items-center gap-2">
            <HelpCircle className="size-5 text-blue-400" />
            Frequently Asked Questions
          </h3>
        </div>
        <div
          className="divide-y"
          style={{ borderColor: 'rgba(148, 163, 184, 0.1)' }}
        >
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className="px-6 py-5"
            >
              <p className="text-white font-medium mb-2">{faq.q}</p>
              <p className="text-sm text-slate-400">{faq.a}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl p-6 text-center"
        style={{
          background: AXIOM.backgrounds.chartContainer,
          border: AXIOM.borders.blue,
        }}
      >
        <HelpCircle className="size-12 text-blue-400 mx-auto mb-4" />
        <h3 className="text-white font-bold mb-2">Need More Help?</h3>
        <p className="text-sm text-slate-400 mb-4">
          Contact your HR department or IT support team
        </p>
        <button
          type="button"
          onClick={() => setIsSupportOpen(true)}
          className="px-6 py-3 rounded-xl text-white font-medium cursor-pointer"
          style={AXIOM.buttons.action}
        >
          Contact Support
        </button>
      </motion.div>

      {isSupportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-2xl p-6 space-y-5"
            style={{
              background: AXIOM.backgrounds.chartContainer,
              border: AXIOM.borders.blue,
              boxShadow: AXIOM.shadows.blue,
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <HelpCircle className="size-5 text-blue-400" />
                Contact HR / IT Support
              </h3>
              <button
                type="button"
                onClick={() => setIsSupportOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitSupport} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white font-mono bg-slate-900/80 border border-slate-700/60 outline-none focus:border-blue-500"
                >
                  <option value="general">General / IT Support</option>
                  <option value="payroll">Payroll & Payslips</option>
                  <option value="expenses">Expense Reimbursement</option>
                  <option value="timesheets">Timesheets & Projects</option>
                  <option value="hr">HR & Department Assignment</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief summary of your question or issue"
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white font-mono bg-slate-900/80 border border-slate-700/60 outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">
                  Message
                </label>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe how your organization admin or HR team can help..."
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white font-mono bg-slate-900/80 border border-slate-700/60 outline-none focus:border-blue-500 resize-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSupportOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl text-sm text-white font-medium flex items-center gap-2 disabled:opacity-60"
                  style={AXIOM.buttons.action}
                >
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Send Request
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
