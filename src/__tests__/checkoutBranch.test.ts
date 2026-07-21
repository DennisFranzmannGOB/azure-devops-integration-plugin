import * as vscode from "vscode";
import { checkoutPrBranch } from "../commands/checkoutBranch";

jest.mock("child_process", () => ({
    execFile: jest.fn(),
}));

jest.mock("vscode");

const { execFile } = require("child_process") as { execFile: jest.Mock };

function mockExecFileSuccess() {
    execFile.mockImplementation(
        (
            _file: string,
            _args: string[],
            _opts: object,
            cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
            cb(null, "ok", "");
        },
    );
}

describe("checkoutPrBranch", () => {
    beforeEach(() => {
        execFile.mockReset();
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
        (vscode.window.showInformationMessage as jest.Mock).mockReset();
        (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) => await task());
        (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/workspace" } }];
    });

    it("checks out an existing local branch without fetching from the remote", async () => {
        mockExecFileSuccess();

        const result = await checkoutPrBranch({
            pr: { sourceRefName: "refs/heads/feature/my-branch" },
        } as any);

        expect(result).toBe(true);
        expect(execFile).toHaveBeenNthCalledWith(
            1,
            "git",
            ["checkout", "feature/my-branch"],
            expect.objectContaining({ cwd: "/workspace", windowsHide: true }),
            expect.any(Function),
        );
        expect(execFile).toHaveBeenCalledTimes(1);
    });

    it("fetches and retries when the branch is not available locally", async () => {
        execFile
            .mockImplementationOnce((
                _file: string,
                _args: string[],
                _opts: object,
                cb: (error: Error | null, stdout: string, stderr: string) => void,
            ) => cb(new Error("branch is missing"), "", "branch is missing"))
            .mockImplementationOnce((
                _file: string,
                _args: string[],
                _opts: object,
                cb: (error: Error | null, stdout: string, stderr: string) => void,
            ) => cb(null, "ok", ""))
            .mockImplementationOnce((
                _file: string,
                _args: string[],
                _opts: object,
                cb: (error: Error | null, stdout: string, stderr: string) => void,
            ) => cb(null, "ok", ""));

        const result = await checkoutPrBranch({
            pr: { sourceRefName: "refs/heads/feature/my-branch" },
        } as any);

        expect(result).toBe(true);
        expect(execFile).toHaveBeenNthCalledWith(1, "git", ["checkout", "feature/my-branch"], expect.any(Object), expect.any(Function));
        expect(execFile).toHaveBeenNthCalledWith(2, "git", ["fetch", "origin"], expect.any(Object), expect.any(Function));
        expect(execFile).toHaveBeenNthCalledWith(3, "git", ["checkout", "feature/my-branch"], expect.any(Object), expect.any(Function));
    });

    it("checks out the branch in the workspace repository that owns the pull request", async () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: "/workspace/other-repository" } },
            { uri: { fsPath: "/workspace/reviewed-repository" } },
        ];
        execFile.mockImplementation((
            _file: string,
            args: string[],
            options: { cwd: string },
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
            if (args.join(" ") === "remote get-url origin") {
                const repository = options.cwd.endsWith("reviewed-repository")
                    ? "reviewed-repository"
                    : "other-repository";
                callback(null, `https://dev.azure.com/org/project/_git/${repository}`, "");
                return;
            }
            callback(null, "ok", "");
        });

        const result = await checkoutPrBranch({
            org: "org",
            pr: {
                sourceRefName: "refs/heads/feature/my-branch",
                repository: {
                    id: "reviewed-repository-id",
                    name: "reviewed-repository",
                    project: { id: "project-id", name: "project" },
                },
            },
        } as any);

        expect(result).toBe(true);
        expect(execFile).toHaveBeenCalledWith(
            "git",
            ["checkout", "feature/my-branch"],
            expect.objectContaining({ cwd: "/workspace/reviewed-repository" }),
            expect.any(Function),
        );
    });

    it("does not checkout in another repository when the pull request repository is not open", async () => {
        execFile.mockImplementation((
            _file: string,
            args: string[],
            _options: object,
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
            if (args.join(" ") === "remote get-url origin") {
                callback(null, "https://dev.azure.com/org/project/_git/other-repository", "");
                return;
            }
            callback(null, "ok", "");
        });

        const result = await checkoutPrBranch({
            org: "org",
            pr: {
                sourceRefName: "refs/heads/feature/my-branch",
                repository: {
                    id: "reviewed-repository-id",
                    name: "reviewed-repository",
                    project: { id: "project-id", name: "project" },
                },
            },
        } as any);

        expect(result).toBe(false);
        expect(execFile).not.toHaveBeenCalledWith(
            "git",
            expect.arrayContaining(["checkout"]),
            expect.anything(),
            expect.anything(),
        );
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'No open workspace folder matches the pull request repository "reviewed-repository".',
        );
    });

    it("passes a suspicious-looking branch name as a literal argument", async () => {
        mockExecFileSuccess();
        const branch = "feature/demo;echo owned";

        await checkoutPrBranch({
            pr: { sourceRefName: `refs/heads/${branch}` },
        } as any);

        expect(execFile).toHaveBeenNthCalledWith(
            1,
            "git",
            ["checkout", branch],
            expect.any(Object),
            expect.any(Function),
        );
    });
});
