/**
 * VS Code extension (step 7): one webview tab per working folder, showing the office of
 * that folder. It opens by itself beside the editor when a window with a folder starts
 * (`pixelOffice.autoOpen`), and the command "Pixel Office: 사무실 열기" opens it again.
 *
 * The extension runs on the local (UI) side, next to the server the agents' hooks talk to.
 * In a remote window the folder path is the remote path (for WSL `/home/...`), which the
 * office matches against the agents' `cwd` (see `normalizePath` in core).
 */
import { dirname, join } from "node:path";

import * as vscode from "vscode";

import { ensureServer, loadCore, messageHtml, officeHtml, spawnServer } from "./office";

const panels = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("pixelOffice.open", () => openCommand()));
  const first = vscode.workspace.workspaceFolders?.[0];
  if (first && vscode.workspace.getConfiguration("pixelOffice").get<boolean>("autoOpen", true)) {
    void open(first, true);
  }
}

export function deactivate(): void {
  // The server is shared with other windows and the hooks; it stays up.
}

async function openCommand(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage("Pixel Office: 열린 작업 폴더가 없습니다. 폴더를 연 뒤 다시 실행하세요.");
    return;
  }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: "사무실을 볼 작업 폴더" });
  if (folder) {
    await open(folder, false);
  }
}

/** The folder as the agents see it: a local path, or the path inside a remote (WSL) machine. */
function folderPath(folder: vscode.WorkspaceFolder): string {
  return folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path;
}

async function open(folder: vscode.WorkspaceFolder, background: boolean): Promise<void> {
  const workspace = folderPath(folder);
  const existing = panels.get(workspace);
  if (existing) {
    existing.reveal(undefined, background);
    return;
  }
  const title = `Pixel Office · ${folder.name}`;
  const panel = vscode.window.createWebviewPanel(
    "pixelOffice",
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: background },
    // Scripts must be allowed for the iframe's page to run; this page's own policy has no script-src.
    { enableScripts: true, retainContextWhenHidden: false },
  );
  panels.set(workspace, panel);
  panel.onDidDispose(() => panels.delete(workspace));
  // A hidden webview is thrown away; when it shows again, make sure the server still runs.
  panel.onDidChangeViewState((event) => {
    if (event.webviewPanel.visible) {
      void render(panel, workspace, title);
    }
  });
  await render(panel, workspace, title);
}

async function render(panel: vscode.WebviewPanel, workspace: string, title: string): Promise<void> {
  try {
    const { core, home } = await loadCore();
    const cliPath = join(dirname(require.resolve("@pixel-office/cli/package.json")), "dist", "src", "cli.js");
    const homeDir = home.homeDir();
    if (home.readServerInfo(homeDir) === null) {
      panel.webview.html = messageHtml("Pixel Office 서버를 시작하는 중…");
    }
    const { port } = await ensureServer({
      home: homeDir,
      homeModule: home,
      start: () => spawnServer(process.execPath, cliPath),
    });
    const local = vscode.Uri.parse(core.officeUrl(port, workspace));
    const external = await vscode.env.asExternalUri(local);
    panel.webview.html = officeHtml(external.toString(), title);
  } catch (error) {
    panel.webview.html = messageHtml((error as Error).message);
  }
}
