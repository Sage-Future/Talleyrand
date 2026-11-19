import React, { FC, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { GraphMetadata } from '../types';
import * as autosaveService from '../services/autosaveService';
import { generateFilename, saveToFile, loadFromFile, parseCaseFile } from '../utils/fileOperations';
import { useGraphStructureStore } from '../stores/graphStructureStore';
import { GRAPH_AUTO_NAMED_EVENT, cancelPendingAutosave } from '../services/autosaveSubscriptions';
import { iconTooltip } from './ui/TooltipLayer';

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

    const isOpenCase = graphId === currentGraphId;
    try {
      // A debounced autosave still holding the case would recreate it the
      // moment it fires — and navigating away flushes it rather than dropping
      // it. Cancel it before the delete, then close the case as soon as the
      // delete lands, which cancels again and empties the stores so nothing
      // left on screen can save itself back.
      if (isOpenCase) {
        cancelPendingAutosave();
      }
      await autosaveService.deleteGraph(graphId);
      if (isOpenCase) {
        useGraphStructureStore.getState().closeGraph();
      }
      await loadGraphs();
      // If we deleted the current graph, navigate away from it
      if (isOpenCase) {
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
                        </div>
                      </div>

                      {/* Action buttons shown on hover */}
                      {hoveredGraphId === graph.id && (
                        <div className="ml-2 flex gap-0.5">
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
    </>
  );
};

// Memoize to prevent re-renders when parent re-renders with same props
export const Sidebar = React.memo(SidebarComponent);
