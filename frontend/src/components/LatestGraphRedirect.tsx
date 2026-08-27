import { FC, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { listUserGraphs, createNewGraph } from '../services/autosaveService';
import { ResearchPage } from './research/ResearchPage';

export const LatestGraphRedirect: FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const hasRunRef = useRef(false);

  useEffect(() => {
    // Prevent running twice in StrictMode
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;

    const loadLatestGraph = async () => {
      try {
        const graphs = await listUserGraphs();

        if (graphs.length > 0) {
          // Backend returns graphs sorted by created_at descending, so first one is newest
          const latestGraph = graphs[0];
          navigate(`/research/${latestGraph.id}`, { replace: true });
        } else {
          // No graphs exist, create a new one
          const newGraphId = await createNewGraph();
          navigate(`/research/${newGraphId}`, { replace: true });
        }
      } catch (error) {
        console.error('Failed to load latest graph:', error);
        // On error, render the fallback page without a graph id
        setIsLoading(false);
      }
    };

    loadLatestGraph();
  }, [navigate]);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontSize: '18px',
          color: '#666',
        }}
      >
        Loading...
      </div>
    );
  }

  return <ResearchPage />;
};
