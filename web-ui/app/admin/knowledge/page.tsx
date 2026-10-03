"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Database,
  Search,
  FileText,
  Trash2,
  CheckCircle2,
  Loader2,
  Sparkles,
  BookOpen,
  Layers,
} from "lucide-react";

// VEX-006: All knowledge operations now route through authenticated BFF proxy.
const KNOWLEDGE_API = '/api/knowledge';

export default function KnowledgeAdminPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${KNOWLEDGE_API}/documents`);
      const data = await res.json();
      if (data.documents) {
        setDocuments(data.documents);
      }
    } catch (err) {
      console.error("Failed to fetch documents", err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      await fetch(`${KNOWLEDGE_API}/documents/ingest`, {
        method: "POST",
        body: formData,
      });
      fetchDocuments();
      form.reset();
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleTestSearch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!testQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`${KNOWLEDGE_API}/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: testQuery,
        }),
      });
      const data = await res.json();
      setTestResults(data);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      await fetch(`${KNOWLEDGE_API}/documents/${docId}`, {
        method: "DELETE",
      });
      fetchDocuments();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };


  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
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
              <div className="size-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <BookOpen className="size-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Engineering Knowledge Administration</h1>
                <p className="text-xs text-muted-foreground">
                  Ingest GD&T manufacturing handbooks, ISO standards, and inspect neural RAG retrieval rules.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 border border-border text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>FastAPI Engine: Docker-internal</span>
          </div>
        </div>

        {/* 1. Ingest Section */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm relative overflow-hidden">
          <div className="flex items-center gap-2.5 mb-4">
            <Upload className="size-4 text-blue-500" />
            <h2 className="text-base font-bold text-foreground">Ingest Engineering Standard (PDF)</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-6">
            Upload machinery handbooks, DIN/ISO standards, or tolerance charts. The engine automatically chunks pages, extracts GD&T symbols, and embeds semantic vectors.
          </p>

          <form onSubmit={handleUpload} className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
            <input
              type="file"
              name="file"
              accept=".pdf"
              required
              className="block w-full text-xs text-muted-foreground
                file:mr-4 file:py-2.5 file:px-4
                file:rounded-xl file:border-0
                file:text-xs file:font-bold
                file:bg-blue-600/10 file:text-blue-500 dark:file:text-blue-400
                hover:file:bg-blue-600/20 file:transition-colors file:cursor-pointer
                border border-border rounded-xl p-1 bg-muted/30"
            />
            <button
              type="submit"
              disabled={isUploading}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-[0_0_20px_rgba(37,99,235,0.25)] flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Ingesting Document...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Upload & Index
                </>
              )}
            </button>
          </form>
        </div>

        {/* 2. Document Index Table */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <Database className="size-4 text-cyan-500" />
              <h2 className="text-base font-bold text-foreground">Indexed Engineering Documents</h2>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {documents.length} document{documents.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                  <th className="py-3 px-4">Document File</th>
                  <th className="py-3 px-4">Version</th>
                  <th className="py-3 px-4">Pages</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      <FileText className="size-8 mx-auto mb-2 opacity-30" />
                      No technical documents indexed yet. Upload a PDF above to build your engineering knowledge base.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc, idx) => (
                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-medium flex items-center gap-2 text-foreground">
                        <FileText className="size-4 text-blue-400" />
                        {doc.filename}
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">{doc.version || "1.0"}</td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">{doc.pageCount ?? "--"}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          <CheckCircle2 className="size-3" />
                          {doc.status || "Active"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="text-red-400 hover:text-red-300 font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Test Retrieval Sandbox */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <Search className="size-4 text-violet-500" />
            <h2 className="text-base font-bold text-foreground">Test Hybrid Metrology Retrieval</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Test how the AI retrieves engineering rules, tolerance tables, and GD&T standard interpretations for blueprint prompts.
          </p>

          <form onSubmit={handleTestSearch} className="flex gap-3">
            <input
              type="text"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              placeholder="e.g. 'Interpret a thread callout M10x1.5-6g' or 'Groove undercut tolerance'"
              className="flex-1 px-4 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
            />
            <button
              type="submit"
              disabled={isSearching || !testQuery.trim()}
              className="px-6 py-2.5 rounded-xl bg-foreground text-background text-xs font-bold hover:opacity-90 transition-all flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Search Rules
            </button>
          </form>

          {testResults && (
            <div className="mt-4 p-4 bg-muted/40 border border-border rounded-xl overflow-auto max-h-96">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                <Layers className="size-3.5 text-blue-400" />
                Retrieved Engineering Signals & Rule Context
              </div>
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">
                {JSON.stringify(testResults, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

