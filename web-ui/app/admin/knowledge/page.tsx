"use client";

import React, { useState, useEffect } from "react";

export default function KnowledgeAdminPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState<any>(null);

  const fetchDocuments = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/knowledge/documents");
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
      await fetch("http://localhost:8000/api/v1/knowledge/documents/ingest", {
        method: "POST",
        body: formData,
      });
      fetchDocuments();
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleTestSearch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const res = await fetch("http://localhost:8000/api/v1/knowledge/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: testQuery,
          detected_symbols: ["Ø", "M"], // Mocked symbols
          feature_candidates: ["Hole"],
        }),
      });
      const data = await res.json();
      setTestResults(data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Knowledge Base Administration</h1>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
        <h2 className="text-xl font-semibold mb-4">Ingest Document</h2>
        <form onSubmit={handleUpload} className="flex gap-4 items-center">
          <input
            type="file"
            name="file"
            accept=".pdf"
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
          <button
            type="submit"
            disabled={isUploading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isUploading ? "Ingesting..." : "Upload & Parse"}
          </button>
        </form>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
        <h2 className="text-xl font-semibold mb-4">Indexed Documents</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2">Document</th>
              <th className="py-2">Version</th>
              <th className="py-2">Pages</th>
              <th className="py-2">Status</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-500">
                  No documents indexed yet.
                </td>
              </tr>
            ) : (
              documents.map((doc, idx) => (
                <tr key={idx} className="border-b">
                  <td className="py-2">{doc.filename}</td>
                  <td className="py-2">{doc.version}</td>
                  <td className="py-2">{doc.pageCount}</td>
                  <td className="py-2">{doc.status}</td>
                  <td className="py-2">
                    <button className="text-red-600 hover:underline">Delete Index</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Test Hybrid Retrieval</h2>
        <form onSubmit={handleTestSearch} className="flex gap-4 mb-4">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="e.g. 'Interpret a diameter callout'"
            className="flex-1 px-4 py-2 border rounded-md"
          />
          <button type="submit" className="bg-gray-800 text-white px-4 py-2 rounded-md hover:bg-gray-900">
            Search
          </button>
        </form>

        {testResults && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md overflow-auto max-h-96">
            <pre className="text-sm">{JSON.stringify(testResults, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
