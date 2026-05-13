import { useCallback, useMemo, useRef, useState } from "react";
import {
  createTabEdgeRequest,
  createTabNodeRequest,
  deleteTabEdgeRequest,
  deleteTabNodeRequest,
} from "@/lib/api";
import type { Node, TabEdge, WorkflowNodeType } from "@/types";

type GraphHistoryCommand = {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

type TabGraphStacks = {
  undo: GraphHistoryCommand[];
  redo: GraphHistoryCommand[];
};

type CreateNodeInput = {
  tabId: string;
  nodeType?: WorkflowNodeType;
  roleName?: string;
  name?: string;
  config?: Record<string, unknown>;
};

type CreateLinkedAgentInput = {
  tabId: string;
  anchorNodeId: string;
  roleName: string;
  name?: string;
};

type DeleteNodeInput = {
  tabId: string;
  node: Node;
  edges?: TabEdge[];
};

type InsertAgentBetweenInput = {
  tabId: string;
  sourceNodeId: string;
  targetNodeId: string;
  roleName: string;
  name?: string;
};

function cloneStacks(stacks?: TabGraphStacks): TabGraphStacks {
  return {
    undo: [...(stacks?.undo ?? [])],
    redo: [...(stacks?.redo ?? [])],
  };
}

function normalizeOptionalName(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function useTabGraphHistory() {
  const stacksRef = useRef(new Map<string, TabGraphStacks>());
  const [revision, setRevision] = useState(0);

  const touch = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const pushHistory = useCallback(
    (tabId: string, command: GraphHistoryCommand) => {
      const next = cloneStacks(stacksRef.current.get(tabId));
      next.undo.push(command);
      next.redo = [];
      stacksRef.current.set(tabId, next);
      touch();
    },
    [touch],
  );

  const createStandaloneNode = useCallback(
    async ({
      tabId,
      nodeType = "agent",
      roleName,
      name,
      config,
    }: CreateNodeInput) => {
      const normalizedName = normalizeOptionalName(name);
      const nodeConfig = config ? { ...config } : undefined;
      let currentNodeId = (
        await createTabNodeRequest(tabId, {
          node_type: nodeType,
          role_name: roleName,
          name: normalizedName,
          config: nodeConfig,
        })
      ).id;

      pushHistory(tabId, {
        undo: async () => {
          await deleteTabNodeRequest(tabId, currentNodeId);
        },
        redo: async () => {
          currentNodeId = (
            await createTabNodeRequest(tabId, {
              node_type: nodeType,
              role_name: roleName,
              name: normalizedName,
              config: nodeConfig,
            })
          ).id;
        },
      });

      return currentNodeId;
    },
    [pushHistory],
  );

  const createLinkedAgent = useCallback(
    async ({ tabId, anchorNodeId, roleName, name }: CreateLinkedAgentInput) => {
      const normalizedName = normalizeOptionalName(name);
      let currentNodeId = (
        await createTabNodeRequest(tabId, {
          node_type: "agent",
          role_name: roleName,
          name: normalizedName,
        })
      ).id;

      try {
        await createTabEdgeRequest(tabId, {
          fromNodeId: anchorNodeId,
          toNodeId: currentNodeId,
        });
      } catch (error) {
        await deleteTabNodeRequest(tabId, currentNodeId).catch(() => undefined);
        throw error;
      }

      pushHistory(tabId, {
        undo: async () => {
          await deleteTabNodeRequest(tabId, currentNodeId);
        },
        redo: async () => {
          currentNodeId = (
            await createTabNodeRequest(tabId, {
              node_type: "agent",
              role_name: roleName,
              name: normalizedName,
            })
          ).id;
          await createTabEdgeRequest(tabId, {
            fromNodeId: anchorNodeId,
            toNodeId: currentNodeId,
          });
        },
      });

      return currentNodeId;
    },
    [pushHistory],
  );

  const createConnection = useCallback(
    async (
      tabId: string,
      sourceNodeId: string,
      targetNodeId: string,
      sourcePortKey = "out",
      targetPortKey = "in",
    ) => {
      const edge = await createTabEdgeRequest(tabId, {
        fromNodeId: sourceNodeId,
        fromPortKey: sourcePortKey,
        toNodeId: targetNodeId,
        toPortKey: targetPortKey,
      });

      pushHistory(tabId, {
        undo: async () => {
          await deleteTabEdgeRequest(tabId, { edgeId: edge.id });
        },
        redo: async () => {
          await createTabEdgeRequest(tabId, {
            fromNodeId: sourceNodeId,
            fromPortKey: sourcePortKey,
            toNodeId: targetNodeId,
            toPortKey: targetPortKey,
          });
        },
      });
    },
    [pushHistory],
  );

  const deleteConnection = useCallback(
    async (
      tabId: string,
      sourceNodeId: string,
      targetNodeId: string,
      sourcePortKey = "out",
      targetPortKey = "in",
    ) => {
      await deleteTabEdgeRequest(tabId, {
        fromNodeId: sourceNodeId,
        fromPortKey: sourcePortKey,
        toNodeId: targetNodeId,
        toPortKey: targetPortKey,
      });

      pushHistory(tabId, {
        undo: async () => {
          await createTabEdgeRequest(tabId, {
            fromNodeId: sourceNodeId,
            fromPortKey: sourcePortKey,
            toNodeId: targetNodeId,
            toPortKey: targetPortKey,
          });
        },
        redo: async () => {
          await deleteTabEdgeRequest(tabId, {
            fromNodeId: sourceNodeId,
            fromPortKey: sourcePortKey,
            toNodeId: targetNodeId,
            toPortKey: targetPortKey,
          });
        },
      });
    },
    [pushHistory],
  );

  const deleteNode = useCallback(
    async ({ tabId, node, edges = [] }: DeleteNodeInput) => {
      const relatedEdges = edges.filter(
        (edge) => edge.from_node_id === node.id || edge.to_node_id === node.id,
      );
      const nodeConfig =
        node.config && typeof node.config === "object"
          ? { ...node.config }
          : undefined;
      const fallbackConfig =
        !nodeConfig && node.node_type !== "agent" && node.name
          ? { name: node.name }
          : undefined;
      const createConfig = nodeConfig ?? fallbackConfig;
      const connectedNodeIds = relatedEdges.length
        ? []
        : Array.from(
            new Set(
              [...node.connections].filter((targetId) => targetId !== node.id),
            ),
          );
      const recreateRelatedEdges = async (nextNodeId: string) => {
        for (const edge of relatedEdges) {
          await createTabEdgeRequest(tabId, {
            fromNodeId:
              edge.from_node_id === node.id ? nextNodeId : edge.from_node_id,
            fromPortKey: edge.from_port_key,
            toNodeId:
              edge.to_node_id === node.id ? nextNodeId : edge.to_node_id,
            toPortKey: edge.to_port_key,
          });
        }
        for (const connectedNodeId of connectedNodeIds) {
          await createTabEdgeRequest(tabId, {
            fromNodeId: connectedNodeId,
            toNodeId: nextNodeId,
          });
        }
      };
      const nodeType = (
        node.node_type === "assistant" ? "agent" : node.node_type
      ) as WorkflowNodeType;
      const isAgentNode = nodeType === "agent";
      const normalizedName = normalizeOptionalName(
        isAgentNode ? node.name : undefined,
      );
      const roleName = node.role_name?.trim() ?? "";
      let currentNodeId = node.id;

      await deleteTabNodeRequest(tabId, currentNodeId);

      pushHistory(tabId, {
        undo: async () => {
          currentNodeId = (
            await createTabNodeRequest(tabId, {
              node_type: nodeType,
              role_name: isAgentNode ? roleName || undefined : undefined,
              name: normalizedName,
              config: createConfig,
            })
          ).id;
          await recreateRelatedEdges(currentNodeId);
        },
        redo: async () => {
          await deleteTabNodeRequest(tabId, currentNodeId);
        },
      });
    },
    [pushHistory],
  );

  const insertAgentBetween = useCallback(
    async ({
      tabId,
      sourceNodeId,
      targetNodeId,
      roleName,
      name,
    }: InsertAgentBetweenInput) => {
      const normalizedName = normalizeOptionalName(name);
      let currentNodeId: string | null = null;

      await deleteTabEdgeRequest(tabId, {
        fromNodeId: sourceNodeId,
        toNodeId: targetNodeId,
      });
      try {
        currentNodeId = (
          await createTabNodeRequest(tabId, {
            node_type: "agent",
            role_name: roleName,
            name: normalizedName,
          })
        ).id;
        await createTabEdgeRequest(tabId, {
          fromNodeId: sourceNodeId,
          toNodeId: currentNodeId,
        });
        await createTabEdgeRequest(tabId, {
          fromNodeId: currentNodeId,
          toNodeId: targetNodeId,
        });
      } catch (error) {
        if (currentNodeId) {
          await deleteTabNodeRequest(tabId, currentNodeId).catch(
            () => undefined,
          );
        }
        await createTabEdgeRequest(tabId, {
          fromNodeId: sourceNodeId,
          toNodeId: targetNodeId,
        }).catch(() => undefined);
        throw error;
      }

      pushHistory(tabId, {
        undo: async () => {
          if (!currentNodeId) {
            return;
          }
          await deleteTabNodeRequest(tabId, currentNodeId);
          await createTabEdgeRequest(tabId, {
            fromNodeId: sourceNodeId,
            toNodeId: targetNodeId,
          });
        },
        redo: async () => {
          await deleteTabEdgeRequest(tabId, {
            fromNodeId: sourceNodeId,
            toNodeId: targetNodeId,
          });
          currentNodeId = (
            await createTabNodeRequest(tabId, {
              node_type: "agent",
              role_name: roleName,
              name: normalizedName,
            })
          ).id;
          await createTabEdgeRequest(tabId, {
            fromNodeId: sourceNodeId,
            toNodeId: currentNodeId,
          });
          await createTabEdgeRequest(tabId, {
            fromNodeId: currentNodeId,
            toNodeId: targetNodeId,
          });
        },
      });

      return currentNodeId;
    },
    [pushHistory],
  );

  const canUndo = useCallback(
    (tabId: string | null) =>
      Boolean(tabId && (stacksRef.current.get(tabId)?.undo.length ?? 0) > 0),
    [],
  );

  const canRedo = useCallback(
    (tabId: string | null) =>
      Boolean(tabId && (stacksRef.current.get(tabId)?.redo.length ?? 0) > 0),
    [],
  );

  const undo = useCallback(
    async (tabId: string | null) => {
      if (!tabId) {
        return false;
      }
      const current = cloneStacks(stacksRef.current.get(tabId));
      const command = current.undo.pop();
      if (!command) {
        return false;
      }

      await command.undo();
      current.redo.push(command);
      stacksRef.current.set(tabId, current);
      touch();
      return true;
    },
    [touch],
  );

  const redo = useCallback(
    async (tabId: string | null) => {
      if (!tabId) {
        return false;
      }
      const current = cloneStacks(stacksRef.current.get(tabId));
      const command = current.redo.pop();
      if (!command) {
        return false;
      }

      await command.redo();
      current.undo.push(command);
      stacksRef.current.set(tabId, current);
      touch();
      return true;
    },
    [touch],
  );

  return useMemo(
    () => ({
      canRedo,
      canUndo,
      createConnection,
      createLinkedAgent,
      createStandaloneAgent: (input: {
        tabId: string;
        roleName: string;
        name?: string;
      }) =>
        createStandaloneNode({
          tabId: input.tabId,
          nodeType: "agent",
          roleName: input.roleName,
          name: input.name,
        }),
      createStandaloneNode,
      deleteAgent: deleteNode,
      deleteConnection,
      insertAgentBetween,
      redo,
      revision,
      undo,
    }),
    [
      canRedo,
      canUndo,
      createConnection,
      createLinkedAgent,
      createStandaloneNode,
      deleteConnection,
      deleteNode,
      insertAgentBetween,
      redo,
      revision,
      undo,
    ],
  );
}
