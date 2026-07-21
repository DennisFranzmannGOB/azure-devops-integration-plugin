import * as vscode from "vscode";
import { EnrichedPullRequest } from "../api";

jest.mock("../auth", () => ({
  getToken: jest.fn().mockResolvedValue("token"),
  getAuthenticationRequiredMessage: jest
    .fn()
    .mockReturnValue(
      "Not authenticated. Sign in with Azure AD or set a Personal Access Token.",
    ),
}));

jest.mock("../api", () => ({
  updateReviewerVote: jest.fn(),
  completePullRequest: jest.fn(),
  abandonPullRequest: jest.fn(),
  addPullRequestComment: jest.fn(),
  getPullRequestDetails: jest.fn(),
  updatePullRequestTitle: jest.fn(),
}));

jest.mock("../prLinks", () => ({
  buildPullRequestUrl: jest.fn().mockReturnValue("https://example.com"),
}));

const api = jest.requireMock("../api") as {
  abandonPullRequest: jest.Mock;
  updateReviewerVote: jest.Mock;
};

function makePr(overrides: Partial<EnrichedPullRequest> = {}): EnrichedPullRequest {
  return {
    pullRequestId: 42,
    title: "Example PR",
    description: "Current description",
    sourceRefName: "refs/heads/feature/branch",
    createdBy: { displayName: "User", id: "user1" },
    reviewers: [],
    repository: {
      id: "repo1",
      name: "repo",
      project: { id: "proj1", name: "proj" },
    },
    status: "active",
    isDraft: false,
    url: "",
    unresolvedCommentCount: 0,
    commentThreads: [],
    checksStatus: "none",
    checks: [],
    workItems: [],
    ...overrides,
  };
}

function makeItem(pr: EnrichedPullRequest, org = "org") {
  return { pr, org } as any;
}

function makeProvider(cachedUserId: string | undefined) {
  return {
    secretStorage: {},
    cachedUserId,
    refresh: jest.fn(),
  } as any;
}

describe("PR action commands without a cached userId", () => {
  let registerPrActions: typeof import("../commands/prActions").registerPrActions;

  beforeAll(() => {
    ({ registerPrActions } = require("../commands/prActions"));
  });

  beforeEach(() => {
    api.abandonPullRequest.mockReset();
    api.updateReviewerVote.mockReset();
    (vscode.window.showWarningMessage as jest.Mock).mockReset();
    (vscode.window.showErrorMessage as jest.Mock).mockReset();
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
  });

  function getHandler(provider: any, commandId: string) {
    (vscode.commands.registerCommand as jest.Mock).mockClear();
    const context = { subscriptions: { push: jest.fn() } } as any;
    registerPrActions(context, provider);
    const registerCalls = (vscode.commands.registerCommand as jest.Mock).mock
      .calls;
    return registerCalls.find(([cmd]: [string]) => cmd === commandId)![1];
  }

  it("still abandons the PR when cachedUserId is missing", async () => {
    const pr = makePr();
    const provider = makeProvider(undefined);
    const handler = getHandler(provider, "azureDevops.abandonPr");

    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Abandon");

    await handler(makeItem(pr));

    expect(api.abandonPullRequest).toHaveBeenCalledWith(
      "org",
      "proj",
      "repo1",
      42,
      "token",
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(provider.refresh).toHaveBeenCalled();
  });

  it("still blocks voting when cachedUserId is missing", async () => {
    const pr = makePr();
    const provider = makeProvider(undefined);
    const handler = getHandler(provider, "azureDevops.approvePr");

    await handler(makeItem(pr));

    expect(api.updateReviewerVote).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "User ID not available. Try refreshing.",
    );
  });
});
