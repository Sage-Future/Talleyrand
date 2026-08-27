import React, { FC, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { GraphMetadata } from '../types';
import * as autosaveService from '../services/autosaveService';
import * as shareService from '../services/shareService';
import { generateFilename, saveToFile, loadFromFile, parseCaseFile } from '../utils/fileOperations';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { GRAPH_AUTO_NAMED_EVENT } from '../services/autosaveSubscriptions';
import { iconTooltip } from './ui/TooltipLayer';
import { ShareCaseModal } from './ShareCaseModal';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewGraph: () => void;
  onSettings: () => void;
  onClose: () => void;
  currentGraphId?: string;
  /** The research view renders its own toggle in the frontier header */
  showToggle?: boolean;
}

const SidebarComponent: FC<SidebarProps> = ({
  isOpen,
  onToggle,
  onNewGraph,
  onSettings,
  onClose,
  currentGraphId,
  showToggle = true,
}) => {
  const [graphs, setGraphs] = useState<GraphMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredGraphId, setHoveredGraphId] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  // The case awaiting the owner's go-ahead to go public.
  const [pendingShare, setPendingShare] = useState<GraphMetadata | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      loadGraphs();
    }
  }, [isOpen]);

  // Refresh graph list when the current graph changes (e.g., when a new graph is created)
  useEffect(() => {
    if (isOpen && currentGraphId) {
      loadGraphs();
    }
  }, [currentGraphId]);

  // Refresh graph list when a graph is auto-named
  useEffect(() => {
    const handleAutoNamed = () => {
      if (isOpen) {
        loadGraphs();
      }
    };

    window.addEventListener(GRAPH_AUTO_NAMED_EVENT, handleAutoNamed);
    return () => window.removeEventListener(GRAPH_AUTO_NAMED_EVENT, handleAutoNamed);
  }, [isOpen]);

  const loadGraphs = async () => {
    setIsLoading(true);
    try {
      const graphList = await autosaveService.listUserGraphs();
      setGraphs(graphList);
    } catch (err) {
      console.error('Failed to load graphs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadGraph = (graphId: string, event?: React.MouseEvent) => {
    const url = `/research/${graphId}`;
    if (event?.ctrlKey || event?.metaKey) {
      window.open(url, '_blank');
    } else {
      navigate(url);
      onClose();
    }
  };

  const handleRenameGraph = async (graphId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = window.prompt('Enter new name for the graph:', currentName);

    if (!newName || newName === currentName) {
      return;
    }

    try {
      // Only update the in-memory name if renaming the currently loaded graph
      if (graphId === currentGraphId) {
        useGraphStructureStore.getState().setName(newName);
      }
      await autosaveService.renameGraph(graphId, newName);
      await loadGraphs();
    } catch (err) {
      console.error('Failed to rename graph:', err);
      alert('Failed to rename graph. Please try again.');
    }
  };

  const handleDeleteGraph = async (graphId: string, graphName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Are you sure you want to delete "${graphName}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await autosaveService.deleteGraph(graphId);
      await loadGraphs();
      // If we deleted the current graph, navigate away from it
      if (graphId === currentGraphId) {
        navigate('/research');
      }
    } catch (err) {
      console.error('Failed to delete graph:', err);
      alert('Failed to delete graph. Please try again.');
    }
  };

  const handleExportGraph = async (graphId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Load the full graph data before exporting
      const fullGraph = await autosaveService.loadGraphById(graphId);
      const json = JSON.stringify(fullGraph, null, 2);
      const filename = generateFilename();
      saveToFile(json, filename);
    } catch (err) {
      console.error('Failed to export graph:', err);
      alert('Failed to export graph. Please try again.');
    }
  };

  const handleUploadFromFile = async () => {
    try {
      const json = await loadFromFile();
      const caseData = parseCaseFile(json);
      const newGraphId = await autosaveService.importGraph(caseData);
      // Entering the imported case the normal way binds the URL, the autosave
      // target and the generation stream to its id all at once.
      navigate(`/research/${newGraphId}`);
      onClose();
    } catch (err) {
      console.error('Failed to import case:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to import case: ${message}`);
    }
  };

  const setShared = (graphId: string, shared: boolean) => {
    setGraphs(prev => prev.map(g => (g.id === graphId ? { ...g, shared } : g)));
  };

  const copyShareLink = async (graphId: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/shared/${graphId}`);
    setShareFeedback(graphId);
    setTimeout(() => setShareFeedback(null), 2000);
  };

  // A shared case just re-copies its link; a private one first shows what
  // going public hands over.
  const handleShareGraph = async (graph: GraphMetadata, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!graph.shared) {
      setPendingShare(graph);
      return;
    }
    try {
      await copyShareLink(graph.id);
    } catch {
      alert('Failed to copy the share link. Please try again.');
    }
  };

  const handleConfirmShare = async (graphId: string) => {
    setPendingShare(null);
    try {
      await shareService.shareGraph(graphId);
      setShared(graphId, true);
      await copyShareLink(graphId);
    } catch {
      alert('Failed to share graph. Please try again.');
    }
  };

  const handleRevokeShare = async (graphId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await shareService.revokeShare(graphId);
      setShared(graphId, false);
    } catch {
      alert('Failed to stop sharing. Please try again.');
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 z-50 flex h-full w-64 flex-col border-r border-stone-200 bg-parchment transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <>
          {/* Header — aligns with the frontier panel's h-12 hairline */}
          <div className="flex h-12 flex-shrink-0 items-center border-b border-stone-200 px-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
              Cases
            </span>
          </div>

          <div className="px-3 pb-1 pt-3">
            <button
              onClick={() => {
                onNewGraph();
                onClose();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-stone-900 py-2 font-serif text-[13px] text-stone-50 shadow-sm transition-colors hover:bg-stone-700"
            >
              <svg
                className="icon-optical h-3.5 w-3.5 text-orange-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New case
            </button>
          </div>

          {/* Case list */}
          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="px-4 py-8 text-center font-serif text-xs text-stone-400">
                Loading…
              </div>
            ) : graphs.length === 0 ? (
              <div className="px-4 py-8 text-center font-serif text-xs text-stone-400">
                <p>Nothing here yet.</p>
                <p className="mt-1.5">Open a case and it will be kept here.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {graphs.map(graph => (
                  <div
                    key={graph.id}
                    className={`group relative cursor-pointer rounded-lg border px-3 py-2 transition-all ${
                      graph.id === currentGraphId
                        ? 'border-stone-300 bg-white shadow-[0_1px_4px_rgba(28,25,23,0.06)]'
                        : 'border-transparent hover:bg-white/60'
                    }`}
                    onClick={e => handleLoadGraph(graph.id, e)}
                    onMouseEnter={() => setHoveredGraphId(graph.id)}
                    onMouseLeave={() => setHoveredGraphId(null)}
                    data-tooltip={`${graph.nodeCount} nodes, ${graph.edgeCount} edges`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h3
                          className={`truncate font-serif text-[13px] leading-snug ${
                            graph.id === currentGraphId ? 'text-stone-800' : 'text-stone-600'
                          }`}
                        >
                          {graph.name || 'Untitled case'}
                        </h3>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-400">
                          {graph.createdAt && <span>{formatDate(graph.createdAt)}</span>}
                          {/* A public case says so at rest, not only on hover */}
                          {graph.shared && (
                            <span
                              className="inline-flex items-center gap-0.5 text-orange-700"
                              data-tooltip={
                                graph.documentNames.length > 0
                                  ? `Anyone with the link can read this case and its ${graph.documentNames.length} attached file${graph.documentNames.length === 1 ? '' : 's'}`
                                  : 'Anyone with the link can read this case'
                              }
                            >
                              <svg
                                className="h-2.5 w-2.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-9a13 13 0 000 18m0-18a13 13 0 010 18M3.6 9h16.8M3.6 15h16.8"
                                />
                              </svg>
                              Shared
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons shown on hover */}
                      {hoveredGraphId === graph.id && (
                        <div className="ml-2 flex gap-0.5">
                          {shareFeedback === graph.id ? (
                            <span className="whitespace-nowrap p-1 text-[11px] font-medium text-orange-700">
                              Link copied
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={e => handleShareGraph(graph, e)}
                                className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
                                {...iconTooltip(graph.shared ? 'Copy share link' : 'Share')}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                                  />
                                </svg>
                              </button>
                              {graph.shared && (
                                <button
                                  onClick={e => handleRevokeShare(graph.id, e)}
                                  className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
                                  {...iconTooltip('Stop sharing')}
                                >
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                                    />
                                  </svg>
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={e =>
                              handleRenameGraph(graph.id, graph.name || 'Untitled case', e)
                            }
                            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
                            {...iconTooltip('Rename')}
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={e => handleExportGraph(graph.id, e)}
                            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700"
                            {...iconTooltip('Export')}
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={e =>
                              handleDeleteGraph(graph.id, graph.name || 'Untitled case', e)
                            }
                            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-rose-600"
                            {...iconTooltip('Delete')}
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          <div className="border-t border-stone-200 p-2">
            <div className="flex gap-1">
              <button
                onClick={handleUploadFromFile}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800"
                data-tooltip="Upload case from file"
              >
                <svg
                  className="-translate-y-[0.5px] h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Import
              </button>

              <button
                onClick={onSettings}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800"
                data-tooltip="Settings"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Settings
              </button>
            </div>
          </div>
        </>
      </div>

      {/* Toggle Button */}
      {showToggle && (
        <button
          onClick={onToggle}
          className={`fixed top-4 z-50 p-2 bg-stone-900 text-stone-50 rounded-lg hover:bg-stone-700 transition-all shadow-lg ${
            isOpen ? 'left-[calc(16rem+0.5rem)]' : 'left-2'
          }`}
          {...iconTooltip(isOpen ? 'Close Sidebar' : 'Open Sidebar')}
        >
          <svg
            className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-0' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}

      {pendingShare && (
        <ShareCaseModal
          caseName={pendingShare.name || 'Untitled case'}
          documentNames={pendingShare.documentNames}
          onConfirm={() => handleConfirmShare(pendingShare.id)}
          onClose={() => setPendingShare(null)}
        />
      )}
    </>
  );
};

// Memoize to prevent re-renders when parent re-renders with same props
export const Sidebar = React.memo(SidebarComponent);
