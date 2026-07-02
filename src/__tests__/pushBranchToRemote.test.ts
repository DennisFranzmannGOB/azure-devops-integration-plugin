import { pushBranchToRemote } from "../git";

jest.mock("child_process", () => ({
    execFile: jest.fn(),
}));

jest.mock("vscode", () => ({
    workspace: {
        workspaceFolders: [{ uri: { fsPath: "/fake/workspace" } }],
    },
}));

const { execFile } = require("child_process") as { execFile: jest.Mock };

function mockExecFile(error: Error | null = null) {
    execFile.mockImplementation(
        (
            _file: string,
            _args: string[],
            _opts: object,
            cb: (err: Error | null) => void,
        ) => {
            cb(error);
        },
    );
}

describe("pushBranchToRemote", () => {
    beforeEach(() => {
        execFile.mockReset();
    });

    it("returns true when git push succeeds", async () => {
        mockExecFile();

        const result = await pushBranchToRemote("feature/my-branch");

        expect(result).toBe(true);
        expect(execFile).toHaveBeenCalledWith(
            "git",
            ["push", "-u", "origin", "feature/my-branch"],
            expect.objectContaining({ cwd: "/fake/workspace", windowsHide: true }),
            expect.any(Function),
        );
    });

    it("returns false when git push fails", async () => {
        mockExecFile(new Error("git push failed"));

        const result = await pushBranchToRemote("feature/my-branch");

        expect(result).toBe(false);
    });

    it("passes suspicious-looking branch names as a literal git argument", async () => {
        mockExecFile();
        const branch = "feature/demo;echo owned";

        await pushBranchToRemote(branch);

        expect(execFile).toHaveBeenCalledWith(
            "git",
            ["push", "-u", "origin", branch],
            expect.any(Object),
            expect.any(Function),
        );
    });
});
