export type Viewer = {
  isOwner: boolean;
  isWorkspaceViewer: boolean;
  canClaimOwner: boolean;
  canClaimWorkspaceViewer: boolean;
};

export type OwnedArtifact = {
  id: string;
  slug: string;
  title: string;
  ownerId: string;
  ownerEmail: string;
  sharedWith: string[];
  sharedDomains: string[];
  isPublic: boolean;
  expiresAt: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  workspaceViewerCount: number;
};

export type ViewedArtifact = {
  id: string;
  slug: string;
  title: string;
  html: string;
  sizeBytes: number;
  updatedAt: string;
  expiresAt: string | null;
  isPublic: boolean;
  canManage: boolean;
  ownerEmails: string[];
  workspaceViewerEmails: string[];
  sharedWith: string[];
  sharedDomains: string[];
};

export type PublishInput = {
  artifactId?: string;
  title: string;
  slug: string;
  html: string;
  sharedWith?: string[];
  sharedDomains?: string[];
  isPublic?: boolean;
  expiresInSeconds?: number | null;
};

export type ArtifactAccess = {
  emails: string[];
  domains: string[];
  isPublic: boolean;
};

export type ArtifactAccessResult =
  | { status: "accepted" }
  | { status: "expired"; expiredAt: string }
  | { status: "unavailable" };

export type PublishResult = {
  id: string;
  slug: string;
  expiresAt: string | null;
  isPublic: boolean;
};

export type PublishResponse = PublishResult & {
  updated: boolean;
};

export type ApiError = {
  error: string;
};
