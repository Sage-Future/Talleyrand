import { client } from '../client';

export async function generateGraphName(graphId: string): Promise<string | null> {
  const { data, error } = await client.POST('/graph/{graph_id}/generate-name', {
    params: { path: { graph_id: graphId } },
  });

  if (error) {
    console.error('Failed to generate graph name:', error);
    return null;
  }

  // Endpoint returns an untyped dict in the OpenAPI schema
  return (data as { name?: string } | undefined)?.name ?? null;
}
