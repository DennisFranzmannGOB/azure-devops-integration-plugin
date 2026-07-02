import { branchExistsOnRemote } from "../git";

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

jest.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/fake/workspace" } }],
  },
}));

const { execFile } = require("child_process") as { execFile: jest.Mock };

function mockExecFile(stdout: string, error: Error | null = null) {
  execFile.mockImplementation(
    (
      _file: string,
      _args: string[],
      _opts: object,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      cb(error, stdout);
    },
  );
}

describe("branchExistsOnRemote", () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  it("returns true when ls-remote returns non-empty output", async () => {
    mockExecFile(
      "abc123\trefs/heads/my-feature\n",
    );
    const result = await branchExistsOnRemote("my-feature");
    expect(result).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "--heads", "origin", "my-feature"],
      expect.objectContaining({ cwd: "/fake/workspace", windowsHide: true }),
      expect.any(Function),
    );
  });

  it("returns false when ls-remote returns empty output", async () => {
    mockExecFile("");
    const result = await branchExistsOnRemote("my-feature");
    expect(result).toBe(false);
  });

  it("returns false when ls-remote fails (non-zero exit)", async () => {
    mockExecFile("", new Error("git error"));
    const result = await branchExistsOnRemote("my-feature");
    expect(result).toBe(false);
  });

  it("passes unusual branch names as a literal git argument", async () => {
    mockExecFile("");
    const branch = "feature/demo;echo owned";

    await branchExistsOnRemote(branch);

    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "--heads", "origin", branch],
      expect.any(Object),
      expect.any(Function),
    );
  });
});
