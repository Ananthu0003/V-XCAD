"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  KeyRound,
} from "lucide-react";

const ADMIN_API = "/api/admin/password-reset-requests";

interface ResetRequest {
  id: string;
  userId: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
  user: { email: string; name: string };
}

export default function PasswordResetRequestsPage() {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${ADMIN_API}?status=pending`);
        if (res.status === 403) {
          window.location.href = "/workspace";
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setRequests(data.requests || []);
        }
      } catch (err) {
        console.error("Failed to fetch requests", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      const res = await fetch(`${ADMIN_API}/${id}/approve`, { method: "POST" });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (err) {
      console.error("Approve error:", err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    try {
      const res = await fetch(`${ADMIN_API}/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setShowRejectModal(null);
        setRejectReason("");
      }
    } catch (err) {
      console.error("Reject error:", err);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
          <div className="space-y-1">
            <Link
              href="/workspace"
              className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2 group"
            >
              <ArrowLeft className="size-3.5 group-hover:-translate-x-1 transition-transform" />
              Back to Tactical Workspace
            </Link>
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Password Reset Requests</h1>
                <p className="text-xs text-muted-foreground">
                  Review and approve user password reset requests.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 border border-border text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-amber-500" />
            <span>{requests.length} pending request{requests.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Requests Table */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <Shield className="size-4 text-amber-500" />
            <h2 className="text-base font-bold text-foreground">Pending Approvals</h2>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Requested</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-muted-foreground">
                      <Clock className="size-8 mx-auto mb-2 opacity-30" />
                      No pending password reset requests.
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">{req.user.name}</div>
                        <div className="text-muted-foreground">{req.user.email}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        {new Date(req.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleApprove(req.id)}
                            disabled={processingId === req.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            {processingId === req.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3.5" />
                            )}
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setShowRejectModal(req.id);
                              setRejectReason("");
                            }}
                            disabled={processingId === req.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-all text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="size-3.5" />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Reject Reason Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex items-center gap-2.5 mb-4">
                <AlertTriangle className="size-4 text-red-500" />
                <h3 className="text-base font-bold text-foreground">Reject Request</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Provide an optional reason for rejecting this password reset request.
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-3 py-2 rounded-xl bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500/50 transition-all resize-none h-20 mb-4"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowRejectModal(null);
                    setRejectReason("");
                  }}
                  className="px-4 py-2 rounded-xl bg-muted/40 text-foreground text-xs font-bold hover:bg-muted/60 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReject(showRejectModal)}
                  disabled={processingId === showRejectModal}
                  className="px-4 py-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {processingId === showRejectModal && (
                    <Loader2 className="size-3 animate-spin" />
                  )}
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
