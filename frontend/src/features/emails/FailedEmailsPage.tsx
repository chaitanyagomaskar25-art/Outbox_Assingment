import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ScheduledEmail } from '../../types';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { EmailDetailModal } from './EmailDetailModal';
import { format } from 'date-fns';
import {
  Search,
  AlertOctagon,
  RotateCcw,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';

export const FailedEmailsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<ScheduledEmail | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['emails', 'FAILED', page, searchTerm],
    queryFn: async () => {
      const res = await api.get(searchTerm.trim() ? '/emails/search' : '/emails', {
        params: {
          status: 'FAILED',
          page,
          limit: 15,
          ...(searchTerm.trim() ? { q: searchTerm.trim() } : {}),
        },
      });
      return res.data.data;
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.post(`/emails/${id}/retry`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });

  const emails: ScheduledEmail[] = data?.emails || [];
  const totalPages: number = data?.totalPages || 1;
  const totalCount: number = data?.total || 0;

  return (
    <div className="space-y-6">
      {selectedEmail && (
        <EmailDetailModal
          email={selectedEmail}
          isOpen={Boolean(selectedEmail)}
          onClose={() => setSelectedEmail(null)}
        />
      )}

      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Failed Deliveries</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Diagnose delivery rejections, review sanitized failure reasons, and trigger retries
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search recipient or subject..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            isLoading={isRefetching}
            className="text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Table Card */}
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center">
            <Spinner size="lg" />
            <p className="mt-3 text-xs text-slate-500">Loading delivery failure reports...</p>
          </div>
        ) : isError ? (
          <div className="py-12 text-center">
            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800">Error loading failed emails</p>
            <Button onClick={() => refetch()} variant="outline" size="sm" className="mt-3">
              Retry
            </Button>
          </div>
        ) : emails.length === 0 ? (
          <div className="py-16 text-center">
            <AlertOctagon className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-700">No failed emails recorded</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              All processed emails have been delivered without terminal SMTP transmission errors.
            </p>
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-6 font-semibold">Recipient</th>
                    <th className="py-3 px-6 font-semibold">Subject</th>
                    <th className="py-3 px-6 font-semibold">Failure Reason</th>
                    <th className="py-3 px-6 font-semibold">Attempts</th>
                    <th className="py-3 px-6 font-semibold">Failed At</th>
                    <th className="py-3 px-6 font-semibold">Status</th>
                    <th className="py-3 px-6 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {emails.map((email) => (
                    <tr key={email.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-6 font-medium text-slate-900">{email.recipientEmail}</td>
                      <td className="py-3 px-6 text-slate-600 max-w-[180px] truncate">
                        {email.subject}
                      </td>
                      <td className="py-3 px-6 text-rose-600 max-w-[220px] truncate font-mono text-[11px]">
                        {email.errorDetails || 'Temporary delivery rejection'}
                      </td>
                      <td className="py-3 px-6 text-slate-500">
                        {email.attemptCount} / {email.maxAttempts}
                      </td>
                      <td className="py-3 px-6 text-slate-500">
                        {email.failedAt
                          ? format(new Date(email.failedAt), 'MMM d, h:mm a')
                          : 'Recorded'}
                      </td>
                      <td className="py-3 px-6">
                        <Badge status={email.status} size="sm" />
                      </td>
                      <td className="py-3 px-6 text-right space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEmail(email)}
                          className="text-xs py-1 px-2"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => retryMutation.mutate(email.id)}
                          isLoading={retryMutation.isPending}
                          className="text-xs py-1 px-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry Send
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
              <span>Showing {emails.length} of {totalCount} failed records</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="py-1 px-2.5"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </Button>
                <span>Page {page} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="py-1 px-2.5"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
