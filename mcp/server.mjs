import { AutoBrowser } from '../api/index.mjs';

const ab = new AutoBrowser();

// MCP Server implementation
// This is a simple stdio-based MCP server

const tools = {
  'auto-browser-map': {
    description: 'Build a page element map from a URL. Extracts all interactive elements with 7-layer detection.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to map' },
        compress: { type: 'boolean', description: 'Compress the map (remove duplicates)', default: true },
        visualize: { type: 'boolean', description: 'Inject visual overlay with numbered boxes', default: false }
      },
      required: ['url']
    }
  },
  'auto-browser-detect': {
    description: 'Detect UI framework used by a website (Element Plus, Ant Design, MUI)',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to detect' }
      },
      required: ['url']
    }
  },
  'auto-browser-cache-list': {
    description: 'List all cached page maps',
    inputSchema: { type: 'object', properties: {} }
  },
  'auto-browser-cache-clear': {
    description: 'Clear all cached page maps and scripts',
    inputSchema: { type: 'object', properties: {} }
  }
};

async function handleRequest(request) {
  const { method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'auto-browser', version: '1.0.0' }
      };

    case 'tools/list':
      return { tools };

    case 'tools/call': {
      const { name, arguments: args } = params;
      
      switch (name) {
        case 'auto-browser-map': {
          await ab.connect();
          await ab.navigate(args.url);
          const map = await ab.buildMap({ compress: args.compress !== false });
          const framework = await ab.detectFramework();
          
          if (args.visualize) {
            await ab.injectOverlay(map.elements);
          }
          
          await ab.disconnect();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                url: map.url,
                title: map.title,
                framework: framework.detected,
                elementCount: map.elements.length,
                elements: map.elements.slice(0, 50) // Limit output
              }, null, 2)
            }]
          };
        }

        case 'auto-browser-detect': {
          await ab.connect();
          await ab.navigate(args.url);
          const framework = await ab.detectFramework();
          await ab.disconnect();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(framework, null, 2)
            }]
          };
        }

        case 'auto-browser-cache-list': {
          const cache = ab.getCache();
          const entries = cache.list();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(entries, null, 2)
            }]
          };
        }

        case 'auto-browser-cache-clear': {
          const cache = ab.getCache();
          cache.clear();
          return {
            content: [{ type: 'text', text: 'Cache cleared' }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Stdio transport
async function main() {
  console.error('[MCP] auto-browser server starting...');
  
  process.stdin.setEncoding('utf-8');
  let buffer = '';

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    
    // Try to parse JSON-RPC messages
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const request = JSON.parse(line);
        const response = await handleRequest(request);
        
        const responseStr = JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: response
        });
        
        process.stdout.write(responseStr + '\n');
      } catch (e) {
        console.error('[MCP] Error:', e.message);
      }
    }
  });

  process.stdin.on('end', () => {
    console.error('[MCP] Server shutting down...');
    process.exit(0);
  });
}

main().catch(e => {
  console.error('[MCP] Fatal:', e.message);
  process.exit(1);
});
