import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import {
  Hash,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  BellRing,
  Search,
  Mail,
  Zap,
} from 'lucide-react';

export const IntegrationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [testResult, setTestResult] = useState<{ status: 'success' | 'warning'; message: string } | null>(null);

  // Fetch Slack integration status
  const { data: slackData, isLoading } = useQuery({
    queryKey: ['slackStatus'],
    queryFn: async () => {
      const res = await api.get('/integrations/slack/status');
      return res.data.data;
    },
  });

  // Disconnect Slack mutation
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      return api.post('/integrations/slack/disconnect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slackStatus'] });
      setTestResult(null);
    },
  });

  // Test Slack notification mutation
  const testSlackMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/integrations/slack/test');
      return res.data;
    },
    onSuccess: (res) => {
      setTestResult({
        status: res.status,
        message: res.message,
      });
    },
    onError: (err: any) => {
      setTestResult({
        status: 'warning',
        message: err.message || 'Failed to dispatch Slack test alert',
      });
    },
  });

  const handleConnectSlack = () => {
    window.location.href = '/api/integrations/slack/authorize';
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Platform Integrations</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage third-party connections for authentication, real-time alert notifications, and storage
        </p>
      </div>

      {testResult && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            testResult.status === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {testResult.status === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
          <button
            onClick={() => setTestResult(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Slack Integration Card */}
        <Card
          title="Slack Notifications"
          subtitle="Real-time alert delivery when hourly sending quotas are reached"
        >
          {isLoading ? (
            <Spinner />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-100">
                    <Hash className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Slack Workspace</h4>
                    <p className="text-xs text-slate-400">
                      {slackData?.isConnected
                        ? `Connected to ${slackData.integration?.teamName || 'Workspace'}`
                        : 'Disconnected'}
                    </p>
                  </div>
                </div>

                {slackData?.isConnected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                    Not Connected
                  </span>
                )}
              </div>

              {slackData?.isConnected ? (
                <div className="space-y-3 pt-2">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs space-y-1.5 text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Target Channel:</span>
                      <span className="font-semibold text-slate-800">
                        {slackData.integration?.channelName ? `#${slackData.integration.channelName}` : 'Incoming Webhook Target'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Rate-Limit Alert Policy:</span>
                      <span className="font-medium text-slate-700">Deduplicated Block Kit Notification</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => testSlackMutation.mutate()}
                      isLoading={testSlackMutation.isPending}
                      className="text-xs gap-1.5"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      Send Test Alert
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => disconnectMutation.mutate()}
                      isLoading={disconnectMutation.isPending}
                      className="text-xs text-rose-600 hover:bg-rose-50 border-rose-200"
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="pt-2 space-y-3">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Connect your Slack workspace using OAuth 2.0. When an outreach sender reaches its configured hourly limit, an alert will be automatically published to your team channel.
                  </p>

                  <Button
                    onClick={handleConnectSlack}
                    variant="primary"
                    size="sm"
                    className="w-full gap-2 bg-[#4A154B] hover:bg-[#3f1240] text-white"
                  >
                    <Hash className="w-4 h-4" />
                    Connect Slack Workspace
                  </Button>

                  {!slackData?.isConfigured && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2.5 border border-amber-200">
                      Configure <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> in <code>.env</code> to enable OAuth redirect.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Google OAuth Card */}
        <Card
          title="Google OAuth 2.0"
          subtitle="Single Sign-On authentication and session identity"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center border border-blue-100">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Google SSO</h4>
                  <p className="text-xs text-slate-400">
                    {user?.googleId ? 'Authenticated via Google' : 'Local Developer Session'}
                  </p>
                </div>
              </div>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Active Session
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Current User:</span>
                <span className="font-semibold text-slate-800">{user?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="font-semibold text-slate-800">{user?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cookie Type:</span>
                <span className="font-mono text-slate-700">HttpOnly / SameSite Lax</span>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              OAuth Callback URL: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">https://outbox-assingment-cqpz.vercel.app/api/auth/google/callback</code>
            </p>
          </div>
        </Card>

        {/* Ethereal Fake SMTP Card */}
        <Card
          title="Ethereal SMTP Delivery"
          subtitle="Isolated SMTP sandbox for deterministic local email testing"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-100">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Ethereal Email Engine</h4>
                <p className="text-xs text-slate-400">smtp.ethereal.email (Port 587)</p>
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Emails scheduled in this environment are transmitted to Ethereal SMTP test inboxes. Every delivered message generates a verified web preview URL viewable directly in your browser.
            </p>

            <div className="p-2.5 bg-indigo-50/50 rounded-lg border border-indigo-100 text-xs text-indigo-900">
              Preview links are captured in delivery logs and displayed under &quot;Sent Emails&quot;.
            </div>
          </div>
        </Card>

        {/* Elasticsearch Card */}
        <Card
          title="Elasticsearch Cluster"
          subtitle="Search indexing engine with PostgreSQL source of truth"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Search Index</h4>
                <p className="text-xs text-slate-400">reachinbox-emails (Port 9200)</p>
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Indices mirror authoritative PostgreSQL email records. If Elasticsearch experiences intermittent downtime, search queries automatically fall back to PostgreSQL database indexes.
            </p>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              Multi-tenant isolated with strict <code>userId</code> term filtering.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
