import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  LayoutDashboard,
  Clock,
  Send,
  AlertOctagon,
  Settings2,
  ExternalLink,
  LogOut,
  Mail,
  Plus,
  Menu,
  X,
  Hash,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ComposeEmailModal } from '../features/emails/ComposeEmailModal';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Fetch Slack status for global badge in header
  const { data: slackData } = useQuery({
    queryKey: ['slackStatus'],
    queryFn: async () => {
      const res = await api.get('/integrations/slack/status');
      return res.data.data;
    },
    staleTime: 30000,
  });

  const navigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Scheduled Emails', href: '/emails/scheduled', icon: Clock },
    { name: 'Sent Emails', href: '/emails/sent', icon: Send },
    { name: 'Failed Emails', href: '/emails/failed', icon: AlertOctagon },
    { name: 'Integrations', href: '/integrations', icon: Settings2 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Compose Modal */}
      <ComposeEmailModal isOpen={isComposeOpen} onClose={() => setIsComposeOpen(false)} />

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-slate-900 border-r border-slate-800 z-30">
        <div className="flex flex-col flex-1 min-h-0">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 h-16 border-b border-slate-800/80">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <span className="text-base font-bold text-white tracking-tight">ReachInbox</span>
              <span className="block text-[10px] text-indigo-400 font-medium -mt-1">Scheduler</span>
            </div>
          </div>

          {/* Quick Action: Compose */}
          <div className="px-4 py-4">
            <Button
              onClick={() => setIsComposeOpen(true)}
              variant="primary"
              className="w-full py-2.5 shadow-indigo-600/30 gap-2 font-medium"
            >
              <Plus className="w-4 h-4" />
              Compose New Email
            </Button>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.name}
                </NavLink>
              );
            })}

            <div className="pt-4 mt-4 border-t border-slate-800">
              <div className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Infrastructure
              </div>
              <a
                href="/admin/queues"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  BullMQ Dashboard
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              </a>
              <a
                href="/api-docs"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" />
                  Swagger / OpenAPI
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              </a>
            </div>
          </nav>

        </div>
      </aside>

      {/* Main content wrapper */}
      <div className="md:pl-64 flex flex-col flex-1 min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200/80 px-4 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h1 className="hidden text-base font-semibold text-slate-800 sm:block">
              Outreach Operations
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Slack integration status indicator */}
            <div
              onClick={() => navigate('/integrations')}
              className="hidden lg:inline-flex cursor-pointer items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-slate-50 transition-colors hover:bg-slate-100"
            >
              <Hash className="w-3.5 h-3.5 text-indigo-600" />
              <span>Slack:</span>
              {slackData?.isConnected ? (
                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Connected ({slackData.integration?.teamName || 'Workspace'})
                </span>
              ) : (
                <span className="text-slate-500">Not Connected</span>
              )}
            </div>

            <Button
              onClick={() => setIsComposeOpen(true)}
              variant="primary"
              size="sm"
              aria-label="Compose New Email"
              title="Compose New Email"
              className="whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compose New Email</span>
            </Button>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-2 sm:pl-4">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name || 'Google account'}
                  className="h-9 w-9 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div
                  aria-label={`${user?.name || user?.email || 'User'} profile`}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
                >
                  {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="max-w-20 truncate text-[11px] font-semibold text-slate-800 sm:max-w-40 sm:text-xs">
                  {user?.name || 'Google User'}
                </p>
                <p className="max-w-20 truncate text-[10px] text-slate-500 sm:max-w-48 sm:text-[11px]">
                  {user?.email}
                </p>
              </div>
              <button
                type="button"
                onClick={logout}
                title="Log out"
                aria-label="Log out"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-rose-600"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-slate-900 border-b border-slate-800 px-4 py-4 space-y-2">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </NavLink>
            ))}
            <Button
              onClick={() => {
                setIsMobileMenuOpen(false);
                setIsComposeOpen(true);
              }}
              variant="primary"
              className="w-full mt-2"
            >
              Compose New Email
            </Button>
          </div>
        )}

        {/* Content Area */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
