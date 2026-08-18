import { useEffect, useMemo, useState } from "react";
import type {
  ArtifactAccess,
  ArtifactAccessResult,
  OwnedArtifact,
  PublishInput,
  PublishResult,
  ViewedArtifact,
  Viewer
} from "../shared/api";

type QueryMap = {
  viewer: { args: []; result: Viewer };
  ownedArtifacts: { args: []; result: OwnedArtifact[] };
  artifactBySlug: { args: [slug: string]; result: ViewedArtifact | null };
};

type MutationMap = {
  claimOwnerAccess: { args: []; result: { claimed: boolean } };
  claimWorkspaceViewerAccess: { args: []; result: { claimed: boolean } };
  acceptArtifactAccess: {
    args: [slug: string];
    result: ArtifactAccessResult;
  };
  publishArtifact: { args: [input: PublishInput]; result: PublishResult };
  setArtifactExpiration: {
    args: [artifactId: string, expiresInSeconds: number | null];
    result: { expiresAt: string | null };
  };
  pruneExpiredArtifacts: { args: []; result: { removed: number } };
  setArtifactAccess: {
    args: [artifactId: string, access: ArtifactAccess];
    result: ArtifactAccess;
  };
  deleteArtifact: { args: [artifactId: string]; result: void };
};

type QueryName = keyof QueryMap;
type MutationName = keyof MutationMap;
type QueryArgs<Name extends QueryName> = QueryMap[Name]["args"];
type QueryResult<Name extends QueryName> = QueryMap[Name]["result"];
type MutationArgs<Name extends MutationName> = MutationMap[Name]["args"];
type MutationResult<Name extends MutationName> = MutationMap[Name]["result"];

const listeners = new Set<() => void>();
let revision = 0;

function invalidateQueries(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function useRevision(): number {
  const [value, setValue] = useState(revision);
  useEffect(() => {
    const update = () => setValue(revision);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}

async function request<Result>(path: string, init?: RequestInit): Promise<Result> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const message = contentType.includes("application/json")
      ? ((await response.json()) as { error?: string }).error
      : await response.text();
    throw new Error(message || `Request failed with HTTP ${response.status}.`);
  }
  if (response.status === 204) return undefined as Result;
  return response.json<Result>();
}

function queryRequest<Name extends QueryName>(
  name: Name,
  args: QueryArgs<Name>
): Promise<QueryResult<Name>> {
  if (name === "viewer") {
    return request("/api/app/viewer") as Promise<QueryResult<Name>>;
  }
  if (name === "ownedArtifacts") {
    return request("/api/app/artifacts") as Promise<QueryResult<Name>>;
  }
  const [slug] = args as QueryArgs<"artifactBySlug">;
  return request(
    `/api/app/artifacts/${encodeURIComponent(slug)}`
  ) as Promise<QueryResult<Name>>;
}

const mutations: {
  [Name in MutationName]: (
    ...args: MutationArgs<Name>
  ) => Promise<MutationResult<Name>>;
} = {
  claimOwnerAccess: () =>
    request("/api/app/access/claim-owner", { method: "POST" }),
  claimWorkspaceViewerAccess: () =>
    request("/api/app/access/claim-workspace-viewer", { method: "POST" }),
  acceptArtifactAccess: (slug) =>
    request(`/api/app/artifacts/${encodeURIComponent(slug)}/access/accept`, {
      method: "POST"
    }),
  publishArtifact: (input) =>
    request("/api/app/artifacts", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  setArtifactExpiration: (artifactId, expiresInSeconds) =>
    request(`/api/app/artifacts/${encodeURIComponent(artifactId)}/expiration`, {
      method: "PATCH",
      body: JSON.stringify({ expiresInSeconds })
    }),
  pruneExpiredArtifacts: () =>
    request("/api/app/artifacts/prune", { method: "POST" }),
  setArtifactAccess: (artifactId, access) =>
    request(`/api/app/artifacts/${encodeURIComponent(artifactId)}/access`, {
      method: "PUT",
      body: JSON.stringify(access)
    }),
  deleteArtifact: (artifactId) =>
    request(`/api/app/artifacts/${encodeURIComponent(artifactId)}`, {
      method: "DELETE"
    })
};

export const client = {
  useQuery<Name extends QueryName>(
    name: Name,
    ...args: QueryArgs<Name>
  ): QueryResult<Name> | undefined {
    const currentRevision = useRevision();
    const key = JSON.stringify(args);
    const stableArgs = useMemo(() => args, [key]);
    const [result, setResult] = useState<QueryResult<Name>>();

    useEffect(() => {
      let active = true;
      void queryRequest(name, stableArgs)
        .then((value) => {
          if (active) setResult(value);
        })
        .catch(() => {
          if (active) setResult(undefined);
        });
      return () => {
        active = false;
      };
    }, [name, key, currentRevision]);

    return result;
  },

  useMutation<Name extends MutationName>(
    name: Name
  ): (...args: MutationArgs<Name>) => Promise<MutationResult<Name>> {
    return useMemo(
      () => async (...args: MutationArgs<Name>) => {
        const result = await mutations[name](...args);
        invalidateQueries();
        return result;
      },
      [name]
    );
  }
};
