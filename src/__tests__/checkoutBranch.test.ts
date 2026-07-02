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

    it("checks out a branch using execFile argument arrays", async () => {
        mockExecFileSuccess();

        const result = await checkoutPrBranch({
            pr: { sourceRefName: "refs/heads/feature/my-branch" },
        } as any);

        expect(result).toBe(true);
        expect(execFile).toHaveBeenNthCalledWith(
            1,
            "git",
            ["fetch", "origin"],
            expect.objectContaining({ cwd: "/workspace", windowsHide: true }),
            expect.any(Function),
        );
        expect(execFile).toHaveBeenNthCalledWith(
            2,
            "git",
            ["checkout", "feature/my-branch"],
            expect.objectContaining({ cwd: "/workspace", windowsHide: true }),
            expect.any(Function),
        );
    });

    it("passes a suspicious-looking branch name as a literal argument", async () => {
        mockExecFileSuccess();
        const branch = "feature/demo;echo owned";

        await checkoutPrBranch({
            pr: { sourceRefName: `refs/heads/${branch}` },
        } as any);

        expect(execFile).toHaveBeenNthCalledWith(
            2,
            "git",
            ["checkout", branch],
            expect.any(Object),
            expect.any(Function),
        );
    });
});