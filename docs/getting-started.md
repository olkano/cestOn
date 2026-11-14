# Start using cestOn

Start with the desktop demo to learn the workflow. It uses simulated workers and disposable projects. Real Codex/Claude work requires the provider setup described below.

## Start the demo

Open a normal PowerShell terminal in your `cestOn` repository folder. Use the Node version in `.node-version` and npm 11.

```powershell
npm run dev
```

If dependencies are missing, run these commands once, then retry:

```powershell
npm ci --ignore-scripts
node scripts/check-native.mjs
```

1. Keep the terminal open and visit **http://127.0.0.1:4317** on this computer.
2. Copy the pairing code printed in the terminal. It expires after ten minutes and works once.
3. Enter the code, give this browser a device name, and select **Connect device**.

Stop with **Ctrl+C** in the terminal and allow cleanup to finish. The demo's task data is removed; restarting creates a new installation and pairing code. Use it for practice rather than work you need to keep.

## Try your first task

1. Open **Work**, then **New task**.
2. Choose **Synthetic workspace**. Enter a title such as `My first task` and a desired outcome such as `Create a short result that I can review`.
3. Keep the default allowed operations and **Ask me to review the verified result**. Select **Create task**.
4. Watch **Phases and verification**. When the task is ready for review, open its **Evidence** and select **Inspect changes** or download the artifact.
5. Select **Accept verified outcome** to finish the task.

The demo returns a predefined synthetic artifact. It lets you practise creating, tracking and reviewing a task; it does not send your request to a real model.

## Find and control your work

| Screen or control | Use it to |
|---|---|
| **Today** | See running work, blockers and results ready for review. |
| **Work** | Create tasks, search and filter them, or inspect a task's history. |
| **Needs me** | Find decisions, blocked tasks and review requests. Open the task before answering. |
| **Assistant** | Ask for a workspace briefing. Open a task and use **Direct this task** for an instruction about that task. |
| **Settings** | Change dispatch state, inspect projects/providers and revoke paired devices. Change the theme with **Appearance**. |
| **Pause task / Resume task** | Pause or resume one task. Check its status to confirm the change. |
| **Pause all dispatch** | Prevent new phases and request active work to pause. Wait for task status to confirm acknowledgement. |

**Command: succeeded** confirms that a command was handled. Check the task's evidence and outcome before treating the work as complete. If the host disconnects, drafts remain unsent; reconnect and review the current state before sending.

## Use your own projects and phone

For work you want to retain, follow [owner installation setup](setup.md) to create a verified bundle and initialize a separate data folder. Register your projects and verification commands, then configure dedicated authenticated Codex/Claude profiles and complete [provider certification](provider-compatibility.md). Native sandbox setup and live certification remain prerequisites for real execution.

Once initialized, use [local operation and recovery](operations.md) for start, device pairing, status, backup and stop commands. A normal start does not enable automatic startup. Keep the Windows host awake and connected while it works.

Phone access requires a configured HTTPS address; `127.0.0.1` on your phone points to the phone itself. After configuring access, pair the phone separately and follow [the device setup checks](device-test-card.md). Real voice, push delivery and physical phone installation still need their acceptance checks.

**Improve cestOn**, available from Settings or Assistant, requires an installed supervisor and certified coding profiles. The desktop demo can record a request but does not apply an application update.
