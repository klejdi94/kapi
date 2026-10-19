import { setScriptSandbox } from '@/lib/scripting';
import { nodeSandbox } from '@/lib/scripting/nodeSandbox';

// The app registers a Web Worker sandbox at startup; tests (like the CLI and
// MCP server) run scripts through the vm-based one.
setScriptSandbox(nodeSandbox);
