/**
 * CRITICAL: Global Web Streams polyfill for Claude Desktop compatibility
 * This MUST be the very first import to ensure ReadableStream is available
 * across ALL modules including pnpm isolated dependencies like @langchain/core
 */
import "web-streams-polyfill/polyfill";

// Now safe to import modules that might trigger LangChain
import { config } from "dotenv";
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import { startMcpServer } from "@solana-agent-kit/adapter-mcp";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

// Add debug logging function
function debugLog(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.error(`[DEBUG ${timestamp}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): void {
  debugLog("Starting environment validation");
  
  const missingVars: string[] = [];
  const requiredVars = ["SOLANA_PRIVATE_KEY", "RPC_URL"];

  requiredVars.forEach((varName) => {
    const value = process.env[varName];
    debugLog(`Checking env var ${varName}`, { set: !!value, length: value?.length });
    if (!value) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    debugLog("Missing environment variables", { missing: missingVars });
    console.error("Error: Required environment variables are not set");
    missingVars.forEach((varName) => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }
  
  debugLog("Environment validation successful");
}

/**
 * Create and configure Solana Agent Kit with plugins
 */
async function createAgent(): Promise<SolanaAgentKit> {
  debugLog("Starting agent creation");
  
  // Validate and decode private key
  const privateKey = process.env.SOLANA_PRIVATE_KEY!;
  debugLog("Decoding private key", { keyLength: privateKey.length });
  
  const decodedPrivateKey = bs58.decode(privateKey);
  if (decodedPrivateKey.length !== 64) {
    throw new Error(`Invalid private key size: expected 64 bytes, got ${decodedPrivateKey.length} bytes`);
  }

  // Create keypair and wallet
  const keypair = Keypair.fromSecretKey(decodedPrivateKey);
  const keypairWallet = new KeypairWallet(keypair, process.env.RPC_URL!);
  
  debugLog("Wallet created", { 
    publicKey: keypair.publicKey.toBase58(),
    rpcUrl: process.env.RPC_URL 
  });

  // Initialize base agent
  let agent = new SolanaAgentKit(keypairWallet, keypairWallet.rpcUrl, {});
  debugLog("Base agent created", { actionsCount: agent.actions.length });

  // Load available plugins
  try {
    debugLog("Loading DeFi plugin");
    const pluginDeFi = await import("@solana-agent-kit/plugin-defi");
    agent = agent.use(pluginDeFi.default);
    debugLog("DeFi plugin loaded", { actionsCount: agent.actions.length });
  } catch (error: any) {
    debugLog("DeFi plugin not available", { error: error.message });
  }

  try {
    debugLog("Loading Token plugin");
    const pluginToken = await import("@solana-agent-kit/plugin-token");
    agent = agent.use(pluginToken.default);
    debugLog("Token plugin loaded", { actionsCount: agent.actions.length });
  } catch (error: any) {
    debugLog("Token plugin not available", { error: error.message });
  }

  // Check for STAKE_WITH_SOLAYER action specifically
  const solayerAction = agent.actions.find(action => action.name === "STAKE_WITH_SOLAYER");
  debugLog("STAKE_WITH_SOLAYER action check", { 
    found: !!solayerAction,
    allActions: agent.actions.map(a => a.name)
  });

  return agent;
}

/**
 * Main function to initialize and start the MCP server
 */
async function main(): Promise<void> {
  try {
    debugLog("Starting MCP server initialization");
    
    // Load environment variables
    config();
    debugLog("Environment loaded");

    // Validate environment
    validateEnvironment();

    // Create agent with plugins
    const agent = await createAgent();

    // Prepare actions for MCP server with result validation
    const actions: Record<string, any> = {};
    for (const action of agent.actions) {
      actions[action.name] = {
        ...action,
        handler: async (agentInstance: any, params: any) => {
          debugLog(`Executing action ${action.name}`, { params });
          
          try {
            const startTime = Date.now();
            const result = await action.handler(agentInstance, params);
            const executionTime = Date.now() - startTime;
            
            debugLog(`Action ${action.name} completed`, { 
              executionTime,
              resultType: typeof result,
              resultKeys: typeof result === 'object' ? Object.keys(result || {}) : undefined
            });
            
            // Ensure result is properly serializable
            let cleanResult = result;
            
            // If result is already a string, try to parse it as JSON
            if (typeof result === 'string') {
              try {
                cleanResult = JSON.parse(result);
                debugLog(`Parsed string result for ${action.name}`);
              } catch {
                // If it's not valid JSON, keep as string but wrap in object
                cleanResult = { message: result };
                debugLog(`Wrapped string result for ${action.name}`);
              }
            }
            
            // Validate that result can be serialized
            try {
              JSON.stringify(cleanResult);
              debugLog(`Result validation successful for ${action.name}`);
              return cleanResult;
            } catch (error: any) {
              debugLog(`Result serialization failed for ${action.name}`, { error: error.message });
              return {
                success: false,
                error: 'Result serialization failed',
                originalError: error.message
              };
            }
            
          } catch (error: any) {
            debugLog(`Action ${action.name} failed`, { 
              error: error.message,
              stack: error.stack?.split('\n').slice(0, 3)
            });
            
            return {
              success: false,
              error: error.message || 'Unknown error occurred',
              action: action.name
            };
          }
        }
      };
    }
    
    debugLog("Actions prepared for MCP", { 
      actionCount: Object.keys(actions).length,
      actionNames: Object.keys(actions)
    });

    // Start MCP server
    debugLog("Starting MCP server transport");
    await startMcpServer(actions, agent as any, { 
      name: "solana-agent", 
      version: "0.0.1" 
    });

    debugLog("MCP server started successfully");
    console.log("MCP server started successfully");
  } catch (error: any) {
    debugLog("MCP server startup failed", { 
      error: error.message, 
      stack: error.stack 
    });
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
}

// Add process event listeners for debugging
process.on('uncaughtException', (error) => {
  debugLog("Uncaught exception", { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  debugLog("Unhandled rejection", { reason, promise });
  process.exit(1);
});

// Start the application
debugLog("Starting MCP server process", { 
  nodeVersion: process.version,
  cwd: process.cwd(),
  argv: process.argv
});

main().catch((error) => {
  debugLog("Fatal error in main", { error: error.message, stack: error.stack });
  console.error("Fatal error:", error);
  process.exit(1);
});
